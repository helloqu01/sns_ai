import { db, isFirebaseConfigured } from "@/lib/firebase-admin";

type IntegrationData = Record<string, unknown>;

type RootIntegrationData = IntegrationData & {
  activeAccountId?: unknown;
};

type IntegrationCacheEntry = {
  value: IntegrationData | null;
  expiresAt: number;
};

type IntegrationCacheGlobal = typeof globalThis & {
  __instagramIntegrationCache?: Map<string, IntegrationCacheEntry>;
};

const globalForIntegrationCache = globalThis as IntegrationCacheGlobal;

const DEFAULT_CACHE_TTL_MS = 15_000;
const MIN_CACHE_TTL_MS = 1_000;
const MAX_CACHE_TTL_MS = 5 * 60_000;

const getCacheTtlMs = () => {
  const raw = Number(process.env.META_INTEGRATION_CACHE_MS ?? DEFAULT_CACHE_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_CACHE_TTL_MS;
  return Math.min(Math.max(raw, MIN_CACHE_TTL_MS), MAX_CACHE_TTL_MS);
};

const getCache = () => {
  if (!globalForIntegrationCache.__instagramIntegrationCache) {
    globalForIntegrationCache.__instagramIntegrationCache = new Map<string, IntegrationCacheEntry>();
  }
  return globalForIntegrationCache.__instagramIntegrationCache;
};

const getCacheKey = (uid: string) => `instagram:${uid}`;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

const hasUsableIdentity = (value: IntegrationData) => {
  return Boolean(asNonEmptyString(value.igUserId) || asNonEmptyString(value.pageId));
};

const hasUsableToken = (value: IntegrationData) => {
  return Boolean(asNonEmptyString(value.pageAccessToken) || asNonEmptyString(value.accessToken));
};

const canTreatDisconnectedAsConnected = (value: IntegrationData) => {
  const status = asNonEmptyString(value.status);
  if (status !== "disconnected") return false;
  if (isExpired(value.expiresAt)) return false;
  if (!hasUsableToken(value) || !hasUsableIdentity(value)) return false;
  if (!asNonEmptyString(value.lastError)) return false;
  if (isAuthRelatedDisconnectReason(value.lastError)) return false;
  return true;
};

const isConnectedStatus = (value: IntegrationData) => {
  const status = asNonEmptyString(value.status);
  if (!status || status === "connected") return true;
  return canTreatDisconnectedAsConnected(value);
};

const withRecoveredStatus = (value: IntegrationData) => {
  if (!canTreatDisconnectedAsConnected(value)) {
    return value;
  }
  return {
    ...value,
    status: "connected",
    lastError: null,
  } as IntegrationData;
};

const isUsableIntegration = (value: IntegrationData | null) => {
  if (!value) return false;
  if (!isConnectedStatus(value)) return false;
  if (isExpired(value.expiresAt)) return false;
  if (!hasUsableToken(value)) return false;
  if (!hasUsableIdentity(value)) return false;
  return true;
};

const toPriorityTimestamp = (value: IntegrationData) => {
  return (
    toTimestamp(asNonEmptyString(value.selectedAt))
    || toTimestamp(asNonEmptyString(value.connectedAt))
    || toTimestamp(asNonEmptyString(value.updatedAt))
    || 0
  );
};

export async function readInstagramIntegration(
  uid: string,
  options?: { forceFresh?: boolean },
): Promise<IntegrationData | null> {
  if (!db || !isFirebaseConfigured) {
    return null;
  }

  const cache = getCache();
  const key = getCacheKey(uid);
  const now = Date.now();

  if (!options?.forceFresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value ? { ...cached.value } : null;
    }
  }

  const rootRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
  const rootSnap = await rootRef.get();
  const rootValue = rootSnap.exists ? ((rootSnap.data() || {}) as RootIntegrationData) : null;

  if (!rootValue) {
    cache.set(key, { value: null, expiresAt: now + getCacheTtlMs() });
    return null;
  }

  const activeAccountId =
    typeof rootValue.activeAccountId === "string" && rootValue.activeAccountId.trim()
      ? rootValue.activeAccountId.trim()
      : null;

  if (activeAccountId) {
    try {
      const accountSnap = await rootRef.collection("accounts").doc(activeAccountId).get();
      const accountValue = accountSnap.exists ? ((accountSnap.data() || {}) as IntegrationData) : null;
      const merged = accountValue
        ? ({ ...rootValue, ...accountValue, accountId: activeAccountId } as IntegrationData)
        : ({ ...rootValue, accountId: activeAccountId } as IntegrationData);
      if (isUsableIntegration(merged)) {
        const recovered = withRecoveredStatus(merged);
        if (asNonEmptyString(merged.status) === "disconnected" && asNonEmptyString(recovered.status) === "connected") {
          const nowIso = new Date().toISOString();
          await rootRef.collection("accounts").doc(activeAccountId).set(
            {
              status: "connected",
              lastError: null,
              updatedAt: nowIso,
            },
            { merge: true },
          ).catch(() => undefined);
          await rootRef.set(
            {
              status: "connected",
              activeAccountId,
              updatedAt: nowIso,
            },
            { merge: true },
          ).catch(() => undefined);
        }
        cache.set(key, { value: recovered, expiresAt: now + getCacheTtlMs() });
        return { ...recovered };
      }
    } catch {
      // active account lookup fallback
    }
  }

  if (isUsableIntegration(rootValue as IntegrationData)) {
    const recovered = withRecoveredStatus(rootValue as IntegrationData);
    cache.set(key, { value: recovered, expiresAt: now + getCacheTtlMs() });
    return { ...recovered };
  }

  try {
    const accountsSnap = await rootRef.collection("accounts").get();
    if (!accountsSnap.empty) {
      let selected: { id: string; value: IntegrationData } | null = null;
      let selectedPriority = Number.NEGATIVE_INFINITY;

      for (const doc of accountsSnap.docs) {
        const accountValue = (doc.data() || {}) as IntegrationData;
        const merged = { ...rootValue, ...accountValue, accountId: doc.id } as IntegrationData;
        if (!isUsableIntegration(merged)) {
          continue;
        }
        const priority = toPriorityTimestamp(accountValue);
        if (!selected || priority > selectedPriority) {
          selected = { id: doc.id, value: merged };
          selectedPriority = priority;
        }
      }

      if (selected) {
        if (activeAccountId !== selected.id) {
          await rootRef.set(
            {
              activeAccountId: selected.id,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          ).catch(() => undefined);
        }
        const recovered = withRecoveredStatus(selected.value);
        if (asNonEmptyString(selected.value.status) === "disconnected" && asNonEmptyString(recovered.status) === "connected") {
          const nowIso = new Date().toISOString();
          await rootRef.collection("accounts").doc(selected.id).set(
            {
              status: "connected",
              lastError: null,
              updatedAt: nowIso,
            },
            { merge: true },
          ).catch(() => undefined);
          await rootRef.set(
            {
              status: "connected",
              activeAccountId: selected.id,
              updatedAt: nowIso,
            },
            { merge: true },
          ).catch(() => undefined);
        }
        cache.set(key, { value: recovered, expiresAt: now + getCacheTtlMs() });
        return { ...recovered };
      }
    }
  } catch {
    // fallback to root value below
  }

  cache.set(key, { value: rootValue as IntegrationData, expiresAt: now + getCacheTtlMs() });
  return { ...rootValue };
}

export function invalidateInstagramIntegration(uid: string) {
  getCache().delete(getCacheKey(uid));
}
