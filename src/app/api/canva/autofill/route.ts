import { NextRequest, NextResponse } from "next/server";
import { CanvaApiError, canvaApiFetch, getRequestUid, toCanvaApiErrorPayload } from "@/lib/services/canva-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlidePayload = {
  title?: string;
  body?: string;
  content?: string;
};

type AutofillDataValue = {
  type: "text";
  text: string;
};

const CANVA_API_BASE = process.env.CANVA_API_BASE || "https://api.canva.com/rest/v1";
const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const canvaFetch = async <T>(uid: string | null, url: string, init?: RequestInit): Promise<T> => {
  return canvaApiFetch<T>({ uid, url, init });
};

const extractDatasetFields = (datasetPayload: unknown): Record<string, string> => {
  if (!datasetPayload || typeof datasetPayload !== "object") return {};

  const rawDataset = (datasetPayload as { dataset?: unknown }).dataset;
  if (!rawDataset || typeof rawDataset !== "object") return {};

  if (Array.isArray(rawDataset)) {
    const result: Record<string, string> = {};
    for (const item of rawDataset) {
      if (!item || typeof item !== "object") continue;
      const name = asNonEmptyString((item as { name?: unknown }).name);
      const type = asNonEmptyString((item as { type?: unknown }).type) || "text";
      if (name) result[name] = type.toLowerCase();
    }
    return result;
  }

  const result: Record<string, string> = {};
  for (const [fieldName, fieldInfo] of Object.entries(rawDataset as Record<string, unknown>)) {
    if (!fieldInfo) continue;
    if (typeof fieldInfo === "string") {
      result[fieldName] = fieldInfo.toLowerCase();
      continue;
    }
    if (typeof fieldInfo === "object") {
      const type = asNonEmptyString((fieldInfo as { type?: unknown }).type) || "text";
      result[fieldName] = type.toLowerCase();
    }
  }
  return result;
};

const buildFieldCandidates = (index: number, labels: string[]) => {
  const raw = String(index);
  const padded = raw.padStart(2, "0");
  const variants = new Set<string>();
  for (const label of labels) {
    variants.add(`SLIDE_${raw}_${label}`);
    variants.add(`SLIDE${raw}_${label}`);
    variants.add(`SLIDE_${padded}_${label}`);
    variants.add(`SLIDE${padded}_${label}`);
    variants.add(`${label}_${raw}`);
    variants.add(`${label}${raw}`);
    variants.add(`${raw}_${label}`);
    variants.add(`${raw}${label}`);
  }
  return Array.from(variants);
};

const pickFirstUnused = (
  candidates: string[],
  textFieldNames: string[],
  normalizedMap: Map<string, string>,
  used: Set<string>,
) => {
  for (const candidate of candidates) {
    const key = normalizedMap.get(normalize(candidate));
    if (key && textFieldNames.includes(key) && !used.has(key)) {
      return key;
    }
  }
  return null;
};

const pickByKeyword = (
  textFieldNames: string[],
  used: Set<string>,
  keywords: string[],
) => {
  const normalizedKeywords = keywords.map((kw) => normalize(kw));
  for (const fieldName of textFieldNames) {
    if (used.has(fieldName)) continue;
    const normalizedName = normalize(fieldName);
    if (normalizedKeywords.some((kw) => normalizedName.includes(kw))) {
      return fieldName;
    }
  }
  return null;
};

const toSlideText = (slide: SlidePayload) => {
  const title = asNonEmptyString(slide.title) || "";
  const body = asNonEmptyString(slide.body) || asNonEmptyString(slide.content) || "";
  return { title, body };
};

const extractJobId = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as {
    id?: unknown;
    job?: { id?: unknown };
    job_id?: unknown;
  };
  return asNonEmptyString(root.job?.id) || asNonEmptyString(root.id) || asNonEmptyString(root.job_id);
};

const extractStatus = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as {
    status?: unknown;
    job?: { status?: unknown };
  };
  const status = asNonEmptyString(root.job?.status) || asNonEmptyString(root.status) || "";
  return status.toLowerCase();
};

const extractEditUrl = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;

  const root = payload as {
    urls?: { edit_url?: unknown };
    design?: { urls?: { edit_url?: unknown } };
    result?: {
      urls?: { edit_url?: unknown };
      design?: { urls?: { edit_url?: unknown } };
    };
    job?: {
      urls?: { edit_url?: unknown };
      design?: { urls?: { edit_url?: unknown } };
      result?: {
        urls?: { edit_url?: unknown };
        design?: { urls?: { edit_url?: unknown } };
      };
    };
  };

  return (
    asNonEmptyString(root.job?.result?.design?.urls?.edit_url) ||
    asNonEmptyString(root.job?.result?.urls?.edit_url) ||
    asNonEmptyString(root.result?.design?.urls?.edit_url) ||
    asNonEmptyString(root.result?.urls?.edit_url) ||
    asNonEmptyString(root.job?.design?.urls?.edit_url) ||
    asNonEmptyString(root.design?.urls?.edit_url) ||
    asNonEmptyString(root.job?.urls?.edit_url) ||
    asNonEmptyString(root.urls?.edit_url)
  );
};

const extractDesignId = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as {
    design?: { id?: unknown };
    result?: { design?: { id?: unknown } };
    job?: {
      design?: { id?: unknown };
      result?: { design?: { id?: unknown } };
    };
  };

  return (
    asNonEmptyString(root.job?.result?.design?.id) ||
    asNonEmptyString(root.result?.design?.id) ||
    asNonEmptyString(root.job?.design?.id) ||
    asNonEmptyString(root.design?.id)
  );
};

const buildTextData = (
  slides: SlidePayload[],
  datasetFields: Record<string, string>,
  caption?: string,
): Record<string, AutofillDataValue> => {
  const textFieldNames = Object.entries(datasetFields)
    .filter(([, type]) => type === "text")
    .map(([name]) => name);

  if (textFieldNames.length === 0) return {};

  const normalizedMap = new Map<string, string>();
  for (const fieldName of textFieldNames) {
    normalizedMap.set(normalize(fieldName), fieldName);
  }

  const used = new Set<string>();
  const result: Record<string, AutofillDataValue> = {};
  const normalizedCaption = asNonEmptyString(caption);

  const applyCaptionMapping = () => {
    if (!normalizedCaption) return;

    const key = pickFirstUnused(
      ["POST_CAPTION", "INSTAGRAM_CAPTION", "SOCIAL_CAPTION", "FEED_CAPTION", "SOCIAL_COPY", "POST_COPY", "CAPTION", "COPY"],
      textFieldNames,
      normalizedMap,
      used,
    ) || pickByKeyword(textFieldNames, used, ["instagramcaption", "socialcaption", "postcaption", "feedcaption", "socialcopy", "postcopy", "caption", "copy"]);

    if (key) {
      result[key] = { type: "text", text: normalizedCaption };
      used.add(key);
    }
  };

  slides.forEach((slide, idx) => {
    const index = idx + 1;
    const { title, body } = toSlideText(slide);

    if (title) {
      const key = pickFirstUnused(
        buildFieldCandidates(index, ["TITLE", "HEADLINE", "SUBTITLE"]),
        textFieldNames,
        normalizedMap,
        used,
      );
      if (key) {
        result[key] = { type: "text", text: title };
        used.add(key);
      }
    }

    if (body) {
      const key = pickFirstUnused(
        buildFieldCandidates(index, ["BODY", "CONTENT", "TEXT", "DESCRIPTION"]),
        textFieldNames,
        normalizedMap,
        used,
      );
      if (key) {
        result[key] = { type: "text", text: body };
        used.add(key);
      }
    }
  });

  applyCaptionMapping();

  if (Object.keys(result).length > 0) return result;

  const firstSlide = slides[0] ? toSlideText(slides[0]) : { title: "", body: "" };
  const fallbackTitleField = pickByKeyword(textFieldNames, used, ["title", "headline", "subject"]);
  const fallbackBodyField = pickByKeyword(textFieldNames, used, ["body", "content", "text", "description"]);

  if (firstSlide.title && fallbackTitleField) {
    result[fallbackTitleField] = { type: "text", text: firstSlide.title };
    used.add(fallbackTitleField);
  }
  if (firstSlide.body && fallbackBodyField && !used.has(fallbackBodyField)) {
    result[fallbackBodyField] = { type: "text", text: firstSlide.body };
    used.add(fallbackBodyField);
  }

  applyCaptionMapping();

  if (Object.keys(result).length > 0) return result;

  const aggregateText = [
    slides
    .map((slide, idx) => {
      const { title, body } = toSlideText(slide);
      const lines = [title, body].filter(Boolean).join("\n");
      return lines ? `[${idx + 1}] ${lines}` : "";
    })
    .filter(Boolean)
    .join("\n\n"),
    normalizedCaption ? `[Caption]\n${normalizedCaption}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!aggregateText) return result;

  const firstField = textFieldNames.find((name) => !used.has(name));
  if (firstField) {
    result[firstField] = { type: "text", text: aggregateText };
  }

  return result;
};

export async function POST(req: NextRequest) {
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
    const body = (await req.json()) as { slides?: SlidePayload[]; caption?: string; title?: string; brandTemplateId?: string };
    const requestedBrandTemplateId = asNonEmptyString(body?.brandTemplateId);
    let brandTemplateId = configuredBrandTemplateId;
    if (requestedBrandTemplateId) {
      brandTemplateId = requestedBrandTemplateId;
    }
    if (!brandTemplateId) {
      try {
        const listed = await canvaFetch<{ items?: Array<{ id?: string }> }>(
          uid,
          `${CANVA_API_BASE}/brand-templates?dataset=non_empty`,
        );
        const firstTemplate = Array.isArray(listed?.items)
          ? listed.items.find((item) => asNonEmptyString(item?.id))
          : null;
        brandTemplateId = asNonEmptyString(firstTemplate?.id);
      } catch (listError) {
        console.warn("Failed to auto-discover brand templates:", listError);
      }
    }

    if (!brandTemplateId) {
      return NextResponse.json(
        {
          error: "Missing CANVA_BRAND_TEMPLATE_ID and no non-empty brand template found.",
          hint: "Create a Canva Brand Template with dataset fields, then set CANVA_BRAND_TEMPLATE_ID in .env.local.",
        },
        { status: 500 },
      );
    }

    const slides = Array.isArray(body?.slides) ? body.slides : [];
    if (slides.length === 0) {
      return NextResponse.json({ error: "slides is required" }, { status: 400 });
    }

    const dataset = await canvaFetch<unknown>(
      uid,
      `${CANVA_API_BASE}/brand-templates/${encodeURIComponent(brandTemplateId)}/dataset`,
    );
    const datasetFields = extractDatasetFields(dataset);
    const data = buildTextData(slides, datasetFields, body?.caption);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        {
          error: "No mappable text fields in Canva dataset.",
          datasetFields: Object.entries(datasetFields).map(([name, type]) => ({ name, type })),
        },
        { status: 400 },
      );
    }

    const defaultTitle = `${asNonEmptyString(slides[0]?.title) || "카드뉴스"} (${new Date().toISOString().slice(0, 10)})`;
    const createPayload = {
      brand_template_id: brandTemplateId,
      title: asNonEmptyString(body?.title) || defaultTitle,
      data,
    };

    const created = await canvaFetch<unknown>(uid, `${CANVA_API_BASE}/autofills`, {
      method: "POST",
      body: JSON.stringify(createPayload),
    });

    const jobId = extractJobId(created);
    if (!jobId) {
      return NextResponse.json(
        { error: "Canva autofill job id not found.", detail: created },
        { status: 502 },
      );
    }

    let latestPayload: unknown = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(POLL_INTERVAL_MS);
      }

      latestPayload = await canvaFetch<unknown>(
        uid,
        `${CANVA_API_BASE}/autofills/${encodeURIComponent(jobId)}`,
      );

      const status = extractStatus(latestPayload);
      const editUrl = extractEditUrl(latestPayload);
      const designId = extractDesignId(latestPayload);

      if (status === "success" && editUrl) {
        return NextResponse.json({
          ok: true,
          status,
          jobId,
          designId,
          editUrl,
          brandTemplateId,
          mappedFieldCount: Object.keys(data).length,
        });
      }

      if (status === "failed" || status === "canceled" || status === "cancelled") {
        return NextResponse.json(
          { error: `Canva autofill failed with status: ${status}`, jobId, detail: latestPayload },
          { status: 502 },
        );
      }
    }

    const editUrl = extractEditUrl(latestPayload);
    if (editUrl) {
      return NextResponse.json({
        ok: true,
        status: extractStatus(latestPayload) || "success",
        jobId,
        designId: extractDesignId(latestPayload),
        editUrl,
        brandTemplateId,
        mappedFieldCount: Object.keys(data).length,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        status: extractStatus(latestPayload) || "in_progress",
        jobId,
        message: "Autofill job started. Check again in a moment.",
      },
      { status: 202 },
    );
  } catch (error) {
    if (!(error instanceof CanvaApiError && (error.code === "canva_reconnect_required" || error.code === "unauthorized"))) {
      console.error("Canva autofill error:", error);
    }
    const payload = toCanvaApiErrorPayload(error, "Canva 자동 채우기 요청에 실패했습니다.");
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
