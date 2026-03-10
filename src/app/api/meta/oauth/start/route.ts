import { NextRequest, NextResponse } from "next/server";
import {
  createMetaOauthState,
  parseMetaOauthSessionToken,
  sanitizeReturnTo,
} from "@/lib/services/meta-oauth-state";

export const runtime = "nodejs";

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

const getForwardedHost = (req: Request) => {
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

const getForwardedProto = (req: Request, host: string) => {
  const forwardedProtos = splitProxyHeaderValues(req.headers.get("x-forwarded-proto"))
    .map((value) => value.toLowerCase());

  if (forwardedProtos.includes("https")) return "https";
  if (forwardedProtos.includes("http")) return "http";
  return isLocalhostOrigin(host) ? "http" : "https";
};

const getPublicOrigin = (req: Request) => {
  const host = getForwardedHost(req);
  const proto = getForwardedProto(req, host);
  if (isLocalhostOrigin(host)) {
    return `http://${host}`;
  }
  return `${proto}://${host}`;
};

const getOriginHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return normalizeHost(value);
  }
};

const resolveRedirectUri = (requestOrigin: string, configuredRedirectUri: string | null) => {
  const requestCallback = `${requestOrigin}/api/meta/oauth/callback`;

  // Keep loopback flows on the same host so popup cookies and callback origin stay aligned.
  if (isLocalhostOrigin(requestOrigin)) {
    if (!configuredRedirectUri) {
      return requestCallback;
    }

    if (isLocalhostOrigin(configuredRedirectUri) && getOriginHost(configuredRedirectUri) === getOriginHost(requestOrigin)) {
      return configuredRedirectUri;
    }

    return requestCallback;
  }

  if (!configuredRedirectUri) {
    return requestCallback;
  }

  return configuredRedirectUri;
};

const normalizeScopes = (flow: "facebook" | "instagram", scopes: string) => {
  const tokens = scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (flow === "facebook") {
    const mapping: Record<string, string> = {
      instagram_business_basic: "instagram_basic",
      instagram_business_manage_insights: "instagram_manage_insights",
      instagram_business_content_publish: "instagram_content_publish",
    };
    return Array.from(
      new Set(tokens.map((scope) => mapping[scope] || scope))
    ).join(",");
  }

  return Array.from(new Set(tokens)).join(",");
};

const getScopes = (flow: "facebook" | "instagram") => {
  if (process.env.META_OAUTH_SCOPES) {
    return normalizeScopes(flow, process.env.META_OAUTH_SCOPES);
  }
  if (flow === "instagram") {
    return "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish";
  }
  return "instagram_basic,instagram_manage_insights,instagram_content_publish,pages_show_list,pages_read_engagement";
};

const getFacebookAppConfig = () => {
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !redirectUri) {
    throw new Error("META_APP_ID / META_REDIRECT_URI is required.");
  }
  return { appId, redirectUri };
};

const getInstagramAppConfig = () => {
  const appId = process.env.META_IG_APP_ID || process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !redirectUri) {
    throw new Error("META_IG_APP_ID (or META_APP_ID) / META_REDIRECT_URI is required.");
  }
  return { appId, redirectUri };
};

const buildFacebookAuthUrl = (state: string, redirectUriOverride?: string) => {
  const { appId, redirectUri } = getFacebookAppConfig();
  const apiVersion = process.env.META_API_VERSION || "v20.0";
  const scope = getScopes("facebook");
  const finalRedirectUri = redirectUriOverride || redirectUri;

  const url = new URL(`https://www.facebook.com/${apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", finalRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("auth_type", "rerequest");
  return url.toString();
};

const buildInstagramAuthUrl = (state: string, redirectUriOverride?: string) => {
  const { appId, redirectUri } = getInstagramAppConfig();
  const scope = getScopes("instagram");
  const loginUrl = process.env.META_IG_LOGIN_URL;
  const finalRedirectUri = redirectUriOverride || redirectUri;

  if (!loginUrl) {
    throw new Error("META_IG_LOGIN_URL is required for Instagram login flow.");
  }

  const url = new URL(loginUrl);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", finalRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestOrigin = getPublicOrigin(req);
    const mode = searchParams.get("mode") || "";
    const flow = (process.env.META_LOGIN_FLOW || "facebook") === "instagram" ? "instagram" : "facebook";
    const redirectUri = resolveRedirectUri(requestOrigin, process.env.META_REDIRECT_URI || null);
    const returnTo = sanitizeReturnTo(searchParams.get("returnTo")) || "/analytics";
    const sessionPayload = parseMetaOauthSessionToken(searchParams.get("session"));
    const uid = req.cookies.get("meta_oauth_uid")?.value || sessionPayload?.uid || null;
    const state = createMetaOauthState({
      mode,
      uid,
      redirectUri,
      returnTo,
    });
    const url = flow === "instagram"
      ? buildInstagramAuthUrl(state, redirectUri)
      : buildFacebookAuthUrl(state, redirectUri);
    const response = NextResponse.redirect(url);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    };
    response.cookies.set("meta_oauth_state", state, cookieOptions);
    response.cookies.set("meta_oauth_mode", mode, cookieOptions);
    response.cookies.set("meta_oauth_redirect_uri", redirectUri, cookieOptions);
    response.cookies.set("meta_oauth_return_to", returnTo, cookieOptions);
    if (sessionPayload?.uid) {
      response.cookies.set("meta_oauth_uid", sessionPayload.uid, cookieOptions);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
