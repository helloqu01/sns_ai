import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  cancelInstagramPublishingRecord,
  countInstagramPublishingRecords,
  createInstagramPublishingRecord,
  getMetaRequestUid,
  InstagramPublishingRecordNotFoundError,
  listInstagramPublishingRecords,
} from "@/lib/services/instagram-publishing";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { deleteCardnewsSlideAssets, materializeCardnewsSlides, type CardnewsAssetSlide } from "@/lib/services/cardnews-assets";
import { readInstagramIntegration } from "@/lib/services/meta-integration-cache";
import type { InstagramPublishMode, InstagramPublishingStatus } from "@/types/instagram-publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseMode = (value: unknown): InstagramPublishMode => {
  return value === "schedule" || value === "scheduled" ? "scheduled" : "now";
};

const parseIsoDateTime = (value: string | null) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const parsePositiveInt = (value: string | null, fallback: number, min = 1, max = 100) => {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const parseStatusFilter = (value: string | null) => {
  if (!value || value === "all") {
    return [] as InstagramPublishingStatus[];
  }
  if (value === "in-progress") {
    return ["queued", "publishing"] as InstagramPublishingStatus[];
  }
  if (value === "queued" || value === "scheduled" || value === "publishing" || value === "published" || value === "failed") {
    return [value] as InstagramPublishingStatus[];
  }
  return null;
};

const parsePublishModeFilter = (value: string | null): InstagramPublishMode | null | "invalid" => {
  if (!value || value === "all") return null;
  if (value === "now" || value === "scheduled") return value;
  return "invalid";
};

const isValidImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const parseSlideImageUrls = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => Boolean(item))
    .filter((item) => isValidImageUrl(item));
};

const parseSlides = (value: unknown) => {
  if (!Array.isArray(value)) return [] as CardnewsAssetSlide[];
  return value
    .map((item): CardnewsAssetSlide | null => {
      if (!item || typeof item !== "object") return null;
      const slide = item as Record<string, unknown>;
      const title = asNonEmptyString(slide.title);
      const body = asNonEmptyString(slide.body);
      const content = asNonEmptyString(slide.content);
      const keywords = asNonEmptyString(slide.keywords);
      const image = asNonEmptyString(slide.image);
      if (!title && !body && !content && !keywords && !image) {
        return null;
      }
      return {
        title,
        body,
        content,
        keywords,
        image,
      } satisfies CardnewsAssetSlide;
    })
    .filter((slide): slide is CardnewsAssetSlide => Boolean(slide));
};

const buildPreviewRenderUrl = (params: {
  origin: string;
  slide: CardnewsAssetSlide;
  ratio?: string | null;
  backgroundImageUrl?: string | null;
}) => {
  const url = new URL("/api/cardnews/slide-image", params.origin);
  url.searchParams.set("title", (params.slide.title || "슬라이드 1").slice(0, 80));
  url.searchParams.set("body", (params.slide.body || params.slide.content || "").slice(0, 260));
  url.searchParams.set("ratio", asNonEmptyString(params.ratio) || "4:5");
  url.searchParams.set("index", "1");
  if (asNonEmptyString(params.backgroundImageUrl)) {
    url.searchParams.set("bg", asNonEmptyString(params.backgroundImageUrl) || "");
  }
  return url.toString();
};

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getMetaRequestUid(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = new URL(req.url).searchParams;
    const limit = parsePositiveInt(searchParams.get("limit"), 24);
    const page = parsePositiveInt(searchParams.get("page"), 1, 1, 10_000);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), limit);
    const createdFrom = parseIsoDateTime(searchParams.get("from"));
    const createdTo = parseIsoDateTime(searchParams.get("to"));
    const statuses = parseStatusFilter(searchParams.get("status"));
    const publishMode = parsePublishModeFilter(searchParams.get("mode"));
    const scope = asNonEmptyString(searchParams.get("accountScope"));

    if (searchParams.get("from") && !createdFrom) {
      return NextResponse.json({ error: "Invalid from datetime" }, { status: 400 });
    }
    if (searchParams.get("to") && !createdTo) {
      return NextResponse.json({ error: "Invalid to datetime" }, { status: 400 });
    }
    if (createdFrom && createdTo && createdFrom >= createdTo) {
      return NextResponse.json({ error: "Invalid datetime range" }, { status: 400 });
    }
    if (statuses === null) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    if (publishMode === "invalid") {
      return NextResponse.json({ error: "Invalid mode filter" }, { status: 400 });
    }

    let activeIgUserId: string | null = null;
    if (scope !== "all") {
      const integration = await readInstagramIntegration(uid);
      activeIgUserId = asNonEmptyString(integration?.igUserId);
    }

    const shouldCountForPagination =
      searchParams.has("page")
      || searchParams.has("pageSize")
      || searchParams.has("status")
      || searchParams.has("mode");

    const posts = await listInstagramPublishingRecords(uid, {
      limit,
      createdFrom,
      createdTo,
      statuses,
      publishMode,
      page,
      pageSize,
      igUserId: activeIgUserId,
    });
    const total = shouldCountForPagination
      ? await countInstagramPublishingRecords(uid, {
        createdFrom,
        createdTo,
        statuses,
        publishMode,
        igUserId: activeIgUserId,
      })
      : posts.length;

    const baseCountOptions = {
      createdFrom,
      createdTo,
      igUserId: activeIgUserId,
    };

    const [
      summaryTotal,
      queuedCount,
      scheduledCount,
      publishingCount,
      publishedCount,
      failedCount,
    ] = await Promise.all([
      countInstagramPublishingRecords(uid, baseCountOptions),
      countInstagramPublishingRecords(uid, { ...baseCountOptions, statuses: ["queued"] }),
      countInstagramPublishingRecords(uid, { ...baseCountOptions, statuses: ["scheduled"] }),
      countInstagramPublishingRecords(uid, { ...baseCountOptions, statuses: ["publishing"] }),
      countInstagramPublishingRecords(uid, { ...baseCountOptions, statuses: ["published"] }),
      countInstagramPublishingRecords(uid, { ...baseCountOptions, statuses: ["failed"] }),
    ]);

    const counts = {
      total: summaryTotal,
      queued: queuedCount,
      scheduled: scheduledCount,
      publishing: publishingCount,
      published: publishedCount,
      failed: failedCount,
    };

    return NextResponse.json({
      posts,
      counts,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: shouldCountForPagination ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      },
    });
  } catch (error) {
    console.error("Instagram publishing list failed:", error);
    const message = error instanceof Error ? error.message : "Failed to load instagram publishing records";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  let cleanupUid: string | null = null;
  let tempPublishAssetId: string | null = null;

  try {
    const uid = await getMetaRequestUid(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    cleanupUid = uid;

    const requestOrigin = new URL(req.url).origin;

    const body = (await req.json()) as {
      caption?: unknown;
      imageUrl?: unknown;
      slideImageUrls?: unknown;
      slides?: unknown;
      aspectRatio?: unknown;
      backgroundImageUrl?: unknown;
      festivalId?: unknown;
      festivalTitle?: unknown;
      mode?: unknown;
      scheduledFor?: unknown;
    };

    const caption = asNonEmptyString(body.caption);
    const imageUrl = asNonEmptyString(body.imageUrl);
    const fallbackSlideImageUrls = parseSlideImageUrls(body.slideImageUrls);
    const slides = parseSlides(body.slides);
    const aspectRatio = asNonEmptyString(body.aspectRatio);
    const backgroundImageUrl = asNonEmptyString(body.backgroundImageUrl) || imageUrl;
    const festivalId = asNonEmptyString(body.festivalId);
    const festivalTitle = asNonEmptyString(body.festivalTitle);
    const mode = parseMode(body.mode);
    const scheduledFor = asNonEmptyString(body.scheduledFor);
    const tentativePublishAssetId = slides.length > 0 ? `publish-${randomUUID()}` : null;
    tempPublishAssetId = tentativePublishAssetId;
    const materialized = slides.length > 0 && tentativePublishAssetId
      ? await materializeCardnewsSlides({
          uid,
          cardnewsId: tentativePublishAssetId,
          slides,
          aspectRatio,
          backgroundImageUrl,
        })
      : null;
    const publishAssetId = materialized ? tentativePublishAssetId : null;
    if (!publishAssetId) {
      tempPublishAssetId = null;
    }
    const slideImageUrls = materialized?.slideImageUrls || fallbackSlideImageUrls;
    const primaryImageUrl = slides[0]
      ? buildPreviewRenderUrl({
          origin: requestOrigin,
          slide: slides[0],
          ratio: aspectRatio,
          backgroundImageUrl,
        })
      : (slideImageUrls[0] || imageUrl);

    if (!caption) {
      if (cleanupUid && tempPublishAssetId) {
        await deleteCardnewsSlideAssets(cleanupUid, tempPublishAssetId).catch(() => undefined);
      }
      return NextResponse.json({ error: "caption is required" }, { status: 400 });
    }
    if (!primaryImageUrl || !isValidImageUrl(primaryImageUrl)) {
      if (cleanupUid && tempPublishAssetId) {
        await deleteCardnewsSlideAssets(cleanupUid, tempPublishAssetId).catch(() => undefined);
      }
      return NextResponse.json({ error: "Valid imageUrl is required" }, { status: 400 });
    }

    if (mode === "scheduled") {
      if (!scheduledFor) {
        if (cleanupUid && tempPublishAssetId) {
          await deleteCardnewsSlideAssets(cleanupUid, tempPublishAssetId).catch(() => undefined);
        }
        return NextResponse.json({ error: "scheduledFor is required" }, { status: 400 });
      }
      const scheduledDate = new Date(scheduledFor);
      if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        if (cleanupUid && tempPublishAssetId) {
          await deleteCardnewsSlideAssets(cleanupUid, tempPublishAssetId).catch(() => undefined);
        }
        return NextResponse.json({ error: "scheduledFor must be a future datetime" }, { status: 400 });
      }
    }

    const record = await createInstagramPublishingRecord(
      uid,
      {
        caption,
        imageUrl: primaryImageUrl,
        slideImageUrls,
        publishAssetId,
        festivalId,
        festivalTitle,
        scheduledFor,
      },
      mode,
    );
    tempPublishAssetId = null;

    if (mode === "scheduled") {
      return NextResponse.json({ post: record }, { status: 201 });
    }

    return NextResponse.json({ post: record }, { status: 201 });
  } catch (error) {
    if (cleanupUid && tempPublishAssetId) {
      await deleteCardnewsSlideAssets(cleanupUid, tempPublishAssetId).catch(() => undefined);
    }
    console.error("Instagram publish create failed:", error);
    const message = error instanceof Error ? error.message : "Failed to create instagram publishing record";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getMetaRequestUid(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = new URL(req.url).searchParams;
    const body = (await req.json().catch(() => ({}))) as { id?: unknown };
    const recordId = asNonEmptyString(searchParams.get("id")) || asNonEmptyString(body.id);
    if (!recordId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const canceled = await cancelInstagramPublishingRecord(uid, recordId);
    return NextResponse.json({
      ok: true,
      canceled: {
        id: canceled.id,
        status: canceled.status,
        scheduledFor: canceled.scheduledFor,
      },
    });
  } catch (error) {
    if (error instanceof InstagramPublishingRecordNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Failed to cancel instagram publishing record";
    const status = /취소할 수 없습니다/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
