import { FestivalAdapter } from "./festival-adapter";
import { UnifiedFestival } from "@/types/festival";
import { XMLParser } from "fast-xml-parser";

export class KopisAdapter extends FestivalAdapter {
    sourceName = "KOPIS" as const;
    private apiKey = process.env.KOPIS_API_KEY;
    private baseUrl = "http://www.kopis.or.kr/openApi/restful/pblprfr";
    private detailUrl = "http://www.kopis.or.kr/openApi/restful/pblprfr";

    constructor() {
        super();
        if (!this.apiKey) {
            console.warn("⚠️ KOPIS_API_KEY is not defined in environment variables.");
        }
    }

    private categorizeGenre(title: string, genrenm: string): string {
        if (title.includes("축제") || title.includes("페스티벌") || title.toLowerCase().includes("festival")) {
            return "축제";
        }
        if (genrenm.includes("뮤지컬")) return "뮤지컬";
        if (genrenm.includes("연극")) return "연극";
        if (genrenm.includes("대중음악") || genrenm.includes("콘서트")) return "콘서트";
        return genrenm || "기타";
    }

    async fetchFestivals(stdate: string, edate: string): Promise<UnifiedFestival[]> {
        if (!this.apiKey) return [];

        const allFestivals: UnifiedFestival[] = [];
        const seenIds = new Set<string>();
        const rowsPerPage = 100; // KOPIS API max rows per request

        // Helper to parse YYYYMMDD to Date
        const parseDate = (str: string) => {
            const y = parseInt(str.substring(0, 4));
            const m = parseInt(str.substring(4, 6)) - 1;
            const d = parseInt(str.substring(6, 8));
            return new Date(y, m, d);
        };

        // Helper to format Date to YYYYMMDD
        const formatDate = (date: Date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${d}`;
        };

        let currentStart = parseDate(stdate);
        const finalEnd = parseDate(edate);

        while (currentStart <= finalEnd) {
            let currentEnd = new Date(currentStart);
            currentEnd.setDate(currentStart.getDate() + 29); // 30-day window including start

            if (currentEnd > finalEnd) {
                currentEnd = finalEnd;
            }

            const chunkSt = formatDate(currentStart);
            const chunkEd = formatDate(currentEnd);

            console.log(`📡 KOPIS: Fetching chunk ${chunkSt} to ${chunkEd}`);

            try {
                let currentPage = 1;
                let hasNextPage = true;

                while (hasNextPage) {
                    const params = new URLSearchParams({
                        service: this.apiKey,
                        stdate: chunkSt,
                        eddate: chunkEd,
                        cpage: String(currentPage),
                        rows: String(rowsPerPage),
                        shcate: "GGGA|KPOP|AAAA|CCCA",
                    });

                    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
                    if (!response.ok) throw new Error(`KOPIS API response not OK: ${response.status}`);

                    const xmlData = await response.text();
                    const parser = new XMLParser();
                    const jsonObj = parser.parse(xmlData);

                    const items = jsonObj.dbs?.db || [];
                    const itemList = Array.isArray(items) ? items : [items];

                    if (itemList.length === 0) {
                        break;
                    }

                    if (itemList.length === 1 && itemList[0]?.returncode) {
                        console.warn(`KOPIS API returned code ${itemList[0].returncode}: ${itemList[0].errmsg || "Unknown error"}`);
                        break;
                    }

                    for (const item of itemList) {
                        if (!item.mt20id || seenIds.has(item.mt20id)) continue;

                        seenIds.add(item.mt20id);

                        const posterUrl = typeof item.poster === "string" ? item.poster.replace(/^http:\/\//, "https://") : "";
                        const title = item.prfnm || "제목 정보 없음";
                        const rawGenre = item.genrenm || "기타";

                        allFestivals.push({
                            id: item.mt20id,
                            title,
                            location: item.fcltynm || "장소 정보 없음",
                            startDate: (item.prfpdfrom || "").replace(/\./g, "-"),
                            endDate: (item.prfpdto || "").replace(/\./g, "-"),
                            imageUrl: posterUrl,
                            source: "KOPIS",
                            sourceLabel: "KOPIS",
                            sourceUrl: `https://kopis.or.kr/por/db/pblprfr/pblprfrView.do?mt20id=${item.mt20id}`,
                            genre: this.categorizeGenre(title, rawGenre),
                        });
                    }

                    // Continue while we get full page size; otherwise chunk is exhausted.
                    hasNextPage = itemList.length >= rowsPerPage;
                    currentPage += 1;
                }
            } catch (error) {
                console.error(`Error fetching chunk ${chunkSt}-${chunkEd} from KOPIS:`, error);
                // Continue to next chunk even if one fails
            }

            // Move to next chunk: currentEnd + 1 day
            currentStart = new Date(currentEnd);
            currentStart.setDate(currentEnd.getDate() + 1);
        }

        return allFestivals;
    }

    async fetchDetail(id: string): Promise<Partial<UnifiedFestival>> {
        if (!this.apiKey) return {};

        try {
            const response = await fetch(`${this.detailUrl}/${id}?service=${this.apiKey}`);
            const xmlData = await response.text();
            const parser = new XMLParser();
            const jsonObj = parser.parse(xmlData);

            const db = jsonObj.dbs?.db;
            if (!db) return {};

            return {
                description: db.relateurl || "",
                price: db.pcseguidance,
                contact: db.dtguidance,
                homepage: db.relateurl, // Often used for ticket links
            };
        } catch (error) {
            console.error("Error fetching KOPIS detail:", error);
            return {};
        }
    }
}
