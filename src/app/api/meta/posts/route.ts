import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { invalidateInstagramIntegration, readInstagramIntegration } from "@/lib/services/meta-integration-cache";
import {
  getFacebookGraphBase,
  getInstagramGraphBase,
  parseMetaApiError,
} from "@/lib/services/meta-graph";
import { buildInstagramRootPayloadFromAccount } from "@/lib/services/meta-integration-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationDoc = {
  status?: unknown;
  flow?: unknown;
  accessToken?: unknown;
  pageAccessToken?: unknown;
  pageName?: unknown;
  pageId?: unknown;
  igUserId?: unknown;
  igUsername?: unknown;
  accountId?: unknown;
  activeAccountId?: unknown;
  expiresAt?: unknown;
  selectedAt?: unknown;
  connectedAt?: unknown;
  updatedAt?: unknown;
};

type InstagramMediaChild = {
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
};

type InstagramMediaItem = {
  id?: string | number;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  children?: {
    data?: InstagramMediaChild[];
  };
};

type InstagramMediaResponse = {
  data?: InstagramMediaItem[];
  paging?: {
    next?: string;
  };
};

type StoredPublishingRecord = {
  caption?: unknown;
  imageUrl?: unknown;
  permalink?: unknown;
  publishedAt?: unknown;
  createdAt?: unknown;
};

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
};

const parseLimit = (value: string | null) => {
  if (!value) return 18;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 18;
  return Math.min(Math.max(parsed, 1), 50);
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

const getPreviewUrl = (post: InstagramMediaItem) => {
  if (post.media_type === "CAROUSEL_ALBUM") {
    const firstChild = post.children?.data?.[0];
    if (firstChild?.thumbnail_url) return firstChild.thumbnail_url;
    if (firstChild?.media_url) return firstChild.media_url;
  }
  return post.thumbnail_url || post.media_url || null;
};

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "children{media_type,media_url,thumbnail_url}",
].join(",");

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFlow = (value: unknown): "facebook" | "instagram" => {
  if (value === "facebook" || value === "instagram") return value;
  return (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
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

const toIsoString = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString();
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

const isConnectedIntegration = (value: IntegrationDoc) => {
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

const normalizePosts = (posts: InstagramMediaItem[]) => {
  return posts
    .map((post) => ({
      id: post.id ? String(post.id) : "",
      caption: post.caption || "",
      mediaType: post.media_type || "",
      mediaUrl: post.media_url || null,
      thumbnailUrl: post.thumbnail_url || null,
      previewUrl: getPreviewUrl(post),
      permalink: post.permalink || null,
      timestamp: post.timestamp || null,
      likeCount: typeof post.like_count === "number" ? post.like_count : null,
      commentCount: typeof post.comments_count === "number" ? post.comments_count : null,
    }))
    .filter((post) => Boolean(post.id));
};

const getIntegrationRef = (uid: string) => {
  if (!db || !isFirebaseConfigured) {
    throw new Error("Firestore not configured");
  }
  return db.collection("users").doc(uid).collection("integrations").doc("instagram");
};

const buildAccountPayload = (integration: IntegrationDoc) => ({
  flow: asFlow(integration.flow),
  pageName: asNonEmptyString(integration.pageName),
  igUserId: asNonEmptyString(integration.igUserId) || asNonEmptyString(integration.pageId),
  igUsername: asNonEmptyString(integration.igUsername),
});

const fetchPostsFromIntegration = async (integration: IntegrationDoc, limit: number) => {
  const flow = asFlow(integration.flow);
  let mediaRes: InstagramMediaResponse;

  if (flow === "instagram") {
    const accessToken = asNonEmptyString(integration.accessToken);
    if (!accessToken) {
      throw new Error("Missing access token");
    }
    const mediaUrl = new URL(`${getInstagramGraphBase()}/me/media`);
    mediaUrl.searchParams.set("fields", MEDIA_FIELDS);
    mediaUrl.searchParams.set("limit", String(limit));
    mediaUrl.searchParams.set("access_token", accessToken);
    mediaRes = await fetchJson<InstagramMediaResponse>(mediaUrl.toString());
  } else {
    const igUserId = asNonEmptyString(integration.igUserId);
    if (!igUserId) {
      throw new Error("No Instagram account selected. Please connect in 분석 > 계정 관리.");
    }
    const accessToken = asNonEmptyString(integration.pageAccessToken) || asNonEmptyString(integration.accessToken);
    if (!accessToken) {
      throw new Error("Missing access token");
    }
    const mediaUrl = new URL(`${getFacebookGraphBase()}/${igUserId}/media`);
    mediaUrl.searchParams.set("fields", MEDIA_FIELDS);
    mediaUrl.searchParams.set("limit", String(limit));
    mediaUrl.searchParams.set("access_token", accessToken);
    mediaRes = await fetchJson<InstagramMediaResponse>(mediaUrl.toString());
  }

  const posts = Array.isArray(mediaRes.data) ? mediaRes.data : [];
  return {
    account: buildAccountPayload(integration),
    posts: normalizePosts(posts),
    nextCursor: mediaRes.paging?.next || null,
  };
};

const readFallbackIntegrations = async (uid: string, excludeAccountIds: string[]) => {
  const integrationRef = getIntegrationRef(uid);
  const rootSnap = await integrationRef.get();
  if (!rootSnap.exists) {
    return [] as IntegrationDoc[];
  }
  const rootData = (rootSnap.data() || {}) as IntegrationDoc;
  const activeAccountId = asNonEmptyString(rootData.activeAccountId);
  const accountsSnap = await integrationRef.collection("accounts").get();

  return accountsSnap.docs
    .map((doc) => {
      return {
        ...rootData,
        ...(doc.data() || {}),
        accountId: doc.id,
      } satisfies IntegrationDoc;
    })
    .filter((candidate) => {
      const accountId = asNonEmptyString(candidate.accountId);
      if (!accountId || excludeAccountIds.includes(accountId)) return false;
      return isConnectedIntegration(candidate);
    })
    .sort((left, right) => {
      const leftId = asNonEmptyString(left.accountId);
      const rightId = asNonEmptyString(right.accountId);
      if (leftId && activeAccountId && leftId === activeAccountId) return -1;
      if (rightId && activeAccountId && rightId === activeAccountId) return 1;
      return toPriorityTimestamp(right) - toPriorityTimestamp(left);
    });
};

const markIntegrationDisconnected = async (uid: string, integration: IntegrationDoc, reason: string) => {
  const accountId = asNonEmptyString(integration.accountId) || asNonEmptyString(integration.activeAccountId);
  if (!accountId) {
    return;
  }

  const nowIso = new Date().toISOString();
  const integrationRef = getIntegrationRef(uid);
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

const activateIntegrationAccount = async (uid: string, integration: IntegrationDoc) => {
  const accountId = asNonEmptyString(integration.accountId);
  if (!accountId) return;

  const nowIso = new Date().toISOString();
  const integrationRef = getIntegrationRef(uid);
  await integrationRef.set(
    buildInstagramRootPayloadFromAccount(accountId, integration, nowIso),
    { merge: true },
  ).catch(() => undefined);
  invalidateInstagramIntegration(uid);
};

const readLocalPublishedPosts = async (uid: string, limit: number) => {
  if (!db || !isFirebaseConfigured) return [];
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("instagramPosts")
    .where("status", "==", "published")
    .orderBy("publishedAt", "desc")
    .limit(Math.max(1, Math.min(limit, 20)))
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return [];

  return snap.docs
    .map((doc) => {
      const data = (doc.data() || {}) as StoredPublishingRecord;
      const imageUrl = asNonEmptyString(data.imageUrl);
      if (!imageUrl) return null;
      return {
        id: doc.id,
        caption: asNonEmptyString(data.caption) || "",
        mediaType: "IMAGE",
        mediaUrl: imageUrl,
        thumbnailUrl: imageUrl,
        previewUrl: imageUrl,
        permalink: asNonEmptyString(data.permalink),
        timestamp: toIsoString(data.publishedAt) || toIsoString(data.createdAt),
        likeCount: null,
        commentCount: null,
      };
    })
    .filter((post): post is {
      id: string;
      caption: string;
      mediaType: string;
      mediaUrl: string;
      thumbnailUrl: string;
      previewUrl: string;
      permalink: string | null;
      timestamp: string | null;
      likeCount: null;
      commentCount: null;
    } => Boolean(post));
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

    const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
    const integration = (await readInstagramIntegration(uid, { forceFresh: true })) as IntegrationDoc | null;
    if (!integration) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    if (!isConnectedIntegration(integration)) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    try {
      const result = await fetchPostsFromIntegration(integration, limit);
      return NextResponse.json(result);
    } catch (error) {
      const parsed = parseMetaApiError(error, "Failed to fetch posts");
      if (!parsed.recoverable) {
        return NextResponse.json(
          { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
          { status: parsed.status },
        );
      }

      if (parsed.disconnectRequired) {
        await markIntegrationDisconnected(uid, integration, parsed.message);
      }
      const excludeAccountIds = [
        asNonEmptyString(integration.accountId),
        asNonEmptyString(integration.activeAccountId),
      ].filter((value): value is string => Boolean(value));
      const fallbackCandidates = await readFallbackIntegrations(uid, excludeAccountIds);

      for (const candidate of fallbackCandidates) {
        try {
          const result = await fetchPostsFromIntegration(candidate, limit);
          await activateIntegrationAccount(uid, candidate);
          return NextResponse.json(result);
        } catch (candidateError) {
          const candidateParsed = parseMetaApiError(candidateError, "Failed to fetch posts");
          if (candidateParsed.disconnectRequired) {
            await markIntegrationDisconnected(uid, candidate, candidateParsed.message);
          }
        }
      }

      const localPosts = await readLocalPublishedPosts(uid, limit);
      if (localPosts.length > 0) {
        return NextResponse.json({
          account: buildAccountPayload(integration),
          posts: localPosts,
          nextCursor: null,
          fallback: "local",
        });
      }

      return NextResponse.json(
        { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
        { status: parsed.status },
      );
    }
  } catch (error) {
    console.error("Meta posts fetch failed:", error);
    const parsed = parseMetaApiError(error, "Failed to fetch posts");
    return NextResponse.json(
      { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
      { status: parsed.status },
    );
  }
}
