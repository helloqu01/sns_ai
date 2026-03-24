export type FestivalSource = 'KOPIS' | 'FESTIVAL_LIFE' | 'MELON_TICKET' | 'WEB_CRAWL' | 'MANUAL';

export interface FestivalDetailSection {
    label: string;
    value: string;
}

export interface UnifiedFestival {
    id: string;          // Original source ID
    title: string;       // Festival name
    location: string;    // Venue name/location
    startDate: string;   // YYYY-MM-DD
    endDate: string;     // YYYY-MM-DD
    publishedDate?: string; // 게시물 등록일 (KST, YYYY-MM-DD)
    publishedAt?: string; // 게시물 등록 시각 (ISO)
    updatedAt?: string; // DB 저장/갱신 시각 (ISO)
    imageUrl: string;    // Main poster image URL
    source: FestivalSource;
    sourceLabel?: string; // e.g., '페스티벌 라이프', 'KOPIS'
    sourceUrl?: string;   // Original page link
    genre: string;       // Native tags or genre from source
    description?: string;
    lineup?: string;
    price?: string;
    contact?: string;
    homepage?: string;
    details?: FestivalDetailSection[];
    coordinate?: {
        lat: number;
        lng: number;
    };
    services?: string[]; // e.g., '퀸즈스마일 유료셔틀', 'F&B 부스'
    interestScore?: number; // 관심도 점수 (높을수록 관심)
    interestSource?: string; // 예: 'NAVER_DATALAB', 'GOOGLE_TRENDS', 'MANUAL'
    interestUpdatedAt?: string; // ISO timestamp
    interestKeywords?: string[]; // 검색 키워드 힌트
}
