import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { getUserCardnewsCollection } from "@/lib/firestore-cardnews";
import { deleteCardnewsSlideAssets } from "@/lib/services/cardnews-assets";
import { invalidateCardnewsListCache } from "@/lib/services/cardnews-list-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CardnewsStatus = "draft" | "published";

type CardnewsSlide = {
  title: string;
  body: string;
  keywords?: string;
  image?: string | null;
  renderedImageUrl?: string | null;
  textPosition?: "top" | "center" | "bottom";
  textOffsetX?: number;
  textOffsetY?: number;
  titleOffsetX?: number;
  titleOffsetY?: number;
  bodyOffsetX?: number;
  bodyOffsetY?: number;
  titleTextStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: number;
  };
  bodyTextStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: number;
  };
};

type CardnewsDetail = {
  id: string;
  status: CardnewsStatus;
  title: string;
  customTitle: string | null;
  slideCount: number;
  imageUrl: string | null;
  previewImageUrl: string | null;
  sourceLabel: string | null;
  source: string | null;
  content: string | null;
  style: string | null;
  target: string | null;
  genre: string | null;
  aspectRatio: string | null;
  tone: string | null;
  captionStyle: string | null;
  caption: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  slides: CardnewsSlide[];
};

type UpdateBody = {
  status?: unknown;
  customTitle?: unknown;
  sourceLabel?: unknown;
  imageUrl?: unknown;
  source?: unknown;
  content?: unknown;
  style?: unknown;
  target?: unknown;
  genre?: unknown;
  aspectRatio?: unknown;
  tone?: unknown;
  captionStyle?: unknown;
  caption?: unknown;
  slides?: unknown;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  return value.trim();
};

const asFiniteNumber = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const asTextPosition = (value: unknown): CardnewsSlide["textPosition"] => {
  if (value === "top" || value === "center" || value === "bottom") return value;
  return undefined;
};

const asSlideTextStyle = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const fontFamily = asNonEmptyString(source.fontFamily) ?? undefined;
  const fontSize = asFiniteNumber(source.fontSize) ?? undefined;
  const color = asNonEmptyString(source.color) ?? undefined;
  const fontWeight = asFiniteNumber(source.fontWeight) ?? undefined;
  if (!fontFamily && fontSize === undefined && !color && fontWeight === undefined) {
    return undefined;
  }
  return {
    fontFamily,
    fontSize,
    color,
    fontWeight,
  };
};

const asStatus = (value: unknown): CardnewsStatus => (value === "published" ? "published" : "draft");

const asIsoString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

const toSlide = (value: unknown): CardnewsSlide | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const title = asNullableString(source.title);
  const body = asNullableString(source.body);
  const keywords = asNullableString(source.keywords);
  const image = asNullableString(source.image);
  const renderedImageUrl = asNullableString(source.renderedImageUrl);
  const textPosition = asTextPosition(source.textPosition);
  const textOffsetX = asFiniteNumber(source.textOffsetX);
  const textOffsetY = asFiniteNumber(source.textOffsetY);
  const titleOffsetX = asFiniteNumber(source.titleOffsetX);
  const titleOffsetY = asFiniteNumber(source.titleOffsetY);
  const bodyOffsetX = asFiniteNumber(source.bodyOffsetX);
  const bodyOffsetY = asFiniteNumber(source.bodyOffsetY);
  const titleTextStyle = asSlideTextStyle(source.titleTextStyle);
  const bodyTextStyle = asSlideTextStyle(source.bodyTextStyle);
  if (
    title === null
    && body === null
    && keywords === null
    && image === null
    && renderedImageUrl === null
    && textPosition === undefined
    && textOffsetX === null
    && textOffsetY === null
    && titleOffsetX === null
    && titleOffsetY === null
    && bodyOffsetX === null
    && bodyOffsetY === null
    && !titleTextStyle
    && !bodyTextStyle
  ) return null;
  return {
    title: title ?? "",
    body: body ?? "",
    keywords: keywords ?? "",
    image,
    renderedImageUrl,
    textPosition,
    textOffsetX: textOffsetX ?? undefined,
    textOffsetY: textOffsetY ?? undefined,
    titleOffsetX: titleOffsetX ?? undefined,
    titleOffsetY: titleOffsetY ?? undefined,
    bodyOffsetX: bodyOffsetX ?? undefined,
    bodyOffsetY: bodyOffsetY ?? undefined,
    titleTextStyle,
    bodyTextStyle,
  };
};

const toSlides = (value: unknown): CardnewsSlide[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(toSlide)
    .filter((slide): slide is CardnewsSlide => Boolean(slide));
};

const stripRenderedImageUrls = (slides: CardnewsSlide[]) => slides.map(({
  title,
  body,
  keywords,
  image,
  textPosition,
  textOffsetX,
  textOffsetY,
  titleOffsetX,
  titleOffsetY,
  bodyOffsetX,
  bodyOffsetY,
  titleTextStyle,
  bodyTextStyle,
}) => ({
  title,
  body,
  keywords,
  image,
  textPosition,
  textOffsetX,
  textOffsetY,
  titleOffsetX,
  titleOffsetY,
  bodyOffsetX,
  bodyOffsetY,
  titleTextStyle,
  bodyTextStyle,
}));

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
};

const getDocIdFromRequest = (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get("id");
  const docId = asNonEmptyString(id);
  return docId;
};

const mapDetail = (id: string, data: Record<string, unknown>): CardnewsDetail => {
  const slides = toSlides(data.slides);
  const firstSlideTitle = slides.length > 0 ? asNonEmptyString(slides[0].title) : null;
  const sourceLabel = asNonEmptyString(data.sourceLabel);
  const customTitle = asNonEmptyString(data.customTitle);
  const title = customTitle || sourceLabel || firstSlideTitle || "카드뉴스";

  return {
    id,
    status: asStatus(data.status),
    title,
    customTitle,
    slideCount: typeof data.slideCount === "number" && Number.isFinite(data.slideCount) ? data.slideCount : slides.length,
    imageUrl: asNonEmptyString(data.imageUrl),
    previewImageUrl: asNonEmptyString(data.previewImageUrl),
    sourceLabel,
    source: asNonEmptyString(data.source),
    content: asNullableString(data.content),
    style: asNullableString(data.style),
    target: asNullableString(data.target),
    genre: asNullableString(data.genre),
    aspectRatio: asNullableString(data.aspectRatio),
    tone: asNullableString(data.tone),
    captionStyle: asNullableString(data.captionStyle),
    caption: asNullableString(data.caption),
    createdAt: asIsoString(data.createdAt),
    updatedAt: asIsoString(data.updatedAt),
    publishedAt: asIsoString(data.publishedAt),
    slides,
  };
};

const buildPatchPayload = (body: UpdateBody, current: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    updatedAt: nowIso,
  };

  if (body.status === "draft" || body.status === "published") {
    patch.status = body.status;
    if (body.status === "published") {
      patch.publishedAt = asIsoString(current.publishedAt) || nowIso;
    } else {
      patch.publishedAt = null;
    }
  }

  if (body.customTitle !== undefined) {
    patch.customTitle = asNonEmptyString(body.customTitle);
  }
  if (body.sourceLabel !== undefined) {
    patch.sourceLabel = asNullableString(body.sourceLabel);
  }
  if (body.imageUrl !== undefined) {
    patch.imageUrl = asNullableString(body.imageUrl);
  }
  if (body.source !== undefined) {
    patch.source = asNullableString(body.source);
  }
  if (body.content !== undefined) {
    patch.content = asNullableString(body.content);
  }
  if (body.style !== undefined) {
    patch.style = asNullableString(body.style);
  }
  if (body.target !== undefined) {
    patch.target = asNullableString(body.target);
  }
  if (body.genre !== undefined) {
    patch.genre = asNullableString(body.genre);
  }
  if (body.aspectRatio !== undefined) {
    patch.aspectRatio = asNullableString(body.aspectRatio);
  }
  if (body.tone !== undefined) {
    patch.tone = asNullableString(body.tone);
  }
  if (body.captionStyle !== undefined) {
    patch.captionStyle = asNullableString(body.captionStyle);
  }
  if (body.caption !== undefined) {
    patch.caption = asNullableString(body.caption);
  }
  if (body.slides !== undefined) {
    const slides = toSlides(body.slides);
    patch.slides = stripRenderedImageUrls(slides);
    patch.slideCount = slides.length;
  }

  return patch;
};

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const docId = getDocIdFromRequest(req);
    if (!docId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const snap = await getUserCardnewsCollection(uid).doc(docId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Cardnews not found" }, { status: 404 });
    }

    const detail = mapDetail(snap.id, (snap.data() || {}) as Record<string, unknown>);
    return NextResponse.json({ item: detail });
  } catch (error) {
    console.error("Failed to read cardnews item:", error);
    return NextResponse.json({ error: "Failed to read cardnews item" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const docId = getDocIdFromRequest(req);
    if (!docId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const docRef = getUserCardnewsCollection(uid).doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Cardnews not found" }, { status: 404 });
    }
    const body = (await req.json().catch(() => ({}))) as UpdateBody;
    const currentData = (snap.data() || {}) as Record<string, unknown>;
    const patch = buildPatchPayload(body, currentData);
    const nextSlides = body.slides !== undefined ? toSlides(body.slides) : toSlides(currentData.slides);
    const shouldResetRenderedAssets =
      body.slides !== undefined || body.imageUrl !== undefined || body.aspectRatio !== undefined;

    if (shouldResetRenderedAssets) {
      if (nextSlides.length > 0) {
        patch.slides = stripRenderedImageUrls(nextSlides);
      }
      patch.slideImageUrls = null;
      patch.previewImageUrl = null;
      patch.renderedAt = null;
      await deleteCardnewsSlideAssets(uid, docId).catch(() => undefined);
    }

    await docRef.set(patch, { merge: true });
    invalidateCardnewsListCache(uid);

    const nextSnap = await docRef.get();
    const detail = mapDetail(nextSnap.id, (nextSnap.data() || {}) as Record<string, unknown>);
    return NextResponse.json({ ok: true, item: detail });
  } catch (error) {
    console.error("Failed to update cardnews item:", error);
    return NextResponse.json({ error: "Failed to update cardnews item" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const docId = getDocIdFromRequest(req);
    if (!docId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const docRef = getUserCardnewsCollection(uid).doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Cardnews not found" }, { status: 404 });
    }

    await docRef.delete();
    await deleteCardnewsSlideAssets(uid, docId).catch(() => undefined);
    invalidateCardnewsListCache(uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete cardnews item:", error);
    return NextResponse.json({ error: "Failed to delete cardnews item" }, { status: 500 });
  }
}
