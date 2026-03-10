type RawGraphError = {
  message?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  type?: unknown;
};

type GraphErrorPayload = {
  error?: RawGraphError;
};

export type ParsedMetaApiError = {
  status: number;
  message: string;
  reconnectRequired: boolean;
  recoverable: boolean;
  disconnectRequired: boolean;
  metaStatus: number | null;
  code: number | null;
  subcode: number | null;
  type: string | null;
};

const DEFAULT_VERSION = "v20.0";

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const extractGraphErrorPayload = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as GraphErrorPayload;
    return parsed?.error && typeof parsed.error === "object" ? parsed.error : null;
  } catch {
    return null;
  }
};

const getReconnectRequired = (params: {
  message: string;
  code: number | null;
  subcode: number | null;
  type: string | null;
}) => {
  const { message, code, subcode, type } = params;
  if (code === 190 || code === 102 || code === 10) return true;
  if (code !== null && code >= 200 && code < 300) return true;
  if (subcode !== null && [458, 459, 460, 463, 467, 490].includes(subcode)) return true;
  if (type === "OAuthException") return true;
  return /token|session|expired|permission|oauth|access blocked|not authorized|insufficient|unsupported post request|cannot be loaded due to missing permissions/i.test(message);
};

const getDisconnectRequired = (params: {
  message: string;
  code: number | null;
  subcode: number | null;
  type: string | null;
}) => {
  const { message, code, subcode, type } = params;
  if (code === 190 || code === 102) return true;
  if (subcode !== null && [458, 459, 460, 463, 467, 490].includes(subcode)) return true;
  if (
    /invalid oauth|error validating access token|access token has expired|session has expired|token expired|session invalid|authorization code/i.test(
      message,
    )
  ) {
    return true;
  }
  if (type === "OAuthException" && /token|session|expired|invalid|revoked/i.test(message)) {
    return true;
  }
  return false;
};

const normalizeMetaStatus = (value: number | null) => {
  if (value === null) return 500;
  if (value >= 400 && value < 500) return 400;
  return 500;
};

export const parseMetaApiError = (error: unknown, fallbackMessage: string): ParsedMetaApiError => {
  const fallback: ParsedMetaApiError = {
    status: 500,
    message: fallbackMessage,
    reconnectRequired: false,
    recoverable: false,
    disconnectRequired: false,
    metaStatus: null,
    code: null,
    subcode: null,
    type: null,
  };

  if (!(error instanceof Error)) {
    return fallback;
  }

  const match = error.message.match(/^Meta API error (\d+):\s*([\s\S]*)$/);
  if (!match) {
    const reconnectRequired = getReconnectRequired({
      message: error.message,
      code: null,
      subcode: null,
      type: null,
    });
    const disconnectRequired = getDisconnectRequired({
      message: error.message,
      code: null,
      subcode: null,
      type: null,
    });
    return {
      ...fallback,
      message: error.message || fallbackMessage,
      reconnectRequired,
      disconnectRequired,
      recoverable: reconnectRequired,
    };
  }

  const metaStatus = asNumber(match[1]);
  const rawBody = match[2] || "";
  const parsedError = extractGraphErrorPayload(rawBody);
  const code = asNumber(parsedError?.code);
  const subcode = asNumber(parsedError?.error_subcode);
  const type = asNonEmptyString(parsedError?.type);
  const message = asNonEmptyString(parsedError?.message) || rawBody || fallbackMessage;
  const reconnectRequired = getReconnectRequired({ message, code, subcode, type });
  const disconnectRequired = getDisconnectRequired({ message, code, subcode, type });

  return {
    status: normalizeMetaStatus(metaStatus),
    message,
    reconnectRequired,
    disconnectRequired,
    recoverable: reconnectRequired,
    metaStatus,
    code,
    subcode,
    type,
  };
};

const getMetaApiVersion = () => {
  const raw = asNonEmptyString(process.env.META_API_VERSION);
  if (!raw) return DEFAULT_VERSION;
  if (/^v\d+\.\d+$/i.test(raw)) return raw;
  if (/^\d+\.\d+$/i.test(raw)) return `v${raw}`;
  return DEFAULT_VERSION;
};

const ensureNormalizedBase = (value: string, fallback: string) => {
  try {
    const url = new URL(value);
    const normalizedPath = (url.pathname || "").replace(/\/+$/, "");
    if (normalizedPath && normalizedPath !== "/") {
      return `${url.origin}${normalizedPath}`;
    }
    return url.origin;
  } catch {
    return fallback;
  }
};

export const getInstagramGraphBase = () => {
  const configured = asNonEmptyString(process.env.META_IG_GRAPH_BASE) || "https://graph.instagram.com";
  return ensureNormalizedBase(configured, "https://graph.instagram.com");
};

export const getFacebookGraphBase = () => {
  return `https://graph.facebook.com/${getMetaApiVersion()}`;
};
