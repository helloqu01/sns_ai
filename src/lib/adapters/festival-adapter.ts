import { UnifiedFestival } from "@/types/festival";

export abstract class FestivalAdapter {
    abstract sourceName: string;

    /**
     * Fetches festivals within the given date range.
     * @param stdate Start date (YYYYMMDD)
     * @param edate End date (YYYYMMDD)
     */
    abstract fetchFestivals(stdate: string, edate: string): Promise<UnifiedFestival[]>;

    /**
     * Fetches details for a specific festival.
     */
    abstract fetchDetail(id: string): Promise<Partial<UnifiedFestival>>;
}
