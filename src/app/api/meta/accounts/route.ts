import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { getFacebookGraphBase, getInstagramGraphBase } from "@/lib/services/meta-graph";
import { invalidateInstagramIntegration } from "@/lib/services/meta-integration-cache";
import { buildInstagramRootPayloadFromAccount } from "@/lib/services/meta-integration-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountSummary = {
  id: string;
  flow: "facebook" | "instagram" | null;
  igUserId: string | null;
  igUsername: string | null;
  pageName: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  status: string | null;
  connected: boolean;
  reconnectRequired: boolean;
  active: boolean;
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
  access_token?: string;
  instagram_business_account?: {
    id?: string | number | null;
  } | null;
};

type FacebookAccountsResponse = {
  data?: FacebookPage[];
};

type StoredAccountDoc = Record<string, unknown>;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFlow = (value: unknown): "facebook" | "instagram" | null => {
  if (value === "facebook" || value === "instagram") {
    return value;
  }
  return null;
};

const getDefaultFlow = () => {
  return (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
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
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
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

const isExpired = (expiresAt: unknown) => {
  const timestamp = toTimestamp(expiresAt);
  if (timestamp === null) return false;
  return timestamp <= Date.now();
};

const isAuthRelatedDisconnectReason = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text) return false;
  return /token|session|expired|invalid oauth|error validating access token|authorization code|revoked|oauth/i.test(text);
};

const hasUsableToken = (value: StoredAccountDoc) => {
  return Boolean(asNonEmptyString(value.accessToken) || asNonEmptyString(value.pageAccessToken));
};

const hasUsableIdentity = (value: StoredAccountDoc) => {
  return Boolean(asNonEmptyString(value.igUserId) || asNonEmptyString(value.pageId));
};

const isConnectedAccountData = (value: StoredAccountDoc) => {
  const status = asNonEmptyString(value.status);
  const lastError = asNonEmptyString(value.lastError);
  const disconnectedButRetriable = status === "disconnected"
    && !isExpired(value.expiresAt)
    && hasUsableToken(value)
    && hasUsableIdentity(value)
    && Boolean(lastError)
    && !isAuthRelatedDisconnectReason(lastError);

  return (status !== "disconnected" || disconnectedButRetriable)
    && !isExpired(value.expiresAt)
    && hasUsableToken(value)
    && hasUsableIdentity(value);
};

const toPriorityTimestamp = (value: StoredAccountDoc) => {
  return (
    toTimestamp(value.selectedAt)
    || toTimestamp(value.connectedAt)
    || toTimestamp(value.updatedAt)
    || 0
  );
};

const pickPreferredAccount = (
  docs: Array<{ id: string; data: StoredAccountDoc }>,
  preferredId: string | null,
) => {
  const connectedDocs = docs
    .filter(({ data }) => isConnectedAccountData(data))
    .sort((left, right) => {
      if (preferredId && left.id === preferredId) return -1;
      if (preferredId && right.id === preferredId) return 1;
      return toPriorityTimestamp(right.data) - toPriorityTimestamp(left.data);
    });

  return connectedDocs[0] || null;
};

const buildDisconnectedRootPayload = (
  flow: "facebook" | "instagram",
  nextActiveAccountId: string | null,
  nowIso: string,
) => ({
  status: "disconnected",
  version: 2,
  flow,
  activeAccountId: nextActiveAccountId,
  accessToken: null,
  tokenType: null,
  expiresAt: null,
  pageId: null,
  pageName: null,
  pageAccessToken: null,
  igUserId: null,
  igUsername: null,
  selectedAt: null,
  connectedAt: null,
  updatedAt: nowIso,
  lastError: null,
});

const syncPendingPostsForRemovedAccount = async (
  uid: string,
  removedAccountId: string,
  fallback: { id: string; data: StoredAccountDoc } | null,
) => {
  if (!db || !isFirebaseConfigured) return;

  const postsSnap = await db
    .collection("users")
    .doc(uid)
    .collection("instagramPosts")
    .where("accountId", "==", removedAccountId)
    .get()
    .catch(() => null);

  if (!postsSnap || postsSnap.empty) {
    return;
  }

  const nowIso = new Date().toISOString();
  const batch = db.batch();
  let writeCount = 0;

  postsSnap.docs.forEach((doc) => {
    const data = (doc.data() || {}) as Record<string, unknown>;
    const status = asNonEmptyString(data.status);
    if (status !== "queued" && status !== "scheduled") {
      return;
    }

    writeCount += 1;
    if (fallback) {
      batch.set(
        doc.ref,
        {
          accountId: fallback.id,
          igUserId: asNonEmptyString(fallback.data.igUserId) || asNonEmptyString(fallback.data.pageId),
          igUsername: asNonEmptyString(fallback.data.igUsername),
          pageName: asNonEmptyString(fallback.data.pageName),
          updatedAt: nowIso,
        },
        { merge: true },
      );
      return;
    }

    batch.set(
      doc.ref,
      {
        accountId: null,
        igUserId: null,
        igUsername: null,
        pageName: null,
        updatedAt: nowIso,
      },
      { merge: true },
    );
  });

  if (writeCount > 0) {
    await batch.commit();
  }
};

const buildConnectedSummary = (params: {
  accountId: string;
  flow: "facebook" | "instagram";
  pageName: string | null;
  igUserId: string | null;
  igUsername: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
  active: boolean;
}): AccountSummary => {
  const connected = !isExpired(params.expiresAt) && Boolean(params.igUserId || params.accountId);
  return {
    id: params.accountId,
    flow: params.flow,
    igUserId: params.igUserId,
    igUsername: params.igUsername,
    pageName: params.pageName,
    connectedAt: params.connectedAt,
    expiresAt: params.expiresAt,
    status: connected ? "connected" : "disconnected",
    connected,
    reconnectRequired: !connected,
    active: params.active,
  };
};

type LegacyAccountSeed = {
  accountId: string;
  flow: "facebook" | "instagram";
  accessToken: string;
  pageAccessToken: string | null;
  tokenType: string;
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
  selectedAt: string | null;
};

const buildLegacySeed = (rootData: Record<string, unknown>, activeAccountId: string | null): LegacyAccountSeed | null => {
  const accountId = activeAccountId
    || asNonEmptyString(rootData.pageId)
    || asNonEmptyString(rootData.igUserId);
  const accessToken = asNonEmptyString(rootData.accessToken) || asNonEmptyString(rootData.pageAccessToken);
  if (!accountId || !accessToken) {
    return null;
  }

  const flow = asFlow(rootData.flow)
    || (asNonEmptyString(rootData.pageAccessToken) ? "facebook" : "instagram");
  const igUsername = asNonEmptyString(rootData.igUsername);
  const pageName = asNonEmptyString(rootData.pageName) || (igUsername ? `@${igUsername}` : "Instagram 계정");
  const pageId = asNonEmptyString(rootData.pageId) || accountId;
  const igUserId = asNonEmptyString(rootData.igUserId) || (flow === "instagram" ? accountId : null);

  return {
    accountId,
    flow,
    accessToken,
    pageAccessToken: asNonEmptyString(rootData.pageAccessToken),
    tokenType: asNonEmptyString(rootData.tokenType) || "bearer",
    pageId,
    pageName,
    igUserId,
    igUsername,
    expiresAt: toIsoString(rootData.expiresAt),
    connectedAt: asNonEmptyString(rootData.connectedAt),
    selectedAt: asNonEmptyString(rootData.selectedAt),
  };
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

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
    const rootSnap = await integrationRef.get();
    const rootData = rootSnap.exists ? ((rootSnap.data() || {}) as Record<string, unknown>) : null;
    let activeAccountId = asNonEmptyString(rootData?.activeAccountId) || null;
    let activeConnectedAccountDoc: { id: string; data: StoredAccountDoc } | null = null;

    const accountsSnap = await integrationRef.collection("accounts").get();
    const accountIdsToRecover: string[] = [];
    const accounts: AccountSummary[] = accountsSnap.docs.map((doc) => {
      const data = (doc.data() || {}) as Record<string, unknown>;
      const flowRaw = asNonEmptyString(data.flow);
      const flow = flowRaw === "facebook" || flowRaw === "instagram" ? flowRaw : null;
      const status = asNonEmptyString(data.status);
      const lastError = asNonEmptyString(data.lastError);
      const expiresAt = toIsoString(data.expiresAt);
      const hasToken = Boolean(asNonEmptyString(data.accessToken) || asNonEmptyString(data.pageAccessToken));
      const hasIdentity = Boolean(asNonEmptyString(data.igUserId) || asNonEmptyString(data.pageId));
      const disconnectedButRetriable = status === "disconnected"
        && !isExpired(data.expiresAt)
        && hasToken
        && hasIdentity
        && Boolean(lastError)
        && !isAuthRelatedDisconnectReason(lastError);
      const connected = (status !== "disconnected" || disconnectedButRetriable)
        && !isExpired(data.expiresAt)
        && hasToken
        && hasIdentity;
      if (disconnectedButRetriable) {
        accountIdsToRecover.push(doc.id);
      }
      return {
        id: doc.id,
        flow,
        igUserId: asNonEmptyString(data.igUserId) || null,
        igUsername: asNonEmptyString(data.igUsername) || null,
        pageName: asNonEmptyString(data.pageName) || null,
        connectedAt: asNonEmptyString(data.connectedAt) || null,
        expiresAt,
        status: connected ? "connected" : status,
        connected,
        reconnectRequired: !connected,
        active: Boolean(activeAccountId && doc.id === activeAccountId),
      };
    });

    if (activeAccountId) {
      const activeDoc = accountsSnap.docs.find((doc) => doc.id === activeAccountId);
      if (activeDoc) {
        const activeData = (activeDoc.data() || {}) as StoredAccountDoc;
        if (isConnectedAccountData(activeData)) {
          activeConnectedAccountDoc = { id: activeDoc.id, data: activeData };
        }
      }
    }

    if (accountIdsToRecover.length > 0) {
      const nowIso = new Date().toISOString();
      await Promise.all(
        accountIdsToRecover.map((accountId) =>
          integrationRef.collection("accounts").doc(accountId).set(
            {
              status: "connected",
              lastError: null,
              updatedAt: nowIso,
            },
            { merge: true },
          ).catch(() => undefined)),
      );
      await integrationRef.set(
        {
          status: "connected",
          activeAccountId: activeAccountId || accountIdsToRecover[0],
          updatedAt: nowIso,
        },
        { merge: true },
      ).catch(() => undefined);
    }

    if (accounts.length === 0 && rootData) {
      const legacySeed = buildLegacySeed(rootData, activeAccountId);
      if (legacySeed) {
        const hasToken = Boolean(legacySeed.accessToken || legacySeed.pageAccessToken);
        const hasIdentity = Boolean(legacySeed.igUserId || legacySeed.pageId);
        const connected = hasToken && hasIdentity && !isExpired(legacySeed.expiresAt);

        accounts.push(buildConnectedSummary({
          accountId: legacySeed.accountId,
          flow: legacySeed.flow,
          pageName: legacySeed.pageName,
          igUserId: legacySeed.igUserId,
          igUsername: legacySeed.igUsername,
          expiresAt: legacySeed.expiresAt,
          connectedAt: legacySeed.connectedAt,
          active: true,
        }));
        activeAccountId = legacySeed.accountId;

        const nowIso = new Date().toISOString();
        await integrationRef.collection("accounts").doc(legacySeed.accountId).set(
          {
            status: connected ? "connected" : "disconnected",
            flow: legacySeed.flow,
            accessToken: legacySeed.accessToken,
            pageAccessToken: legacySeed.flow === "facebook" ? legacySeed.pageAccessToken : null,
            tokenType: legacySeed.tokenType,
            expiresAt: legacySeed.expiresAt,
            pageId: legacySeed.pageId,
            pageName: legacySeed.pageName,
            igUserId: legacySeed.igUserId,
            igUsername: legacySeed.igUsername,
            selectedAt: legacySeed.selectedAt || nowIso,
            connectedAt: legacySeed.connectedAt || nowIso,
            updatedAt: nowIso,
          },
          { merge: true },
        ).catch(() => undefined);

        await integrationRef.set(
          {
            status: connected ? "connected" : "disconnected",
            version: 2,
            flow: legacySeed.flow,
            activeAccountId: legacySeed.accountId,
            pageId: legacySeed.pageId,
            pageName: legacySeed.pageName,
            pageAccessToken: legacySeed.flow === "facebook" ? legacySeed.pageAccessToken : null,
            igUserId: legacySeed.igUserId,
            igUsername: legacySeed.igUsername,
            selectedAt: legacySeed.selectedAt || nowIso,
            updatedAt: nowIso,
            connectedAt: legacySeed.connectedAt || nowIso,
          },
          { merge: true },
        ).catch(() => undefined);
      }
    }

    if (accounts.length === 0 && rootData) {
      const nowIso = new Date().toISOString();
      const flow = asFlow(rootData.flow) || getDefaultFlow();
      const accessToken = asNonEmptyString(rootData.accessToken) || asNonEmptyString(rootData.pageAccessToken);
      const tokenType = asNonEmptyString(rootData.tokenType) || "bearer";
      const expiresAt = toIsoString(rootData.expiresAt);

      if (accessToken && !isExpired(expiresAt)) {
        if (flow === "instagram") {
          try {
            const meUrl = new URL(`${getInstagramGraphBase()}/me`);
            meUrl.searchParams.set("fields", "id,username");
            meUrl.searchParams.set("access_token", accessToken);
            const me = await fetchJson<InstagramMeResponse>(meUrl.toString());
            const igUserId = me?.id ? String(me.id) : null;
            const igUsername = typeof me?.username === "string" ? me.username : null;
            if (igUserId) {
              const pageName = igUsername ? `@${igUsername}` : "Instagram 계정";
              await integrationRef.collection("accounts").doc(igUserId).set(
                {
                  status: "connected",
                  flow: "instagram",
                  accessToken,
                  pageAccessToken: null,
                  tokenType,
                  expiresAt,
                  pageId: igUserId,
                  pageName,
                  igUserId,
                  igUsername,
                  selectedAt: nowIso,
                  connectedAt: nowIso,
                  updatedAt: nowIso,
                },
                { merge: true },
              );
              await integrationRef.set(
                {
                  status: "connected",
                  version: 2,
                  flow: "instagram",
                  activeAccountId: igUserId,
                  pageId: igUserId,
                  pageName,
                  pageAccessToken: null,
                  igUserId,
                  igUsername,
                  selectedAt: nowIso,
                  connectedAt: nowIso,
                  updatedAt: nowIso,
                },
                { merge: true },
              );
              accounts.push(buildConnectedSummary({
                accountId: igUserId,
                flow: "instagram",
                pageName,
                igUserId,
                igUsername,
                expiresAt,
                connectedAt: nowIso,
                active: true,
              }));
              activeAccountId = igUserId;
            }
          } catch {
            // ignore bootstrap failure
          }
        } else {
          try {
            const baseUrl = getFacebookGraphBase();
            const pagesUrl = new URL(`${baseUrl}/me/accounts`);
            pagesUrl.searchParams.set("fields", "id,name,instagram_business_account,access_token");
            pagesUrl.searchParams.set("access_token", accessToken);
            const pagesRes = await fetchJson<FacebookAccountsResponse>(pagesUrl.toString());
            const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
            const page = pages.find((item) => Boolean(item?.instagram_business_account?.id)) || pages[0] || null;
            if (page?.id) {
              const accountId = String(page.id);
              const igUserId = page.instagram_business_account?.id ? String(page.instagram_business_account.id) : null;
              let igUsername: string | null = null;
              if (igUserId) {
                try {
                  const igUrl = new URL(`${baseUrl}/${igUserId}`);
                  igUrl.searchParams.set("fields", "username");
                  igUrl.searchParams.set("access_token", accessToken);
                  const igRes = await fetchJson<InstagramProfileResponse>(igUrl.toString());
                  igUsername = typeof igRes?.username === "string" ? igRes.username : null;
                } catch {
                  igUsername = null;
                }
              }
              const pageName = typeof page.name === "string" ? page.name : (igUsername ? `@${igUsername}` : "이름 없음");
              const pageAccessToken = typeof page.access_token === "string" ? page.access_token : null;
              await integrationRef.collection("accounts").doc(accountId).set(
                {
                  status: "connected",
                  flow: "facebook",
                  accessToken,
                  pageAccessToken,
                  tokenType,
                  expiresAt,
                  pageId: accountId,
                  pageName,
                  igUserId,
                  igUsername,
                  selectedAt: nowIso,
                  connectedAt: nowIso,
                  updatedAt: nowIso,
                },
                { merge: true },
              );
              await integrationRef.set(
                {
                  status: "connected",
                  version: 2,
                  flow: "facebook",
                  activeAccountId: accountId,
                  pageId: accountId,
                  pageName,
                  pageAccessToken,
                  igUserId,
                  igUsername,
                  selectedAt: nowIso,
                  connectedAt: nowIso,
                  updatedAt: nowIso,
                },
                { merge: true },
              );
              accounts.push(buildConnectedSummary({
                accountId,
                flow: "facebook",
                pageName,
                igUserId,
                igUsername,
                expiresAt,
                connectedAt: nowIso,
                active: true,
              }));
              activeAccountId = accountId;
            }
          } catch {
            // ignore bootstrap failure
          }
        }
      }
    }

    if (activeConnectedAccountDoc) {
      const rootNeedsSync =
        !rootData
        || asNonEmptyString(rootData.activeAccountId) !== activeConnectedAccountDoc.id
        || !hasUsableToken(rootData)
        || !hasUsableIdentity(rootData)
        || asFlow(rootData.flow) !== asFlow(activeConnectedAccountDoc.data.flow)
        || asNonEmptyString(rootData.pageId) !== (asNonEmptyString(activeConnectedAccountDoc.data.pageId) || activeConnectedAccountDoc.id)
        || asNonEmptyString(rootData.igUserId) !== asNonEmptyString(activeConnectedAccountDoc.data.igUserId)
        || asNonEmptyString(rootData.pageName) !== asNonEmptyString(activeConnectedAccountDoc.data.pageName)
        || asNonEmptyString(rootData.igUsername) !== asNonEmptyString(activeConnectedAccountDoc.data.igUsername)
        || toIsoString(rootData.expiresAt) !== toIsoString(activeConnectedAccountDoc.data.expiresAt);

      if (rootNeedsSync) {
        await integrationRef.set(
          buildInstagramRootPayloadFromAccount(activeConnectedAccountDoc.id, activeConnectedAccountDoc.data, new Date().toISOString()),
          { merge: true },
        ).catch(() => undefined);
        invalidateInstagramIntegration(uid);
      }
    }

    return NextResponse.json({
      activeAccountId,
      accounts,
    });
  } catch (error) {
    console.error("Meta accounts fetch failed:", error);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
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

    const searchParams = new URL(req.url).searchParams;
    const requestBody = (await req.json().catch(() => ({}))) as { accountId?: unknown };
    const accountId = asNonEmptyString(requestBody.accountId) || asNonEmptyString(searchParams.get("accountId"));
    if (!accountId) {
      return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }

    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
    const [rootSnap, accountSnap] = await Promise.all([
      integrationRef.get(),
      integrationRef.collection("accounts").doc(accountId).get(),
    ]);

    if (!accountSnap.exists) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const rootData = rootSnap.exists ? ((rootSnap.data() || {}) as StoredAccountDoc) : null;
    const currentActiveAccountId = asNonEmptyString(rootData?.activeAccountId);
    const fallbackFlow = asFlow(rootData?.flow) || getDefaultFlow();

    await integrationRef.collection("accounts").doc(accountId).delete();

    const remainingSnap = await integrationRef.collection("accounts").get();
    const remainingAccounts = remainingSnap.docs.map((doc) => ({
      id: doc.id,
      data: (doc.data() || {}) as StoredAccountDoc,
    }));
    const preferredActiveId = currentActiveAccountId && currentActiveAccountId !== accountId ? currentActiveAccountId : null;
    const nextActiveAccount = pickPreferredAccount(remainingAccounts, preferredActiveId);
    const nowIso = new Date().toISOString();

    if (nextActiveAccount) {
      await integrationRef.set(
        buildInstagramRootPayloadFromAccount(nextActiveAccount.id, nextActiveAccount.data, nowIso),
        { merge: true },
      );
    } else {
      const fallbackDisconnectedAccountId = preferredActiveId || remainingAccounts[0]?.id || null;
      await integrationRef.set(
        buildDisconnectedRootPayload(fallbackFlow, fallbackDisconnectedAccountId, nowIso),
        { merge: true },
      );
    }

    await syncPendingPostsForRemovedAccount(uid, accountId, nextActiveAccount);
    invalidateInstagramIntegration(uid);

    return NextResponse.json({
      ok: true,
      removedAccountId: accountId,
      activeAccountId: nextActiveAccount?.id || null,
    });
  } catch (error) {
    console.error("Meta account removal failed:", error);
    return NextResponse.json({ error: "Failed to remove account" }, { status: 500 });
  }
}
