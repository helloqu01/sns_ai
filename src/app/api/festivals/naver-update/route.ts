import { NextRequest, NextResponse } from "next/server";
import { festivalService } from "@/lib/services/festival-service";

export const runtime = "nodejs";
export const revalidate = 0;

const resolveMaxBatchSize = () => {
    const fallback = 30;
    const min = 1;
    const max = 100;
    const raw = Number.parseInt(process.env.FESTIVAL_NAVER_UPDATE_MAX_IDS || String(fallback), 10);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(Math.max(raw, min), max);
};

const toFestivalIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
};

export async function POST(req: NextRequest) {
    const maxBatchSize = resolveMaxBatchSize();

    try {
        const body = await req.json().catch(() => null) as { festivalIds?: unknown } | null;
        const festivalIds = toFestivalIds(body?.festivalIds);

        if (festivalIds.length === 0) {
            return NextResponse.json(
                { error: "festivalIds 배열에 하나 이상의 ID를 전달해야 합니다." },
                { status: 400 },
            );
        }

        if (festivalIds.length > maxBatchSize) {
            return NextResponse.json(
                { error: `한 번에 최대 ${maxBatchSize}개까지만 업데이트할 수 있습니다.` },
                { status: 400 },
            );
        }

        const result = await festivalService.updateFestivalsByGeminiResearch(festivalIds);
        return NextResponse.json({
            ok: true,
            ...result,
        });
    } catch (error: unknown) {
        console.error("API Festival AI Research Update Error:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
