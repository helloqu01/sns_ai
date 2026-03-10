type MetaIntegrationAccountData = {
  flow?: unknown;
  accessToken?: unknown;
  tokenType?: unknown;
  expiresAt?: unknown;
  pageId?: unknown;
  pageName?: unknown;
  pageAccessToken?: unknown;
  igUserId?: unknown;
  igUsername?: unknown;
  connectedAt?: unknown;
};

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

const toIsoString = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString();
};

const getDefaultFlow = () => {
  return (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
};

const asFlow = (value: unknown): "facebook" | "instagram" => {
  if (value === "facebook" || value === "instagram") return value;
  return getDefaultFlow();
};

export const buildInstagramRootPayloadFromAccount = (
  accountId: string,
  accountData: MetaIntegrationAccountData,
  nowIso: string,
) => {
  const flow = asFlow(accountData.flow);
  return {
    status: "connected",
    version: 2,
    flow,
    activeAccountId: accountId,
    accessToken: asNonEmptyString(accountData.accessToken),
    tokenType: asNonEmptyString(accountData.tokenType),
    expiresAt: toIsoString(accountData.expiresAt),
    pageId: asNonEmptyString(accountData.pageId) || accountId,
    pageName: asNonEmptyString(accountData.pageName),
    pageAccessToken: flow === "facebook" ? asNonEmptyString(accountData.pageAccessToken) : null,
    igUserId: asNonEmptyString(accountData.igUserId),
    igUsername: asNonEmptyString(accountData.igUsername),
    selectedAt: nowIso,
    connectedAt: asNonEmptyString(accountData.connectedAt) || nowIso,
    updatedAt: nowIso,
    lastError: null,
  };
};
