import { NextRequest, NextResponse } from "next/server";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { invalidateInstagramIntegration, readInstagramIntegration } from "@/lib/services/meta-integration-cache";
import { getFacebookGraphBase, getInstagramGraphBase } from "@/lib/services/meta-graph";
import { buildInstagramRootPayloadFromAccount } from "@/lib/services/meta-integration-root";

export const runtime = "nodejs";

type InstagramMeResponse = {
  id?: string | number;
  username?: string;
};

type InstagramProfileResponse = {
  username?: string;
};

type FacebookPage = {
  id: string | number;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string | number | null;
  } | null;
};

type FacebookAccountsResponse = {
  data?: FacebookPage[];
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

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

export async function GET(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const integration = await readInstagramIntegration(uid);
    if (!integration) {
      return NextResponse.json({ selected: null });
    }
    const data = integration as {
      pageId?: string;
      pageName?: string;
      igUserId?: string;
      igUsername?: string;
      selectedAt?: string;
    };
    if (!data?.pageId || !data?.igUserId) {
      return NextResponse.json({ selected: null });
    }
    return NextResponse.json({
      selected: {
        pageId: data.pageId,
        pageName: data.pageName,
        igUserId: data.igUserId,
        igUsername: data.igUsername,
        selectedAt: data.selectedAt ?? null,
      },
    });
  } catch (error) {
    console.error("Selection fetch failed:", error);
    return NextResponse.json({ error: "Failed to fetch selection" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!db || !isFirebaseConfigured) {
    return NextResponse.json({ error: "Firestore not configured" }, { status: 500 });
  }
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json()) as { pageId?: string | number };
    const { pageId } = body;
    if (!pageId) {
      return NextResponse.json({ error: "pageId required" }, { status: 400 });
    }
    const requestedPageId = String(pageId);

    const docRef = db.collection("users").doc(uid).collection("integrations").doc("instagram");
    const integration = await readInstagramIntegration(uid, { forceFresh: true });
    if (!integration) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }
    const accessToken = typeof integration.accessToken === "string" ? integration.accessToken : null;
    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    const integrationFlow = typeof integration.flow === "string" ? integration.flow : null;
    const flow = integrationFlow === "instagram" || integrationFlow === "facebook"
      ? integrationFlow
      : (process.env.META_LOGIN_FLOW || "facebook") === "instagram"
        ? "instagram"
        : "facebook";
    if (flow === "instagram") {
      const graphBase = getInstagramGraphBase();
      const accountRef = docRef.collection("accounts").doc(requestedPageId);
      const existingAccountSnap = await accountRef.get();
      const now = new Date().toISOString();

      if (existingAccountSnap.exists) {
        const existingAccountData = (existingAccountSnap.data() || {}) as Record<string, unknown>;
        const accountPayload = {
          status: "connected",
          flow: "instagram",
          accessToken: typeof existingAccountData.accessToken === "string" ? existingAccountData.accessToken : accessToken,
          tokenType: typeof existingAccountData.tokenType === "string"
            ? existingAccountData.tokenType
            : typeof integration.tokenType === "string"
              ? integration.tokenType
              : "bearer",
          expiresAt: typeof existingAccountData.expiresAt === "string"
            ? existingAccountData.expiresAt
            : typeof integration.expiresAt === "string"
              ? integration.expiresAt
              : null,
          pageId: typeof existingAccountData.pageId === "string" ? existingAccountData.pageId : requestedPageId,
          pageName: typeof existingAccountData.pageName === "string"
            ? existingAccountData.pageName
            : typeof existingAccountData.igUsername === "string"
              ? `@${existingAccountData.igUsername}`
              : "Instagram 계정",
          pageAccessToken: null,
          igUserId: typeof existingAccountData.igUserId === "string" ? existingAccountData.igUserId : requestedPageId,
          igUsername: typeof existingAccountData.igUsername === "string" ? existingAccountData.igUsername : null,
          selectedAt: now,
          updatedAt: now,
          connectedAt: typeof existingAccountData.connectedAt === "string" ? existingAccountData.connectedAt : now,
        } satisfies Record<string, unknown>;

        await accountRef.set(accountPayload, { merge: true });
        await docRef.set(
          buildInstagramRootPayloadFromAccount(requestedPageId, accountPayload, now),
          { merge: true },
        );
        invalidateInstagramIntegration(uid);

        return NextResponse.json({
          selected: {
            pageId: (typeof accountPayload.pageId === "string" ? accountPayload.pageId : requestedPageId),
            pageName: typeof accountPayload.pageName === "string"
              ? accountPayload.pageName
              : typeof accountPayload.igUsername === "string"
                ? `@${accountPayload.igUsername}`
                : "Instagram 계정",
            igUserId: typeof accountPayload.igUserId === "string" ? accountPayload.igUserId : requestedPageId,
            igUsername: typeof accountPayload.igUsername === "string" ? accountPayload.igUsername : null,
            selectedAt: now,
          },
        });
      }

      const meUrl = new URL(`${graphBase}/me`);
      meUrl.searchParams.set("fields", "id,username");
      meUrl.searchParams.set("access_token", accessToken);
      const meRes = await fetchJson<InstagramMeResponse>(meUrl.toString());
      const igId = meRes?.id ? String(meRes.id) : null;
      const igUsername = meRes?.username || null;
      if (!igId) {
        return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
      }
      if (requestedPageId !== igId) {
        return NextResponse.json({ error: "Instagram account mismatch" }, { status: 400 });
      }

      const tokenType = typeof integration.tokenType === "string" ? integration.tokenType : "bearer";
      const expiresAt = typeof integration.expiresAt === "string" ? integration.expiresAt : null;
      const payload = {
        status: "connected",
        flow: "instagram",
        accessToken,
        tokenType,
        expiresAt,
        pageId: igId,
        pageName: igUsername ? `@${igUsername}` : "Instagram 계정",
        pageAccessToken: null,
        igUserId: igId,
        igUsername,
        selectedAt: now,
        updatedAt: now,
        connectedAt: now,
      } satisfies Record<string, unknown>;

      await accountRef.set(payload, { merge: true });
      await docRef.set(
        buildInstagramRootPayloadFromAccount(igId, payload, now),
        { merge: true },
      );
      invalidateInstagramIntegration(uid);

      return NextResponse.json({
        selected: {
          pageId: igId,
          pageName: igUsername ? `@${igUsername}` : "Instagram 계정",
          igUserId: igId,
          igUsername,
          selectedAt: now,
        },
      });
    }

    const baseUrl = getFacebookGraphBase();
    const pagesUrl = new URL(`${baseUrl}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,instagram_business_account,access_token");
    pagesUrl.searchParams.set("access_token", accessToken);
    const pagesRes = await fetchJson<FacebookAccountsResponse>(pagesUrl.toString());
    const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
    const page = pages.find((p) => String(p.id) === requestedPageId);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const igId = page?.instagram_business_account?.id || null;
    if (!igId) {
      return NextResponse.json({ error: "No Instagram account linked to page" }, { status: 400 });
    }

    let igUsername: string | null = null;
    try {
      const igUrl = new URL(`${baseUrl}/${igId}`);
      igUrl.searchParams.set("fields", "username");
      igUrl.searchParams.set("access_token", accessToken);
      const igRes = await fetchJson<InstagramProfileResponse>(igUrl.toString());
      igUsername = igRes?.username || null;
    } catch {
      igUsername = null;
    }

    const now = new Date().toISOString();
    const accountId = String(page.id);
    const tokenType = typeof integration.tokenType === "string" ? integration.tokenType : "bearer";
    const expiresAt = typeof integration.expiresAt === "string" ? integration.expiresAt : null;
    const connectedAt = typeof integration.connectedAt === "string" ? integration.connectedAt : now;

    await docRef.collection("accounts").doc(accountId).set(
      {
        status: "connected",
        flow: "facebook",
        accessToken,
        tokenType,
        expiresAt,
        pageId: accountId,
        pageName: page.name || "이름 없음",
        pageAccessToken: page.access_token || null,
        igUserId: String(igId),
        igUsername,
        selectedAt: now,
        updatedAt: now,
        connectedAt,
      },
      { merge: true },
    );

    await docRef.set({
      status: "connected",
      version: 2,
      flow: "facebook",
      activeAccountId: accountId,
      accessToken,
      tokenType,
      expiresAt,
      pageId: accountId,
      pageName: page.name || "이름 없음",
      pageAccessToken: page.access_token || null,
      igUserId: String(igId),
      igUsername,
      selectedAt: now,
      updatedAt: now,
      connectedAt,
    }, { merge: true });
    invalidateInstagramIntegration(uid);

    return NextResponse.json({
      selected: {
        pageId: accountId,
        pageName: page.name || "이름 없음",
        igUserId: String(igId),
        igUsername,
        selectedAt: now,
      },
    });
  } catch (error) {
    console.error("Selection save failed:", error);
    return NextResponse.json({ error: "Failed to save selection" }, { status: 500 });
  }
}
