import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { getUserCardnewsCollection } from "@/lib/firestore-cardnews";

type DashboardStatsPayload = {
  publishedCardnewsCount: number;
  draftCardnewsCount: number;
  updatedAt: string | null;
};

type StatsCacheEntry = {
  payload: DashboardStatsPayload;
  expiresAt: number;
};

type StatsCacheGlobal = typeof globalThis & {
  __dashboardStatsCache?: Record<string, StatsCacheEntry>;
};

const globalForStatsCache = globalThis as StatsCacheGlobal;

const DEFAULT_STATS_CACHE_MS = 10 * 60_000;
const MIN_STATS_CACHE_MS = 30_000;
const MAX_STATS_CACHE_MS = 10 * 60_000;

const getStatsCacheMs = () => {
  const raw = Number(process.env.DASHBOARD_STATS_CACHE_MS ?? DEFAULT_STATS_CACHE_MS);
  if (!Number.isFinite(raw)) return DEFAULT_STATS_CACHE_MS;
  return Math.min(Math.max(raw, MIN_STATS_CACHE_MS), MAX_STATS_CACHE_MS);
};

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
};

const getCountByStatus = async (uid: string, status: "draft" | "published") => {
  if (!db) return 0;
  try {
    const aggregate = await getUserCardnewsCollection(uid).where("status", "==", status).count().get();
    const value = aggregate.data().count;
    if (typeof value === "number") {
      return value;
    }
  } catch {
    // Fallback for environments where count aggregation is unavailable.
  }
  const snapshot = await getUserCardnewsCollection(uid).where("status", "==", status).get();
  return snapshot.size;
};

const getDefaultPayload = (): DashboardStatsPayload => ({
  publishedCardnewsCount: 0,
  draftCardnewsCount: 0,
  updatedAt: null,
});

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json(getDefaultPayload());
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

    const now = Date.now();
    const cached = globalForStatsCache.__dashboardStatsCache?.[uid];
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload);
    }

    const [draftCardnewsCount, publishedCardnewsCount] = await Promise.all([
      getCountByStatus(uid, "draft"),
      getCountByStatus(uid, "published"),
    ]);
    const payload: DashboardStatsPayload = {
      draftCardnewsCount,
      publishedCardnewsCount,
      updatedAt: new Date().toISOString(),
    };

    if (!globalForStatsCache.__dashboardStatsCache) {
      globalForStatsCache.__dashboardStatsCache = {};
    }
    globalForStatsCache.__dashboardStatsCache[uid] = {
      payload,
      expiresAt: now + getStatsCacheMs(),
    };

    const response = NextResponse.json(payload);
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json(getDefaultPayload(), { status: 200 });
  }
}
