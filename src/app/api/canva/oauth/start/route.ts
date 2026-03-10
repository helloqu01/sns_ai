import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generatePkcePair, getCanvaOAuthPublicConfig } from "@/lib/services/canva-integration";

export const runtime = "nodejs";

const CANVA_AUTHORIZE_URL = process.env.CANVA_AUTHORIZE_URL || "https://www.canva.com/api/oauth/authorize";

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

const getOriginHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return normalizeHost(value);
  }
};

const resolveRedirectUri = (requestOrigin: string, configuredRedirectUri: string | null) => {
  const requestCallback = `${requestOrigin}/api/canva/oauth/callback`;

  // Local development must stay on the same loopback host so popup cookies survive.
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestOrigin = getPublicOrigin(req);
    const mode = searchParams.get("mode") || "";
    const state = crypto.randomUUID();
    const { verifier, challenge } = generatePkcePair();

    const config = getCanvaOAuthPublicConfig();
    if (!config.clientId) {
      return NextResponse.json(
        { error: "Canva OAuth client_id configuration is missing." },
        { status: 500 },
      );
    }
    const redirectUri = resolveRedirectUri(requestOrigin, config.redirectUri);

    const url = new URL(CANVA_AUTHORIZE_URL);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(url.toString());
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    };
    response.cookies.set("canva_oauth_state", state, cookieOptions);
    response.cookies.set("canva_oauth_mode", mode, cookieOptions);
    response.cookies.set("canva_oauth_verifier", verifier, cookieOptions);
    response.cookies.set("canva_oauth_redirect_uri", redirectUri, cookieOptions);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
