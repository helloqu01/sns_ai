import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";

const CANVA_TOKEN_URL = process.env.CANVA_TOKEN_URL || "https://api.canva.com/rest/v1/oauth/token";
const CANVA_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CANVA_REFRESH_RETRY_BACKOFF_MS = 5 * 60 * 1000;

type CanvaTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
};

type CanvaIntegrationDoc = {
  status?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  tokenType?: unknown;
  expiresAt?: unknown;
  scope?: unknown;
  updatedAt?: unknown;
  connectedAt?: unknown;
  source?: unknown;
  lastErrorCode?: unknown;
  lastErrorMessage?: unknown;
};

type RuntimeCanvaTokenCache = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  updatedAt: number;
};

type CanvaGlobal = typeof globalThis & {
  __canvaRuntimeTokenCache?: RuntimeCanvaTokenCache | null;
  __canvaRefreshRetryBlockedUntil?: Record<string, number>;
};

type CanvaTokenSource = {
  kind: "integration" | "runtime" | "env";
  uid: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
};

const globalForCanva = globalThis as CanvaGlobal;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toTimestampMs = (value: unknown): number | null => {
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
  if (value && typeof value === "object") {
    if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      try {
        const timestamp = (value as { toDate: () => Date }).toDate().getTime();
        if (!Number.isNaN(timestamp)) {
          return timestamp;
        }
      } catch {
        // ignore
      }
    }
    if ("seconds" in value) {
      const seconds = Number((value as { seconds?: unknown }).seconds);
      if (Number.isFinite(seconds) && seconds > 0) {
        const nanoseconds = Number((value as { nanoseconds?: unknown }).nanoseconds);
        const millis = Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1_000_000) : 0;
        return Math.floor(seconds * 1000) + millis;
      }
    }
  }
  return null;
};

const toIsoTimestamp = (value: unknown): string | null => {
  const timestamp = toTimestampMs(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString();
};

const toIsoFromEpochSeconds = (seconds: number | null): string | null => {
  if (!seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
};

const parseJwtExpiresAt = (token: string | null): string | null => {
  if (!token || !token.includes(".")) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    const exp = asOptionalNumber(json?.exp);
    if (!exp) return null;
    return new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
};

const readRuntimeCache = (): RuntimeCanvaTokenCache | null => {
  return globalForCanva.__canvaRuntimeTokenCache || null;
};

export const setRuntimeCanvaTokenCache = (value: RuntimeCanvaTokenCache | null) => {
  globalForCanva.__canvaRuntimeTokenCache = value;
};

const getRefreshRetryBlockedUntilMap = () => {
  if (!globalForCanva.__canvaRefreshRetryBlockedUntil) {
    globalForCanva.__canvaRefreshRetryBlockedUntil = {};
  }
  return globalForCanva.__canvaRefreshRetryBlockedUntil;
};

const getRefreshRetryKey = (source: CanvaTokenSource) => {
  const uidPart = source.uid || "global";
  const tokenPart = source.refreshToken?.slice(-12) || "no_refresh_token";
  return `${source.kind}:${uidPart}:${tokenPart}`;
};

const getCanvaOAuthConfig = () => {
  const clientId = asNonEmptyString(process.env.CANVA_CLIENT_ID) || asNonEmptyString(process.env.CANVA_OAUTH_CLIENT_ID);
  const clientSecret = asNonEmptyString(process.env.CANVA_CLIENT_SECRET) || asNonEmptyString(process.env.CANVA_OAUTH_CLIENT_SECRET);
  const redirectUri = asNonEmptyString(process.env.CANVA_OAUTH_REDIRECT_URI) || asNonEmptyString(process.env.CANVA_REDIRECT_URI);
  const scopes =
    asNonEmptyString(process.env.CANVA_OAUTH_SCOPES)
    || "design:content:write design:meta:read brandtemplate:content:read design:content:read brandtemplate:meta:read";
  return { clientId, clientSecret, redirectUri, scopes };
};

export const getCanvaOAuthPublicConfig = () => {
  const { clientId, redirectUri, scopes } = getCanvaOAuthConfig();
  return {
    clientId,
    redirectUri,
    scopes,
    configured: Boolean(clientId && redirectUri),
  };
};

const getCanvaBasicCredentials = () => {
  const { clientId, clientSecret } = getCanvaOAuthConfig();
  if (!clientId || !clientSecret) {
    return null;
  }
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
};

const parseCanvaTokenPayload = (payload: CanvaTokenResponse) => {
  const accessToken = asNonEmptyString(payload.access_token);
  const refreshToken = asNonEmptyString(payload.refresh_token);
  const tokenType = asNonEmptyString(payload.token_type) || "Bearer";
  const expiresIn = asOptionalNumber(payload.expires_in);
  const scope = asNonEmptyString(payload.scope);
  const expiresAt = toIsoFromEpochSeconds(expiresIn);

  if (!accessToken) {
    throw new Error("Canva OAuth response missing access_token");
  }

  return {
    accessToken,
    refreshToken,
    tokenType,
    scope,
    expiresAt,
  };
};

const mergeCanvaTokenWithSource = (
  source: CanvaTokenSource,
  nextToken: {
    accessToken: string;
    refreshToken: string | null;
    tokenType: string;
    scope: string | null;
    expiresAt: string | null;
  },
) => {
  return {
    accessToken: nextToken.accessToken,
    refreshToken: nextToken.refreshToken || source.refreshToken,
    tokenType: nextToken.tokenType,
    scope: nextToken.scope || source.scope,
    expiresAt: nextToken.expiresAt || parseJwtExpiresAt(nextToken.accessToken) || source.expiresAt,
  };
};

const isExpiringSoon = (expiresAt: string | null) => {
  if (!expiresAt) return false;
  const expiresMs = toTimestampMs(expiresAt);
  if (expiresMs === null) return false;
  return expiresMs <= Date.now() + CANVA_REFRESH_SKEW_MS;
};

const shouldReconnectForTokenError = (status: number, payload: unknown, message: string) => {
  if (status === 401) return true;
  const code = typeof payload === "object" && payload && "code" in payload
    ? asNonEmptyString((payload as { code?: unknown }).code)
      || asNonEmptyString((payload as { error?: unknown }).error)
    : null;
  if (code && ["invalid_access_token", "invalid_grant", "invalid_refresh_token", "invalid_client"].includes(code)) {
    return true;
  }
  return message.toLowerCase().includes("invalid_access_token");
};

const getCanvaTokenErrorMessage = (payload: unknown) => {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") {
    return "Canva OAuth token request failed";
  }

  return (
    asNonEmptyString((payload as { error_description?: unknown }).error_description)
    || asNonEmptyString((payload as { message?: unknown }).message)
    || asNonEmptyString((payload as { error?: unknown }).error)
    || "Canva OAuth token request failed"
  );
};

const getCanvaTokenErrorCode = (payload: unknown) => {
  if (typeof payload === "string") return "canva_oauth_failed";
  if (!payload || typeof payload !== "object") return "canva_oauth_failed";
  return (
    asNonEmptyString((payload as { code?: unknown }).code)
    || asNonEmptyString((payload as { error?: unknown }).error)
    || "canva_oauth_failed"
  );
};

const getCanvaTokenDocRef = (uid: string) => {
  return db?.collection("users").doc(uid).collection("integrations").doc("canva") ?? null;
};

const readCanvaIntegrationFromFirestore = async (uid: string): Promise<CanvaTokenSource | null> => {
  if (!db || !isFirebaseConfigured) return null;
  const docRef = getCanvaTokenDocRef(uid);
  if (!docRef) return null;
  const snap = await docRef.get();
  if (!snap.exists) return null;
  const data = (snap.data() || {}) as CanvaIntegrationDoc;
  const accessToken = asNonEmptyString(data.accessToken);
  if (!accessToken) return null;
  return {
    kind: "integration",
    uid,
    accessToken,
    refreshToken: asNonEmptyString(data.refreshToken),
    expiresAt: toIsoTimestamp(data.expiresAt),
    scope: asNonEmptyString(data.scope),
  };
};

const readCanvaTokensFromEnv = (): CanvaTokenSource | null => {
  const accessToken = asNonEmptyString(process.env.CANVA_ACCESS_TOKEN);
  if (!accessToken) return null;
  const refreshToken = asNonEmptyString(process.env.CANVA_REFRESH_TOKEN);
  const expiresAt =
    toIsoTimestamp(process.env.CANVA_ACCESS_TOKEN_EXPIRES_AT)
    || parseJwtExpiresAt(accessToken);
  return {
    kind: "env",
    uid: null,
    accessToken,
    refreshToken,
    expiresAt,
    scope: asNonEmptyString(process.env.CANVA_OAUTH_SCOPES),
  };
};

const resolveCanvaTokenSource = async (uid: string | null): Promise<CanvaTokenSource | null> => {
  if (uid) {
    const userIntegration = await readCanvaIntegrationFromFirestore(uid);
    if (userIntegration) return userIntegration;
  }

  const runtime = readRuntimeCache();
  if (runtime?.accessToken) {
    return {
      kind: "runtime",
      uid: null,
      accessToken: runtime.accessToken,
      refreshToken: runtime.refreshToken,
      expiresAt: runtime.expiresAt,
      scope: runtime.scope,
    };
  }

  return readCanvaTokensFromEnv();
};

const persistCanvaTokenSource = async (
  source: CanvaTokenSource,
  nextToken: {
    accessToken: string;
    refreshToken: string | null;
    tokenType: string;
    scope: string | null;
    expiresAt: string | null;
  },
  context: "oauth" | "refresh",
) => {
  if (source.kind === "integration" && source.uid && db && isFirebaseConfigured) {
    const docRef = getCanvaTokenDocRef(source.uid);
    if (docRef) {
      const now = new Date().toISOString();
      await docRef.set(
        {
          status: "connected",
          accessToken: nextToken.accessToken,
          refreshToken: nextToken.refreshToken,
          tokenType: nextToken.tokenType,
          expiresAt: nextToken.expiresAt,
          scope: nextToken.scope,
          updatedAt: now,
          connectedAt: context === "oauth" ? now : undefined,
          source: context,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
        { merge: true },
      );
      return;
    }
  }

  setRuntimeCanvaTokenCache({
    accessToken: nextToken.accessToken,
    refreshToken: nextToken.refreshToken,
    expiresAt: nextToken.expiresAt,
    scope: nextToken.scope,
    updatedAt: Date.now(),
  });
};

const requestCanvaToken = async (
  body: URLSearchParams,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: string | null;
}> => {
  const basicCredentials = getCanvaBasicCredentials();
  if (!basicCredentials) {
    throw new CanvaApiError(
      "Canva OAuth 클라이언트 설정이 누락되었습니다.",
      500,
      "canva_oauth_not_configured",
      true,
    );
  }

  const response = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await response.text();
  const payload = raw
    ? (() => {
      try {
        return JSON.parse(raw) as CanvaTokenResponse | { code?: string; message?: string };
      } catch {
        return raw;
      }
    })()
    : {};

  if (!response.ok) {
    const message = getCanvaTokenErrorMessage(payload);
    const code = getCanvaTokenErrorCode(payload);
    throw new CanvaApiError(
      `Canva OAuth ${response.status}: ${message}`,
      response.status,
      code,
      shouldReconnectForTokenError(response.status, payload, message),
      payload,
    );
  }

  return parseCanvaTokenPayload(payload as CanvaTokenResponse);
};

const refreshCanvaAccessToken = async (source: CanvaTokenSource) => {
  if (!source.refreshToken) {
    throw new CanvaApiError(
      "Canva refresh token이 없어 재연결이 필요합니다.",
      401,
      "canva_reconnect_required",
      true,
    );
  }

  const refreshRetryKey = getRefreshRetryKey(source);
  const blockedUntil = getRefreshRetryBlockedUntilMap()[refreshRetryKey] || 0;
  if (blockedUntil > Date.now()) {
    throw new CanvaApiError(
      "Canva 연결이 만료되었습니다. 재연결이 필요합니다.",
      401,
      "canva_reconnect_required",
      true,
    );
  }

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: source.refreshToken,
    });
    if (source.scope) {
      body.set("scope", source.scope);
    }
    const nextToken = mergeCanvaTokenWithSource(source, await requestCanvaToken(body));
    delete getRefreshRetryBlockedUntilMap()[refreshRetryKey];
    await persistCanvaTokenSource(source, nextToken, "refresh");
    return {
      ...source,
      accessToken: nextToken.accessToken,
      refreshToken: nextToken.refreshToken,
      expiresAt: nextToken.expiresAt,
      scope: nextToken.scope,
    } satisfies CanvaTokenSource;
  } catch (error) {
    if (error instanceof CanvaApiError) {
      const reconnectRequired = error.reconnectRequired || [400, 401, 403, 429].includes(error.status);
      if (reconnectRequired) {
        getRefreshRetryBlockedUntilMap()[refreshRetryKey] = Date.now() + CANVA_REFRESH_RETRY_BACKOFF_MS;
      }
      throw new CanvaApiError(
        reconnectRequired ? "Canva 연결이 만료되었습니다. 재연결이 필요합니다." : error.message,
        reconnectRequired ? 401 : error.status,
        reconnectRequired ? "canva_reconnect_required" : error.code,
        reconnectRequired,
        error.detail ?? error,
      );
    }
    throw error;
  }
};

const ensureCanvaToken = async (uid: string | null) => {
  const source = await resolveCanvaTokenSource(uid);
  if (!source) {
    throw new CanvaApiError(
      "Canva 연결 정보가 없습니다. 재연결이 필요합니다.",
      401,
      "canva_reconnect_required",
      true,
    );
  }

  if (!isExpiringSoon(source.expiresAt)) {
    return source;
  }

  if (!source.refreshToken) {
    return source;
  }

  try {
    return await refreshCanvaAccessToken(source);
  } catch {
    return source;
  }
};

type ResponsePayload = string | Record<string, unknown> | Array<unknown> | null;

const parseResponsePayload = async (response: Response): Promise<ResponsePayload> => {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResponsePayload;
  } catch {
    return raw;
  }
};

const payloadMessage = (payload: ResponsePayload) => {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  return asNonEmptyString((payload as { message?: unknown }).message);
};

const payloadCode = (payload: ResponsePayload) => {
  if (!payload || typeof payload !== "object") return null;
  return asNonEmptyString((payload as { code?: unknown }).code);
};

const fetchWithAccessToken = async <T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; payload: T | ResponsePayload }> => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const payload = await parseResponsePayload(response);
  return { response, payload: payload as T | ResponsePayload };
};

export class CanvaApiError extends Error {
  status: number;
  code: string;
  reconnectRequired: boolean;
  detail?: unknown;

  constructor(
    message: string,
    status = 500,
    code = "canva_api_error",
    reconnectRequired = false,
    detail?: unknown,
  ) {
    super(message);
    this.name = "CanvaApiError";
    this.status = status;
    this.code = code;
    this.reconnectRequired = reconnectRequired;
    this.detail = detail;
  }
}

export const toCanvaApiErrorPayload = (error: unknown, fallbackMessage: string) => {
  if (error instanceof CanvaApiError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        errorCode: error.code,
        reconnectRequired: error.reconnectRequired,
      },
    };
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return {
    status: 500,
    body: {
      error: message || fallbackMessage,
      errorCode: "canva_unknown_error",
      reconnectRequired: false,
    },
  };
};

export const canvaApiFetch = async <T>(params: {
  uid: string | null;
  url: string;
  init?: RequestInit;
}): Promise<T> => {
  const source = await ensureCanvaToken(params.uid);
  const first = await fetchWithAccessToken<T>(source.accessToken, params.url, params.init);
  if (first.response.ok) {
    return first.payload as T;
  }

  if (first.response.status === 401) {
    if (!source.refreshToken) {
      throw new CanvaApiError(
        `Canva API ${first.response.status}: ${payloadMessage(first.payload as ResponsePayload) || "Access token is invalid"}`,
        401,
        payloadCode(first.payload as ResponsePayload) || "canva_reconnect_required",
        true,
        first.payload,
      );
    }

    const refreshed = await refreshCanvaAccessToken(source);
    const retried = await fetchWithAccessToken<T>(refreshed.accessToken, params.url, params.init);
    if (retried.response.ok) {
      return retried.payload as T;
    }
    throw new CanvaApiError(
      `Canva API ${retried.response.status}: ${payloadMessage(retried.payload as ResponsePayload) || "Request failed"}`,
      retried.response.status,
      payloadCode(retried.payload as ResponsePayload) || "canva_api_error",
      shouldReconnectForTokenError(retried.response.status, retried.payload, payloadMessage(retried.payload as ResponsePayload) || ""),
      retried.payload,
    );
  }

  throw new CanvaApiError(
    `Canva API ${first.response.status}: ${payloadMessage(first.payload as ResponsePayload) || "Request failed"}`,
    first.response.status,
    payloadCode(first.payload as ResponsePayload) || "canva_api_error",
    shouldReconnectForTokenError(first.response.status, first.payload, payloadMessage(first.payload as ResponsePayload) || ""),
    first.payload,
  );
};

export const getRequestUid = async (req: NextRequest): Promise<string | null> => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (error) {
    throw new CanvaApiError(
      "Unauthorized",
      401,
      "unauthorized",
      false,
      error,
    );
  }
};

export const exchangeCanvaAuthorizationCode = async (params: {
  code: string;
  codeVerifier: string;
  redirectUri?: string | null;
}) => {
  const { redirectUri } = getCanvaOAuthConfig();
  const resolvedRedirectUri = asNonEmptyString(params.redirectUri) || redirectUri;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
  });
  if (resolvedRedirectUri) {
    body.set("redirect_uri", resolvedRedirectUri);
  }
  return requestCanvaToken(body);
};

export const persistCanvaOAuthToken = async (uid: string | null, token: {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: string | null;
}) => {
  const source: CanvaTokenSource = uid
    ? {
      kind: "integration",
      uid,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    }
    : {
      kind: "runtime",
      uid: null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    };
  await persistCanvaTokenSource(source, token, "oauth");
};

export const readCanvaOAuthStatus = async (uid: string | null) => {
  const source = await resolveCanvaTokenSource(uid);
  if (!source) {
    return {
      connected: false,
      expiresAt: null as string | null,
      source: null as string | null,
    };
  }
  const expiresAt = toIsoTimestamp(source.expiresAt);
  const expiresAtTimestamp = toTimestampMs(expiresAt);
  const connected = !(expiresAtTimestamp !== null && expiresAtTimestamp <= Date.now());
  return {
    connected,
    expiresAt,
    source: source.kind,
  };
};

export const generatePkcePair = () => {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};
