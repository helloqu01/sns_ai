const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const dotenv = require("dotenv");

const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const NAVER_BASE_URL = process.env.NAVER_DATALAB_BASE_URL || "https://openapi.naver.com/v1/datalab/search";
const NAVER_CLIENT_ID = process.env.NAVER_DATALAB_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_DATALAB_CLIENT_SECRET;

const resolveServiceAccountPath = () => {
  const envPathValue = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const candidates = [
    envPathValue,
    path.join(process.cwd(), "QUEENS_SNS KEY.json"),
    path.join(process.cwd(), "..", "QUEENS_SNS KEY.json"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    return candidate;
  }

  return null;
};

const initAdmin = () => {
  if (admin.apps.length > 0) return admin.apps[0];

  const serviceAccountPath = resolveServiceAccountPath();
  if (serviceAccountPath) {
    const raw = fs.readFileSync(serviceAccountPath, "utf8");
    const parsed = JSON.parse(raw);
    return admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId: parsed.project_id,
    });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (projectId) {
    return admin.initializeApp({ projectId });
  }

  if (process.env.FIREBASE_CONFIG) {
    return admin.initializeApp();
  }

  throw new Error("Firebase Admin init failed: no credentials or project id available.");
};

const getArg = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
};

const hasFlag = (flag) => process.argv.includes(flag);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getKSTDate = (offsetDays = 0) => {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
};

const normalizeTitle = (title) => (title || "").trim();

const buildKeywords = (title) => {
  const original = normalizeTitle(title);
  const cleaned = original
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const keywords = [];
  if (cleaned) keywords.push(cleaned);
  if (original && !keywords.includes(original)) keywords.push(original);
  return keywords.slice(0, 5);
};

const fetchTrend = async (payload, attempt = 1, maxAttempts = 3) => {
  const res = await fetch(NAVER_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    return res.json();
  }

  const bodyText = await res.text();
  if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
    const backoffMs = 800 * attempt;
    console.warn(`[naver] ${res.status} retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
    await sleep(backoffMs);
    return fetchTrend(payload, attempt + 1, maxAttempts);
  }

  throw new Error(`[naver] ${res.status} ${bodyText}`);
};

const computeScore = (result) => {
  const ratios = Array.isArray(result?.data)
    ? result.data.map((item) => item?.ratio).filter((ratio) => typeof ratio === "number")
    : [];
  if (ratios.length === 0) return 0;
  const sum = ratios.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / ratios.length) * 100) / 100;
};

const run = async () => {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_DATALAB_CLIENT_ID / NAVER_DATALAB_CLIENT_SECRET env is required.");
  }
  if (typeof fetch !== "function") {
    throw new Error("Node 18+ is required (global fetch not available).");
  }

  const lookbackDays = Number(getArg("--days") || 60);
  const timeUnit = getArg("--time-unit") || "week";
  const limit = Number(getArg("--limit") || 0);
  const sleepMs = Number(getArg("--sleep-ms") || 300);
  const refreshDays = Number(getArg("--refresh-days") || 7);
  const device = getArg("--device");
  const gender = getArg("--gender");
  const agesRaw = getArg("--ages");
  const dryRun = hasFlag("--dry-run");

  const startDate = getKSTDate(-lookbackDays);
  const endDate = getKSTDate(0);

  initAdmin();
  const db = admin.firestore();

  const today = getKSTDate(0);
  const snapshot = await db.collection("festivals")
    .where("source", "==", "FESTIVAL_LIFE")
    .get();

  const festivals = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data?.title || !data?.id) return;
    if (data?.endDate && data.endDate < today) return;

    if (refreshDays > 0 && data.interestUpdatedAt) {
      const updatedAt = new Date(data.interestUpdatedAt);
      if (!Number.isNaN(updatedAt.getTime())) {
        const ageMs = Date.now() - updatedAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays < refreshDays) return;
      }
    }

    festivals.push({
      id: data.id,
      title: data.title,
      docRef: doc.ref,
    });
  });

  const targetFestivals = limit > 0 ? festivals.slice(0, limit) : festivals;
  const groups = targetFestivals.map((festival) => ({
    groupName: String(festival.id),
    keywords: buildKeywords(festival.title),
    docRef: festival.docRef,
  }));

  if (groups.length === 0) {
    console.log("[naver] Nothing to update.");
    return;
  }

  const maxGroupsPerRequest = 5;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < groups.length; i += maxGroupsPerRequest) {
    const chunk = groups.slice(i, i + maxGroupsPerRequest);
    const payload = {
      startDate,
      endDate,
      timeUnit,
      keywordGroups: chunk.map((group) => ({
        groupName: group.groupName,
        keywords: group.keywords,
      })),
    };

    if (device) payload.device = device;
    if (gender) payload.gender = gender;
    if (agesRaw) {
      payload.ages = agesRaw.split(",").map((v) => v.trim()).filter(Boolean);
    }

    const response = await fetchTrend(payload);
    const results = Array.isArray(response?.results) ? response.results : [];
    const resultMap = new Map(results.map((result) => [String(result.title), result]));

    if (!dryRun) {
      const batch = db.batch();
      chunk.forEach((group) => {
        const result = resultMap.get(group.groupName);
        if (!result) {
          skipped += 1;
          return;
        }
        const score = computeScore(result);
        batch.set(group.docRef, {
          interestScore: score,
          interestSource: "NAVER_DATALAB",
          interestUpdatedAt: new Date().toISOString(),
          interestKeywords: group.keywords,
        }, { merge: true });
        updated += 1;
      });
      await batch.commit();
    } else {
      chunk.forEach((group) => {
        const result = resultMap.get(group.groupName);
        if (!result) {
          skipped += 1;
          return;
        }
        updated += 1;
      });
    }

    console.log(`[naver] Progress ${Math.min(i + maxGroupsPerRequest, groups.length)}/${groups.length} (updated ${updated}, skipped ${skipped})`);

    if (sleepMs > 0 && i + maxGroupsPerRequest < groups.length) {
      await sleep(sleepMs);
    }
  }

  console.log(`[naver] Done. Updated ${updated}, skipped ${skipped}.`);
};

run().catch((err) => {
  console.error("[naver] Failed:", err);
  process.exit(1);
});
