export const META_OAUTH_RESULT_STORAGE_KEY = "meta_oauth_result";

export type MetaOauthPopupResult = {
  type: "meta_oauth";
  success: boolean;
  error?: string | null;
  errorDescription?: string | null;
};

const normalizeMetaOauthPopupResult = (value: unknown): MetaOauthPopupResult | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "meta_oauth" || typeof record.success !== "boolean") {
    return null;
  }

  return {
    type: "meta_oauth",
    success: record.success,
    error: typeof record.error === "string" ? record.error : null,
    errorDescription: typeof record.errorDescription === "string" ? record.errorDescription : null,
  };
};

export const readStoredMetaOauthResult = () => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(META_OAUTH_RESULT_STORAGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(META_OAUTH_RESULT_STORAGE_KEY);
    return normalizeMetaOauthPopupResult(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(META_OAUTH_RESULT_STORAGE_KEY);
    return null;
  }
};
