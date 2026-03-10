import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCanvaAuthorizationCode, persistCanvaOAuthToken } from "@/lib/services/canva-integration";

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

const clearOauthCookies = (response: NextResponse) => {
  response.cookies.set("canva_oauth_state", "", { path: "/", maxAge: 0 });
  response.cookies.set("canva_oauth_mode", "", { path: "/", maxAge: 0 });
  response.cookies.set("canva_oauth_uid", "", { path: "/", maxAge: 0 });
  response.cookies.set("canva_oauth_verifier", "", { path: "/", maxAge: 0 });
  response.cookies.set("canva_oauth_redirect_uri", "", { path: "/", maxAge: 0 });
};

const toAsciiJson = (value: unknown) => {
  return JSON.stringify(value).replace(/[^\x20-\x7E]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
};

const popupResponse = (payload: {
  success: boolean;
  fallbackPath: string;
  error?: string;
  errorDescription?: string;
}) => {
  const popupPayload = toAsciiJson({
    type: "canva_oauth",
    success: payload.success,
    error: payload.error || null,
    errorDescription: payload.errorDescription || null,
  });
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /></head><body>
<script>
  const payload = ${popupPayload};
  try {
    localStorage.setItem("canva_oauth_result", JSON.stringify(payload));
  } catch {}
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      try {
        window.opener.postMessage(payload, "*");
      } catch {}
    }
  }
  try {
    window.close();
  } catch {}
  if (!window.opener) {
    window.location.replace(${JSON.stringify(payload.fallbackPath)});
  }
  window.setTimeout(() => window.location.replace(${JSON.stringify(payload.fallbackPath)}), 200);
</script>
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const cookieStore = await cookies();
  const mode = cookieStore.get("canva_oauth_mode")?.value || "";
  const uid = cookieStore.get("canva_oauth_uid")?.value || null;

  if (error) {
    const redirectUrl = `/?canva_connected=0&error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDescription || "")}`;
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        fallbackPath: redirectUrl,
        error,
        errorDescription: errorDescription || undefined,
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, redirectUrl));
    clearOauthCookies(response);
    return response;
  }

  if (!code || !state) {
    const redirectPath = "/?canva_connected=0&error=missing_code";
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        fallbackPath: redirectPath,
        error: "missing_code",
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, "/?canva_connected=0&error=missing_code"));
    clearOauthCookies(response);
    return response;
  }

  const cookieState = cookieStore.get("canva_oauth_state")?.value || "";
  if (!cookieState || cookieState !== state) {
    const redirectPath = "/?canva_connected=0&error=state_mismatch";
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        fallbackPath: redirectPath,
        error: "state_mismatch",
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, "/?canva_connected=0&error=state_mismatch"));
    clearOauthCookies(response);
    return response;
  }

  const codeVerifier = cookieStore.get("canva_oauth_verifier")?.value || "";
  const redirectUri = cookieStore.get("canva_oauth_redirect_uri")?.value || null;
  if (!codeVerifier) {
    const redirectPath = "/?canva_connected=0&error=missing_pkce_verifier";
    if (mode === "popup") {
      const response = popupResponse({
        success: false,
        fallbackPath: redirectPath,
        error: "missing_pkce_verifier",
      });
      clearOauthCookies(response);
      return response;
    }
    const response = NextResponse.redirect(absoluteUrl(req, "/?canva_connected=0&error=missing_pkce_verifier"));
    clearOauthCookies(response);
    return response;
  }

  try {
    const token = await exchangeCanvaAuthorizationCode({
      code,
      codeVerifier,
      redirectUri,
    });
    await persistCanvaOAuthToken(uid, token);

    if (mode === "popup") {
      const response = popupResponse({
        success: true,
        fallbackPath: "/?canva_connected=1",
      });
      clearOauthCookies(response);
      return response;
    }

    const response = NextResponse.redirect(absoluteUrl(req, "/?canva_connected=1"));
    clearOauthCookies(response);
    return response;
  } catch (oauthError) {
    console.error("Canva OAuth callback failed:", oauthError);
    const detail = oauthError instanceof Error ? oauthError.message : "oauth_failed";

    if (mode === "popup") {
      const redirectPath = `/?canva_connected=0&error=oauth_failed&error_description=${encodeURIComponent(detail)}`;
      const response = popupResponse({
        success: false,
        fallbackPath: redirectPath,
        error: "oauth_failed",
        errorDescription: detail,
      });
      clearOauthCookies(response);
      return response;
    }

    const response = NextResponse.redirect(absoluteUrl(
      req,
      `/?canva_connected=0&error=oauth_failed&error_description=${encodeURIComponent(detail)}`,
    ));
    clearOauthCookies(response);
    return response;
  }
}
