import { NextRequest, NextResponse } from "next/server";
import { CanvaApiError, canvaApiFetch, getRequestUid, toCanvaApiErrorPayload } from "@/lib/services/canva-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANVA_API_BASE = process.env.CANVA_API_BASE || "https://api.canva.com/rest/v1";

type CanvaTemplateItem = {
  id?: unknown;
  title?: unknown;
  view_url?: unknown;
  create_url?: unknown;
  updated_at?: unknown;
  thumbnail?: {
    url?: unknown;
  } | null;
};

const MAX_BRAND_TEMPLATE_PAGES = 5;
const MAX_BRAND_TEMPLATE_COUNT = 500;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asOptionalNumber = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const fetchAllBrandTemplates = async (uid: string | null) => {
  const items: CanvaTemplateItem[] = [];
  const seenContinuations = new Set<string>();
  let continuation: string | null = null;

  for (let page = 0; page < MAX_BRAND_TEMPLATE_PAGES; page += 1) {
    const params = new URLSearchParams({
      dataset: "non_empty",
      limit: "100",
      sort_by: "modified_descending",
    });

    if (continuation) {
      params.set("continuation", continuation);
    }

    const payload = await canvaApiFetch<{ items?: CanvaTemplateItem[]; continuation?: unknown }>({
      uid,
      url: `${CANVA_API_BASE}/brand-templates?${params.toString()}`,
    });

    if (Array.isArray(payload?.items)) {
      items.push(...payload.items);
    }

    if (items.length >= MAX_BRAND_TEMPLATE_COUNT) {
      break;
    }

    const nextContinuation = asNonEmptyString(payload?.continuation);
    if (!nextContinuation || seenContinuations.has(nextContinuation)) {
      break;
    }

    seenContinuations.add(nextContinuation);
    continuation = nextContinuation;
  }

  return items.slice(0, MAX_BRAND_TEMPLATE_COUNT);
};

export async function GET(req: NextRequest) {
  const configuredBrandTemplateId = asNonEmptyString(process.env.CANVA_BRAND_TEMPLATE_ID);

  let uid: string | null = null;
  try {
    uid = await getRequestUid(req);
  } catch (error) {
    const payload = toCanvaApiErrorPayload(error, "Unauthorized");
    return NextResponse.json(payload.body, { status: payload.status });
  }
  if (!uid) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized", reconnectRequired: false },
      { status: 401 },
    );
  }

  try {
    const templates = (await fetchAllBrandTemplates(uid))
      .map((item) => ({
        id: asNonEmptyString(item?.id),
        title: asNonEmptyString(item?.title) || "Untitled template",
        viewUrl: asNonEmptyString(item?.view_url),
        createUrl: asNonEmptyString(item?.create_url),
        thumbnailUrl: asNonEmptyString(item?.thumbnail?.url),
        updatedAt: asOptionalNumber(item?.updated_at),
      }))
      .filter((item): item is {
        id: string;
        title: string;
        viewUrl: string | null;
        createUrl: string | null;
        thumbnailUrl: string | null;
        updatedAt: number | null;
      } => Boolean(item.id));

    const defaultTemplateId = configuredBrandTemplateId && templates.some((template) => template.id === configuredBrandTemplateId)
      ? configuredBrandTemplateId
      : (templates[0]?.id || null);

    return NextResponse.json({
      templates,
      defaultTemplateId,
      count: templates.length,
    });
  } catch (error) {
    if (!(error instanceof CanvaApiError && (error.code === "canva_reconnect_required" || error.code === "unauthorized"))) {
      console.error("Canva templates fetch failed:", error);
    }
    const payload = toCanvaApiErrorPayload(error, "Canva 템플릿 조회에 실패했습니다.");
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
