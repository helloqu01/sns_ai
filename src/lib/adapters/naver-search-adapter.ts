import { createHash } from "crypto";
import { FestivalAdapter } from "./festival-adapter";
import { FestivalDetailSection, UnifiedFestival } from "@/types/festival";

type NaverSearchType = "news" | "blog";

type NaverSearchItem = {
    title?: string;
    description?: string;
    link?: string;
    originallink?: string;
    pubDate?: string;
    postdate?: string;
};

type NaverSearchResponse = {
    items?: unknown;
};

type DateRange = {
    startDate: string;
    endDate: string;
};

const NAVER_MISSING_CREDENTIALS_FLAG = "__NAVER_SEARCH_MISSING_CREDENTIALS_WARNED__";

export class NaverSearchAdapter extends FestivalAdapter {
    sourceName = "WEB_CRAWL" as const;
    private baseUrl = process.env.NAVER_SEARCH_BASE_URL || "https://openapi.naver.com/v1/search";
    private clientId = process.env.NAVER_SEARCH_CLIENT_ID || process.env.NAVER_CLIENT_ID || process.env.NAVER_DATALAB_CLIENT_ID;
    private clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET || process.env.NAVER_DATALAB_CLIENT_SECRET;
    private requestDelayMs = Number.parseInt(process.env.NAVER_SEARCH_DELAY_MS || "140", 10);
    private maxRetries = Number.parseInt(process.env.NAVER_SEARCH_MAX_RETRIES || "2", 10);
    private display = Number.parseInt(process.env.NAVER_SEARCH_DISPLAY || "40", 10);
    private keywords = this.resolveKeywords();
    private searchTypes = this.resolveSearchTypes();
    constructor() {
        super();
        if (!this.hasCredentials()) {
            this.warnMissingCredentials();
        }
    }

    private resolveKeywords(): string[] {
        const raw = process.env.NAVER_SEARCH_KEYWORDS;
        if (typeof raw === "string" && raw.trim().length > 0) {
            const parsed = raw
                .split(",")
                .map((keyword) => keyword.trim())
                .filter(Boolean);
            if (parsed.length > 0) {
                return parsed.slice(0, 10);
            }
        }
        return [
            "뮤직 페스티벌 라인업",
            "락 페스티벌 티켓 오픈",
            "국내 페스티벌 일정",
            "내한공연 티켓 오픈",
            "축제 라인업 발표",
        ];
    }

    private resolveSearchTypes(): NaverSearchType[] {
        const raw = process.env.NAVER_SEARCH_TYPES;
        if (typeof raw !== "string" || raw.trim().length === 0) {
            return ["news", "blog"];
        }
        const parsed = raw
            .split(",")
            .map((type) => type.trim().toLowerCase())
            .filter((type): type is NaverSearchType => type === "news" || type === "blog");
        return parsed.length > 0 ? parsed : ["news", "blog"];
    }

    private hasCredentials() {
        return Boolean(this.clientId && this.clientSecret);
    }

    private warnMissingCredentials() {
        if (process.env[NAVER_MISSING_CREDENTIALS_FLAG] === "1") return;
        process.env[NAVER_MISSING_CREDENTIALS_FLAG] = "1";
        console.warn("⚠️ NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET is not configured.");
    }

    private normalizeDisplayCount() {
        if (!Number.isFinite(this.display)) return 40;
        return Math.min(Math.max(this.display, 1), 100);
    }

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private stripTags(text: string) {
        return text.replace(/<[^>]*>/g, " ");
    }

    private decodeEntities(text: string) {
        return text
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ");
    }

    private cleanText(input: unknown) {
        if (typeof input !== "string") return "";
        const decoded = this.decodeEntities(this.stripTags(input));
        return decoded.replace(/\s+/g, " ").trim();
    }

    private normalizeSourceUrl(url: string) {
        try {
            const parsed = new URL(url);
            const blockedParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "from"];
            blockedParams.forEach((param) => parsed.searchParams.delete(param));
            parsed.hash = "";
            const normalized = parsed.toString();
            return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
        } catch {
            return url.trim();
        }
    }

    private toIsoDateString(date: Date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    private buildDate(year: number, month: number, day: number): string | null {
        const candidate = new Date(year, month - 1, day);
        if (
            Number.isNaN(candidate.getTime())
            || candidate.getFullYear() !== year
            || candidate.getMonth() !== month - 1
            || candidate.getDate() !== day
        ) {
            return null;
        }
        return this.toIsoDateString(candidate);
    }

    private parsePublishedAt(item: NaverSearchItem): string | null {
        if (typeof item.pubDate === "string" && item.pubDate.trim().length > 0) {
            const parsed = new Date(item.pubDate);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        if (typeof item.postdate === "string" && /^\d{8}$/.test(item.postdate)) {
            const year = Number.parseInt(item.postdate.slice(0, 4), 10);
            const month = Number.parseInt(item.postdate.slice(4, 6), 10);
            const day = Number.parseInt(item.postdate.slice(6, 8), 10);
            const ymd = this.buildDate(year, month, day);
            if (!ymd) return null;
            return new Date(`${ymd}T00:00:00+09:00`).toISOString();
        }
        return null;
    }

    private parseDateRangeFromText(text: string, referenceDate: Date): DateRange | null {
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized) return null;

        // 2026.04.25 ~ 2026.04.26 / 2026-04-25~04-26 / 2026년 4월 25일 ~ 26일
        const fullRange = normalized.match(
            /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\s*(?:~|-|–|—)\s*(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]?\s*(\d{1,2})\s*일?/,
        );
        if (fullRange) {
            const startYear = Number.parseInt(fullRange[1], 10);
            const startMonth = Number.parseInt(fullRange[2], 10);
            const startDay = Number.parseInt(fullRange[3], 10);
            const endYearRaw = fullRange[4] ? Number.parseInt(fullRange[4], 10) : startYear;
            const endMonth = Number.parseInt(fullRange[5], 10);
            const endDay = Number.parseInt(fullRange[6], 10);
            const startDate = this.buildDate(startYear, startMonth, startDay);
            let endYear = endYearRaw;
            let endDate = this.buildDate(endYear, endMonth, endDay);
            if (startDate && endDate && endDate < startDate && !fullRange[4]) {
                endYear += 1;
                endDate = this.buildDate(endYear, endMonth, endDay);
            }
            if (startDate && endDate) {
                return { startDate, endDate };
            }
        }

        // 4월 25일 ~ 4월 26일
        const monthDayRange = normalized.match(
            /(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:~|-|–|—)\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/,
        );
        if (monthDayRange) {
            const year = referenceDate.getFullYear();
            const startMonth = Number.parseInt(monthDayRange[1], 10);
            const startDay = Number.parseInt(monthDayRange[2], 10);
            const endMonth = Number.parseInt(monthDayRange[3], 10);
            const endDay = Number.parseInt(monthDayRange[4], 10);
            const startDate = this.buildDate(year, startMonth, startDay);
            let endYear = year;
            let endDate = this.buildDate(endYear, endMonth, endDay);
            if (startDate && endDate && endDate < startDate) {
                endYear += 1;
                endDate = this.buildDate(endYear, endMonth, endDay);
            }
            if (startDate && endDate) {
                return { startDate, endDate };
            }
        }

        // 4월 25일 ~ 26일
        const sameMonthRange = normalized.match(
            /(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:~|-|–|—)\s*(\d{1,2})\s*일/,
        );
        if (sameMonthRange) {
            const year = referenceDate.getFullYear();
            const month = Number.parseInt(sameMonthRange[1], 10);
            const startDay = Number.parseInt(sameMonthRange[2], 10);
            const endDay = Number.parseInt(sameMonthRange[3], 10);
            const startDate = this.buildDate(year, month, startDay);
            let endYear = year;
            let endDate = this.buildDate(endYear, month, endDay);
            if (startDate && endDate && endDate < startDate) {
                if (month === 12) {
                    endYear += 1;
                    endDate = this.buildDate(endYear, 1, endDay);
                } else {
                    endDate = this.buildDate(endYear, month + 1, endDay);
                }
            }
            if (startDate && endDate) {
                return { startDate, endDate };
            }
        }

        // Single date with year.
        const fullDate = normalized.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/);
        if (fullDate) {
            const year = Number.parseInt(fullDate[1], 10);
            const month = Number.parseInt(fullDate[2], 10);
            const day = Number.parseInt(fullDate[3], 10);
            const ymd = this.buildDate(year, month, day);
            if (ymd) {
                return { startDate: ymd, endDate: ymd };
            }
        }

        // Single month/day without year.
        const monthDay = normalized.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (monthDay) {
            const baseYear = referenceDate.getFullYear();
            const month = Number.parseInt(monthDay[1], 10);
            const day = Number.parseInt(monthDay[2], 10);
            let ymd = this.buildDate(baseYear, month, day);
            if (ymd && ymd < this.toIsoDateString(referenceDate)) {
                ymd = this.buildDate(baseYear + 1, month, day);
            }
            if (ymd) {
                return { startDate: ymd, endDate: ymd };
            }
        }

        return null;
    }

    private extractLabeledValue(text: string, labels: string[], maxLen = 120): string | null {
        const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        const match = text.match(new RegExp(`(?:${escaped})\\s*[:：]\\s*([^\\n|]{2,${maxLen}})`, "i"));
        if (!match?.[1]) return null;
        return match[1].trim();
    }

    private toGenre(query: string, title: string) {
        const source = `${query} ${title}`.toLowerCase();
        if (source.includes("락") || source.includes("rock")) return "락 페스티벌";
        if (source.includes("festival") || source.includes("페스티벌") || source.includes("축제")) return "축제";
        if (source.includes("콘서트") || source.includes("공연") || source.includes("내한")) return "콘서트";
        return "기타";
    }

    private isFestivalRelated(title: string, description: string) {
        const text = `${title} ${description}`.toLowerCase();
        return /(페스티벌|festival|축제|라인업|티켓|콘서트|공연|내한|뮤직)/i.test(text);
    }

    private toDateRangeFilter(stdate: string, edate: string) {
        const toDate = (value: string) => {
            if (!/^\d{8}$/.test(value)) return null;
            const year = Number.parseInt(value.slice(0, 4), 10);
            const month = Number.parseInt(value.slice(4, 6), 10);
            const day = Number.parseInt(value.slice(6, 8), 10);
            const parsed = new Date(year, month - 1, day);
            if (Number.isNaN(parsed.getTime())) return null;
            return this.toIsoDateString(parsed);
        };
        return {
            start: toDate(stdate),
            end: toDate(edate),
        };
    }

    private withinRange(festival: UnifiedFestival, range: { start: string | null; end: string | null }) {
        if (!range.start || !range.end) return true;
        return festival.endDate >= range.start && festival.startDate <= range.end;
    }

    private buildUniqueId(seed: string) {
        const hash = createHash("sha1").update(seed).digest("hex").slice(0, 18);
        return `naver-${hash}`;
    }

    private mapToUnifiedFestival(
        item: NaverSearchItem,
        query: string,
        fallbackDateRange?: DateRange,
    ): UnifiedFestival | null {
        const title = this.cleanText(item.title);
        const description = this.cleanText(item.description);
        if (!title || !this.isFestivalRelated(title, description)) {
            return null;
        }

        const publishedAt = this.parsePublishedAt(item);
        const referenceDate = publishedAt ? new Date(publishedAt) : new Date();
        const dateRange = this.parseDateRangeFromText(`${title}\n${description}`, referenceDate) || fallbackDateRange;
        if (!dateRange) {
            return null;
        }

        const sourceUrlRaw = this.cleanText(item.originallink || item.link);
        const sourceUrl = sourceUrlRaw ? this.normalizeSourceUrl(sourceUrlRaw) : "";
        const location = this.extractLabeledValue(description, ["장소", "공연장", "개최 장소", "venue", "location"]) || "상세 정보 참조";
        const lineup = this.extractLabeledValue(description, ["라인업", "출연", "아티스트", "lineup", "artists"], 200);
        const price = this.extractLabeledValue(description, ["티켓 가격", "가격", "입장료", "예매가", "tickets"], 140);
        const bookingSite =
            this.extractLabeledValue(
                description,
                ["예매처", "예매 사이트", "예매 링크", "티켓 예매처", "booking", "ticketing"],
                180,
            )
            || "";
        const homepage =
            this.extractLabeledValue(description, ["홈페이지", "공식 홈페이지", "website"], 180)
            || (bookingSite.startsWith("http") ? bookingSite : "")
            || (sourceUrl.startsWith("http") ? sourceUrl : "");
        const publishedDate = publishedAt
            ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(publishedAt))
            : undefined;

        const details: FestivalDetailSection[] = [
            { label: "일정", value: `${dateRange.startDate} ~ ${dateRange.endDate}` },
            location && location !== "상세 정보 참조" ? { label: "장소", value: location } : null,
            lineup ? { label: "라인업", value: lineup } : null,
            price ? { label: "티켓 가격", value: price } : null,
            bookingSite ? { label: "예매처", value: bookingSite } : null,
        ].filter((section): section is FestivalDetailSection => Boolean(section));

        const seed = sourceUrl || `${title}|${dateRange.startDate}|${dateRange.endDate}|${publishedAt || ""}`;
        return {
            id: this.buildUniqueId(seed),
            title: title.slice(0, 180),
            location,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            publishedDate,
            publishedAt: publishedAt || undefined,
            imageUrl: "",
            source: "WEB_CRAWL",
            sourceLabel: "네이버 검색",
            sourceUrl: sourceUrl || undefined,
            genre: this.toGenre(query, title),
            description: description ? description.slice(0, 900) : undefined,
            lineup: lineup || undefined,
            price: price || undefined,
            homepage: homepage || undefined,
            details: details.length > 0 ? details : undefined,
        };
    }

    private normalizeTitleForMatch(value: string) {
        return value
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[^a-z0-9가-힣\s]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private isLikelySameFestival(targetTitle: string, candidateTitle: string) {
        const target = this.normalizeTitleForMatch(targetTitle);
        const candidate = this.normalizeTitleForMatch(candidateTitle);
        if (!target || !candidate) return false;
        if (target === candidate) return true;
        if (candidate.includes(target) || target.includes(candidate)) return true;

        const targetTokens = target.split(" ").filter((token) => token.length >= 2);
        if (targetTokens.length === 0) return false;
        const matchedTokens = targetTokens.filter((token) => candidate.includes(token)).length;
        return matchedTokens >= Math.max(1, Math.ceil(targetTokens.length * 0.6));
    }

    private scoreTitleMatch(targetTitle: string, candidate: UnifiedFestival) {
        const target = this.normalizeTitleForMatch(targetTitle);
        const title = this.normalizeTitleForMatch(candidate.title);
        if (!target || !title) return 0;

        let score = 0;
        if (target === title) score += 120;
        if (title.includes(target) || target.includes(title)) score += 75;

        const targetTokens = target.split(" ").filter((token) => token.length >= 2);
        const tokenMatches = targetTokens.filter((token) => title.includes(token)).length;
        score += tokenMatches * 12;

        if (candidate.lineup) score += 4;
        if (candidate.price) score += 3;
        if (candidate.homepage) score += 3;
        if (candidate.description) score += 2;
        return score;
    }

    async searchByFestivalTitle(
        title: string,
        fallbackDateRange?: DateRange,
    ): Promise<UnifiedFestival | null> {
        if (!this.hasCredentials()) {
            this.warnMissingCredentials();
            return null;
        }

        const cleanedTitle = this.cleanText(title);
        if (!cleanedTitle) return null;

        const queryCandidates = Array.from(
            new Set([
                cleanedTitle,
                `${cleanedTitle} 페스티벌`,
                `${cleanedTitle} 라인업`,
                `${cleanedTitle} 티켓`,
                `${cleanedTitle} 예매처`,
                `${cleanedTitle} 공연장`,
                `${cleanedTitle} 일정`,
            ]),
        );
        const dedupe = new Set<string>();
        const candidates: UnifiedFestival[] = [];

        for (const searchType of this.searchTypes) {
            for (const query of queryCandidates) {
                const items = await this.fetchSearchItems(searchType, query);
                items.forEach((item) => {
                    const mapped = this.mapToUnifiedFestival(item, query, fallbackDateRange);
                    if (!mapped) return;
                    if (!this.isLikelySameFestival(cleanedTitle, mapped.title)) return;
                    const dedupeKey = mapped.sourceUrl
                        ? `${mapped.source}|${this.normalizeSourceUrl(mapped.sourceUrl)}`
                        : `${mapped.source}|${mapped.title}|${mapped.startDate}|${mapped.endDate}`;
                    if (dedupe.has(dedupeKey)) return;
                    dedupe.add(dedupeKey);
                    candidates.push(mapped);
                });
                await this.sleep(this.requestDelayMs);
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => this.scoreTitleMatch(cleanedTitle, b) - this.scoreTitleMatch(cleanedTitle, a));
        return candidates[0] || null;
    }

    private async fetchSearchItems(searchType: NaverSearchType, query: string): Promise<NaverSearchItem[]> {
        if (!this.clientId || !this.clientSecret) {
            return [];
        }

        const display = this.normalizeDisplayCount();
        const params = new URLSearchParams({
            query,
            display: String(display),
            sort: "date",
        });
        const url = `${this.baseUrl}/${searchType}.json?${params.toString()}`;

        let attempt = 0;
        let lastError: unknown;
        while (attempt <= this.maxRetries) {
            try {
                const res = await fetch(url, {
                    headers: {
                        "X-Naver-Client-Id": this.clientId,
                        "X-Naver-Client-Secret": this.clientSecret,
                    },
                });

                if (res.ok) {
                    const payload = (await res.json()) as NaverSearchResponse;
                    const items = Array.isArray(payload.items) ? payload.items : [];
                    return items.filter((item): item is NaverSearchItem => Boolean(item && typeof item === "object"));
                }

                const bodyText = await res.text();
                if (![429, 500, 502, 503, 504].includes(res.status) || attempt === this.maxRetries) {
                    throw new Error(`[naver-search] ${res.status} ${bodyText}`);
                }
                await this.sleep(this.requestDelayMs * Math.pow(2, attempt));
            } catch (error) {
                lastError = error;
                if (attempt === this.maxRetries) break;
                await this.sleep(this.requestDelayMs * Math.pow(2, attempt));
            }
            attempt += 1;
        }

        if (lastError) {
            console.warn(`[naver-search] fetch failed for "${query}" (${searchType})`, lastError);
        }
        return [];
    }

    async fetchFestivals(stdate: string, edate: string): Promise<UnifiedFestival[]> {
        if (!this.hasCredentials()) {
            this.warnMissingCredentials();
            return [];
        }

        const collected: UnifiedFestival[] = [];
        const rangeFilter = this.toDateRangeFilter(stdate, edate);
        const dedupe = new Set<string>();

        for (const searchType of this.searchTypes) {
            for (const query of this.keywords) {
                const items = await this.fetchSearchItems(searchType, query);
                items.forEach((item) => {
                    const mapped = this.mapToUnifiedFestival(item, query);
                    if (!mapped || !this.withinRange(mapped, rangeFilter)) return;
                    const key = mapped.sourceUrl
                        ? `${mapped.source}|${this.normalizeSourceUrl(mapped.sourceUrl)}`
                        : `${mapped.source}|${mapped.title}|${mapped.startDate}|${mapped.endDate}`;
                    if (dedupe.has(key)) return;
                    dedupe.add(key);
                    collected.push(mapped);
                });
                await this.sleep(this.requestDelayMs);
            }
        }

        return collected;
    }

    async fetchDetail(id: string): Promise<Partial<UnifiedFestival>> {
        void id;
        return {};
    }
}
