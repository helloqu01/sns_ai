/**
 * api-auth.ts
 * 서버 API 라우트에서 요청자 UID를 추출하는 공통 유틸.
 * 로컬 개발 환경(loopback)에서는 NEXT_PUBLIC_DEV_AUTH_BYPASS 설정에 따라
 * Firebase 토큰 검증을 우회하고 DEV_AUTH_BYPASS_UID를 반환합니다.
 */

import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { isDevAuthBypassActive } from "@/lib/dev-auth-bypass";

const DEV_FALLBACK_UID = "dev-local-user";

/**
 * 요청에서 UID를 추출합니다.
 * - 로컬 loopback + DEV_AUTH_BYPASS 활성화 시 → DEV_AUTH_BYPASS_UID 또는 기본값 반환
 * - 그 외 → Authorization Bearer 토큰을 Firebase Admin으로 검증
 */
export async function resolveUidFromRequest(req: NextRequest): Promise<string | null> {
  // 로컬 개발 bypass
  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  if (isDevAuthBypassActive(hostname)) {
    const devUid = (process.env.DEV_AUTH_BYPASS_UID ?? "").trim() || DEV_FALLBACK_UID;
    return devUid;
  }

  // 프로덕션: Firebase 토큰 검증
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return null;

  const admin = getFirebaseAdmin();
  if (!admin) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}
