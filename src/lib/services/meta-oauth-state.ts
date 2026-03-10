import crypto from "crypto";

const META_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type MetaOauthStatePayload = {
  nonce: string;
  issuedAt: number;
  mode: string;
  uid: string | null;
  redirectUri: string | null;
  returnTo: string | null;
};

export type MetaOauthSessionPayload = {
  nonce: string;
  issuedAt: number;
  uid: string;
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const asNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const sanitizeReturnTo = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  return trimmed;
};

const getMetaOauthStateSecret = () => {
  return (
    process.env.META_STATE_SECRET
    || process.env.META_IG_APP_SECRET
    || process.env.META_APP_SECRET
    || "meta-oauth-state-dev-secret"
  );
};

const signState = (encodedPayload: string) => {
  return crypto
    .createHmac("sha256", getMetaOauthStateSecret())
    .update(encodedPayload)
    .digest("base64url");
};

export const createMetaOauthState = (payload: {
  mode?: string | null;
  uid?: string | null;
  redirectUri?: string | null;
  returnTo?: string | null;
}) => {
  const body: MetaOauthStatePayload = {
    nonce: crypto.randomUUID(),
    issuedAt: Date.now(),
    mode: asString(payload.mode),
    uid: asNullableString(payload.uid),
    redirectUri: asNullableString(payload.redirectUri),
    returnTo: sanitizeReturnTo(payload.returnTo),
  };

  const encodedPayload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encodedPayload}.${signState(encodedPayload)}`;
};

export const parseMetaOauthState = (value: string | null | undefined) => {
  if (!value) return null;
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(signState(encodedPayload));
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<MetaOauthStatePayload>;

    const issuedAt = typeof parsed.issuedAt === "number" ? parsed.issuedAt : NaN;
    if (!Number.isFinite(issuedAt)) return null;
    if (issuedAt < Date.now() - META_OAUTH_STATE_TTL_MS) return null;
    if (issuedAt > Date.now() + 60_000) return null;

    return {
      nonce: asString(parsed.nonce),
      issuedAt,
      mode: asString(parsed.mode),
      uid: asNullableString(parsed.uid),
      redirectUri: asNullableString(parsed.redirectUri),
      returnTo: sanitizeReturnTo(parsed.returnTo),
    } satisfies MetaOauthStatePayload;
  } catch {
    return null;
  }
};

export const createMetaOauthSessionToken = (uid: string) => {
  const normalizedUid = asNullableString(uid);
  if (!normalizedUid) {
    throw new Error("uid is required");
  }

  const body: MetaOauthSessionPayload = {
    nonce: crypto.randomUUID(),
    issuedAt: Date.now(),
    uid: normalizedUid,
  };

  const encodedPayload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encodedPayload}.${signState(encodedPayload)}`;
};

export const parseMetaOauthSessionToken = (value: string | null | undefined) => {
  if (!value) return null;
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(signState(encodedPayload));
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<MetaOauthSessionPayload>;

    const issuedAt = typeof parsed.issuedAt === "number" ? parsed.issuedAt : NaN;
    const uid = asNullableString(parsed.uid);
    if (!Number.isFinite(issuedAt) || !uid) return null;
    if (issuedAt < Date.now() - META_OAUTH_STATE_TTL_MS) return null;
    if (issuedAt > Date.now() + 60_000) return null;

    return {
      nonce: asString(parsed.nonce),
      issuedAt,
      uid,
    } satisfies MetaOauthSessionPayload;
  } catch {
    return null;
  }
};
