import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { resolveUidFromRequest } from "@/lib/api-auth";
import { getUserCardnewsCollection } from "@/lib/firestore-cardnews";
import { getCardnewsListCache, setCardnewsListCache } from "@/lib/services/cardnews-list-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CardnewsStatus = "draft" | "published";
type CardnewsStatusFilter = CardnewsStatus | "all";

type CardnewsSummary = {
  id: string;
  status: CardnewsStatus;
  title: string;
  slideCount: number;
  imageUrl: string | null;
  sourceLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asStatus = (value: unknown): CardnewsStatus => (value === "published" ? "published" : "draft");

const asNumber = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);


const parseLimit = (value: string | null, fallback = 10) => {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 100));
};

const parsePage = (value: string | null) => {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 10_000));
};

const parseStatusFilter = (value: string | null): CardnewsStatusFilter | null => {
  if (!value || value === "all") return "all";
  if (value === "draft" || value === "published") return value;
  return null;
};

const getListCacheMs = () => {
  const raw = Number(process.env.CARDNEWS_LIST_CACHE_MS ?? "120000");
  if (!Number.isFinite(raw)) return 120000;
  return Math.min(Math.max(raw, 15_000), 10 * 60_000);
};

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await resolveUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = parseStatusFilter(searchParams.get("status"));
    if (!statusFilter) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const legacyLimit = parseLimit(searchParams.get("limit"), 10);
    const pageSize = parseLimit(searchParams.get("pageSize"), legacyLimit);
    const requestedPage = parsePage(searchParams.get("page"));
    const cacheKey = `${uid}:${statusFilter}:${requestedPage}:${pageSize}`;
    const now = Date.now();
    const cached = getCardnewsListCache(cacheKey);
    if (cached && cached.expiresAt > now) {
      const response = NextResponse.json({ items: cached.items, pagination: cached.pagination });
      response.headers.set("Cache-Control", "private, max-age=30");
      return response;
    }

    const query = statusFilter === "all"
      ? getUserCardnewsCollection(uid)
      : getUserCardnewsCollection(uid).where("status", "==", statusFilter);

    const totalSnapshot = await query.count().get();
    const total = Number(totalSnapshot.data().count || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;

    const snap = await query
      .orderBy("updatedAt", "desc")
      .offset(offset)
      .limit(pageSize)
      .get();

    const items: CardnewsSummary[] = snap.docs.map((doc) => {
      const data = (doc.data() || {}) as Record<string, unknown>;
      const slides = Array.isArray(data.slides) ? data.slides : [];
      const firstSlide = slides[0] && typeof slides[0] === "object" ? (slides[0] as Record<string, unknown>) : null;
      const slideTitle = firstSlide ? asNonEmptyString(firstSlide.title) : null;
      const sourceLabel = asNonEmptyString(data.sourceLabel);
      const customTitle = asNonEmptyString(data.customTitle);
      const title = customTitle || sourceLabel || slideTitle || "카드뉴스";

      return {
        id: doc.id,
        status: asStatus(data.status),
        title,
        slideCount: asNumber(data.slideCount, slides.length || 0),
        imageUrl: asNonEmptyString(data.previewImageUrl) || asNonEmptyString(data.imageUrl),
        sourceLabel,
        createdAt: asNonEmptyString(data.createdAt),
        updatedAt: asNonEmptyString(data.updatedAt),
        publishedAt: asNonEmptyString(data.publishedAt),
      };
    });

    const pagination = {
      page,
      pageSize,
      total,
      totalPages,
    };

    setCardnewsListCache(cacheKey, {
      items,
      pagination,
      expiresAt: now + getListCacheMs(),
    });

    const response = NextResponse.json({ items, pagination });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("Failed to list cardnews:", error);
    return NextResponse.json({ error: "Failed to list cardnews" }, { status: 500 });
  }
}
