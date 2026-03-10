import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import {
  getMetaRequestUid,
  processDueInstagramPublishingRecords,
} from "@/lib/services/instagram-publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }

  try {
    const uid = await getMetaRequestUid(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
    const limitValue = typeof body.limit === "number" ? body.limit : Number.parseInt(String(body.limit || "1"), 10);
    const parsedLimit = Number.isNaN(limitValue) ? 1 : limitValue;
    const limit = Math.max(1, Math.min(parsedLimit, 1));

    const result = await processDueInstagramPublishingRecords(uid, limit);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Instagram publish dispatch failed:", error);
    const message = error instanceof Error ? error.message : "Failed to dispatch scheduled instagram posts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
