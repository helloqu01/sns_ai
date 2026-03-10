const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const dotenv = require("dotenv");

const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const resolveServiceAccountPath = () => {
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const candidates = [
    envPath,
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

const normalizeTitle = (title) => (title || "").trim().toLowerCase();

const run = async () => {
  const fileArgIndex = process.argv.indexOf("--file");
  const filePath = fileArgIndex > -1
    ? process.argv[fileArgIndex + 1]
    : path.join(rootDir, "data", "festival_interest.json");

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const records = JSON.parse(raw);
  if (!Array.isArray(records)) {
    throw new Error("Input file must be a JSON array.");
  }

  initAdmin();
  const db = admin.firestore();

  const byId = new Map();
  const byTitle = new Map();
  for (const item of records) {
    if (!item) continue;
    if (item.id) byId.set(String(item.id), item);
    if (item.title) byTitle.set(normalizeTitle(item.title), item);
  }

  let updated = 0;
  let skipped = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collection("festivals")
      .where("source", "==", "FESTIVAL_LIFE")
      .orderBy("id")
      .limit(400);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const id = data.id || doc.id;
      const title = data.title;
      const record = byId.get(String(id)) || byTitle.get(normalizeTitle(title));

      if (!record || typeof record.interestScore !== "number") {
        skipped += 1;
        return;
      }

      batch.set(doc.ref, {
        interestScore: record.interestScore,
        interestSource: record.interestSource || "MANUAL",
        interestUpdatedAt: record.interestUpdatedAt || new Date().toISOString(),
        interestKeywords: Array.isArray(record.interestKeywords) ? record.interestKeywords : undefined,
      }, { merge: true });
      updated += 1;
    });

    await batch.commit();
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(`[interest] Updated ${updated} (skipped ${skipped})...`);
  }

  console.log(`[interest] Done. Updated ${updated}, skipped ${skipped}.`);
};

run().catch((err) => {
  console.error("[interest] Failed:", err);
  process.exit(1);
});
