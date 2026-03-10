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

const getTodayKST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

const run = async () => {
  initAdmin();
  const db = admin.firestore();
  const today = getTodayKST();

  let totalDeleted = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collection("festivals")
      .where("endDate", "<", today)
      .orderBy("endDate")
      .limit(400);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    totalDeleted += snapshot.size;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(`[cleanup] Deleted ${totalDeleted} so far...`);
  }

  console.log(`[cleanup] Done. Total deleted: ${totalDeleted}`);
};

run().catch((err) => {
  console.error("[cleanup] Failed:", err);
  process.exit(1);
});
