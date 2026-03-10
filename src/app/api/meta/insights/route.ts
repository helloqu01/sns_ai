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

type InstagramMediaItem = {
  id?: string | number;
  like_count?: number;
  comments_count?: number;
};

type InstagramMediaResponse = {
  data?: InstagramMediaItem[];
};

type InsightValue = {
  value?: unknown;
  end_time?: unknown;
};

type InsightItem = {
  name?: unknown;
  values?: InsightValue[];
};

type InsightsResponse = {
  data?: InsightItem[];
};

type AccountInsightDaily = {
  date: string;
  reach: number | null;
  impressions: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
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

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object") {
    if ("value" in value) {
      return asNumber((value as { value?: unknown }).value);
    }
    if ("count" in value) {
      return asNumber((value as { count?: unknown }).count);
    }
  }
  return null;
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

const parsePositiveInt = (value: string | null, min: number, max: number, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
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

const resolveIntegrationAccessToken = (integration: IntegrationDoc) => {
  const flow = asFlow(integration.flow);
  if (flow === "facebook") {
    return asNonEmptyString(integration.pageAccessToken) || asNonEmptyString(integration.accessToken);
  }
  return asNonEmptyString(integration.accessToken);
};

const resolveIntegrationIgUserId = (integration: IntegrationDoc) => {
  return asNonEmptyString(integration.igUserId) || asNonEmptyString(integration.pageId);
};

const parseMetricMap = (payload: InsightsResponse) => {
  const metrics = new Map<string, { latest: number | null; series: Array<{ date: string; value: number }> }>();
  const items = Array.isArray(payload.data) ? payload.data : [];

  items.forEach((item) => {
    const name = asNonEmptyString(item.name);
    if (!name) return;
    const values = Array.isArray(item.values) ? item.values : [];
    const series = values
      .map((entry) => {
        const rawDate = asNonEmptyString(entry.end_time);
        const timestamp = rawDate ? Date.parse(rawDate) : NaN;
        const date = Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
        const value = asNumber(entry.value);
        if (!date || value === null) return null;
        return { date, value };
      })
      .filter((entry): entry is { date: string; value: number } => Boolean(entry));
    const latestFromSeries = series.length > 0 ? series[series.length - 1].value : null;
    const latestFromValues = values.length > 0 ? asNumber(values[values.length - 1]?.value) : null;
    const latest = latestFromSeries ?? latestFromValues;
    metrics.set(name, { latest, series });
  });

  return metrics;
};

const buildDailyRows = (metricMap: Map<string, { latest: number | null; series: Array<{ date: string; value: number }> }>) => {
  const byDate = new Map<string, AccountInsightDaily>();
  const metricKeyMap: Record<string, keyof Omit<AccountInsightDaily, "date">> = {
    reach: "reach",
    impressions: "impressions",
    accounts_engaged: "accountsEngaged",
    total_interactions: "totalInteractions",
  };

  Object.entries(metricKeyMap).forEach(([metricName, outputKey]) => {
    const metric = metricMap.get(metricName);
    if (!metric) return;
    metric.series.forEach((point) => {
      const current = byDate.get(point.date) || {
        date: point.date,
        reach: null,
        impressions: null,
        accountsEngaged: null,
        totalInteractions: null,
      };
      current[outputKey] = point.value;
      byDate.set(point.date, current);
    });
  });

  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
};

const fetchMediaList = async (
  integration: IntegrationDoc,
  postLimit: number,
): Promise<InstagramMediaItem[]> => {
  const flow = asFlow(integration.flow);
  const accessToken = resolveIntegrationAccessToken(integration);
  if (!accessToken) {
    throw new Error("Missing access token");
  }

  const mediaUrl = flow === "instagram"
    ? new URL(`${getInstagramGraphBase()}/me/media`)
    : new URL(`${getFacebookGraphBase()}/${resolveIntegrationIgUserId(integration) || ""}/media`);

  if (flow === "facebook" && !resolveIntegrationIgUserId(integration)) {
    throw new Error("No Instagram account selected.");
  }

  mediaUrl.searchParams.set("fields", "id,like_count,comments_count");
  mediaUrl.searchParams.set("limit", String(postLimit));
  mediaUrl.searchParams.set("access_token", accessToken);

  const mediaRes = await fetchJson<InstagramMediaResponse>(mediaUrl.toString());
  return Array.isArray(mediaRes.data) ? mediaRes.data : [];
};

const fetchAccountInsights = async (
  integration: IntegrationDoc,
  days: number,
): Promise<{
  reach: number | null;
  impressions: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  daily: AccountInsightDaily[];
  warning: string | null;
}> => {
  const flow = asFlow(integration.flow);
  const accessToken = resolveIntegrationAccessToken(integration);
  const igUserId = resolveIntegrationIgUserId(integration);
  if (!accessToken || !igUserId) {
    return {
      reach: null,
      impressions: null,
      accountsEngaged: null,
      totalInteractions: null,
      daily: [],
      warning: "insights_unavailable",
    };
  }

  const metricSets = [
    ["reach", "impressions", "accounts_engaged", "total_interactions"],
    ["reach", "impressions", "accounts_engaged"],
    ["reach", "impressions"],
  ];
  const since = Math.floor((Date.now() - (days - 1) * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const endpointCandidates = flow === "instagram"
    ? [
      `${getInstagramGraphBase()}/me/insights`,
      `${getInstagramGraphBase()}/${igUserId}/insights`,
      `${getFacebookGraphBase()}/${igUserId}/insights`,
    ]
    : [`${getFacebookGraphBase()}/${igUserId}/insights`];

  let lastError: unknown = null;

  for (const endpoint of endpointCandidates) {
    for (const metricSet of metricSets) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("metric", metricSet.join(","));
        url.searchParams.set("period", "day");
        url.searchParams.set("since", String(since));
        url.searchParams.set("until", String(until));
        url.searchParams.set("access_token", accessToken);
        const payload = await fetchJson<InsightsResponse>(url.toString());
        const metricMap = parseMetricMap(payload);
        if (metricMap.size === 0) {
          continue;
        }
        return {
          reach: metricMap.get("reach")?.latest ?? null,
          impressions: metricMap.get("impressions")?.latest ?? null,
          accountsEngaged: metricMap.get("accounts_engaged")?.latest ?? null,
          totalInteractions: metricMap.get("total_interactions")?.latest ?? null,
          daily: buildDailyRows(metricMap),
          warning: null,
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) {
    const parsed = parseMetaApiError(lastError, "Failed to fetch account insights");
    return {
      reach: null,
      impressions: null,
      accountsEngaged: null,
      totalInteractions: null,
      daily: [],
      warning: parsed.message || "account_insights_unavailable",
    };
  }

  return {
    reach: null,
    impressions: null,
    accountsEngaged: null,
    totalInteractions: null,
    daily: [],
    warning: "account_insights_unavailable",
  };
};

const fetchMediaMetric = async (
  flow: "facebook" | "instagram",
  mediaId: string,
  accessToken: string,
): Promise<{ saved: number | null; shares: number | null }> => {
  const metricSets = [
    ["saved", "shares"],
    ["saved"],
  ];

  const endpointCandidates = flow === "instagram"
    ? [`${getInstagramGraphBase()}/${mediaId}/insights`, `${getFacebookGraphBase()}/${mediaId}/insights`]
    : [`${getFacebookGraphBase()}/${mediaId}/insights`];

  for (const endpoint of endpointCandidates) {
    for (const metricSet of metricSets) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("metric", metricSet.join(","));
        url.searchParams.set("access_token", accessToken);
        const payload = await fetchJson<InsightsResponse>(url.toString());
        const metricMap = parseMetricMap(payload);
        if (metricMap.size === 0) continue;
        return {
          saved: metricMap.get("saved")?.latest ?? null,
          shares: metricMap.get("shares")?.latest ?? null,
        };
      } catch {
        // ignore and try next candidate/metric set
      }
    }
  }

  return { saved: null, shares: null };
};

const fetchInsightsFromIntegration = async (
  integration: IntegrationDoc,
  days: number,
  postLimit: number,
  mediaInsightLimit: number,
) => {
  const mediaItems = await fetchMediaList(integration, postLimit);
  const likes = mediaItems.reduce((sum, item) => sum + (typeof item.like_count === "number" ? item.like_count : 0), 0);
  const comments = mediaItems.reduce((sum, item) => sum + (typeof item.comments_count === "number" ? item.comments_count : 0), 0);

  const accountInsights = await fetchAccountInsights(integration, days);
  const warnings = accountInsights.warning ? [accountInsights.warning] : [];

  let savesTotal: number | null = null;
  let sharesTotal: number | null = null;
  const accessToken = resolveIntegrationAccessToken(integration);
  const flow = asFlow(integration.flow);

  if (accessToken && mediaInsightLimit > 0) {
    let savesAcc = 0;
    let sharesAcc = 0;
    let foundSaves = false;
    let foundShares = false;

    const targetItems = mediaItems
      .map((item) => (item.id != null ? String(item.id) : null))
      .filter((value): value is string => Boolean(value))
      .slice(0, mediaInsightLimit);

    for (const mediaId of targetItems) {
      const metric = await fetchMediaMetric(flow, mediaId, accessToken);
      if (metric.saved !== null) {
        foundSaves = true;
        savesAcc += metric.saved;
      }
      if (metric.shares !== null) {
        foundShares = true;
        sharesAcc += metric.shares;
      }
    }

    savesTotal = foundSaves ? savesAcc : null;
    sharesTotal = foundShares ? sharesAcc : null;
  }

  return {
    account: buildAccountPayload(integration),
    summary: {
      reach: accountInsights.reach,
      impressions: accountInsights.impressions,
      accountsEngaged: accountInsights.accountsEngaged,
      totalInteractions: accountInsights.totalInteractions,
      likes,
      comments,
      saves: savesTotal,
      shares: sharesTotal,
    },
    daily: accountInsights.daily,
    updatedAt: new Date().toISOString(),
    warnings,
  };
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

    const { searchParams } = new URL(req.url);
    const days = parsePositiveInt(searchParams.get("days"), 1, 30, 7);
    const postLimit = parsePositiveInt(searchParams.get("posts"), 1, 24, 12);
    const mediaInsightLimit = parsePositiveInt(searchParams.get("mediaInsights"), 0, 12, 8);

    const integration = (await readInstagramIntegration(uid, { forceFresh: true })) as IntegrationDoc | null;
    if (!integration || !isConnectedIntegration(integration)) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    try {
      const payload = await fetchInsightsFromIntegration(integration, days, postLimit, mediaInsightLimit);
      return NextResponse.json(payload);
    } catch (error) {
      const parsed = parseMetaApiError(error, "Failed to fetch insights");
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
          const payload = await fetchInsightsFromIntegration(candidate, days, postLimit, mediaInsightLimit);
          await activateIntegrationAccount(uid, candidate);
          return NextResponse.json(payload);
        } catch (candidateError) {
          const candidateParsed = parseMetaApiError(candidateError, "Failed to fetch insights");
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
    console.error("Meta insights fetch failed:", error);
    const parsed = parseMetaApiError(error, "Failed to fetch insights");
    return NextResponse.json(
      { error: parsed.message, reconnectRequired: parsed.reconnectRequired },
      { status: parsed.status },
    );
  }
}
