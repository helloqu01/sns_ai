import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { invalidateInstagramIntegration } from "@/lib/services/meta-integration-cache";
import { buildInstagramRootPayloadFromAccount } from "@/lib/services/meta-integration-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const isExpired = (expiresAt: unknown) => {
  const timestamp = toTimestamp(expiresAt);
  if (timestamp === null) return false;
  return timestamp <= Date.now();
};

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
};

export async function POST(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { accountId?: unknown };
    const accountId = asNonEmptyString(body.accountId);
    if (!accountId) {
      return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }

    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
    const accountSnap = await integrationRef.collection("accounts").doc(accountId).get();
    if (!accountSnap.exists) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const accountData = (accountSnap.data() || {}) as Record<string, unknown>;
    const accountStatus = asNonEmptyString(accountData.status);
    const expiresAt = accountData.expiresAt;
    const hasToken = Boolean(asNonEmptyString(accountData.accessToken) || asNonEmptyString(accountData.pageAccessToken));
    const hasIdentity = Boolean(asNonEmptyString(accountData.igUserId) || asNonEmptyString(accountData.pageId));
    if (accountStatus === "disconnected" || !hasToken || !hasIdentity || isExpired(expiresAt)) {
      return NextResponse.json({ error: "Reconnect required for this account" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    await integrationRef.set(
      buildInstagramRootPayloadFromAccount(accountId, accountData, nowIso),
      { merge: true },
    );
    invalidateInstagramIntegration(uid);

    return NextResponse.json({ ok: true, activeAccountId: accountId });
  } catch (error) {
    console.error("Meta active account update failed:", error);
    return NextResponse.json({ error: "Failed to update active account" }, { status: 500 });
  }
}
