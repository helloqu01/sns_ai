import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { getUserCardnewsCollection } from "@/lib/firestore-cardnews";
import { invalidateCardnewsListCache } from "@/lib/services/cardnews-list-cache";

export const dynamic = "force-dynamic";

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

    const { draftId } = await req.json();
    if (!draftId || typeof draftId !== "string") {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    const docRef = getUserCardnewsCollection(uid).doc(draftId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const data = snap.data();
    if (data?.status === "published") {
      return NextResponse.json({ ok: true, status: "published" });
    }

    const now = new Date().toISOString();
    await docRef.set({
      status: "published",
      publishedAt: now,
      updatedAt: now,
    }, { merge: true });
    invalidateCardnewsListCache(uid);

    return NextResponse.json({ ok: true, status: "published" });
  } catch (error) {
    console.error("Publish cardnews failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
