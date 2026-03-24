import { FestivalDetailSection, FestivalSource, UnifiedFestival } from "@/types/festival";
import { FestivalLifeAdapter } from "../adapters/festival-life-adapter";
import { MelonTicketAdapter } from "../adapters/melon-ticket-adapter";
import { NaverSearchAdapter } from "../adapters/naver-search-adapter";
import { db, isFirebaseConfigured } from "../firebase-admin";
import { geminiFlashModel } from "../gemini";

type FirestoreFestivalDoc = UnifiedFestival & {
    updatedAt?: string;
};

type FestivalCacheState = {
    festivals: UnifiedFestival[];
    expiresAt: number;
    lastUpdated: string | null;
};

type FestivalUpsertSummary = {
    inputCount: number;
    deduplicatedCount: number;
    skippedDuplicateCount: number;
    upsertedCount: number;
    cleanedDuplicateDocCount: number;
};

type ExistingFestivalDocLookup = {
    docIdByDedupeKey: Map<string, string>;
    duplicateDocIds: Set<string>;
};

export type FestivalTodaySyncSummary = {
    syncDate: string;
    crawledCount: number;
    todayCount: number;
    deduplicatedCount: number;
    skippedDuplicateCount: number;
    upsertedCount: number;
    cleanedDuplicateDocCount: number;
};

type FestivalTodaySyncResult = FestivalTodaySyncSummary & {
    festivals: UnifiedFestival[];
};

export type FestivalPublishedDateSyncSummary = {
    targetDates: string[];
    crawledCount: number;
    matchedCount: number;
    deduplicatedCount: number;
    skippedDuplicateCount: number;
    upsertedCount: number;
    cleanedDuplicateDocCount: number;
};

type FestivalPublishedDateSyncResult = FestivalPublishedDateSyncSummary & {
    festivals: UnifiedFestival[];
};

type GeminiResearchOutput = {
    ticketPrice: string;
    venue: string;
    lineup: string;
    performanceSchedule: string;
    bookingSite: string;
    startDate: string;
    endDate: string;
    evidenceSummary: string;
};

export type FestivalNaverUpdateItem = {
    festivalId: string;
    title?: string;
    status: "updated" | "unchanged" | "not-found" | "no-match" | "error";
    searchedAt?: string;
    updatedFields?: string[];
    researched?: {
        ticketPrice?: string;
        venue?: string;
        lineup?: string;
        performanceSchedule?: string;
        bookingSite?: string;
        sourceUrl?: string;
        startDate?: string;
        endDate?: string;
        location?: string;
        price?: string;
        homepage?: string;
        description?: string;
        details?: FestivalDetailSection[];
    };
    message?: string;
};

export type FestivalNaverUpdateResult = {
    requestedCount: number;
    processedCount: number;
    updatedCount: number;
    unchangedCount: number;
    notFoundCount: number;
    noMatchCount: number;
    errorCount: number;
    results: FestivalNaverUpdateItem[];
};

export class FestivalService {
    private adapters = [new FestivalLifeAdapter(), new MelonTicketAdapter(), new NaverSearchAdapter()];
    private primarySources: FestivalSource[] = ["FESTIVAL_LIFE", "MELON_TICKET"];
    private memoryCache: FestivalCacheState | null = null;
    private firestoreLoadInFlight: Promise<UnifiedFestival[]> | null = null;
    private refreshInFlight: Promise<UnifiedFestival[]> | null = null;
    private cacheTtlMs = this.resolveCacheTtlMs();

    private resolveCacheTtlMs() {
        const defaultMs = 5 * 60_000;
        const minMs = 30_000;
        const maxMs = 60 * 60_000;
        const raw = Number(process.env.FESTIVAL_CACHE_MS ?? defaultMs);
        if (!Number.isFinite(raw)) return defaultMs;
        return Math.min(Math.max(raw, minMs), maxMs);
    }

    private getPrimarySources(): FestivalSource[] {
        const unique = Array.from(new Set(this.primarySources.filter(Boolean)));
        return unique.length > 0 ? unique : ["FESTIVAL_LIFE"];
    }

    private applyPrimarySourceFilter(query: FirebaseFirestore.Query): FirebaseFirestore.Query {
        const sources = this.getPrimarySources().slice(0, 10);
        if (sources.length === 1) {
            return query.where("source", "==", sources[0]);
        }
        return query.where("source", "in", sources);
    }

    private getTodayKST(): string {
        // KST 기준으로 오늘 날짜(YYYY-MM-DD)
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    }

    private getYesterdayKST(): string {
        // KST 기준으로 어제 날짜(YYYY-MM-DD)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(yesterday);
    }

    private getFestivalPublishedDate(festival: UnifiedFestival): string | null {
        if (typeof festival.publishedDate === "string" && festival.publishedDate.trim().length > 0) {
            return festival.publishedDate.trim();
        }

        if (typeof festival.publishedAt === "string" && festival.publishedAt.trim().length > 0) {
            const parsed = new Date(festival.publishedAt);
            if (!Number.isNaN(parsed.getTime())) {
                return new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Seoul",
                }).format(parsed);
            }
        }

        return null;
    }

    private getFestivalPublishedTimeMs(festival: UnifiedFestival): number | null {
        if (typeof festival.publishedAt === "string" && festival.publishedAt.trim().length > 0) {
            const parsed = new Date(festival.publishedAt);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.getTime();
            }
        }

        const publishedDate = this.getFestivalPublishedDate(festival);
        if (!publishedDate) return null;

        const parsed = new Date(`${publishedDate}T00:00:00+09:00`);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.getTime();
    }

    private isValidFestival(festival: UnifiedFestival): boolean {
        if (!festival?.id || !festival?.title || !festival?.startDate || !festival?.endDate) {
            return false;
        }

        // 종료된 행사는 제외 (KST 기준)
        const today = this.getTodayKST();
        if (festival.endDate < today) {
            return false;
        }

        // FESTIVAL_LIFE: only expose posts with reachable-looking source links.
        if (festival.source === "FESTIVAL_LIFE") {
            const isFestivalLifeDetailUrl = !!festival.sourceUrl
                && festival.sourceUrl.startsWith("https://festivallife.kr/")
                && festival.sourceUrl.includes("bmode=view")
                && festival.sourceUrl.includes("idx=");
            if (!isFestivalLifeDetailUrl) {
                return false;
            }
        }

        return true;
    }

    private sortFestivals(festivals: UnifiedFestival[]) {
        return [...festivals].sort((a, b) => a.startDate.localeCompare(b.startDate));
    }

    private normalizeDedupeText(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .replace(/[^a-z0-9가-힣\s]/gi, "");
    }

    private normalizeSourceUrl(url: string): string {
        try {
            const parsed = new URL(url.trim());
            parsed.hash = "";
            const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
            const normalizedSearch = Array.from(parsed.searchParams.entries())
                .filter(([key]) => {
                    const lowerKey = key.toLowerCase();
                    return !lowerKey.startsWith("utm_") && lowerKey !== "fbclid";
                })
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join("&");

            return `${parsed.origin.toLowerCase()}${normalizedPath}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
        } catch {
            return url.trim().toLowerCase();
        }
    }

    private extractFestivalLifeDetailId(sourceUrl: string): string | null {
        try {
            const parsed = new URL(sourceUrl.trim());
            if (!parsed.hostname.toLowerCase().includes("festivallife.kr")) return null;
            const idx = parsed.searchParams.get("idx")?.trim() || "";
            return idx.length > 0 ? idx : null;
        } catch {
            return null;
        }
    }

    private buildFestivalDedupeKey(festival: Partial<UnifiedFestival>): string | null {
        const source = typeof festival.source === "string" ? festival.source : "";
        if (!source) return null;

        if (typeof festival.sourceUrl === "string" && festival.sourceUrl.trim().length > 0) {
            if (source === "FESTIVAL_LIFE") {
                const festivalLifeDetailId = this.extractFestivalLifeDetailId(festival.sourceUrl);
                if (festivalLifeDetailId) {
                    // FESTIVAL_LIFE has duplicate listings across /concert and /gigs with the same idx.
                    // Use idx as canonical identity to avoid exposing duplicated cards.
                    return `${source}|detail:${festivalLifeDetailId}`;
                }
            }
            return `${source}|url:${this.normalizeSourceUrl(festival.sourceUrl)}`;
        }

        const title = typeof festival.title === "string" ? this.normalizeDedupeText(festival.title) : "";
        const location = typeof festival.location === "string" ? this.normalizeDedupeText(festival.location) : "";
        const startDate = typeof festival.startDate === "string" ? festival.startDate : "";
        const endDate = typeof festival.endDate === "string" ? festival.endDate : "";

        if (!title || !startDate || !endDate) {
            return null;
        }

        return `${source}|meta:${title}|${location}|${startDate}|${endDate}`;
    }

    private dedupeFestivals(festivals: UnifiedFestival[]) {
        const deduplicatedFestivals: UnifiedFestival[] = [];
        const seen = new Set<string>();

        for (const festival of festivals) {
            const dedupeKey = this.buildFestivalDedupeKey(festival) || `id:${festival.id}`;
            if (seen.has(dedupeKey)) {
                continue;
            }

            seen.add(dedupeKey);
            deduplicatedFestivals.push(festival);
        }

        return {
            deduplicatedFestivals: this.sortFestivals(deduplicatedFestivals),
            duplicateCount: festivals.length - deduplicatedFestivals.length,
        };
    }

    private setMemoryCache(festivals: UnifiedFestival[], lastUpdated: string | null) {
        this.memoryCache = {
            festivals: this.sortFestivals(festivals),
            expiresAt: Date.now() + this.cacheTtlMs,
            lastUpdated,
        };
    }

    private getFreshMemoryCache(): FestivalCacheState | null {
        if (!this.memoryCache) return null;
        if (this.memoryCache.expiresAt <= Date.now()) return null;
        return this.memoryCache;
    }

    private toStoredFestivalDoc(docId: string, data: Partial<UnifiedFestival> | undefined): UnifiedFestival | null {
        if (!data || typeof data !== "object") return null;

        const id = typeof data.id === "string" && data.id.trim().length > 0 ? data.id.trim() : docId;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        const location = typeof data.location === "string" ? data.location.trim() : "";
        const startDate = typeof data.startDate === "string" ? data.startDate.trim() : "";
        const endDate = typeof data.endDate === "string" ? data.endDate.trim() : "";
        if (!id || !title || !startDate || !endDate) {
            return null;
        }

        return {
            ...(data as UnifiedFestival),
            id,
            title,
            location: location || "상세 정보 참조",
            startDate,
            endDate,
            imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
            source: data.source || "FESTIVAL_LIFE",
            genre: typeof data.genre === "string" && data.genre.trim().length > 0 ? data.genre : "기타",
        };
    }

    private async getFestivalsByRequestedIds(festivalIds: string[]) {
        const records = new Map<string, { docId: string; festival: UnifiedFestival }>();
        const firestore = db;
        if (!firestore || festivalIds.length === 0) return records;

        const uniqueIds = Array.from(new Set(festivalIds.map((id) => id.trim()).filter(Boolean)));
        if (uniqueIds.length === 0) return records;

        const docRefs = uniqueIds.map((festivalId) => firestore.collection("festivals").doc(festivalId));
        const directSnapshots = await firestore.getAll(...docRefs);
        directSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) return;
            const festival = this.toStoredFestivalDoc(snapshot.id, snapshot.data() as Partial<UnifiedFestival>);
            if (!festival) return;
            records.set(uniqueIds[index], {
                docId: snapshot.id,
                festival,
            });
        });

        const unresolvedIds = uniqueIds.filter((festivalId) => !records.has(festivalId));
        if (unresolvedIds.length === 0) return records;

        const chunkSize = 10; // Firestore "in" filter limit.
        for (let i = 0; i < unresolvedIds.length; i += chunkSize) {
            const chunk = unresolvedIds.slice(i, i + chunkSize);
            const snapshot = await firestore.collection("festivals").where("id", "in", chunk).get();
            snapshot.forEach((doc) => {
                const festival = this.toStoredFestivalDoc(doc.id, doc.data() as Partial<UnifiedFestival>);
                if (!festival) return;
                if (!chunk.includes(festival.id)) return;
                if (records.has(festival.id)) return;
                records.set(festival.id, {
                    docId: doc.id,
                    festival,
                });
            });
        }

        return records;
    }

    private cleanResearchValue(value: unknown, maxLen = 280): string {
        if (typeof value !== "string") return "";
        return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
    }

    private isIsoDate(value: string) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    private extractJsonObjectFromText(text: string) {
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace < 0 || lastBrace <= firstBrace) {
            throw new Error("Gemini 조사 응답에서 JSON 객체를 찾지 못했습니다.");
        }
        return text.slice(firstBrace, lastBrace + 1);
    }

    private stripHtmlForResearch(input: string) {
        return input
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/\s+/g, " ")
            .trim();
    }

    private async fetchPageTextForResearch(url: string): Promise<string | null> {
        const trimmed = url.trim();
        if (!trimmed) return null;
        if (!/^https?:\/\//i.test(trimmed)) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);

        try {
            const response = await fetch(trimmed, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                signal: controller.signal,
            });
            if (!response.ok) return null;

            const html = await response.text();
            const plain = this.stripHtmlForResearch(html);
            if (!plain) return null;
            return plain.slice(0, 12_000);
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private parseGeminiResearchOutput(rawText: string): GeminiResearchOutput {
        const parsed = JSON.parse(this.extractJsonObjectFromText(rawText)) as Partial<GeminiResearchOutput>;
        return {
            ticketPrice: this.cleanResearchValue(parsed.ticketPrice, 220),
            venue: this.cleanResearchValue(parsed.venue, 220),
            lineup: this.cleanResearchValue(parsed.lineup, 280),
            performanceSchedule: this.cleanResearchValue(parsed.performanceSchedule, 220),
            bookingSite: this.cleanResearchValue(parsed.bookingSite, 240),
            startDate: this.cleanResearchValue(parsed.startDate, 20),
            endDate: this.cleanResearchValue(parsed.endDate, 20),
            evidenceSummary: this.cleanResearchValue(parsed.evidenceSummary, 320),
        };
    }

    private buildGeminiResearchPrompt(festival: UnifiedFestival, sourceContext: string) {
        return `
당신은 한국 공연/페스티벌 데이터 조사 보조 AI입니다.
아래 제공된 텍스트에서만 근거를 찾아 필수 항목 5개를 추출하세요.

[필수 추출 항목]
1) ticketPrice: 티켓 가격
2) venue: 공연 장소
3) lineup: 라인업
4) performanceSchedule: 공연 일정
5) bookingSite: 예매처

[엄격 규칙]
- 추측 금지. 텍스트 근거가 없으면 빈 문자열("")을 반환하세요.
- 외부 지식을 임의로 보충하지 마세요.
- 날짜를 정확히 파악할 수 있으면 startDate/endDate를 YYYY-MM-DD로 채우고, 아니면 빈 문자열로 두세요.
- 설명 문장 없이 JSON 객체만 출력하세요.

[행사 기본 정보]
- 행사명: ${festival.title}
- 기존 일정: ${festival.startDate} ~ ${festival.endDate}
- 기존 장소: ${festival.location}
- 기존 라인업: ${festival.lineup || ""}
- 기존 티켓 가격: ${festival.price || ""}
- 기존 홈페이지: ${festival.homepage || ""}
- 원문 URL: ${festival.sourceUrl || ""}

[조사 텍스트]
${sourceContext}

[출력 JSON 스키마]
{
  "ticketPrice": "",
  "venue": "",
  "lineup": "",
  "performanceSchedule": "",
  "bookingSite": "",
  "startDate": "",
  "endDate": "",
  "evidenceSummary": ""
}
`.trim();
    }

    private mergeDetailsWithRequiredResearchFields(
        existingDetails: FestivalDetailSection[] | undefined,
        output: GeminiResearchOutput,
    ): FestivalDetailSection[] {
        const map = new Map<string, string>();
        (existingDetails || []).forEach((detail) => {
            const label = this.cleanResearchValue(detail.label, 40);
            const value = this.cleanResearchValue(detail.value, 240);
            if (!label || !value) return;
            if (!map.has(label)) {
                map.set(label, value);
            }
        });

        const scheduleValue = output.performanceSchedule || (
            output.startDate && output.endDate ? `${output.startDate} ~ ${output.endDate}` : ""
        );
        if (scheduleValue) map.set("일정", scheduleValue);
        if (output.venue) map.set("장소", output.venue);
        if (output.lineup) map.set("라인업", output.lineup);
        if (output.ticketPrice) map.set("티켓 가격", output.ticketPrice);
        if (output.bookingSite) map.set("예매처", output.bookingSite);

        return Array.from(map.entries())
            .map(([label, value]) => ({ label, value }))
            .slice(0, 12);
    }

    private buildGeminiResearchPatch(existing: UnifiedFestival, output: GeminiResearchOutput) {
        const patch: Partial<UnifiedFestival> = {};
        const updatedFields: string[] = [];

        const nextVenue = this.cleanResearchValue(output.venue, 200);
        if (nextVenue && nextVenue !== this.cleanResearchValue(existing.location, 200)) {
            patch.location = nextVenue;
            updatedFields.push("location");
        }

        const nextLineup = this.cleanResearchValue(output.lineup, 260);
        if (nextLineup && nextLineup !== this.cleanResearchValue(existing.lineup, 260)) {
            patch.lineup = nextLineup;
            updatedFields.push("lineup");
        }

        const nextTicketPrice = this.cleanResearchValue(output.ticketPrice, 180);
        if (nextTicketPrice && nextTicketPrice !== this.cleanResearchValue(existing.price, 180)) {
            patch.price = nextTicketPrice;
            updatedFields.push("price");
        }

        const nextBookingSite = this.cleanResearchValue(output.bookingSite, 240);
        if (
            nextBookingSite
            && /^https?:\/\//i.test(nextBookingSite)
            && nextBookingSite !== this.cleanResearchValue(existing.homepage, 240)
        ) {
            patch.homepage = nextBookingSite;
            updatedFields.push("homepage");
        }

        const nextStartDate = this.cleanResearchValue(output.startDate, 20);
        if (nextStartDate && this.isIsoDate(nextStartDate) && nextStartDate !== existing.startDate) {
            patch.startDate = nextStartDate;
            updatedFields.push("startDate");
        }

        const nextEndDate = this.cleanResearchValue(output.endDate, 20);
        if (nextEndDate && this.isIsoDate(nextEndDate) && nextEndDate !== existing.endDate) {
            patch.endDate = nextEndDate;
            updatedFields.push("endDate");
        }

        const mergedDetails = this.mergeDetailsWithRequiredResearchFields(existing.details, output);
        const currentDetails = Array.isArray(existing.details) ? existing.details : [];
        if (JSON.stringify(currentDetails) !== JSON.stringify(mergedDetails)) {
            patch.details = mergedDetails;
            updatedFields.push("details");
        }

        return { patch, updatedFields, mergedDetails };
    }

    private async researchFestivalWithGemini(festival: UnifiedFestival) {
        const sourceTexts: string[] = [];
        const baseDescription = this.cleanResearchValue(festival.description, 3_000);
        if (baseDescription) sourceTexts.push(`[기존 설명]\n${baseDescription}`);

        const baseDetails = Array.isArray(festival.details)
            ? festival.details
                .map((detail) => `${this.cleanResearchValue(detail.label, 40)}: ${this.cleanResearchValue(detail.value, 220)}`)
                .filter((line) => line.length > 2)
                .join("\n")
            : "";
        if (baseDetails) sourceTexts.push(`[기존 상세 정보]\n${baseDetails}`);

        if (festival.sourceUrl) {
            const sourcePageText = await this.fetchPageTextForResearch(festival.sourceUrl);
            if (sourcePageText) {
                sourceTexts.push(`[원문 페이지 본문]\n${sourcePageText}`);
            }
        }

        if (festival.homepage && festival.homepage !== festival.sourceUrl) {
            const homepageText = await this.fetchPageTextForResearch(festival.homepage);
            if (homepageText) {
                sourceTexts.push(`[홈페이지 본문]\n${homepageText}`);
            }
        }

        const sourceContext = sourceTexts.join("\n\n").slice(0, 16_000);
        if (!sourceContext.trim()) {
            return {
                output: {
                    ticketPrice: "",
                    venue: "",
                    lineup: "",
                    performanceSchedule: "",
                    bookingSite: "",
                    startDate: "",
                    endDate: "",
                    evidenceSummary: "",
                } satisfies GeminiResearchOutput,
                patch: {} as Partial<UnifiedFestival>,
                updatedFields: [] as string[],
                mergedDetails: Array.isArray(festival.details) ? festival.details : [],
            };
        }

        const prompt = this.buildGeminiResearchPrompt(festival, sourceContext);
        const result = await geminiFlashModel.generateContent(prompt);
        const response = await result.response;
        const output = this.parseGeminiResearchOutput(response.text().trim());
        const { patch, updatedFields, mergedDetails } = this.buildGeminiResearchPatch(festival, output);
        return { output, patch, updatedFields, mergedDetails };
    }

    private buildKnownFestivalLifeIdsByPath(festivals: UnifiedFestival[]): Map<string, Set<string>> {
        const map = new Map<string, Set<string>>();

        festivals.forEach((festival) => {
            if (festival.source !== "FESTIVAL_LIFE" || !festival.sourceUrl) return;
            let parsed: URL;
            try {
                parsed = new URL(festival.sourceUrl);
            } catch {
                return;
            }

            const idx = parsed.searchParams.get("idx");
            if (!idx) return;

            const pathKey = parsed.pathname.replace(/\/$/, "");
            if (!map.has(pathKey)) {
                map.set(pathKey, new Set<string>());
            }
            map.get(pathKey)?.add(idx);
        });

        return map;
    }

    private async fetchCachedFestivalsFromFirestore(): Promise<FestivalCacheState> {
        if (!db) {
            return {
                festivals: [],
                expiresAt: Date.now() + this.cacheTtlMs,
                lastUpdated: null,
            };
        }

        const snapshot = await this.applyPrimarySourceFilter(
            db.collection("festivals"),
        ).get();

        if (snapshot.empty) {
            return {
                festivals: [],
                expiresAt: Date.now() + this.cacheTtlMs,
                lastUpdated: null,
            };
        }

        let lastUpdated: string | null = null;
        const festivals: UnifiedFestival[] = [];

        snapshot.forEach((doc) => {
            const data = doc.data() as FirestoreFestivalDoc;
            if (typeof data.updatedAt === "string" && (!lastUpdated || data.updatedAt > lastUpdated)) {
                lastUpdated = data.updatedAt;
            }

            festivals.push({
                id: data.id || doc.id,
                title: data.title,
                location: data.location,
                startDate: data.startDate,
                endDate: data.endDate,
                publishedDate: data.publishedDate,
                publishedAt: data.publishedAt,
                updatedAt: data.updatedAt,
                description: data.description,
                lineup: data.lineup,
                price: data.price,
                contact: data.contact,
                homepage: data.homepage,
                details: Array.isArray(data.details) ? data.details : undefined,
                imageUrl: data.imageUrl,
                source: data.source,
                sourceLabel: data.sourceLabel,
                sourceUrl: data.sourceUrl,
                genre: data.genre,
                interestScore: data.interestScore,
                interestSource: data.interestSource,
                interestUpdatedAt: data.interestUpdatedAt,
                interestKeywords: data.interestKeywords,
            });
        });

        return {
            festivals: this.dedupeFestivals(
                festivals.filter((festival) => this.isValidFestival(festival)),
            ).deduplicatedFestivals,
            expiresAt: Date.now() + this.cacheTtlMs,
            lastUpdated,
        };
    }

    private async getKnownFestivalLifeIdsByPathFromFirestore(): Promise<Map<string, Set<string>>> {
        const map = new Map<string, Set<string>>();
        if (!db) return map;

        const snapshot = await db.collection("festivals")
            .where("source", "==", "FESTIVAL_LIFE")
            .select("sourceUrl")
            .get();

        if (snapshot.empty) return map;

        snapshot.forEach((doc) => {
            const data = doc.data() as { sourceUrl?: string };
            if (!data.sourceUrl) return;
            let parsed: URL;
            try {
                parsed = new URL(data.sourceUrl);
            } catch {
                return;
            }
            const idx = parsed.searchParams.get("idx");
            if (!idx) return;
            const pathKey = parsed.pathname.replace(/\/$/, "");
            if (!map.has(pathKey)) {
                map.set(pathKey, new Set<string>());
            }
            map.get(pathKey)?.add(idx);
        });

        return map;
    }

    private applyKnownIdsToAdapter(knownIdsByPath: Map<string, Set<string>>) {
        const festivalLifeAdapter = this.adapters.find(
            (adapter) => adapter instanceof FestivalLifeAdapter
        ) as FestivalLifeAdapter | undefined;
        if (festivalLifeAdapter) {
            festivalLifeAdapter.setKnownDetailIdsByPath(knownIdsByPath.size > 0 ? knownIdsByPath : null);
        }
    }

    private async getExistingFestivalDocLookup(): Promise<ExistingFestivalDocLookup> {
        const docIdByDedupeKey = new Map<string, string>();
        const duplicateDocIds = new Set<string>();
        if (!db) {
            return { docIdByDedupeKey, duplicateDocIds };
        }

        const snapshot = await this.applyPrimarySourceFilter(
            db.collection("festivals"),
        )
            .select("source", "sourceUrl", "title", "location", "startDate", "endDate")
            .get();

        if (snapshot.empty) {
            return { docIdByDedupeKey, duplicateDocIds };
        }

        snapshot.forEach((doc) => {
            const data = doc.data() as Partial<FirestoreFestivalDoc>;
            const dedupeKey = this.buildFestivalDedupeKey({
                id: doc.id,
                source: data.source ?? "FESTIVAL_LIFE",
                sourceUrl: data.sourceUrl,
                title: data.title,
                location: data.location,
                startDate: data.startDate,
                endDate: data.endDate,
            });

            if (!dedupeKey) return;

            const existingDocId = docIdByDedupeKey.get(dedupeKey);
            if (!existingDocId) {
                docIdByDedupeKey.set(dedupeKey, doc.id);
                return;
            }
            if (existingDocId === doc.id) {
                return;
            }

            const keepDocId = existingDocId.localeCompare(doc.id) <= 0 ? existingDocId : doc.id;
            const removeDocId = keepDocId === existingDocId ? doc.id : existingDocId;
            docIdByDedupeKey.set(dedupeKey, keepDocId);
            duplicateDocIds.add(removeDocId);
        });

        for (const keepDocId of docIdByDedupeKey.values()) {
            duplicateDocIds.delete(keepDocId);
        }

        return { docIdByDedupeKey, duplicateDocIds };
    }

    private async upsertFestivalsToFirestore(festivals: UnifiedFestival[]): Promise<FestivalUpsertSummary> {
        const { deduplicatedFestivals, duplicateCount } = this.dedupeFestivals(festivals);

        if (!db || !isFirebaseConfigured || deduplicatedFestivals.length === 0) {
            return {
                inputCount: festivals.length,
                deduplicatedCount: deduplicatedFestivals.length,
                skippedDuplicateCount: duplicateCount,
                upsertedCount: 0,
                cleanedDuplicateDocCount: 0,
            };
        }

        let existingLookup: ExistingFestivalDocLookup = {
            docIdByDedupeKey: new Map<string, string>(),
            duplicateDocIds: new Set<string>(),
        };
        try {
            existingLookup = await this.getExistingFestivalDocLookup();
        } catch (error) {
            console.warn("Failed to load existing festivals for dedupe. Continuing with ID-based upsert.", error);
        }

        const batchSize = 400;
        const updatedAt = new Date().toISOString();
        let upsertedCount = 0;

        for (let i = 0; i < deduplicatedFestivals.length; i += batchSize) {
            const batch = db.batch();
            const chunk = deduplicatedFestivals.slice(i, i + batchSize);
            for (const festival of chunk) {
                const dedupeKey = this.buildFestivalDedupeKey(festival);
                const existingDocId = dedupeKey ? existingLookup.docIdByDedupeKey.get(dedupeKey) : null;
                const targetDocId = existingDocId || festival.id;
                if (dedupeKey && !existingDocId) {
                    existingLookup.docIdByDedupeKey.set(dedupeKey, targetDocId);
                }
                existingLookup.duplicateDocIds.delete(targetDocId);

                const docRef = db.collection("festivals").doc(targetDocId);
                batch.set(docRef, {
                    ...festival,
                    id: targetDocId,
                    updatedAt,
                }, { merge: true });
                upsertedCount += 1;
            }
            await batch.commit();
        }

        const duplicateDocIdsToDelete = Array.from(existingLookup.duplicateDocIds);
        for (let i = 0; i < duplicateDocIdsToDelete.length; i += batchSize) {
            const batch = db.batch();
            const chunk = duplicateDocIdsToDelete.slice(i, i + batchSize);
            for (const duplicateDocId of chunk) {
                batch.delete(db.collection("festivals").doc(duplicateDocId));
            }
            await batch.commit();
        }

        return {
            inputCount: festivals.length,
            deduplicatedCount: deduplicatedFestivals.length,
            skippedDuplicateCount: duplicateCount,
            upsertedCount,
            cleanedDuplicateDocCount: duplicateDocIdsToDelete.length,
        };
    }

    private async prepareKnownIdsForIncrementalCrawl(cacheForRefresh: FestivalCacheState | null) {
        try {
            const knownIdsByPath = cacheForRefresh?.festivals?.length
                ? this.buildKnownFestivalLifeIdsByPath(cacheForRefresh.festivals)
                : await this.getKnownFestivalLifeIdsByPathFromFirestore();
            this.applyKnownIdsToAdapter(knownIdsByPath);
        } catch {
            console.warn("Failed to prepare known IDs for incremental crawl.");
        }
    }

    private async crawlFestivalsFromAdapters(): Promise<UnifiedFestival[]> {
        const { stdate, edate } = FestivalService.getDateRange();
        console.log(`🌐 Fetching from ${this.adapters.length} adapters...`);

        const results = await Promise.all(
            this.adapters.map((adapter) => adapter.fetchFestivals(stdate, edate))
        );

        return this.sortFestivals(
            results.flat().filter((festival) => this.isValidFestival(festival))
        );
    }

    private filterFestivalsPublishedOnDate(festivals: UnifiedFestival[], targetDate: string): UnifiedFestival[] {
        return festivals.filter((festival) => this.getFestivalPublishedDate(festival) === targetDate);
    }

    private filterFestivalsPublishedOnDates(
        festivals: UnifiedFestival[],
        targetDates: string[],
    ): UnifiedFestival[] {
        const normalizedDates = new Set(targetDates);
        return festivals.filter((festival) => {
            const publishedDate = this.getFestivalPublishedDate(festival);
            return !!publishedDate && normalizedDates.has(publishedDate);
        });
    }

    private filterFestivalsPublishedAfter(
        festivals: UnifiedFestival[],
        publishedAfter: string | undefined,
    ): UnifiedFestival[] {
        if (!publishedAfter) {
            return festivals;
        }

        const thresholdMs = new Date(publishedAfter).getTime();
        if (!Number.isFinite(thresholdMs)) {
            return festivals;
        }

        return festivals.filter((festival) => {
            const publishedTimeMs = this.getFestivalPublishedTimeMs(festival);
            return publishedTimeMs !== null && publishedTimeMs > thresholdMs;
        });
    }

    private normalizeTargetDates(targetDates: string[]): string[] {
        return Array.from(
            new Set(
                targetDates
                    .map((date) => date.trim())
                    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
            ),
        ).sort((a, b) => a.localeCompare(b));
    }

    /**
     * Calculates the date range: This week's Monday to Next week's Sunday.
     */
    static getDateRange() {
        const today = new Date();
        const day = today.getDay(); // 0 (Sun) to 6 (Sat)

        // This week's Monday
        const diffToMonday = day === 0 ? -6 : 1 - day;
        const monday = new Date(today);
        monday.setDate(today.getDate() + diffToMonday);

        // Extended to 70 days from Monday to ensure full 60-day coverage from any day of the week
        const nextSunday = new Date(monday);
        nextSunday.setDate(monday.getDate() + 70);

        const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');

        return {
            stdate: formatDate(monday),
            edate: formatDate(nextSunday),
            displayStart: monday.toISOString().split('T')[0],
            displayEnd: nextSunday.toISOString().split('T')[0]
        };
    }

    async syncTodayFestivals(options?: { disableIncremental?: boolean; publishedAfter?: string }): Promise<FestivalTodaySyncResult> {
        const syncDate = this.getYesterdayKST();
        const syncResult = await this.syncFestivalsByPublishedDates([syncDate], options);

        return {
            syncDate,
            crawledCount: syncResult.crawledCount,
            todayCount: syncResult.matchedCount,
            deduplicatedCount: syncResult.deduplicatedCount,
            skippedDuplicateCount: syncResult.skippedDuplicateCount,
            upsertedCount: syncResult.upsertedCount,
            cleanedDuplicateDocCount: syncResult.cleanedDuplicateDocCount,
            festivals: syncResult.festivals,
        };
    }

    async syncFestivalsByPublishedDates(
        targetDates: string[],
        options?: { disableIncremental?: boolean; publishedAfter?: string },
    ): Promise<FestivalPublishedDateSyncResult> {
        const normalizedTargetDates = this.normalizeTargetDates(targetDates);
        if (!db || !isFirebaseConfigured) {
            return {
                targetDates: normalizedTargetDates,
                crawledCount: 0,
                matchedCount: 0,
                deduplicatedCount: 0,
                skippedDuplicateCount: 0,
                upsertedCount: 0,
                cleanedDuplicateDocCount: 0,
                festivals: [],
            };
        }

        if (normalizedTargetDates.length === 0) {
            return {
                targetDates: [],
                crawledCount: 0,
                matchedCount: 0,
                deduplicatedCount: 0,
                skippedDuplicateCount: 0,
                upsertedCount: 0,
                cleanedDuplicateDocCount: 0,
                festivals: [],
            };
        }

        if (options?.disableIncremental) {
            this.applyKnownIdsToAdapter(new Map());
        } else {
            const cacheForRefresh = this.getFreshMemoryCache() ?? this.memoryCache;
            await this.prepareKnownIdsForIncrementalCrawl(cacheForRefresh);
        }

        const crawledFestivals = await this.crawlFestivalsFromAdapters();
        const matchedFestivals = this.filterFestivalsPublishedOnDates(crawledFestivals, normalizedTargetDates);
        const filteredFestivals = this.filterFestivalsPublishedAfter(
            matchedFestivals,
            options?.publishedAfter,
        );
        if (filteredFestivals.length === 0) {
            return {
                targetDates: normalizedTargetDates,
                crawledCount: crawledFestivals.length,
                matchedCount: 0,
                deduplicatedCount: 0,
                skippedDuplicateCount: 0,
                upsertedCount: 0,
                cleanedDuplicateDocCount: 0,
                festivals: [],
            };
        }

        const upsertSummary = await this.upsertFestivalsToFirestore(filteredFestivals);
        try {
            const cachedFromDb = await this.fetchCachedFestivalsFromFirestore();
            this.memoryCache = cachedFromDb;
        } catch {
            console.warn("Failed to refresh festival cache after festival sync.");
        }

        const deduplicatedFilteredFestivals = this.dedupeFestivals(filteredFestivals).deduplicatedFestivals;

        return {
            targetDates: normalizedTargetDates,
            crawledCount: crawledFestivals.length,
            matchedCount: filteredFestivals.length,
            deduplicatedCount: upsertSummary.deduplicatedCount,
            skippedDuplicateCount: upsertSummary.skippedDuplicateCount,
            upsertedCount: upsertSummary.upsertedCount,
            cleanedDuplicateDocCount: upsertSummary.cleanedDuplicateDocCount,
            festivals: deduplicatedFilteredFestivals,
        };
    }

    async updateFestivalsByGeminiResearch(festivalIds: string[]): Promise<FestivalNaverUpdateResult> {
        const uniqueFestivalIds = Array.from(new Set(festivalIds.map((id) => id.trim()).filter(Boolean)));
        if (uniqueFestivalIds.length === 0) {
            return {
                requestedCount: 0,
                processedCount: 0,
                updatedCount: 0,
                unchangedCount: 0,
                notFoundCount: 0,
                noMatchCount: 0,
                errorCount: 0,
                results: [],
            };
        }

        if (!db || !isFirebaseConfigured) {
            return {
                requestedCount: uniqueFestivalIds.length,
                processedCount: uniqueFestivalIds.length,
                updatedCount: 0,
                unchangedCount: 0,
                notFoundCount: 0,
                noMatchCount: 0,
                errorCount: uniqueFestivalIds.length,
                results: uniqueFestivalIds.map((festivalId) => ({
                    festivalId,
                    status: "error" as const,
                    message: "Firebase가 설정되지 않아 업데이트할 수 없습니다.",
                })),
            };
        }

        const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
        if (!geminiApiKey) {
            return {
                requestedCount: uniqueFestivalIds.length,
                processedCount: uniqueFestivalIds.length,
                updatedCount: 0,
                unchangedCount: 0,
                notFoundCount: 0,
                noMatchCount: 0,
                errorCount: uniqueFestivalIds.length,
                results: uniqueFestivalIds.map((festivalId) => ({
                    festivalId,
                    status: "error" as const,
                    message: "Gemini API Key가 설정되지 않아 AI 조사를 수행할 수 없습니다.",
                })),
            };
        }

        const festivalRecords = await this.getFestivalsByRequestedIds(uniqueFestivalIds);
        const results: FestivalNaverUpdateItem[] = [];
        let updatedCount = 0;
        let unchangedCount = 0;
        let notFoundCount = 0;
        let noMatchCount = 0;
        let errorCount = 0;

        for (const festivalId of uniqueFestivalIds) {
            const record = festivalRecords.get(festivalId);
            const searchedAt = new Date().toISOString();
            if (!record) {
                notFoundCount += 1;
                results.push({
                    festivalId,
                    status: "not-found",
                    searchedAt,
                    message: "선택한 페스티벌 정보를 DB에서 찾지 못했습니다.",
                });
                continue;
            }

            const { docId, festival } = record;
            try {
                const { output, patch, updatedFields, mergedDetails } = await this.researchFestivalWithGemini(festival);
                const researched = {
                    ticketPrice: output.ticketPrice || undefined,
                    venue: output.venue || undefined,
                    lineup: output.lineup || undefined,
                    performanceSchedule: output.performanceSchedule || undefined,
                    bookingSite: output.bookingSite || undefined,
                    sourceUrl: festival.sourceUrl,
                    startDate: output.startDate || festival.startDate,
                    endDate: output.endDate || festival.endDate,
                    location: output.venue || festival.location,
                    price: output.ticketPrice || festival.price,
                    homepage: output.bookingSite || festival.homepage,
                    description: output.evidenceSummary || undefined,
                    details: mergedDetails.length > 0 ? mergedDetails : undefined,
                };

                const requiredFieldChecklist = [
                    { label: "티켓 가격", value: researched.ticketPrice },
                    { label: "공연 장소", value: researched.venue },
                    { label: "라인업", value: researched.lineup },
                    { label: "공연 일정", value: researched.performanceSchedule },
                    { label: "예매처", value: researched.bookingSite },
                ];
                const missingRequiredFields = requiredFieldChecklist
                    .filter((field) => !field.value || field.value.trim().length === 0)
                    .map((field) => field.label);
                const requiredFieldSummaryMessage = missingRequiredFields.length === 0
                    ? "요청한 필수 조사 항목 5개를 모두 확보했습니다."
                    : `필수 조사 항목 미확보: ${missingRequiredFields.join(", ")}`;

                if (requiredFieldChecklist.every((field) => !field.value || field.value.trim().length === 0)) {
                    noMatchCount += 1;
                    results.push({
                        festivalId,
                        title: festival.title,
                        status: "no-match",
                        searchedAt,
                        researched,
                        message: `Gemini 조사에서 필수 항목 근거를 충분히 찾지 못했습니다. ${requiredFieldSummaryMessage}`,
                    });
                    continue;
                }
                if (updatedFields.length === 0) {
                    unchangedCount += 1;
                    results.push({
                        festivalId,
                        title: festival.title,
                        status: "unchanged",
                        searchedAt,
                        researched,
                        message: `업데이트할 변경점이 없습니다. ${requiredFieldSummaryMessage}`,
                    });
                    continue;
                }

                await db.collection("festivals").doc(docId).set({
                    ...patch,
                    updatedAt: new Date().toISOString(),
                }, { merge: true });

                updatedCount += 1;
                results.push({
                    festivalId,
                    title: festival.title,
                    status: "updated",
                    searchedAt,
                    updatedFields,
                    researched,
                    message: requiredFieldSummaryMessage,
                });
            } catch (error) {
                errorCount += 1;
                results.push({
                    festivalId,
                    title: festival.title,
                    status: "error",
                    searchedAt,
                    message: error instanceof Error ? error.message : "Gemini 기반 업데이트 처리 중 오류가 발생했습니다.",
                });
            }
        }

        if (updatedCount > 0) {
            try {
                const cachedFromDb = await this.fetchCachedFestivalsFromFirestore();
                this.memoryCache = cachedFromDb;
            } catch {
                console.warn("Failed to refresh festival cache after AI research update.");
            }
        }

        return {
            requestedCount: uniqueFestivalIds.length,
            processedCount: results.length,
            updatedCount,
            unchangedCount,
            notFoundCount,
            noMatchCount,
            errorCount,
            results,
        };
    }

    // Backward compatibility for legacy route name.
    async updateFestivalsByNaverSearch(festivalIds: string[]): Promise<FestivalNaverUpdateResult> {
        return this.updateFestivalsByGeminiResearch(festivalIds);
    }

    async getFestivals(forceRefresh = false): Promise<UnifiedFestival[]> {
        if (!db || !isFirebaseConfigured) {
            console.warn("Firestore is not configured. DB-only mode requires a valid Firebase setup.");
            return [];
        }

        const freshCache = this.getFreshMemoryCache();
        if (!forceRefresh && freshCache && freshCache.festivals.length > 0) {
            return freshCache.festivals;
        }

        // 1. Serve from Firestore cache with request de-duplication.
        if (!forceRefresh) {
            if (this.firestoreLoadInFlight) {
                return this.firestoreLoadInFlight;
            }

            this.firestoreLoadInFlight = (async () => {
                try {
                    const cachedFromDb = await this.fetchCachedFestivalsFromFirestore();
                    this.memoryCache = cachedFromDb;
                    if (cachedFromDb.festivals.length > 0) {
                        console.log("🚀 Serving from Firestore cache");
                        return cachedFromDb.festivals;
                    }
                } catch {
                    console.warn("Firestore query failed.");
                }

                if (freshCache && freshCache.festivals.length > 0) {
                    return freshCache.festivals;
                }

                return [];
            })();

            try {
                return await this.firestoreLoadInFlight;
            } finally {
                this.firestoreLoadInFlight = null;
            }
        }

        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }

        // 2. Force refresh path (crawl + upsert), deduplicated across concurrent requests.
        this.refreshInFlight = (async () => {
            const cacheForRefresh = this.getFreshMemoryCache() ?? this.memoryCache;

            try {
                const syncResult = await this.syncTodayFestivals();
                if (syncResult.todayCount === 0) {
                    console.warn("Live crawl returned no festivals published on target date:", syncResult.syncDate);
                }
            } catch (error) {
                console.error("Festival refresh sync failed:", error);
            }

            try {
                const cachedFromDb = await this.fetchCachedFestivalsFromFirestore();
                this.memoryCache = cachedFromDb;
                if (cachedFromDb.festivals.length > 0) {
                    return cachedFromDb.festivals;
                }
            } catch {
                console.warn("Cache fallback failed after refresh sync.");
            }

            if (cacheForRefresh?.festivals.length) {
                console.warn("Using in-memory festivals because refresh sync returned empty.");
                return cacheForRefresh.festivals;
            }

            return [];
        })();

        try {
            return await this.refreshInFlight;
        } finally {
            this.refreshInFlight = null;
        }
    }

    getLastUpdated(): string | null {
        return this.getFreshMemoryCache()?.lastUpdated ?? this.memoryCache?.lastUpdated ?? null;
    }
}

export const festivalService = new FestivalService();

export async function getFestivalLastUpdated(): Promise<string | null> {
    return festivalService.getLastUpdated();
}
