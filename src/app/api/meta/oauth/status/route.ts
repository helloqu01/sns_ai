import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { readInstagramIntegration } from "@/lib/services/meta-integration-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstagramIntegrationData = Record<string, unknown>;
type ConnectedAccountStatus = {
  connectedAt: string | null;
  expiresAt: string | null;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toValidTimestamp = (value: unknown) => {
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
  const timestamp = toValidTimestamp(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString();
};

const isExpired = (expiresAt: unknown) => {
  const timestamp = toValidTimestamp(expiresAt);
  if (timestamp === null) return false;
  return timestamp <= Date.now();
};

const evaluateConnection = (integration: InstagramIntegrationData | null) => {
  const status = asNonEmptyString(integration?.status);
  const connectedAt = toIsoString(integration?.connectedAt) || asNonEmptyString(integration?.connectedAt);
  const expiresAt = toIsoString(integration?.expiresAt) || asNonEmptyString(integration?.expiresAt);
  const hasAccessToken = Boolean(asNonEmptyString(integration?.accessToken) || asNonEmptyString(integration?.pageAccessToken));
  const hasIdentity = Boolean(
    asNonEmptyString(integration?.igUserId)
    || asNonEmptyString(integration?.pageId)
    || asNonEmptyString(integration?.activeAccountId),
  );
  const connected = status !== "disconnected" && hasAccessToken && hasIdentity && !isExpired(integration?.expiresAt);
  const reconnectRequired = Boolean(integration) && !connected
    && (status === "disconnected" || isExpired(integration?.expiresAt) || !hasAccessToken || !hasIdentity);
  return {
    connected,
    connectedAt,
    expiresAt,
    reconnectRequired,
  };
};

const readFallbackConnectedAccount = async (uid: string): Promise<ConnectedAccountStatus | null> => {
  if (!db || !isFirebaseConfigured) return null;

  const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
  const accountsSnap = await integrationRef.collection("accounts").where("status", "==", "connected").get();
  if (accountsSnap.empty) return null;

  let selected: ConnectedAccountStatus | null = null;
  let latestConnectedAt = Number.NEGATIVE_INFINITY;

  accountsSnap.docs.forEach((doc) => {
    const data = (doc.data() || {}) as InstagramIntegrationData;
    const status = asNonEmptyString(data.status);
    const expiresAt = toIsoString(data.expiresAt) || asNonEmptyString(data.expiresAt);
    const hasAccessToken = Boolean(asNonEmptyString(data.accessToken) || asNonEmptyString(data.pageAccessToken));
    const hasIdentity = Boolean(asNonEmptyString(data.igUserId) || asNonEmptyString(data.pageId));
    if (status === "disconnected" || !hasAccessToken || !hasIdentity) {
      return;
    }
    if (isExpired(data.expiresAt)) {
      return;
    }

    const connectedAt = toIsoString(data.connectedAt) || asNonEmptyString(data.connectedAt);
    const connectedAtMs = toValidTimestamp(connectedAt) ?? Number.NEGATIVE_INFINITY;
    if (!selected || connectedAtMs > latestConnectedAt) {
      latestConnectedAt = connectedAtMs;
      selected = { connectedAt, expiresAt };
    }
  });

  return selected;
};

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null, reconnectRequired: false });
    }
    const admin = getFirebaseAdmin();
    if (!admin) {
      return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null, reconnectRequired: false });
    }
    const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
    if (!decoded) {
      return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null, reconnectRequired: false });
    }
    const uid = decoded.uid;
    const integration = (await readInstagramIntegration(uid)) as InstagramIntegrationData | null;
    const status = evaluateConnection(integration);

    if (!status.connected) {
      const fallback = await readFallbackConnectedAccount(uid);
      if (fallback) {
        return NextResponse.json({
          connected: true,
          connectedAt: fallback.connectedAt,
          expiresAt: fallback.expiresAt,
          reconnectRequired: false,
        });
      }
    }

    return NextResponse.json({
      connected: status.connected,
      connectedAt: status.connectedAt,
      expiresAt: status.expiresAt,
      reconnectRequired: status.reconnectRequired,
    });
  } catch (error) {
    console.error("Failed to read OAuth status:", error);
    return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null, reconnectRequired: false });
  }
}
