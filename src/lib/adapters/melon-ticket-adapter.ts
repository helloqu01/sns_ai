import { FestivalAdapter } from "./festival-adapter";
import { FestivalDetailSection, UnifiedFestival } from "@/types/festival";

type MelonGenreConfig = {
    code: string;
    genreType: string;
    label: string;
};

type MelonProdItem = {
    prodId?: number | string;
    title?: string;
    subTitle?: string;
    periodInfo?: string;
    placeName?: string;
    regionName?: string;
    posterImg?: string;
    summary?: string;
    perfTimeInfo?: string;
    announceInfo?: string;
    seatGradeJson?: string;
    saleTypeJson?: string;
    csInfo?: string;
    partnerInfo?: string;
    stateFlg?: string;
    regDate?: string;
    mdfDate?: string;
};

type MelonProdListResponse = {
    result?: number;
    data?: unknown;
};

type SeatGradeJson = {
    data?: {
        list?: Array<{
            seatGradeName?: string;
            basePrice?: number;
        }>;
    };
};

type SaleTypeJson = {
    data?: {
        list?: Array<{
            saleTypeCodeList?: Array<{
                reserveStartDt?: string;
            }>;
        }>;
    };
};

const GENRE_MAP: Record<string, { genreType: string; label: string }> = {
    GENRE_CON_ALL: { genreType: "GENRE_CON", label: "콘서트" },
    GENRE_FAN_ALL: { genreType: "GENRE_FAN", label: "팬미팅" },
    GENRE_ART_ALL: { genreType: "GENRE_ART", label: "뮤지컬/연극" },
    GENRE_CLA_ALL: { genreType: "GENRE_CLA", label: "클래식" },
    GENRE_EXH_ALL: { genreType: "GENRE_EXH", label: "전시/행사" },
};

export class MelonTicketAdapter extends FestivalAdapter {
    sourceName = "MELON_TICKET" as const;

    private baseUrl = "https://ticket.melon.com";
    private requestDelayMs = this.resolveInt(process.env.MELON_TICKET_DELAY_MS, 140, 50, 2_000);
    private maxRetries = this.resolveInt(process.env.MELON_TICKET_MAX_RETRIES, 2, 0, 5);
    private sortType = this.resolveSortType();
    private maxItemsPerGenre = this.resolveInt(process.env.MELON_TICKET_MAX_ITEMS_PER_GENRE, 220, 20, 500);
    private genres = this.resolveGenres();

    private resolveInt(raw: string | undefined, fallback: number, min: number, max: number) {
        const parsed = Number.parseInt(raw ?? "", 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(Math.max(parsed, min), max);
    }

    private resolveSortType() {
        const raw = (process.env.MELON_TICKET_SORT_TYPE || "HIT").toUpperCase().trim();
        const allowed = new Set(["HIT", "LATELY_ADMIN", "LATELY_PERF"]);
        return allowed.has(raw) ? raw : "HIT";
    }

    private resolveGenres(): MelonGenreConfig[] {
        const raw = process.env.MELON_TICKET_GENRE_CODES;
        const defaults = ["GENRE_CON_ALL"];
        const selected = (typeof raw === "string" && raw.trim().length > 0)
            ? raw.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean)
            : defaults;

        const unique = Array.from(new Set(selected));
        const resolved = unique
            .map((code) => {
                const mapped = GENRE_MAP[code];
                if (!mapped) return null;
                return { code, genreType: mapped.genreType, label: mapped.label } satisfies MelonGenreConfig;
            })
            .filter((genre): genre is MelonGenreConfig => !!genre);

        return resolved.length > 0
            ? resolved
            : [{ code: "GENRE_CON_ALL", genreType: "GENRE_CON", label: "콘서트" }];
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private buildListUrl(genre: MelonGenreConfig) {
        const params = new URLSearchParams({
            commCode: "",
            sortType: this.sortType,
            perfGenreCode: genre.code,
            perfThemeCode: "",
            filterCode: "FILTER_ALL",
            v: "1",
        });
        return `${this.baseUrl}/performance/ajax/prodList.json?${params.toString()}`;
    }

    private async fetchProdList(genre: MelonGenreConfig): Promise<MelonProdItem[]> {
        const url = this.buildListUrl(genre);
        const referer = `${this.baseUrl}/concert/index.htm?genreType=${genre.genreType}`;

        let attempt = 0;
        let lastError: unknown;

        while (attempt <= this.maxRetries) {
            try {
                const response = await fetch(url, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                        "Accept": "application/json,text/plain,*/*",
                        "Referer": referer,
                        "X-Requested-With": "XMLHttpRequest",
                    },
                });

                if (!response.ok) {
                    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.maxRetries) {
                        throw new Error(`MELON_TICKET fetch failed: ${response.status}`);
                    }
                    await this.sleep(this.requestDelayMs * Math.pow(2, attempt));
                    attempt += 1;
                    continue;
                }

                const parsed = await response.json() as MelonProdListResponse;
                if (parsed.result !== 0 || !Array.isArray(parsed.data)) {
                    return [];
                }

                return parsed.data
                    .filter((item): item is MelonProdItem => !!item && typeof item === "object")
                    .slice(0, this.maxItemsPerGenre);
            } catch (error) {
                lastError = error;
                if (attempt === this.maxRetries) break;
                await this.sleep(this.requestDelayMs * Math.pow(2, attempt));
            }
            attempt += 1;
        }

        console.error(`MELON_TICKET ${genre.code} list fetch failed.`, lastError);
        return [];
    }

    private normalizeSpaces(value: string) {
        return value.replace(/\s+/g, " ").trim();
    }

    private stripHtml(input: string, maxLength = 3_000) {
        if (!input) return "";

        let cleaned = input
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/\s+/g, " ")
            .trim();

        if (cleaned.length > maxLength) {
            cleaned = cleaned.slice(0, maxLength);
        }

        return cleaned;
    }

    private parseDateYmd(value: string): string | null {
        const match = value.match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
        if (!match) return null;

        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);

        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return null;
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null;
        }

        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    private parseDateRange(periodInfo: string): { startDate: string; endDate: string } | null {
        const normalized = this.normalizeSpaces(periodInfo);
        if (!normalized) return null;

        const fullRange = normalized.match(/(\d{4}\.\d{2}\.\d{2})\s*[-~]\s*(\d{4}\.\d{2}\.\d{2})/);
        if (fullRange) {
            const startDate = this.parseDateYmd(fullRange[1].replace(/\./g, "-"));
            const endDate = this.parseDateYmd(fullRange[2].replace(/\./g, "-"));
            if (startDate && endDate) {
                return { startDate, endDate };
            }
        }

        const single = normalized.match(/(\d{4}\.\d{2}\.\d{2})/);
        if (!single) return null;

        const ymd = this.parseDateYmd(single[1].replace(/\./g, "-"));
        if (!ymd) return null;
        return { startDate: ymd, endDate: ymd };
    }

    private toIsoDate(value: string): string | null {
        if (!/^\d{8}$/.test(value)) return null;
        const year = Number.parseInt(value.slice(0, 4), 10);
        const month = Number.parseInt(value.slice(4, 6), 10);
        const day = Number.parseInt(value.slice(6, 8), 10);
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return null;
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    private parseRange(stdate: string, edate: string) {
        return {
            start: this.toIsoDate(stdate),
            end: this.toIsoDate(edate),
        };
    }

    private overlapsRange(
        dateRange: { startDate: string; endDate: string },
        range: { start: string | null; end: string | null },
    ) {
        if (!range.start || !range.end) return true;
        return dateRange.endDate >= range.start && dateRange.startDate <= range.end;
    }

    private parsePublished(rawValue?: string): { publishedAt?: string; publishedDate?: string } {
        if (!rawValue || typeof rawValue !== "string") return {};

        const normalized = rawValue.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return {};

        const publishedDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
        }).format(parsed);

        return {
            publishedAt: parsed.toISOString(),
            publishedDate,
        };
    }

    private parseSeatPriceLabel(seatGradeJson?: string): string {
        if (!seatGradeJson) return "";

        try {
            const parsed = JSON.parse(seatGradeJson) as SeatGradeJson;
            const list = parsed?.data?.list;
            if (!Array.isArray(list) || list.length === 0) return "";

            return list
                .slice(0, 4)
                .map((grade) => {
                    const name = typeof grade.seatGradeName === "string" ? this.normalizeSpaces(grade.seatGradeName) : "";
                    const price = typeof grade.basePrice === "number"
                        ? `${grade.basePrice.toLocaleString("ko-KR")}원`
                        : "";
                    if (name && price) return `${name} ${price}`;
                    return name || price;
                })
                .filter(Boolean)
                .join(" / ");
        } catch {
            return "";
        }
    }

    private parseTicketOpen(saleTypeJson?: string): string {
        if (!saleTypeJson) return "";

        try {
            const parsed = JSON.parse(saleTypeJson) as SaleTypeJson;
            const groups = parsed?.data?.list;
            if (!Array.isArray(groups) || groups.length === 0) return "";

            const candidates: string[] = [];

            for (const group of groups) {
                const saleTypes = Array.isArray(group.saleTypeCodeList) ? group.saleTypeCodeList : [];
                for (const saleType of saleTypes) {
                    if (typeof saleType.reserveStartDt === "string" && /^\d{14}$/.test(saleType.reserveStartDt)) {
                        candidates.push(saleType.reserveStartDt);
                    }
                }
            }

            if (candidates.length === 0) return "";

            const earliest = candidates.sort()[0];
            return `${earliest.slice(0, 4)}-${earliest.slice(4, 6)}-${earliest.slice(6, 8)} ${earliest.slice(8, 10)}:${earliest.slice(10, 12)}`;
        } catch {
            return "";
        }
    }

    private extractLineup(summary: string) {
        const plain = this.stripHtml(summary, 1_000);
        const match = plain.match(/(?:출연|라인업|아티스트|artist)\s*[:：]\s*([^|\n]{2,220})/i);
        return match?.[1] ? this.normalizeSpaces(match[1]) : "";
    }

    private parseStateLabel(stateFlg?: string) {
        if (stateFlg === "SS0100") return "판매예정";
        if (stateFlg === "SS0200") return "판매중";
        return "";
    }

    private buildDescription(item: MelonProdItem): string {
        const blocks = [
            this.stripHtml(item.summary || "", 1_500),
            this.stripHtml(item.perfTimeInfo || "", 600),
            this.stripHtml(item.announceInfo || "", 2_200),
        ].filter(Boolean);

        return blocks.join("\n\n").slice(0, 4_000);
    }

    private buildImageUrl(posterImg?: string): string {
        if (!posterImg) return "";
        if (/^https?:\/\//i.test(posterImg)) return posterImg;
        return `https://cdnticket.melon.co.kr${posterImg}/melon/strip/true/quality/80`;
    }

    private buildDetails(item: MelonProdItem, price: string, ticketOpen: string): FestivalDetailSection[] {
        const details: FestivalDetailSection[] = [];

        const append = (label: string, value: string) => {
            const normalized = this.normalizeSpaces(value || "");
            if (!normalized) return;
            details.push({ label, value: normalized.slice(0, 400) });
        };

        append("일정", item.periodInfo || "");
        append("장소", item.placeName || "");
        append("티켓 가격", price);
        append("티켓 오픈", ticketOpen);
        append("공연 시간", this.stripHtml(item.perfTimeInfo || "", 280));
        append("판매 상태", this.parseStateLabel(item.stateFlg));
        append("지역", item.regionName || "");
        append("문의", this.stripHtml(item.csInfo || "", 220));
        append("예매처", "멜론티켓");

        return details.slice(0, 12);
    }

    private mapItemToFestival(
        item: MelonProdItem,
        genre: MelonGenreConfig,
        range: { start: string | null; end: string | null },
    ): UnifiedFestival | null {
        const rawProdId = item.prodId;
        const prodId = typeof rawProdId === "number"
            ? String(rawProdId)
            : (typeof rawProdId === "string" ? rawProdId.trim() : "");
        if (!prodId) return null;

        const title = this.normalizeSpaces(item.title || item.subTitle || "");
        if (!title) return null;

        const dateRange = this.parseDateRange(item.periodInfo || "");
        if (!dateRange) return null;
        if (!this.overlapsRange(dateRange, range)) return null;

        const price = this.parseSeatPriceLabel(item.seatGradeJson);
        const ticketOpen = this.parseTicketOpen(item.saleTypeJson);
        const description = this.buildDescription(item);
        const lineup = this.extractLineup(item.summary || "");

        const sourceUrl = `${this.baseUrl}/performance/index.htm?prodId=${prodId}`;
        const published = this.parsePublished(item.regDate || item.mdfDate);

        const location = this.normalizeSpaces(item.placeName || item.regionName || "상세 정보 참조");
        const contact = this.stripHtml(item.csInfo || "", 220);

        return {
            id: `melon-${prodId}`,
            title,
            location,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            publishedAt: published.publishedAt,
            publishedDate: published.publishedDate,
            imageUrl: this.buildImageUrl(item.posterImg),
            source: "MELON_TICKET",
            sourceLabel: "멜론티켓",
            sourceUrl,
            genre: genre.label,
            description,
            lineup,
            price,
            contact,
            homepage: sourceUrl,
            details: this.buildDetails(item, price, ticketOpen),
        };
    }

    async fetchFestivals(stdate: string, edate: string): Promise<UnifiedFestival[]> {
        const range = this.parseRange(stdate, edate);
        const results: UnifiedFestival[] = [];
        const seen = new Set<string>();

        for (const genre of this.genres) {
            const items = await this.fetchProdList(genre);
            for (const item of items) {
                const mapped = this.mapItemToFestival(item, genre, range);
                if (!mapped) continue;
                if (seen.has(mapped.id)) continue;
                seen.add(mapped.id);
                results.push(mapped);
            }

            await this.sleep(this.requestDelayMs);
        }

        return results;
    }

    async fetchDetail(id: string): Promise<Partial<UnifiedFestival>> {
        void id;
        return {};
    }
}
