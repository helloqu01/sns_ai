import { NextRequest, NextResponse } from "next/server";
import { festivalService, getFestivalLastUpdated } from "@/lib/services/festival-service";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get('refresh') === 'true';
    const delta = searchParams.get('delta') === 'true';
    const since = searchParams.get('since')?.trim() || undefined;

    try {
        const festivals = refresh && delta
            ? (await festivalService.syncTodayFestivals({ publishedAfter: since })).festivals
            : await festivalService.getFestivals(refresh);
        const response = NextResponse.json(festivals);
        const lastUpdated = await getFestivalLastUpdated();
        if (lastUpdated) {
            response.headers.set("x-festivals-last-updated", lastUpdated);
        }
        response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return response;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal Server Error";
        console.error("API Festival Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

const isAuthorizedFestivalSyncRequest = (req: NextRequest): boolean => {
    const expectedSecret = process.env.FESTIVAL_SYNC_SECRET?.trim();
    if (!expectedSecret) return false;

    const headerSecret = req.headers.get("x-festival-sync-secret")?.trim();
    if (headerSecret && headerSecret === expectedSecret) {
        return true;
    }

    const bearer = req.headers.get("authorization")?.trim();
    if (bearer?.startsWith("Bearer ")) {
        const token = bearer.slice(7).trim();
        if (token === expectedSecret) {
            return true;
        }
    }

    return false;
};

export async function POST(req: NextRequest) {
    const expectedSecret = process.env.FESTIVAL_SYNC_SECRET?.trim();
    if (!expectedSecret) {
        return NextResponse.json(
            { error: "FESTIVAL_SYNC_SECRET is not configured." },
            { status: 500 },
        );
    }

    if (!isAuthorizedFestivalSyncRequest(req)) {
        return NextResponse.json(
            { error: "Unauthorized festival sync request." },
            { status: 401 },
        );
    }

    try {
        const body = await req.json().catch(() => null) as {
            dates?: unknown;
            disableIncremental?: unknown;
        } | null;
        const targetDates = Array.isArray(body?.dates)
            ? body.dates.filter((date): date is string => typeof date === "string")
            : [];
        const disableIncremental = body?.disableIncremental === true;

        const syncResult = targetDates.length > 0
            ? await festivalService.syncFestivalsByPublishedDates(targetDates, { disableIncremental })
            : await festivalService.syncTodayFestivals();
        const { festivals, ...summary } = syncResult;
        return NextResponse.json({
            ok: true,
            ...summary,
            syncedFestivalCount: festivals.length,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal Server Error";
        console.error("API Festival Sync Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
