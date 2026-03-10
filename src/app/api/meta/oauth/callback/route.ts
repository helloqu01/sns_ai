import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { invalidateInstagramIntegration } from "@/lib/services/meta-integration-cache";
import { getFacebookGraphBase, getInstagramGraphBase } from "@/lib/services/meta-graph";
import { buildInstagramRootPayloadFromAccount } from "@/lib/services/meta-integration-root";
import { parseMetaOauthState, sanitizeReturnTo } from "@/lib/services/meta-oauth-state";

export const runtime = "nodejs";

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

type SelectionUpdate = {
  pageId: string | null;
  pageName: string | null;
  pageAccessToken: string | null;
  igUserId: string | null;
  igUsername: string | null;
  selectedAt: string | null;
};

type InstagramIntegrationAccount = SelectionUpdate & {
  status: "connected";
  flow: "facebook" | "instagram";
  accessToken: string;
  tokenType: string;
  expiresAt: string | null;
  updatedAt: string;
  connectedAt: string;
};

type OAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string | number;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const splitProxyHeaderValues = (value: string | null) => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeHost = (value: string) => {
  return value.replace(/^https?:\/\//i, "").split("/")[0]?.trim() || "";
};

const isLocalhostOrigin = (value: string) => {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("127.0.0.1")
    || normalized.includes("localhost")
    || normalized.includes("0.0.0.0")
    || normalized.includes("::1")
  );
};

const getForwardedHost = (req: NextRequest) => {
  const requestHost = normalizeHost(req.headers.get("host") || new URL(req.url).host);
  if (isLocalhostOrigin(requestHost)) {
    return requestHost;
  }
  const forwardedHosts = [
    ...splitProxyHeaderValues(req.headers.get("x-forwarded-host")),
    ...splitProxyHeaderValues(req.headers.get("x-fh-requested-host")),
  ]
    .map(normalizeHost)
    .filter(Boolean);

  if (!forwardedHosts.length) {
    return requestHost;
  }

  const publicForwardedHost = [...forwardedHosts]
    .reverse()
    .find((host) => !isLocalhostOrigin(host));
  if (publicForwardedHost) {
    return publicForwardedHost;
  }
  return forwardedHosts[forwardedHosts.length - 1];
};

const getForwardedProto = (req: NextRequest, host: string) => {
  const forwardedProtos = splitProxyHeaderValues(req.headers.get("x-forwarded-proto"))
    .map((value) => value.toLowerCase());

  if (forwardedProtos.includes("https")) return "https";
  if (forwardedProtos.includes("http")) return "http";
  return isLocalhostOrigin(host) ? "http" : "https";
};

const getPublicOrigin = (req: NextRequest) => {
  const host = getForwardedHost(req);
  const proto = getForwardedProto(req, host);
  if (isLocalhostOrigin(host)) {
    return `http://${host}`;
  }
  return `${proto}://${host}`;
};

const absoluteUrl = (req: NextRequest, path: string) => new URL(path, getPublicOrigin(req));

const buildResultPath = (
  returnTo: string,
  values: Record<string, string | null | undefined>,
) => {
  const url = new URL(returnTo, "https://queens-sns.web.app");
  Object.entries(values).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}${url.hash}`;
};

const toAsciiJson = (value: unknown) => {
  return JSON.stringify(value).replace(/[^\x20-\x7E]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
};

const popupResponse = ({
  success,
  error,
  errorDescription,
  fallbackPath,
}: {
  success: boolean;
  error?: string | null;
  errorDescription?: string | null;
  fallbackPath: string;
}) => {
  const payload = toAsciiJson({
    type: "meta_oauth",
    success,
    error: error || null,
    errorDescription: errorDescription || null,
  });

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /></head><body>
<script>
  const payload = ${payload};
  try {
    localStorage.setItem("meta_oauth_result", JSON.stringify(payload));
  } catch {}
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {}
  }
  try {
    window.close();
  } catch {}
  window.setTimeout(() => {
    window.location.replace(${JSON.stringify(fallbackPath)});
  }, 200);
</script>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
};

const clearOauthCookies = (response: NextResponse) => {
  response.cookies.set("meta_oauth_state", "", { path: "/", maxAge: 0 });
  response.cookies.set("meta_oauth_mode", "", { path: "/", maxAge: 0 });
  response.cookies.set("meta_oauth_uid", "", { path: "/", maxAge: 0 });
  response.cookies.set("meta_oauth_redirect_uri", "", { path: "/", maxAge: 0 });
  response.cookies.set("meta_oauth_return_to", "", { path: "/", maxAge: 0 });
};

const getEnv = (redirectUriOverride?: string | null) => {
  const redirectUri = redirectUriOverride || process.env.META_REDIRECT_URI;
  const apiVersion = process.env.META_API_VERSION || "v20.0";
  if (!redirectUri) {
    throw new Error("META_REDIRECT_URI is required.");
  }
  return { redirectUri, apiVersion };
};

const getFacebookEnv = (redirectUriOverride?: string | null) => {
  const { redirectUri, apiVersion } = getEnv(redirectUriOverride);
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("META_APP_ID / META_APP_SECRET is required for Facebook login flow.");
  }
  return { appId, appSecret, redirectUri, apiVersion };
};

const getInstagramEnv = (redirectUriOverride?: string | null) => {
  const { redirectUri, apiVersion } = getEnv(redirectUriOverride);
  const appId = process.env.META_IG_APP_ID || process.env.META_APP_ID;
  const appSecret = process.env.META_IG_APP_SECRET || process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("META_IG_APP_ID / META_IG_APP_SECRET (or META_APP_ID / META_APP_SECRET) is required for Instagram login flow.");
  }
  return { appId, appSecret, redirectUri, apiVersion };
};

const exchangeForTokenFacebook = async (code: string, redirectUriOverride?: string | null) => {
  const { appId, appSecret, redirectUri, apiVersion } = getFacebookEnv(redirectUriOverride);
  const tokenUrl = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const res = await fetch(tokenUrl.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
};

const exchangeForLongLivedFacebook = async (shortToken: string) => {
  const { appId, appSecret, apiVersion } = getFacebookEnv();
  const url = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Long-lived token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
};

const exchangeForTokenInstagram = async (code: string, redirectUriOverride?: string | null) => {
  const { appId, appSecret, redirectUri } = getInstagramEnv(redirectUriOverride);
  const tokenUrl = process.env.META_IG_TOKEN_URL || "https://api.instagram.com/oauth/access_token";
  const body = new URLSearchParams();
  body.set("client_id", appId);
  body.set("client_secret", appSecret);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);
  body.set("code", code);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
};

const exchangeForLongLivedInstagram = async (shortToken: string) => {
  const { appSecret } = getInstagramEnv();
  const url = new URL(process.env.META_IG_LONG_TOKEN_URL || "https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Long-lived token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<OAuthTokenResponse>;
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

const getInstagramGraphBases = () => {
  const configuredBase = getInstagramGraphBase();
  const defaults = [configuredBase, "https://graph.instagram.com"];
  const normalized = defaults
    .map((value) => value.replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set(normalized)];
};

const resolveInstagramSelection = async (
  accessToken: string,
  nowIso: string,
  fallbackIgUserId: string | null,
) => {
  const graphBases = getInstagramGraphBases();
  let igUserId = fallbackIgUserId;
  let igUsername: string | null = null;

  for (const graphBase of graphBases) {
    try {
      const meUrl = new URL(`${graphBase}/me`);
      meUrl.searchParams.set("fields", "id,username");
      meUrl.searchParams.set("access_token", accessToken);
      const meRes = await fetchJson<InstagramMeResponse>(meUrl.toString());
      const meId = meRes?.id ? String(meRes.id) : null;
      if (meId) {
        igUserId = meId;
      }
      igUsername = asNonEmptyString(meRes?.username);
      if (igUserId) {
        break;
      }
    } catch {
      continue;
    }
  }

  if (!igUserId) {
    return null;
  }

  if (!igUsername) {
    for (const graphBase of graphBases) {
      try {
        const profileUrl = new URL(`${graphBase}/${igUserId}`);
        profileUrl.searchParams.set("fields", "username");
        profileUrl.searchParams.set("access_token", accessToken);
        const profileRes = await fetchJson<InstagramProfileResponse>(profileUrl.toString());
        igUsername = asNonEmptyString(profileRes?.username);
        if (igUsername) {
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return {
    pageId: igUserId,
    pageName: igUsername ? `@${igUsername}` : "Instagram 계정",
    pageAccessToken: null,
    igUserId,
    igUsername,
    selectedAt: nowIso,
  } satisfies SelectionUpdate;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const cookieStore = await cookies();
  const statePayload = parseMetaOauthState(state);
  const mode = cookieStore.get("meta_oauth_mode")?.value || statePayload?.mode || "";
  const uid = cookieStore.get("meta_oauth_uid")?.value || statePayload?.uid || null;
  const redirectUri = cookieStore.get("meta_oauth_redirect_uri")?.value || statePayload?.redirectUri || null;
  const returnTo = sanitizeReturnTo(
    cookieStore.get("meta_oauth_return_to")?.value || statePayload?.returnTo || null,
  ) || "/analytics";

  if (error) {
    const redirectPath = buildResultPath(returnTo, {
      connected: "0",
      error,
      error_description: errorDescription || "",
    });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error,
        errorDescription: errorDescription || null,
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }

  if (!code || !state) {
    const redirectPath = buildResultPath(returnTo, { connected: "0", error: "missing_code" });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error: "missing_code",
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }

  const cookieState = cookieStore.get("meta_oauth_state")?.value;
  const stateMatchesCookie = Boolean(cookieState && cookieState === state);
  if (!statePayload && !stateMatchesCookie) {
    const redirectPath = buildResultPath(returnTo, { connected: "0", error: "state_mismatch" });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error: "state_mismatch",
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }

  if (!uid) {
    const redirectPath = buildResultPath(returnTo, { connected: "0", error: "missing_session" });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error: "missing_session",
        errorDescription: "OAuth session missing uid",
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }

  if (!db || !isFirebaseConfigured) {
    const redirectPath = buildResultPath(returnTo, { connected: "0", error: "firestore_unavailable" });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error: "firestore_unavailable",
        errorDescription: "Firestore is not configured",
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }

  try {
    const flow = (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
    const shortToken = flow === "instagram"
      ? await exchangeForTokenInstagram(code, redirectUri)
      : await exchangeForTokenFacebook(code, redirectUri);
    let tokenData = shortToken;
    try {
      tokenData = flow === "instagram"
        ? await exchangeForLongLivedInstagram(shortToken.access_token)
        : await exchangeForLongLivedFacebook(shortToken.access_token);
    } catch {
      console.warn("Failed to exchange long-lived token, using short-lived.");
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const fallbackExpiresInSeconds = flow === "instagram" ? 60 * 24 * 60 * 60 : null;
    const expiresInSeconds =
      typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in) && tokenData.expires_in > 0
        ? tokenData.expires_in
        : fallbackExpiresInSeconds;
    const expiresAt = expiresInSeconds
      ? new Date(now.getTime() + expiresInSeconds * 1000).toISOString()
      : null;

    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");

    if (flow === "instagram") {
      const existingSnap = await integrationRef.get().catch(() => null);
      const existing = existingSnap?.exists ? ((existingSnap.data() || {}) as Record<string, unknown>) : null;

      let selectionUpdate: SelectionUpdate | null = null;
      const fallbackIgUserId = shortToken?.user_id ? String(shortToken.user_id) : null;
      selectionUpdate = await resolveInstagramSelection(tokenData.access_token, nowIso, fallbackIgUserId);

      if (!selectionUpdate?.igUserId) {
        throw new Error("인스타그램 계정 정보를 확인하지 못했습니다. 계정 유형/권한을 확인한 뒤 다시 연동해 주세요.");
      }

      {
        const accountId = selectionUpdate.igUserId;

        const hasActiveAccountId =
          existing && typeof existing.activeAccountId === "string" && existing.activeAccountId.trim().length > 0;
        if (!hasActiveAccountId && existing) {
          const legacyAccountIdRaw =
            (typeof existing.igUserId === "string" && existing.igUserId.trim())
            || (typeof existing.pageId === "string" && existing.pageId.trim())
            || null;
          const legacyAccessTokenRaw = typeof existing.accessToken === "string" ? existing.accessToken.trim() : "";
          const legacyAccountId = legacyAccountIdRaw && legacyAccountIdRaw !== accountId ? legacyAccountIdRaw : null;
          const legacyAccessToken = legacyAccessTokenRaw || null;

          if (legacyAccountId && legacyAccessToken) {
            try {
              const legacyRef = integrationRef.collection("accounts").doc(legacyAccountId);
              const legacySnap = await legacyRef.get();
              if (!legacySnap.exists) {
                const legacyTokenType =
                  typeof existing.tokenType === "string" && existing.tokenType.trim()
                    ? existing.tokenType.trim()
                    : "bearer";
                const legacyExpiresAt = typeof existing.expiresAt === "string" ? existing.expiresAt : null;
                const legacyPageAccessToken =
                  typeof existing.pageAccessToken === "string" && existing.pageAccessToken.trim()
                    ? existing.pageAccessToken.trim()
                    : null;
                const legacyPageName = typeof existing.pageName === "string" ? existing.pageName : null;
                const legacyIgUsername = typeof existing.igUsername === "string" ? existing.igUsername : null;
                const legacySelectedAt = typeof existing.selectedAt === "string" ? existing.selectedAt : nowIso;

                const legacyPayload: InstagramIntegrationAccount = {
                  status: "connected",
                  flow: legacyPageAccessToken ? "facebook" : "instagram",
                  accessToken: legacyAccessToken,
                  tokenType: legacyTokenType,
                  expiresAt: legacyExpiresAt,
                  pageId: typeof existing.pageId === "string" ? existing.pageId : legacyAccountId,
                  pageName: legacyPageName || (legacyIgUsername ? `@${legacyIgUsername}` : null),
                  pageAccessToken: legacyPageAccessToken,
                  igUserId: typeof existing.igUserId === "string" ? existing.igUserId : legacyAccountId,
                  igUsername: legacyIgUsername,
                  selectedAt: legacySelectedAt,
                  updatedAt: nowIso,
                  connectedAt: typeof existing.connectedAt === "string" ? existing.connectedAt : nowIso,
                };

                await legacyRef.set(legacyPayload, { merge: true });
              }
            } catch (error) {
              console.warn("Failed to migrate legacy instagram integration:", error);
            }
          }
        }

        const accountRef = integrationRef.collection("accounts").doc(accountId);
        const accountPayload: InstagramIntegrationAccount = {
          status: "connected",
          flow: "instagram",
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type || "bearer",
          expiresAt,
          ...selectionUpdate,
          updatedAt: nowIso,
          connectedAt: nowIso,
        };

        await accountRef.set(accountPayload, { merge: true });
        await integrationRef.set(
          buildInstagramRootPayloadFromAccount(accountId, accountPayload, nowIso),
          { merge: true },
        );
      }
    } else {
      const existingSnap = await integrationRef.get().catch(() => null);
      const existing = existingSnap?.exists ? ((existingSnap.data() || {}) as Record<string, unknown>) : null;
      const previousActiveAccountId = asNonEmptyString(existing?.activeAccountId);
      const baseUrl = getFacebookGraphBase();
      const pagesUrl = new URL(`${baseUrl}/me/accounts`);
      pagesUrl.searchParams.set("fields", "id,name,instagram_business_account,access_token");
      pagesUrl.searchParams.set("access_token", tokenData.access_token);

      let pages: FacebookPage[] = [];
      try {
        const pagesRes = await fetchJson<FacebookAccountsResponse>(pagesUrl.toString());
        pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
      } catch (error) {
        console.warn("Failed to load Facebook pages in callback:", error);
      }

      const accountRows = await Promise.all(
        pages.map(async (page) => {
          const accountId = String(page.id);
          const igUserId = page?.instagram_business_account?.id ? String(page.instagram_business_account.id) : null;
          let igUsername: string | null = null;
          if (igUserId) {
            try {
              const igUrl = new URL(`${baseUrl}/${igUserId}`);
              igUrl.searchParams.set("fields", "username");
              igUrl.searchParams.set("access_token", tokenData.access_token);
              const igRes = await fetchJson<InstagramProfileResponse>(igUrl.toString());
              igUsername = asNonEmptyString(igRes?.username);
            } catch {
              igUsername = null;
            }
          }

          const pageName = asNonEmptyString(page.name) || (igUsername ? `@${igUsername}` : "이름 없음");
          const accountPayload: InstagramIntegrationAccount = {
            status: "connected",
            flow: "facebook",
            accessToken: tokenData.access_token,
            tokenType: tokenData.token_type || "bearer",
            expiresAt,
            pageId: accountId,
            pageName,
            pageAccessToken: asNonEmptyString(page.access_token),
            igUserId,
            igUsername,
            selectedAt: nowIso,
            updatedAt: nowIso,
            connectedAt: nowIso,
          };

          await integrationRef.collection("accounts").doc(accountId).set(accountPayload, { merge: true });

          return {
            accountId,
            pageName,
            pageAccessToken: asNonEmptyString(page.access_token),
            igUserId,
            igUsername,
          };
        }),
      );

      const activeAccount =
        (previousActiveAccountId && accountRows.find((row) => row.accountId === previousActiveAccountId))
        || accountRows.find((row) => row.igUserId)
        || accountRows[0]
        || null;
      if (!activeAccount) {
        throw new Error("연결 가능한 Facebook 페이지 또는 Instagram 비즈니스 계정을 찾지 못했습니다.");
      }

      await integrationRef.set(
        {
          status: "connected",
          version: 2,
          flow: "facebook",
          activeAccountId: activeAccount.accountId,
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type || "bearer",
          expiresAt,
          pageId: activeAccount.accountId,
          pageName: activeAccount.pageName,
          pageAccessToken: activeAccount.pageAccessToken || null,
          igUserId: activeAccount.igUserId || null,
          igUsername: activeAccount.igUsername || null,
          selectedAt: nowIso,
          updatedAt: nowIso,
          connectedAt: nowIso,
        },
        { merge: true },
      );
    }

    invalidateInstagramIntegration(uid);

    if (mode === "popup") {
      const response = popupResponse({
        success: true,
        fallbackPath: buildResultPath(returnTo, { connected: "1" }),
      });
      clearOauthCookies(response);
      return response;
    }

    const response = NextResponse.redirect(
      absoluteUrl(req, buildResultPath(returnTo, { connected: "1" })),
    );
    clearOauthCookies(response);
    return response;
  } catch (error) {
    console.error("Meta OAuth callback failed:", error);
    const redirectPath = buildResultPath(returnTo, { connected: "0", error: "oauth_failed" });
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        error: "oauth_failed",
        errorDescription: error instanceof Error ? error.message : null,
        fallbackPath: redirectPath,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectPath));
    clearOauthCookies(response);
    return response;
  }
}
