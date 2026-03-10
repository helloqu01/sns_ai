import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { createMetaOauthSessionToken } from "@/lib/services/meta-oauth-state";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: "idToken required" }, { status: 400 });
    }
    const admin = getFirebaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Firebase admin not configured" }, { status: 500 });
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.email_verified) {
      return NextResponse.json({ error: "Email not verified" }, { status: 403 });
    }
    const uid = decoded.uid;
    const response = NextResponse.json({
      ok: true,
      session: createMetaOauthSessionToken(uid),
    });
    response.cookies.set("meta_oauth_uid", uid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("OAuth session error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Invalid token", detail }, { status: 401 });
  }
}
