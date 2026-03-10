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

type PageInfo = {
  id: string;
  name: string;
  igUserId?: string | null;
  igUsername?: string | null;
};

type InstagramMeResponse = {
  id?: string | number;
  username?: string;
};

type InstagramProfileResponse = {
  username?: string;
};

type FacebookPage = {
  id: string | number;
  name?: string;
  instagram_business_account?: {
    id?: string | number | null;
  } | null;
};

type FacebookAccountsResponse = {
  data?: FacebookPage[];
};

type StoredAccountDoc = {
  status?: unknown;
  flow?: unknown;
  accessToken?: unknown;
  pageAccessToken?: unknown;
  expiresAt?: unknown;
  pageId?: unknown;
  pageName?: unknown;
  igUserId?: unknown;
  igUsername?: unknown;
  selectedAt?: unknown;
  connectedAt?: unknown;
  updatedAt?: unknown;
};

type IntegrationDoc = StoredAccountDoc & {
  accountId?: unknown;
  activeAccountId?: unknown;
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

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

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

const isExpired = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return false;
  return timestamp <= Date.now();
};

const hasUsableToken = (value: IntegrationDoc) => {
  return Boolean(asNonEmptyString(value.accessToken) || asNonEmptyString(value.pageAccessToken));
};

const hasUsableIdentity = (value: IntegrationDoc) => {
  return Boolean(asNonEmptyString(value.pageId) || asNonEmptyString(value.igUserId));
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

const toPageInfo = (value: IntegrationDoc, fallbackId?: string | null): PageInfo | null => {
  const pageId = asNonEmptyString(value.pageId) || fallbackId || asNonEmptyString(value.igUserId);
  if (!pageId) return null;
  const igUserId = asNonEmptyString(value.igUserId) || null;
  const igUsername = asNonEmptyString(value.igUsername) || null;
  const pageName = asNonEmptyString(value.pageName) || (igUsername ? `@${igUsername}` : "Instagram 계정");
  return {
    id: pageId,
    name: pageName,
    igUserId,
    igUsername,
  };
};

const getIntegrationRef = (uid: string) => {
  if (!db || !isFirebaseConfigured) {
    throw new Error("Firestore not configured");
  }
  return db.collection("users").doc(uid).collection("integrations").doc("instagram");
};

const readStoredPages = async (uid: string): Promise<PageInfo[]> => {
  if (!db || !isFirebaseConfigured) {
    return [];
  }

  const integrationRef = getIntegrationRef(uid);
  const [rootSnap, accountsSnap] = await Promise.all([
    integrationRef.get(),
    integrationRef.collection("accounts").get(),
  ]);

  const pagesById = new Map<string, PageInfo>();
  const rootData = rootSnap.exists ? ((rootSnap.data() || {}) as IntegrationDoc) : null;
  if (rootData && isConnectedIntegration(rootData)) {
    const rootPage = toPageInfo(rootData);
    if (rootPage) {
      pagesById.set(rootPage.id, rootPage);
    }
  }

  accountsSnap.docs.forEach((doc) => {
    const accountData = (doc.data() || {}) as IntegrationDoc;
    const merged = {
      ...(rootData || {}),
      ...accountData,
      accountId: doc.id,
    } satisfies IntegrationDoc;
    if (!isConnectedIntegration(merged)) return;
    const page = toPageInfo(merged, doc.id);
    if (!page) return;
    pagesById.set(page.id, page);
  });

  return Array.from(pagesById.values());
};

const fetchPagesFromIntegration = async (integration: IntegrationDoc) => {
  const flow = asFlow(integration.flow);
  const accessToken = asNonEmptyString(
    flow === "facebook"
      ? integration.pageAccessToken || integration.accessToken
      : integration.accessToken,
  );
  if (!accessToken) {
    throw new Error("Missing access token");
  }

  if (flow === "instagram") {
    const meUrl = new URL(`${getInstagramGraphBase()}/me`);
    meUrl.searchParams.set("fields", "id,username");
    meUrl.searchParams.set("access_token", accessToken);
    const meRes = await fetchJson<InstagramMeResponse>(meUrl.toString());
    const igId = meRes?.id ? String(meRes.id) : null;
    const igUsername = meRes?.username || null;
    return igId
      ? [{
        id: igId,
        name: igUsername ? `@${igUsername}` : "Instagram 계정",
        igUserId: igId,
        igUsername,
      } satisfies PageInfo]
      : [];
  }

  const baseUrl = getFacebookGraphBase();
  const pagesUrl = new URL(`${baseUrl}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,instagram_business_account,access_token");
  pagesUrl.searchParams.set("access_token", accessToken);

  const pagesRes = await fetchJson<FacebookAccountsResponse>(pagesUrl.toString());
  const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];

  return Promise.all(
    pages.map(async (page) => {
      const igId = page?.instagram_business_account?.id || null;
      let igUsername: string | null = null;
      if (igId) {
        try {
          const igUrl = new URL(`${baseUrl}/${igId}`);
          igUrl.searchParams.set("fields", "username");
          igUrl.searchParams.set("access_token", accessToken);
          const igRes = await fetchJson<InstagramProfileResponse>(igUrl.toString());
          igUsername = igRes?.username || null;
        } catch {
          igUsername = null;
        }
      }
      return {
        id: String(page.id),
        name: page.name || "이름 없음",
        igUserId: igId ? String(igId) : null,
        igUsername,
      } satisfies PageInfo;
    }),
  );
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

  const candidates = accountsSnap.docs
    .map((doc) => {
      const merged = {
        ...rootData,
        ...(doc.data() || {}),
        accountId: doc.id,
      } satisfies IntegrationDoc;
      return merged;
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

  return candidates;
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

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const storedPages = await readStoredPages(uid);
    if (storedPages.length > 0) {
      return NextResponse.json({ pages: storedPages });
    }

    const integration = (await readInstagramIntegration(uid, { forceFresh: true })) as IntegrationDoc | null;
    if (!integration) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }
    try {
      const pages = await fetchPagesFromIntegration(integration);
      return NextResponse.json({ pages });
    } catch (error) {
      const parsed = parseMetaApiError(error, "Failed to fetch pages");
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
          const pages = await fetchPagesFromIntegration(candidate);
          await activateIntegrationAccount(uid, candidate);
          return NextResponse.json({ pages });
        } catch (candidateError) {
          const candidateParsed = parseMetaApiError(candidateError, "Failed to fetch pages");
          if (candidateParsed.disconnectRequired) {
            await markIntegrationDisconnected(uid, candidate, candidateParsed.message);
          }
        }
      }

      return NextResponse.json(
        { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
        { status: parsed.status },
      );
    }
  } catch (error) {
    console.error("Meta pages fetch failed:", error);
    const parsed = parseMetaApiError(error, "Failed to fetch pages");
    return NextResponse.json(
      { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
      { status: parsed.status },
    );
  }
}
