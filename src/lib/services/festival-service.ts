import { UnifiedFestival } from "@/types/festival";
import { FestivalLifeAdapter } from "../adapters/festival-life-adapter";
import { db, isFirebaseConfigured } from "../firebase-admin";

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

export class FestivalService {
    private adapters = [new FestivalLifeAdapter()];
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

    private buildFestivalDedupeKey(festival: Partial<UnifiedFestival>): string | null {
        const source = typeof festival.source === "string" ? festival.source : "";
        if (!source) return null;

        if (typeof festival.sourceUrl === "string" && festival.sourceUrl.trim().length > 0) {
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

        const snapshot = await db.collection("festivals")
            .where("source", "==", "FESTIVAL_LIFE")
            .get();

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
            festivals: this.sortFestivals(festivals.filter((festival) => this.isValidFestival(festival))),
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

        const snapshot = await db.collection("festivals")
            .where("source", "==", "FESTIVAL_LIFE")
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

        return {
            targetDates: normalizedTargetDates,
            crawledCount: crawledFestivals.length,
            matchedCount: filteredFestivals.length,
            deduplicatedCount: upsertSummary.deduplicatedCount,
            skippedDuplicateCount: upsertSummary.skippedDuplicateCount,
            upsertedCount: upsertSummary.upsertedCount,
            cleanedDuplicateDocCount: upsertSummary.cleanedDuplicateDocCount,
            festivals: this.sortFestivals(filteredFestivals),
        };
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
