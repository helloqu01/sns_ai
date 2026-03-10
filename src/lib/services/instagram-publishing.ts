import type { NextRequest } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { deleteCardnewsSlideAssets } from "@/lib/services/cardnews-assets";
import { invalidateInstagramIntegration, readInstagramIntegration } from "@/lib/services/meta-integration-cache";
import {
  getFacebookGraphBase,
  getInstagramGraphBase,
  parseMetaApiError,
} from "@/lib/services/meta-graph";
import type {
  InstagramPublishMode,
  InstagramPublishingRecord,
  InstagramPublishingStatus,
} from "@/types/instagram-publishing";

type IntegrationDoc = {
  status?: string;
  flow?: "facebook" | "instagram";
  accessToken?: string;
  pageAccessToken?: string | null;
  pageName?: string | null;
  igUserId?: string | null;
  igUsername?: string | null;
  pageId?: string | null;
  activeAccountId?: string | null;
  accountId?: string | null;
  expiresAt?: string | null;
  selectedAt?: string | null;
  connectedAt?: string | null;
  updatedAt?: string | null;
};

type ResolvedPublishingIntegration = {
  accountId: string | null;
  flow: "facebook" | "instagram";
  accessToken: string;
  igUserId: string;
  igUsername: string | null;
  pageName: string | null;
};

type CreateInstagramPostInput = {
  caption: string;
  imageUrl: string;
  slideImageUrls?: string[] | null;
  publishAssetId?: string | null;
  festivalId?: string | null;
  festivalTitle?: string | null;
  scheduledFor?: string | null;
};

type ListInstagramPublishingRecordsOptions = {
  limit?: number;
  createdFrom?: string | null;
  createdTo?: string | null;
  page?: number;
  pageSize?: number;
  statuses?: InstagramPublishingStatus[] | null;
  publishMode?: InstagramPublishMode | null;
  igUserId?: string | null;
};

const POSTS_SUBCOLLECTION = "instagramPosts";
const DEFAULT_LIST_LIMIT = 24;

export class InstagramPublishingRecordNotFoundError extends Error {}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isValidImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const toTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
    return null;
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      const nanoseconds = Number((value as { nanoseconds?: unknown }).nanoseconds);
      const millis = Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1_000_000) : 0;
      return Math.floor(seconds * 1000) + millis;
    }
  }
  return null;
};

const isExpired = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return false;
  return timestamp <= Date.now();
};

const hasUsableToken = (value: IntegrationDoc) => {
  return Boolean(asNonEmptyString(value.accessToken) || asNonEmptyString(value.pageAccessToken));
};

const hasUsableIdentity = (value: IntegrationDoc) => {
  return Boolean(asNonEmptyString(value.igUserId) || asNonEmptyString(value.pageId));
};

const isConnectedAccountDoc = (value: IntegrationDoc) => {
  const status = asNonEmptyString(value.status);
  return status !== "disconnected" && !isExpired(value.expiresAt) && hasUsableToken(value) && hasUsableIdentity(value);
};

const toPriorityTimestamp = (value: IntegrationDoc) => {
  return (
    toTimestamp(value.selectedAt)
    || toTimestamp(value.connectedAt)
    || toTimestamp(value.updatedAt)
    || 0
  );
};

const normalizeIsoDateTime = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizeImageUrlList = (value: unknown, fallbackImageUrl?: string | null) => {
  const urls = Array.isArray(value)
    ? value
      .map((item) => asNonEmptyString(item))
      .filter((item): item is string => Boolean(item))
      .filter((item) => isValidImageUrl(item))
    : [];

  if (urls.length > 0) {
    return urls.slice(0, 10);
  }

  const fallback = asNonEmptyString(fallbackImageUrl);
  return fallback && isValidImageUrl(fallback) ? [fallback] : [];
};

const asStatus = (value: unknown): InstagramPublishingStatus => {
  switch (value) {
    case "queued":
    case "scheduled":
    case "publishing":
    case "published":
    case "failed":
      return value;
    default:
      return "queued";
  }
};

const asPublishMode = (value: unknown): InstagramPublishMode => {
  return value === "scheduled" ? "scheduled" : "now";
};

const getFlow = (): "facebook" | "instagram" => {
  return (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
};

const getGraphBase = (flow: "facebook" | "instagram") => {
  if (flow === "instagram") {
    return getInstagramGraphBase();
  }
  return getFacebookGraphBase();
};

const getPublicAppOrigin = (() => {
  let cached: string | null | undefined;
  return () => {
    if (cached !== undefined) {
      return cached;
    }

    const candidates = [
      process.env.PUBLIC_APP_ORIGIN,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.APP_URL,
      process.env.META_REDIRECT_URI,
      process.env.CANVA_OAUTH_REDIRECT_URI,
    ];

    for (const candidate of candidates) {
      const text = asNonEmptyString(candidate);
      if (!text) continue;
      try {
        const parsed = new URL(text);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          cached = parsed.origin;
          return cached;
        }
      } catch {
        continue;
      }
    }

    cached = null;
    return cached;
  };
})();

const toMetaPublishableImageUrl = (sourceUrl: string) => {
  if (!isValidImageUrl(sourceUrl)) {
    return sourceUrl;
  }

  const appOrigin = getPublicAppOrigin();
  if (!appOrigin) {
    return sourceUrl;
  }

  try {
    const parsed = new URL(sourceUrl);
    if (parsed.origin === appOrigin && parsed.pathname === "/api/cardnews/slide-image") {
      const optimized = new URL(parsed.toString());
      optimized.searchParams.set("mode", "publish");
      return optimized.toString();
    }

    if (parsed.origin === appOrigin && parsed.pathname === "/api/cardnews/image-proxy") {
      const optimized = new URL(parsed.toString());
      optimized.searchParams.set("mode", "publish");
      if (!optimized.searchParams.get("ratio")) {
        optimized.searchParams.set("ratio", "4:5");
      }
      return optimized.toString();
    }

    const proxyUrl = new URL("/api/cardnews/image-proxy", appOrigin);
    proxyUrl.searchParams.set("src", sourceUrl);
    proxyUrl.searchParams.set("ratio", "4:5");
    proxyUrl.searchParams.set("mode", "publish");
    return proxyUrl.toString();
  } catch {
    return sourceUrl;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getPostsCollection = (uid: string) => {
  if (!db || !isFirebaseConfigured) {
    throw new Error("Firestore not configured");
  }
  return db.collection("users").doc(uid).collection(POSTS_SUBCOLLECTION);
};

const getIntegrationDocRef = (uid: string) => {
  if (!db || !isFirebaseConfigured) {
    throw new Error("Firestore not configured");
  }
  return db.collection("users").doc(uid).collection("integrations").doc("instagram");
};

const cleanupPublishingAssets = async (
  uid: string,
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  publishAssetId: string | null,
) => {
  const assetId = asNonEmptyString(publishAssetId);
  if (!assetId) return;

  try {
    await deleteCardnewsSlideAssets(uid, assetId);
  } catch {
    return;
  }

  await docRef.set(
    {
      publishAssetId: null,
      slideImageUrls: null,
      publishableImageUrls: null,
      tempAssetsDeletedAt: new Date().toISOString(),
    },
    { merge: true },
  ).catch(() => undefined);
};

const readIntegrationAccount = async (uid: string, accountId: string): Promise<IntegrationDoc | null> => {
  const snap = await getIntegrationDocRef(uid).collection("accounts").doc(accountId).get();
  if (!snap.exists) return null;
  return (snap.data() || {}) as IntegrationDoc;
};

const mapRecord = (id: string, data: Record<string, unknown>): InstagramPublishingRecord => ({
  id,
  status: asStatus(data.status),
  publishMode: asPublishMode(data.publishMode),
  caption: asNonEmptyString(data.caption) || "",
  imageUrl: asNonEmptyString(data.imageUrl) || "",
  scheduledFor: normalizeIsoDateTime(data.scheduledFor),
  createdAt: normalizeIsoDateTime(data.createdAt),
  updatedAt: normalizeIsoDateTime(data.updatedAt),
  publishedAt: normalizeIsoDateTime(data.publishedAt),
  failedAt: normalizeIsoDateTime(data.failedAt),
  festivalId: asNonEmptyString(data.festivalId),
  festivalTitle: asNonEmptyString(data.festivalTitle),
  accountId: asNonEmptyString(data.accountId),
  igUserId: asNonEmptyString(data.igUserId),
  igUsername: asNonEmptyString(data.igUsername),
  pageName: asNonEmptyString(data.pageName),
  mediaContainerId: asNonEmptyString(data.mediaContainerId),
  mediaPublishId: asNonEmptyString(data.mediaPublishId),
  permalink: asNonEmptyString(data.permalink),
  lastError: asNonEmptyString(data.lastError),
});

const parseGraphErrorMessage = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "Instagram API request failed";
  }

  if ("error" in payload && payload.error && typeof payload.error === "object") {
    const graphError = payload.error as { message?: unknown; error_user_msg?: unknown };
    return (
      asNonEmptyString(graphError.error_user_msg)
      || asNonEmptyString(graphError.message)
      || "Instagram API request failed"
    );
  }

  return "Instagram API request failed";
};

const getGraphTimeoutMs = () => {
  const parsed = Number.parseInt(process.env.META_GRAPH_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(parsed)) return 20_000;
  return Math.min(Math.max(parsed, 2_000), 60_000);
};

const getPublishingImageConcurrency = () => {
  const parsed = Number.parseInt(process.env.META_PUBLISH_IMAGE_CONCURRENCY || "", 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(parsed, 2));
};

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) => {
  if (items.length === 0) return [] as R[];

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
};

const graphFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const timeoutMs = getGraphTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const raw = await res.text();
    const payload = raw
      ? (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      })()
      : null;
    if (!res.ok) {
      const safeBody = raw || JSON.stringify({ error: { message: parseGraphErrorMessage(payload) } });
      throw new Error(`Meta API error ${res.status}: ${safeBody}`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Meta API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const isRetryableGraphError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (message.includes("timeout")) return true;
  if (/meta api error 5\d\d/.test(message)) return true;
  if (message.includes("temporarily unavailable")) return true;
  if (message.includes("connection")) return true;
  return false;
};

const graphFormPost = async <T>(
  url: string,
  params: Record<string, string>,
  options?: { retries?: number },
): Promise<T> => {
  const maxRetries = Math.max(0, Math.min(options?.retries ?? 1, 3));
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      body.set(key, value);
    });

    try {
      return await graphFetch<T>(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableGraphError(error)) {
        throw error;
      }
      await sleep(700 * (attempt + 1));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("Meta API request failed"));
};

const isRecoverablePublishingError = (error: unknown) => {
  const parsed = parseMetaApiError(error, "Instagram API request failed");
  if (parsed.recoverable) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unsupported post request|cannot be loaded due to missing permissions|api access blocked|permission|token|oauth|session|expired|not authorized/i.test(message);
};

const listFallbackAccountIds = async (uid: string, excludeAccountIds: string[]) => {
  const integrationRef = getIntegrationDocRef(uid);
  const [rootSnap, accountsSnap] = await Promise.all([
    integrationRef.get(),
    integrationRef.collection("accounts").get(),
  ]);
  if (!rootSnap.exists || accountsSnap.empty) {
    return [] as string[];
  }

  const rootData = (rootSnap.data() || {}) as IntegrationDoc;
  const activeAccountId = asNonEmptyString(rootData.activeAccountId);

  return accountsSnap.docs
    .map((doc) => ({ id: doc.id, data: (doc.data() || {}) as IntegrationDoc }))
    .filter(({ id, data }) => !excludeAccountIds.includes(id) && isConnectedAccountDoc(data))
    .sort((left, right) => {
      if (activeAccountId && left.id === activeAccountId) return -1;
      if (activeAccountId && right.id === activeAccountId) return 1;
      return toPriorityTimestamp(right.data) - toPriorityTimestamp(left.data);
    })
    .map((item) => item.id);
};

const markPublishingAccountDisconnected = async (uid: string, accountId: string, reason: string) => {
  const nowIso = new Date().toISOString();
  const integrationRef = getIntegrationDocRef(uid);
  await integrationRef.collection("accounts").doc(accountId).set(
    {
      status: "disconnected",
      lastError: reason,
      updatedAt: nowIso,
    },
    { merge: true },
  ).catch(() => undefined);

  await integrationRef.set(
    {
      status: "disconnected",
      updatedAt: nowIso,
    },
    { merge: true },
  ).catch(() => undefined);
  invalidateInstagramIntegration(uid);
};

const activatePublishingAccount = async (uid: string, integration: ResolvedPublishingIntegration) => {
  if (!integration.accountId) return;
  const nowIso = new Date().toISOString();
  const integrationRef = getIntegrationDocRef(uid);
  await integrationRef.set(
    {
      status: "connected",
      version: 2,
      flow: integration.flow,
      activeAccountId: integration.accountId,
      igUserId: integration.igUserId,
      igUsername: integration.igUsername,
      pageName: integration.pageName,
      selectedAt: nowIso,
      updatedAt: nowIso,
    },
    { merge: true },
  ).catch(() => undefined);
  invalidateInstagramIntegration(uid);
};

export const getMetaRequestUid = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;

  const admin = getFirebaseAdmin();
  if (!admin) return null;

  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
};

export const resolveInstagramPublishingIntegration = async (uid: string): Promise<ResolvedPublishingIntegration> => {
  const integration = (await readInstagramIntegration(uid, { forceFresh: true })) as IntegrationDoc | null;
  if (!integration || !isConnectedAccountDoc(integration)) {
    throw new Error("인스타그램 계정이 연결되어 있지 않습니다.");
  }

  const flow = integration.flow === "facebook" || integration.flow === "instagram" ? integration.flow : getFlow();
  const accessToken = asNonEmptyString(
    flow === "facebook" ? integration.pageAccessToken || integration.accessToken : integration.accessToken,
  );
  const igUserId = asNonEmptyString(integration.igUserId) || asNonEmptyString(integration.pageId);
  const resolvedAccountId = asNonEmptyString(integration.accountId) || asNonEmptyString(integration.activeAccountId);

  if (!accessToken) {
    throw new Error("인스타그램 액세스 토큰이 없습니다.");
  }
  if (!igUserId) {
    throw new Error("게시할 인스타그램 계정이 선택되지 않았습니다.");
  }

  return {
    accountId: resolvedAccountId,
    flow,
    accessToken,
    igUserId,
    igUsername: asNonEmptyString(integration.igUsername),
    pageName: asNonEmptyString(integration.pageName),
  };
};

export const resolveInstagramPublishingIntegrationByAccount = async (
  uid: string,
  accountId: string,
): Promise<ResolvedPublishingIntegration> => {
  const account = await readIntegrationAccount(uid, accountId);
  if (!account || !isConnectedAccountDoc(account)) {
    throw new Error("인스타그램 계정을 찾을 수 없습니다.");
  }

  const flow = account.flow === "facebook" || account.flow === "instagram" ? account.flow : getFlow();
  const accessToken = asNonEmptyString(
    flow === "facebook" ? account.pageAccessToken || account.accessToken : account.accessToken,
  );
  const igUserId = asNonEmptyString(account.igUserId) || asNonEmptyString(account.pageId);

  if (!accessToken) {
    throw new Error("인스타그램 액세스 토큰이 없습니다.");
  }
  if (!igUserId) {
    throw new Error("게시할 인스타그램 계정이 선택되지 않았습니다.");
  }

  return {
    accountId,
    flow,
    accessToken,
    igUserId,
    igUsername: asNonEmptyString(account.igUsername),
    pageName: asNonEmptyString(account.pageName),
  };
};

const createMediaContainer = async (
  integration: ResolvedPublishingIntegration,
  imageUrl: string,
  caption: string,
) => {
  const graphBase = getGraphBase(integration.flow);
  const payload = await graphFormPost<{ id?: unknown }>(
    `${graphBase}/${integration.igUserId}/media`,
    {
      image_url: imageUrl,
      caption,
      access_token: integration.accessToken,
    },
  );

  const mediaContainerId = asNonEmptyString(payload?.id);
  if (!mediaContainerId) {
    throw new Error("인스타그램 미디어 컨테이너 생성에 실패했습니다.");
  }
  return mediaContainerId;
};

const createCarouselItemContainer = async (
  integration: ResolvedPublishingIntegration,
  imageUrl: string,
) => {
  const graphBase = getGraphBase(integration.flow);
  const payload = await graphFormPost<{ id?: unknown }>(
    `${graphBase}/${integration.igUserId}/media`,
    {
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: integration.accessToken,
    },
  );

  const mediaContainerId = asNonEmptyString(payload?.id);
  if (!mediaContainerId) {
    throw new Error("인스타그램 캐러셀 아이템 컨테이너 생성에 실패했습니다.");
  }
  return mediaContainerId;
};

const createCarouselContainer = async (
  integration: ResolvedPublishingIntegration,
  childContainerIds: string[],
  caption: string,
) => {
  if (childContainerIds.length < 2) {
    throw new Error("캐러셀 게시에는 2장 이상의 이미지가 필요합니다.");
  }

  const graphBase = getGraphBase(integration.flow);
  const payload = await runPendingAwareAttempt(
    () => graphFormPost<{ id?: unknown }>(
      `${graphBase}/${integration.igUserId}/media`,
      {
        media_type: "CAROUSEL",
        children: childContainerIds.join(","),
        caption,
        access_token: integration.accessToken,
      },
    ),
    { attempts: 4, baseDelayMs: 500 },
  );

  const mediaContainerId = asNonEmptyString(payload?.id);
  if (!mediaContainerId) {
    throw new Error("인스타그램 캐러셀 컨테이너 생성에 실패했습니다.");
  }
  return mediaContainerId;
};

const shouldRetryPublish = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  return [
    "not ready",
    "please wait",
    "temporarily unavailable",
    "is still being processed",
    "try again",
  ].some((token) => message.includes(token));
};

const runPendingAwareAttempt = async <T>(
  worker: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
) => {
  const attempts = Math.max(1, Math.min(options?.attempts ?? 4, 6));
  const baseDelayMs = Math.max(200, Math.min(options?.baseDelayMs ?? 700, 2_000));
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(baseDelayMs * attempt);
    }

    try {
      return await worker();
    } catch (error) {
      lastError = error;
      if (!shouldRetryPublish(error) || attempt === attempts - 1) {
        break;
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("인스타그램 처리 중 오류가 발생했습니다."));
};

const publishMediaContainer = async (
  integration: ResolvedPublishingIntegration,
  creationId: string,
) => {
  const graphBase = getGraphBase(integration.flow);
  const payload = await runPendingAwareAttempt(
    () => graphFormPost<{ id?: unknown }>(
      `${graphBase}/${integration.igUserId}/media_publish`,
      {
        creation_id: creationId,
        access_token: integration.accessToken,
      },
    ),
    { attempts: 4, baseDelayMs: 800 },
  );
  const mediaPublishId = asNonEmptyString(payload?.id);
  if (!mediaPublishId) {
    throw new Error("인스타그램 게시 완료 응답에 media id가 없습니다.");
  }
  return mediaPublishId;
};

const fetchMediaPermalink = async (
  integration: ResolvedPublishingIntegration,
  mediaId: string,
) => {
  const graphBase = getGraphBase(integration.flow);
  const url = new URL(`${graphBase}/${mediaId}`);
  url.searchParams.set("fields", "permalink");
  url.searchParams.set("access_token", integration.accessToken);

  try {
    const payload = await graphFetch<{ permalink?: unknown }>(url.toString());
    return asNonEmptyString(payload?.permalink);
  } catch {
    return null;
  }
};

const publishRecordWithIntegration = async (
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  integration: ResolvedPublishingIntegration,
  imageUrls: string[],
  caption: string,
) => {
  if (imageUrls.length === 0) {
    throw new Error("게시할 이미지가 없습니다.");
  }

  const publishingAt = new Date().toISOString();
  await docRef.set(
    {
      status: "publishing",
      updatedAt: publishingAt,
      failedAt: null,
      lastError: null,
      accountId: integration.accountId,
      igUserId: integration.igUserId,
      igUsername: integration.igUsername,
      pageName: integration.pageName,
    },
    { merge: true },
  );

  const normalizedImageUrls = imageUrls.filter((url) => isValidImageUrl(url)).slice(0, 10);
  if (normalizedImageUrls.length === 0) {
    throw new Error("게시할 이미지 URL이 올바르지 않습니다.");
  }
  const publishableImageUrls = normalizedImageUrls.map((url) => toMetaPublishableImageUrl(url));

  let mediaContainerId: string;
  if (publishableImageUrls.length === 1) {
    mediaContainerId = await createMediaContainer(integration, publishableImageUrls[0], caption);
    await docRef.set(
      {
        mediaContainerId,
        mediaChildContainerIds: null,
        publishableImageUrls,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } else {
    const carouselItemConcurrency = getPublishingImageConcurrency();
    const childContainerIds = await runWithConcurrency(
      publishableImageUrls,
      carouselItemConcurrency,
      async (imageUrl) => createCarouselItemContainer(integration, imageUrl),
    );

    mediaContainerId = await createCarouselContainer(integration, childContainerIds, caption);
    await docRef.set(
      {
        mediaContainerId,
        mediaChildContainerIds: childContainerIds,
        publishableImageUrls,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  const mediaPublishId = await publishMediaContainer(integration, mediaContainerId);
  const permalink = await fetchMediaPermalink(integration, mediaPublishId);
  const publishedAt = new Date().toISOString();

  await docRef.set(
    {
      status: "published",
      updatedAt: publishedAt,
      publishedAt,
      mediaPublishId,
      permalink,
      lastError: null,
    },
    { merge: true },
  );
};

export const createInstagramPublishingRecord = async (
  uid: string,
  input: CreateInstagramPostInput,
  mode: InstagramPublishMode,
) => {
  const integration = await resolveInstagramPublishingIntegration(uid);
  const now = new Date().toISOString();
  const scheduledFor = mode === "scheduled" ? normalizeIsoDateTime(input.scheduledFor) : null;
  const slideImageUrls = normalizeImageUrlList(input.slideImageUrls, input.imageUrl);
  const docRef = getPostsCollection(uid).doc();
  const payload = {
    status: mode === "scheduled" ? "scheduled" : "queued",
    publishMode: mode,
    caption: input.caption,
    imageUrl: input.imageUrl,
    slideImageUrls: slideImageUrls.length > 0 ? slideImageUrls : null,
    publishAssetId: asNonEmptyString(input.publishAssetId),
    scheduledFor,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    failedAt: null,
    festivalId: input.festivalId ?? null,
    festivalTitle: input.festivalTitle ?? null,
    accountId: integration.accountId,
    igUserId: integration.igUserId,
    igUsername: integration.igUsername,
    pageName: integration.pageName,
    mediaContainerId: null,
    mediaPublishId: null,
    permalink: null,
    lastError: null,
  } satisfies Record<string, unknown>;

  await docRef.set(payload);
  return mapRecord(docRef.id, payload);
};

const normalizeStatuses = (value: InstagramPublishingStatus[] | null | undefined) => {
  if (!Array.isArray(value) || value.length === 0) return [] as InstagramPublishingStatus[];
  const unique = new Set<InstagramPublishingStatus>();
  value.forEach((status) => {
    if (status === "queued" || status === "scheduled" || status === "publishing" || status === "published" || status === "failed") {
      unique.add(status);
    }
  });
  return Array.from(unique);
};

const isMissingIndexError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return /FAILED_PRECONDITION|requires an index/i.test(error.message);
};

const matchesRecordFilters = (
  record: InstagramPublishingRecord,
  options: ListInstagramPublishingRecordsOptions,
) => {
  const createdFrom = normalizeIsoDateTime(options.createdFrom);
  const createdTo = normalizeIsoDateTime(options.createdTo);
  const publishMode =
    options.publishMode === "now" || options.publishMode === "scheduled"
      ? options.publishMode
      : null;
  const igUserId = asNonEmptyString(options.igUserId);
  const statuses = normalizeStatuses(options.statuses);
  const createdAt = normalizeIsoDateTime(record.createdAt);

  if (createdFrom && (!createdAt || createdAt < createdFrom)) {
    return false;
  }
  if (createdTo && (!createdAt || createdAt >= createdTo)) {
    return false;
  }
  if (publishMode && record.publishMode !== publishMode) {
    return false;
  }
  if (igUserId && record.igUserId !== igUserId) {
    return false;
  }
  if (statuses.length > 0 && !statuses.includes(record.status)) {
    return false;
  }
  return true;
};

const buildFallbackRecordsQuery = (
  uid: string,
  options: ListInstagramPublishingRecordsOptions,
) => {
  const createdFrom = normalizeIsoDateTime(options.createdFrom);
  const createdTo = normalizeIsoDateTime(options.createdTo);

  let query = getPostsCollection(uid).orderBy("createdAt", "desc");
  if (createdFrom) {
    query = query.where("createdAt", ">=", createdFrom);
  }
  if (createdTo) {
    query = query.where("createdAt", "<", createdTo);
  }
  return query;
};

const readFilteredRecordsWithFallbackQuery = async (
  uid: string,
  options: ListInstagramPublishingRecordsOptions,
) => {
  const snapshot = await buildFallbackRecordsQuery(uid, options).get();
  return snapshot.docs
    .map((doc) => mapRecord(doc.id, doc.data() as Record<string, unknown>))
    .filter((record) => matchesRecordFilters(record, options));
};

const buildRecordsQuery = (
  uid: string,
  options: ListInstagramPublishingRecordsOptions,
) => {
  const createdFrom = normalizeIsoDateTime(options.createdFrom);
  const createdTo = normalizeIsoDateTime(options.createdTo);
  const publishMode =
    options.publishMode === "now" || options.publishMode === "scheduled"
      ? options.publishMode
      : null;
  const igUserId = asNonEmptyString(options.igUserId);
  const statuses = normalizeStatuses(options.statuses);

  let query = getPostsCollection(uid).orderBy("createdAt", "desc");
  if (createdFrom) {
    query = query.where("createdAt", ">=", createdFrom);
  }
  if (createdTo) {
    query = query.where("createdAt", "<", createdTo);
  }
  if (publishMode) {
    query = query.where("publishMode", "==", publishMode);
  }
  if (igUserId) {
    query = query.where("igUserId", "==", igUserId);
  }
  if (statuses.length === 1) {
    query = query.where("status", "==", statuses[0]);
  } else if (statuses.length > 1) {
    query = query.where("status", "in", statuses.slice(0, 10));
  }
  return query;
};

export const listInstagramPublishingRecords = async (
  uid: string,
  options: number | ListInstagramPublishingRecordsOptions = DEFAULT_LIST_LIMIT,
) => {
  const resolvedOptions = typeof options === "number" ? { limit: options } : options;
  const page = Math.max(1, Number.isFinite(resolvedOptions.page) ? Number(resolvedOptions.page) : 1);
  const pageSize = Math.max(1, Math.min(
    Number.isFinite(resolvedOptions.pageSize) ? Number(resolvedOptions.pageSize) : resolvedOptions.limit ?? DEFAULT_LIST_LIMIT,
    100,
  ));
  const offset = Math.max(0, (page - 1) * pageSize);

  try {
    let query = buildRecordsQuery(uid, resolvedOptions);
    if (offset > 0) {
      query = query.offset(offset);
    }

    const snapshot = await query
      .limit(pageSize)
      .get();

    return snapshot.docs.map((doc) => mapRecord(doc.id, doc.data() as Record<string, unknown>));
  } catch (error) {
    if (!isMissingIndexError(error)) {
      throw error;
    }

    const filteredRecords = await readFilteredRecordsWithFallbackQuery(uid, resolvedOptions);
    return filteredRecords.slice(offset, offset + pageSize);
  }
};

export const countInstagramPublishingRecords = async (
  uid: string,
  options: ListInstagramPublishingRecordsOptions = {},
) => {
  try {
    const snapshot = await buildRecordsQuery(uid, options).count().get();
    return Number(snapshot.data().count || 0);
  } catch (error) {
    if (!isMissingIndexError(error)) {
      throw error;
    }

    const filteredRecords = await readFilteredRecordsWithFallbackQuery(uid, options);
    return filteredRecords.length;
  }
};

export const executeInstagramPublishingRecord = async (uid: string, recordId: string) => {
  const docRef = getPostsCollection(uid).doc(recordId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new Error("게시 예약 문서를 찾을 수 없습니다.");
  }

  const data = (snap.data() || {}) as Record<string, unknown>;
  const record = mapRecord(recordId, data);
  const publishAssetId = asNonEmptyString(data.publishAssetId);

  if (record.status === "published") {
    await cleanupPublishingAssets(uid, docRef, publishAssetId);
    return record;
  }

  const caption = asNonEmptyString(data.caption);
  const imageUrls = normalizeImageUrlList(data.slideImageUrls, asNonEmptyString(data.imageUrl));
  if (imageUrls.length === 0 || !caption) {
    throw new Error("이미지 URL과 캡션이 필요합니다.");
  }

  const recordAccountId = asNonEmptyString(data.accountId);
  const primaryIntegration = recordAccountId
    ? await resolveInstagramPublishingIntegrationByAccount(uid, recordAccountId)
    : await resolveInstagramPublishingIntegration(uid);
  const triedAccountIds = new Set<string>();
  let lastError: unknown = null;

  const tryPublish = async (integration: ResolvedPublishingIntegration) => {
    if (integration.accountId) {
      triedAccountIds.add(integration.accountId);
    }
    try {
      await publishRecordWithIntegration(docRef, integration, imageUrls, caption);
      await activatePublishingAccount(uid, integration);
      await cleanupPublishingAssets(uid, docRef, publishAssetId);
      return true;
    } catch (error) {
      lastError = error;
      if (integration.accountId && isRecoverablePublishingError(error)) {
        const parsed = parseMetaApiError(error, "Instagram API request failed");
        if (parsed.disconnectRequired) {
          await markPublishingAccountDisconnected(uid, integration.accountId, parsed.message);
        }
      }
      return false;
    }
  };

  let published = await tryPublish(primaryIntegration);

  if (!published && isRecoverablePublishingError(lastError)) {
    const fallbackAccountIds = await listFallbackAccountIds(uid, Array.from(triedAccountIds));
    for (const accountId of fallbackAccountIds) {
      const fallbackIntegration = await resolveInstagramPublishingIntegrationByAccount(uid, accountId).catch(() => null);
      if (!fallbackIntegration) {
        continue;
      }
      published = await tryPublish(fallbackIntegration);
      if (published) {
        break;
      }
    }
  }

  if (!published) {
    const failedAt = new Date().toISOString();
    const parsed = parseMetaApiError(lastError, "인스타그램 게시 중 알 수 없는 오류가 발생했습니다.");
    await docRef.set(
      {
        status: "failed",
        updatedAt: failedAt,
        failedAt,
        lastError: parsed.message,
      },
      { merge: true },
    );
    await cleanupPublishingAssets(uid, docRef, publishAssetId);
  }

  const latestSnap = await docRef.get();
  return mapRecord(latestSnap.id, (latestSnap.data() || {}) as Record<string, unknown>);
};

export const cancelInstagramPublishingRecord = async (uid: string, recordId: string) => {
  const docRef = getPostsCollection(uid).doc(recordId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new InstagramPublishingRecordNotFoundError("게시 예약 문서를 찾을 수 없습니다.");
  }

  const data = (snap.data() || {}) as Record<string, unknown>;
  const record = mapRecord(recordId, data);
  const publishAssetId = asNonEmptyString(data.publishAssetId);
  if (record.status === "publishing") {
    throw new Error("게시 중인 항목은 취소할 수 없습니다.");
  }
  if (record.status === "published") {
    throw new Error("이미 게시 완료된 항목은 취소할 수 없습니다.");
  }
  if (record.status !== "scheduled" && record.status !== "queued") {
    throw new Error("해당 상태의 항목은 취소할 수 없습니다.");
  }

  await cleanupPublishingAssets(uid, docRef, publishAssetId);
  await docRef.delete();
  return record;
};

export const processDueInstagramPublishingRecords = async (uid: string, limit = 5) => {
  const safeLimit = Math.max(1, Math.min(limit, 5));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const toMillis = (value: string | null) => {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  let queuedSnapshot;
  try {
    queuedSnapshot = await getPostsCollection(uid)
      .where("status", "==", "queued")
      .limit(Math.max(safeLimit * 10, 30))
      .get();
  } catch {
    queuedSnapshot = await getPostsCollection(uid)
      .limit(Math.max(safeLimit * 10, 30))
      .get();
  }

  const queuedNowRecords = queuedSnapshot.docs
    .map((doc) => mapRecord(doc.id, doc.data() as Record<string, unknown>))
    .filter((record) => record.status === "queued" && record.publishMode === "now")
    .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt))
    .slice(0, safeLimit);

  const remainingLimit = Math.max(0, safeLimit - queuedNowRecords.length);
  let dueScheduledRecords: InstagramPublishingRecord[] = [];

  if (remainingLimit > 0) {
    let scheduledSnapshot;
    try {
      scheduledSnapshot = await getPostsCollection(uid)
        .where("status", "==", "scheduled")
        .where("scheduledFor", "<=", nowIso)
        .orderBy("scheduledFor", "asc")
        .limit(remainingLimit)
        .get();
    } catch {
      scheduledSnapshot = await getPostsCollection(uid)
        .where("status", "==", "scheduled")
        .limit(Math.max(remainingLimit * 10, 30))
        .get();
    }

    dueScheduledRecords = scheduledSnapshot.docs
      .map((doc) => mapRecord(doc.id, doc.data() as Record<string, unknown>))
      .filter((record) => {
        if (!record.scheduledFor) return false;
        return toMillis(record.scheduledFor) <= now;
      })
      .sort((left, right) => toMillis(left.scheduledFor) - toMillis(right.scheduledFor))
      .slice(0, remainingLimit);
  }

  const dueRecords = [...queuedNowRecords, ...dueScheduledRecords].slice(0, safeLimit);

  let succeeded = 0;
  let failed = 0;
  const processed: InstagramPublishingRecord[] = [];

  for (const record of dueRecords) {
    try {
      const result = await executeInstagramPublishingRecord(uid, record.id);
      processed.push(result);
      if (result.status === "published") {
        succeeded += 1;
      } else if (result.status === "failed") {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      const failedAt = new Date().toISOString();
      const parsed = parseMetaApiError(error, "인스타그램 게시 처리 중 오류가 발생했습니다.");
      const docRef = getPostsCollection(uid).doc(record.id);
      await docRef.set(
        {
          status: "failed",
          updatedAt: failedAt,
          failedAt,
          lastError: parsed.message,
        },
        { merge: true },
      ).catch(() => undefined);
      const currentSnap = await docRef.get().catch(() => null);
      const currentData = (currentSnap?.data() || {}) as Record<string, unknown>;
      await cleanupPublishingAssets(uid, docRef, asNonEmptyString(currentData.publishAssetId)).catch(() => undefined);

      const latest = await docRef.get().catch(() => null);
      if (latest?.exists) {
        processed.push(mapRecord(latest.id, (latest.data() || {}) as Record<string, unknown>));
      } else {
        processed.push({
          ...record,
          status: "failed",
          updatedAt: failedAt,
          failedAt,
          lastError: parsed.message,
        });
      }
    }
  }

  return {
    processed: processed.length,
    succeeded,
    failed,
    posts: processed,
  };
};
