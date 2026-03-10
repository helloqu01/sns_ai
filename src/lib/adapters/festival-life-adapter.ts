import { FestivalAdapter } from "./festival-adapter";
import { FestivalDetailSection, UnifiedFestival } from "@/types/festival";

type ListingSource = {
    path: string;
    genre: string;
};

type DetailFieldDefinition = {
    label: string;
    labels: string[];
};

export class FestivalLifeAdapter extends FestivalAdapter {
    sourceName = "FESTIVAL_LIFE" as const;
    private baseUrl = "https://festivallife.kr";
    private listingSources: ListingSource[] = [
        { path: "/concert", genre: "콘서트" },
        { path: "/festival", genre: "축제" },
        { path: "/concert_k", genre: "K-공연" },
        { path: "/festival_o", genre: "해외축제" },
        { path: "/gigs", genre: "기타" },
    ];
    private maxPagesPerSource = 8;
    private requestDelayMs = 140;
    private maxRetries = 3;
    private knownDetailIdsByPath: Map<string, Set<string>> | null = null;
    private detailFieldDefinitions: DetailFieldDefinition[] = [
        { label: "일정", labels: ["개최 일정", "공연 일정", "행사 일정", "페스티벌 일정", "일정", "공연 일시", "행사 일시", "dates"] },
        { label: "장소", labels: ["개최 장소", "공연 장소", "행사 장소", "페스티벌 장소", "장소", "venue", "location"] },
        { label: "라인업", labels: ["라인업", "출연진", "아티스트", "artist", "line up", "lineup"] },
        { label: "티켓 가격", labels: ["티켓 가격", "티켓가격", "가격", "price", "tickets"] },
        { label: "예매처", labels: ["예매처", "예매", "티켓 예매", "예약", "booking"] },
        { label: "문의", labels: ["문의처", "연락처", "문의", "contact", "전화"] },
        { label: "홈페이지", labels: ["공식 홈페이지", "공식 사이트", "홈페이지", "website", "url"] },
        { label: "주최", labels: ["주최", "host"] },
        { label: "주관", labels: ["주관", "organizer"] },
        { label: "관람등급", labels: ["관람등급", "관람 등급", "연령", "age"] },
        { label: "러닝타임", labels: ["러닝타임", "running time"] },
        { label: "오픈일", labels: ["티켓 오픈", "예매 오픈", "오픈일", "오픈", "ticket open", "on sale"] },
    ];

    setKnownDetailIdsByPath(map: Map<string, Set<string>> | null) {
        this.knownDetailIdsByPath = map;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async fetchWithRetry(url: string): Promise<Response> {
        let attempt = 0;
        let lastError: unknown;

        while (attempt <= this.maxRetries) {
            try {
                const response = await fetch(url, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    }
                });

                if (response.ok) return response;

                // Retry only for temporary failures / rate limits.
                if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.maxRetries) {
                    throw new Error(`Failed to fetch ${url}: ${response.status}`);
                }

                const backoffMs = this.requestDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 120);
                await this.sleep(backoffMs);
            } catch (error) {
                lastError = error;
                if (attempt === this.maxRetries) break;
                const backoffMs = this.requestDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 120);
                await this.sleep(backoffMs);
            }

            attempt += 1;
        }

        throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
    }

    private async fetchHtml(url: string): Promise<string> {
        const response = await this.fetchWithRetry(url);
        await this.sleep(this.requestDelayMs);
        return await response.text();
    }

    private extractMetaContent(html: string, attr: "property" | "name", key: string): string | null {
        const pattern = new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
        const matched = html.match(pattern);
        return matched ? matched[1].replace(/\\/g, "") : null;
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    private extractLabeledSection(sourceText: string, labels: string[], stopLabels: string[]): string | null {
        const plainText = this.stripTags(sourceText).replace(/\s+/g, " ").trim();
        if (!plainText) return null;

        const labelPattern = labels.map((label) => this.escapeRegExp(label)).join("|");
        const stopPattern = stopLabels.map((label) => this.escapeRegExp(label)).join("|");
        const delimiterPattern = "(?:[:：]|\\||-)";
        const lookahead = stopPattern
            ? `(?=(?:${stopPattern})\\s*${delimiterPattern}|$)`
            : "$";
        const pattern = new RegExp(
            `(?:${labelPattern})\\s*${delimiterPattern}\\s*([\\s\\S]{1,220}?)${lookahead}`,
            "i",
        );
        const matched = plainText.match(pattern);
        return matched?.[1]?.trim() || null;
    }

    private extractDetailBodyHtml(detailHtml: string): string {
        const primaryStartPattern = /<div[^>]*class=["'][^"']*(?:board_txt_area|show_body|board_contents|post_view)[^"']*["'][^>]*>/i;
        const primaryStartMatch = primaryStartPattern.exec(detailHtml);
        if (primaryStartMatch?.index !== undefined) {
            const startIndex = primaryStartMatch.index;
            const tail = detailHtml.slice(startIndex);
            const tailEndPattern = /<div[^>]*class=["'][^"']*(?:board_view_btn|comment_area|board_prev_next|reply_area|comment_list|view_footer)[^"']*["'][^>]*>/i;
            const tailEndMatch = tailEndPattern.exec(tail);
            if (tailEndMatch?.index !== undefined && tailEndMatch.index > 0) {
                return tail.slice(0, tailEndMatch.index);
            }
            return tail.slice(0, 24_000);
        }

        const fallbackPatterns = [
            /<article[^>]*>([\s\S]*?)<\/article>/i,
            /<main[^>]*>([\s\S]*?)<\/main>/i,
        ];

        for (const pattern of fallbackPatterns) {
            const matched = detailHtml.match(pattern);
            if (matched && matched[1]) return matched[1];
        }

        return detailHtml;
    }

    private extractLocation(detailHtml: string, bodyHtml: string): string {
        const labeledValue = this.extractValueByLabels(
            detailHtml,
            bodyHtml,
            ["개최 장소", "공연 장소", "행사 장소", "페스티벌 장소", "장소", "venue", "location"],
            ["개최 일정", "공연 일정", "행사 일정", "일정", "dates", "venue", "티켓 가격", "가격", "티켓", "예매", "문의", "홈페이지", "라인업"],
        );
        if (labeledValue) {
            return labeledValue;
        }

        const patterns = [
            /개최\s*장소\s*(?:[:：]|\|)\s*([^<\r\n]+)/i,
            /공연\s*장소\s*(?:[:：]|\|)\s*([^<\r\n]+)/i,
            /장소\s*(?:[:：]|\|)\s*([^<\r\n]+)/i,
            /venue\s*(?:[:：]|\|)\s*([^<\r\n]+)/i,
            /location\s*(?:[:：]|\|)\s*([^<\r\n]+)/i,
        ];

        for (const pattern of patterns) {
            const inBody = bodyHtml.match(pattern);
            if (inBody?.[1]) return this.stripTags(inBody[1]).trim();
        }

        const plain = this.stripTags(bodyHtml || detailHtml);
        for (const pattern of patterns) {
            const inPlain = plain.match(pattern);
            if (inPlain?.[1]) return this.stripTags(inPlain[1]).trim();
        }

        return "";
    }

    private extractImageUrl(detailHtml: string, bodyHtml: string): string {
        const ogImage = this.extractMetaContent(detailHtml, "property", "og:image");
        if (ogImage) return ogImage;

        const imgRegex = /<img[^>]*src="([^"]+)"/gi;
        let imgMatch: RegExpExecArray | null;

        while ((imgMatch = imgRegex.exec(bodyHtml)) !== null) {
            const url = imgMatch[1].replace(/\\/g, "");
            if (!url.includes("cdn.imweb.me")) continue;
            if (url.includes("icon") || url.includes("bg_")) continue;
            return url;
        }

        while ((imgMatch = imgRegex.exec(detailHtml)) !== null) {
            const url = imgMatch[1].replace(/\\/g, "");
            if (!url.includes("cdn.imweb.me")) continue;
            if (url.includes("icon") || url.includes("bg_")) continue;
            return url;
        }

        return "";
    }

    private stripTags(html: string, maxLength = 2000): string {
        if (!html) return "";
        let cleaned = html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim();

        cleaned = cleaned.replace(/LOCALIZE\.[a-zA-Z가-힣_0-9]+(\([^)]*\))?/g, "");
        cleaned = cleaned.replace(/CONV_ARGUMENTS\.[a-zA-Z_0-9]+/g, "");
        cleaned = cleaned.replace(/\{\{.*?\}\}/g, "");

        if (maxLength > 0 && cleaned.length > maxLength) return cleaned.substring(0, maxLength);
        return cleaned.trim();
    }

    private extractValueByLabels(
        detailHtml: string,
        bodyHtml: string,
        labels: string[],
        stopLabels: string[],
    ): string {
        const metaDescription = this.extractMetaContent(detailHtml, "name", "description")
            || this.extractMetaContent(detailHtml, "property", "og:description")
            || "";

        const candidates = [
            this.extractLabeledSection(metaDescription, labels, stopLabels),
            this.extractLabeledSection(bodyHtml, labels, stopLabels),
            this.extractLabeledSection(detailHtml, labels, stopLabels),
        ];

        for (const candidate of candidates) {
            if (candidate) {
                return this.stripTags(candidate).trim();
            }
        }

        return "";
    }

    private getDefaultDetailStopLabels(excludedLabels: string[] = []): string[] {
        const allLabels = this.detailFieldDefinitions.flatMap((field) => field.labels);
        const excluded = new Set(excludedLabels.map((label) => label.toLowerCase()));
        return allLabels.filter((label) => !excluded.has(label.toLowerCase()));
    }

    private extractStructuredDetails(detailHtml: string, bodyHtml: string): FestivalDetailSection[] {
        const details: FestivalDetailSection[] = [];
        const seenLabels = new Set<string>();
        const seenValues = new Set<string>();

        for (const field of this.detailFieldDefinitions) {
            const value = this.extractValueByLabels(
                detailHtml,
                bodyHtml,
                field.labels,
                this.getDefaultDetailStopLabels(field.labels),
            );
            const normalizedValue = value.trim();
            if (!normalizedValue) continue;

            const valueKey = normalizedValue.toLowerCase();
            if (seenLabels.has(field.label) || seenValues.has(valueKey)) {
                continue;
            }

            seenLabels.add(field.label);
            seenValues.add(valueKey);
            details.push({
                label: field.label,
                value: normalizedValue,
            });
        }

        return details;
    }

    private getDetailValue(details: FestivalDetailSection[], label: string): string {
        return details.find((detail) => detail.label === label)?.value || "";
    }

    private extractPrice(detailHtml: string, bodyHtml: string): string {
        return this.extractValueByLabels(
            detailHtml,
            bodyHtml,
            ["티켓 가격", "티켓가격", "가격", "price", "tickets"],
            ["티켓 오픈", "예매 오픈", "오픈일", "오픈", "on sale", "티켓 예매", "예매", "예약", "booking", "문의", "연락처", "홈페이지", "공연 장소", "행사 장소", "장소", "공연 일정", "행사 일정", "일정", "dates", "venue"],
        );
    }

    private extractContact(detailHtml: string, bodyHtml: string): string {
        const labeledValue = this.extractValueByLabels(
            detailHtml,
            bodyHtml,
            ["문의처", "연락처", "문의", "contact", "전화"],
            ["홈페이지", "공연 장소", "행사 장소", "장소", "공연 일정", "행사 일정", "일정", "티켓", "예매"],
        );
        if (labeledValue) {
            return labeledValue;
        }

        const plainText = this.stripTags(bodyHtml, 12000);
        const emailMatch = plainText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (emailMatch?.[0]) {
            return emailMatch[0].trim();
        }

        const phoneMatch = plainText.match(/(?:\+?\d{1,3}[-\s]?)?(0\d{1,2})[-\s]?\d{3,4}[-\s]?\d{4}/);
        return phoneMatch?.[0]?.trim() || "";
    }

    private normalizeExtractedUrl(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return "";

        const directUrl = trimmed.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
        if (directUrl) {
            return directUrl;
        }

        const bareDomain = trimmed.match(/(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s"'<>]*)?/i)?.[0];
        if (!bareDomain) return "";

        return bareDomain.startsWith("http") ? bareDomain : `https://${bareDomain}`;
    }

    private extractHomepage(detailHtml: string, bodyHtml: string): string {
        const labeledValue = this.extractValueByLabels(
            detailHtml,
            bodyHtml,
            ["공식 홈페이지", "공식 사이트", "홈페이지", "website", "url"],
            ["문의", "연락처", "공연 장소", "행사 장소", "장소", "공연 일정", "행사 일정", "일정", "티켓", "예매"],
        );
        const normalizedLabeledValue = this.normalizeExtractedUrl(labeledValue);
        if (normalizedLabeledValue) {
            return normalizedLabeledValue;
        }

        const hrefRegex = /<a[^>]*href="([^"]+)"/gi;
        let match: RegExpExecArray | null;
        while ((match = hrefRegex.exec(bodyHtml)) !== null) {
            const href = match[1].trim();
            if (!href.startsWith("http")) continue;
            if (href.includes("festivallife.kr")) continue;
            return href;
        }

        return "";
    }

    private extractDescription(bodyHtml: string): string {
        return this.stripTags(bodyHtml, 12000);
    }

    private formatDate(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    private formatDateInKst(date: Date): string {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
        }).format(date);
    }

    private createDate(year: number, month: number, day: number): Date | null {
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    private parsePublishedTimestamp(rawValue: string | null): { publishedAt: string; publishedDate: string } | null {
        if (!rawValue) return null;

        const parsed = new Date(rawValue);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                publishedAt: parsed.toISOString(),
                publishedDate: this.formatDateInKst(parsed),
            };
        }

        const dateOnlyMatch = rawValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateOnlyMatch) return null;

        const normalizedDate = `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
        return {
            publishedAt: `${normalizedDate}T00:00:00+09:00`,
            publishedDate: normalizedDate,
        };
    }

    private extractPublishedInfo(detailHtml: string): { publishedAt: string; publishedDate: string } | null {
        const metaPublished = this.extractMetaContent(detailHtml, "property", "article:published_time");
        const metaResult = this.parsePublishedTimestamp(metaPublished);
        if (metaResult) return metaResult;

        const jsonLdMatch = detailHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i);
        const jsonLdResult = this.parsePublishedTimestamp(jsonLdMatch?.[1] ?? null);
        if (jsonLdResult) return jsonLdResult;

        return null;
    }

    private extractDateRangeFromText(
        text: string,
        fallbackYear?: number,
    ): { startDate: string; endDate: string } | null {
        const normalized = this.stripTags(text).replace(/\s+/g, " ").trim();
        if (!normalized) return null;

        const sameMonthKoreanRange = normalized.match(
            /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})\s*(?:일)?\s*[~\-–]\s*(\d{1,2})일/i,
        );
        if (sameMonthKoreanRange) {
            const startDate = this.createDate(
                Number(sameMonthKoreanRange[1]),
                Number(sameMonthKoreanRange[2]),
                Number(sameMonthKoreanRange[3]),
            );
            const endDate = this.createDate(
                Number(sameMonthKoreanRange[1]),
                Number(sameMonthKoreanRange[2]),
                Number(sameMonthKoreanRange[4]),
            );
            if (startDate && endDate) {
                return {
                    startDate: this.formatDate(startDate),
                    endDate: this.formatDate(endDate),
                };
            }
        }

        const crossMonthKoreanRange = normalized.match(
            /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})\s*(?:일)?\s*[~\-–]\s*(\d{1,2})월\s*(\d{1,2})일/i,
        );
        if (crossMonthKoreanRange) {
            const startDate = this.createDate(
                Number(crossMonthKoreanRange[1]),
                Number(crossMonthKoreanRange[2]),
                Number(crossMonthKoreanRange[3]),
            );
            const endDate = this.createDate(
                Number(crossMonthKoreanRange[1]),
                Number(crossMonthKoreanRange[4]),
                Number(crossMonthKoreanRange[5]),
            );
            if (startDate && endDate) {
                return {
                    startDate: this.formatDate(startDate),
                    endDate: this.formatDate(endDate),
                };
            }
        }

        const sameMonthNumericRange = normalized.match(
            /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*[~\-–]\s*(\d{1,2})(?!\d)/i,
        );
        if (sameMonthNumericRange) {
            const startDate = this.createDate(
                Number(sameMonthNumericRange[1]),
                Number(sameMonthNumericRange[2]),
                Number(sameMonthNumericRange[3]),
            );
            const endDate = this.createDate(
                Number(sameMonthNumericRange[1]),
                Number(sameMonthNumericRange[2]),
                Number(sameMonthNumericRange[4]),
            );
            if (startDate && endDate) {
                return {
                    startDate: this.formatDate(startDate),
                    endDate: this.formatDate(endDate),
                };
            }
        }

        if (fallbackYear && Number.isFinite(fallbackYear)) {
            const sameMonthRangeNoYear = normalized.match(
                /(\d{1,2})월\s*(\d{1,2})\s*(?:일)?\s*[~\-–]\s*(\d{1,2})일/i,
            );
            if (sameMonthRangeNoYear) {
                const startDate = this.createDate(
                    fallbackYear,
                    Number(sameMonthRangeNoYear[1]),
                    Number(sameMonthRangeNoYear[2]),
                );
                const endDate = this.createDate(
                    fallbackYear,
                    Number(sameMonthRangeNoYear[1]),
                    Number(sameMonthRangeNoYear[3]),
                );
                if (startDate && endDate) {
                    return {
                        startDate: this.formatDate(startDate),
                        endDate: this.formatDate(endDate),
                    };
                }
            }

            const crossMonthRangeNoYear = normalized.match(
                /(\d{1,2})월\s*(\d{1,2})\s*(?:일)?\s*[~\-–]\s*(\d{1,2})월\s*(\d{1,2})일/i,
            );
            if (crossMonthRangeNoYear) {
                const startDate = this.createDate(
                    fallbackYear,
                    Number(crossMonthRangeNoYear[1]),
                    Number(crossMonthRangeNoYear[2]),
                );
                const endDate = this.createDate(
                    fallbackYear,
                    Number(crossMonthRangeNoYear[3]),
                    Number(crossMonthRangeNoYear[4]),
                );
                if (startDate && endDate) {
                    return {
                        startDate: this.formatDate(startDate),
                        endDate: this.formatDate(endDate),
                    };
                }
            }
        }

        const dates: Date[] = [];

        const numeric = [...normalized.matchAll(/(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/g)];
        for (const match of numeric) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (!Number.isNaN(date.getTime())) dates.push(date);
        }

        const korean = [...normalized.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)];
        for (const match of korean) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (!Number.isNaN(date.getTime())) dates.push(date);
        }

        if (dates.length === 0) return null;

        dates.sort((a, b) => a.getTime() - b.getTime());
        return {
            startDate: this.formatDate(dates[0]),
            endDate: this.formatDate(dates[dates.length - 1]),
        };
    }

    private extractEventDateRange(
        detailHtml: string,
        bodyHtml: string,
        fallbackYear?: number,
    ): { startDate: string; endDate: string } | null {
        const metaDescription = this.extractMetaContent(detailHtml, "name", "description")
            || this.extractMetaContent(detailHtml, "property", "og:description")
            || "";
        const scheduleLabels = ["개최 일정", "공연 일정", "행사 일정", "페스티벌 일정", "일정", "공연 일시", "행사 일시", "dates"];
        const stopLabels = ["개최 장소", "공연 장소", "행사 장소", "장소", "venue", "location", "티켓 가격", "가격", "티켓", "예매", "문의", "라인업", "홈페이지"];

        const candidates = [
            this.extractLabeledSection(metaDescription, scheduleLabels, stopLabels),
            this.extractLabeledSection(bodyHtml, scheduleLabels, stopLabels),
            metaDescription,
            this.stripTags(bodyHtml),
        ];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const parsed = this.extractDateRangeFromText(candidate, fallbackYear);
            if (parsed) {
                return parsed;
            }
        }

        return null;
    }

    private extractFallbackDateFromMeta(detailHtml: string): { startDate: string; endDate: string } | null {
        const publishedInfo = this.extractPublishedInfo(detailHtml);
        if (!publishedInfo) return null;

        return {
            startDate: publishedInfo.publishedDate,
            endDate: publishedInfo.publishedDate,
        };
    }

    private extractDetailLinks(listHtml: string, sectionPath: string): string[] {
        const hrefRegex = /href="([^"]+)"/g;
        const links = new Set<string>();
        let match: RegExpExecArray | null;

        while ((match = hrefRegex.exec(listHtml)) !== null) {
            const href = match[1];
            if (!href.includes(`${sectionPath}/`) || !href.includes("bmode=view") || !href.includes("idx=")) {
                continue;
            }

            try {
                const absolute = new URL(href, this.baseUrl);
                if (absolute.pathname !== `${sectionPath}/`) continue;
                const idx = absolute.searchParams.get("idx");
                if (!idx) continue;
                links.add(absolute.toString());
            } catch {
                // ignore invalid URLs
            }
        }

        return Array.from(links);
    }

    private buildListingPageUrl(path: string, page: number): string {
        if (page <= 1) return `${this.baseUrl}${path}`;
        return `${this.baseUrl}${path}?page=${page}`;
    }

    private decodeXmlEntities(text: string): string {
        return text
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'");
    }

    private parseDateFromRssPubDate(pubDate: string): { publishedAt: string; publishedDate: string } {
        const d = new Date(pubDate);
        if (Number.isNaN(d.getTime())) {
            const now = new Date();
            return {
                publishedAt: now.toISOString(),
                publishedDate: this.formatDateInKst(now),
            };
        }

        return {
            publishedAt: d.toISOString(),
            publishedDate: this.formatDateInKst(d),
        };
    }

    private getGenreByPath(path: string): string {
        const found = this.listingSources.find((source) => source.path === path);
        return found?.genre ?? "기타";
    }

    private async fetchFromRssFallback(limit = 120): Promise<UnifiedFestival[]> {
        const rssXml = await this.fetchHtml(`${this.baseUrl}/rss`);
        const itemBlocks = Array.from(rssXml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, limit);
        const items: UnifiedFestival[] = [];
        const seen = new Set<string>();

        for (const itemMatch of itemBlocks) {
            const block = itemMatch[1];
            const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
            const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
            const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const imageMatch = block.match(/<media:content[^>]*url="([^"]+)"/i);

            if (!linkMatch?.[1] || !titleMatch?.[1]) continue;

            const sourceUrl = this.decodeXmlEntities(linkMatch[1].trim());
            if (!sourceUrl.includes("bmode=view") || !sourceUrl.includes("idx=")) continue;

            let parsedUrl: URL;
            try {
                parsedUrl = new URL(sourceUrl);
            } catch {
                continue;
            }

            const path = parsedUrl.pathname.replace(/\/$/, "");
            if (!["/concert", "/festival", "/concert_k", "/festival_o", "/gigs"].includes(path)) continue;

            const idx = parsedUrl.searchParams.get("idx");
            if (!idx) continue;

            const id = `fl-rss-${path.replace("/", "")}-${idx}`;
            if (seen.has(id)) continue;

            const title = this.stripTags(this.decodeXmlEntities(titleMatch[1])).trim();
            if (!title) continue;

            const publishedInfo = pubDateMatch?.[1]
                ? this.parseDateFromRssPubDate(this.decodeXmlEntities(pubDateMatch[1].trim()))
                : {
                    publishedAt: new Date().toISOString(),
                    publishedDate: this.formatDateInKst(new Date()),
                };

            seen.add(id);
            items.push({
                id,
                title,
                location: "상세 정보 참조",
                startDate: publishedInfo.publishedDate,
                endDate: publishedInfo.publishedDate,
                publishedAt: publishedInfo.publishedAt,
                publishedDate: publishedInfo.publishedDate,
                imageUrl: imageMatch?.[1] ? this.decodeXmlEntities(imageMatch[1]) : "",
                source: "FESTIVAL_LIFE",
                sourceLabel: "페스티벌 라이프",
                sourceUrl,
                genre: this.getGenreByPath(path),
            });
        }

        return items;
    }

    private async fetchAllListingLinks(path: string): Promise<string[]> {
        const allLinks = new Set<string>();
        const knownSet = this.knownDetailIdsByPath?.get(path);
        const hasKnown = !!knownSet && knownSet.size > 0;
        let consecutiveNoNewPages = 0;
        let consecutiveAllKnownPages = 0;

        for (let page = 1; page <= this.maxPagesPerSource; page++) {
            const html = await this.fetchHtml(this.buildListingPageUrl(path, page));
            const pageLinks = this.extractDetailLinks(html, path);

            if (pageLinks.length === 0) {
                break;
            }

            let addedCount = 0;
            let unknownCount = 0;
            for (const link of pageLinks) {
                if (hasKnown) {
                    const idx = new URL(link).searchParams.get("idx");
                    if (idx && knownSet?.has(idx)) {
                        continue;
                    }
                }

                if (!allLinks.has(link)) {
                    allLinks.add(link);
                    addedCount += 1;
                }
                unknownCount += 1;
            }

            if (addedCount === 0) {
                consecutiveNoNewPages += 1;
                if (consecutiveNoNewPages >= 2) break;
            } else {
                consecutiveNoNewPages = 0;
            }

            if (hasKnown) {
                if (unknownCount === 0) {
                    consecutiveAllKnownPages += 1;
                    if (consecutiveAllKnownPages >= 1) break;
                } else {
                    consecutiveAllKnownPages = 0;
                }
            }
        }

        return Array.from(allLinks);
    }

    async fetchFestivals(_stdate: string, _edate: string): Promise<UnifiedFestival[]> {
        try {
            void _stdate;
            void _edate;

            const listResults: Array<{ source: ListingSource; links: string[] }> = [];
            for (const source of this.listingSources) {
                try {
                    const links = await this.fetchAllListingLinks(source.path);
                    listResults.push({ source, links });
                } catch (error) {
                    console.error(`Error fetching FESTIVAL_LIFE list ${source.path}:`, error);
                    listResults.push({ source, links: [] });
                }
            }

            const totalListingLinks = listResults.reduce((acc, current) => acc + current.links.length, 0);
            if (totalListingLinks === 0) {
                console.warn("FESTIVAL_LIFE listing crawl returned no links. Falling back to RSS.");
                return await this.fetchFromRssFallback();
            }

            const items: UnifiedFestival[] = [];
            const seen = new Set<string>();

            for (const { source, links } of listResults) {
                for (const detailUrl of links) {
                    const detailId = new URL(detailUrl).searchParams.get("idx");
                    if (!detailId) continue;

                    const uniqueId = `fl-${source.path.replace("/", "")}-${detailId}`;
                    if (seen.has(uniqueId)) continue;

                    try {
                        const detailHtml = await this.fetchHtml(detailUrl);
                        if (detailHtml.includes("존재 하지 않는 게시물")) continue;

                        const bodyHtml = this.extractDetailBodyHtml(detailHtml);
                        const detailText = this.stripTags(detailHtml);
                        const publishedInfo = this.extractPublishedInfo(detailHtml);
                        const rawTitle = this.extractMetaContent(detailHtml, "property", "og:title")
                            || this.extractMetaContent(detailHtml, "name", "title")
                            || "";

                        const viewTitleMatch = detailHtml.match(/<h[1-6][^>]*class="[^"]*view_tit[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i);
                        const titleFromView = viewTitleMatch ? this.stripTags(viewTitleMatch[1]) : "";
                        const normalizedMetaTitle = this.stripTags(rawTitle).split(" : ")[0].trim();
                        const title = titleFromView || normalizedMetaTitle;
                        if (!title) continue;
                        const titleYearMatch = title.match(/(20\d{2})/);
                        const fallbackYear = titleYearMatch
                            ? Number(titleYearMatch[1])
                            : publishedInfo
                                ? new Date(publishedInfo.publishedAt).getFullYear()
                                : undefined;

                        const description = this.extractDescription(bodyHtml);
                        const details = this.extractStructuredDetails(detailHtml, bodyHtml);

                        const dateRange = this.extractEventDateRange(detailHtml, bodyHtml, fallbackYear)
                            || this.extractDateRangeFromText(detailText, fallbackYear)
                            || this.extractFallbackDateFromMeta(detailHtml);
                        if (!dateRange) continue;

                        const location = this.extractLocation(detailHtml, bodyHtml);
                        const lineup = this.getDetailValue(details, "라인업");
                        const price = this.extractPrice(detailHtml, bodyHtml);
                        const contact = this.extractContact(detailHtml, bodyHtml);
                        const homepage = this.extractHomepage(detailHtml, bodyHtml);
                        const imageUrl = this.extractImageUrl(detailHtml, bodyHtml);

                        seen.add(uniqueId);
                        items.push({
                            id: uniqueId,
                            title,
                            location: location || "상세 정보 참조",
                            startDate: dateRange.startDate,
                            endDate: dateRange.endDate,
                            publishedAt: publishedInfo?.publishedAt,
                            publishedDate: publishedInfo?.publishedDate,
                            description,
                            lineup,
                            price,
                            contact,
                            homepage,
                            details,
                            imageUrl,
                            source: "FESTIVAL_LIFE",
                            sourceLabel: "페스티벌 라이프",
                            sourceUrl: detailUrl,
                            genre: source.genre,
                        });
                    } catch (error) {
                        console.error(`Error fetching FESTIVAL_LIFE detail ${detailUrl}:`, error);
                    }
                }
            }

            if (items.length === 0) {
                console.warn("FESTIVAL_LIFE detail crawl returned no items. Falling back to RSS.");
                return await this.fetchFromRssFallback();
            }

            return items;
        } catch (error) {
            console.error("Error in FestivalLifeAdapter:", error);
            try {
                return await this.fetchFromRssFallback();
            } catch (fallbackError) {
                console.error("RSS fallback failed:", fallbackError);
                return [];
            }
        }
    }

    async fetchDetail(_id: string): Promise<Partial<UnifiedFestival>> {
        return {};
    }
}
