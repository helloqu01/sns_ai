import { NextRequest, NextResponse } from "next/server";
import { getRequestUid, readCanvaOAuthStatus, toCanvaApiErrorPayload } from "@/lib/services/canva-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const uid = await getRequestUid(req);
    if (!uid) {
      return NextResponse.json({
        connected: false,
        expiresAt: null,
        source: null,
      });
    }

    const status = await readCanvaOAuthStatus(uid);
    return NextResponse.json(status);
  } catch (error) {
    console.error("Failed to read Canva OAuth status:", error);
    const payload = toCanvaApiErrorPayload(error, "Canva OAuth 상태를 확인하지 못했습니다.");
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
