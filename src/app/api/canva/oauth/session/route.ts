import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken || typeof idToken !== "string") {
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

    const response = NextResponse.json({ ok: true });
    response.cookies.set("canva_oauth_uid", decoded.uid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("Canva OAuth session error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Invalid token", detail }, { status: 401 });
  }
}
