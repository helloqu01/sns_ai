import fs from "fs";
import path from "path";
import type { app as FirebaseApp, AppOptions } from "firebase-admin";

type FirebaseEnv = {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
    storageBucket?: string;
};

function getProjectIdFromFirebaseConfig(): string | undefined {
    const config = process.env.FIREBASE_CONFIG;
    if (!config) return undefined;

    const readProjectId = (raw: string): string | undefined => {
        try {
            const parsed = JSON.parse(raw) as { projectId?: string; project_id?: string };
            return parsed.projectId || parsed.project_id;
        } catch {
            return undefined;
        }
    };

    if (config.trim().startsWith("{")) {
        return readProjectId(config);
    }

    try {
        if (!fs.existsSync(config)) return undefined;
        const raw = fs.readFileSync(config, "utf8");
        return readProjectId(raw);
    } catch {
        return undefined;
    }
}

function getStorageBucketFromFirebaseConfig(): string | undefined {
    const config = process.env.FIREBASE_CONFIG;
    if (!config) return undefined;

    const readBucket = (raw: string): string | undefined => {
        try {
            const parsed = JSON.parse(raw) as { storageBucket?: string; storage_bucket?: string };
            return parsed.storageBucket || parsed.storage_bucket;
        } catch {
            return undefined;
        }
    };

    if (config.trim().startsWith("{")) {
        return readBucket(config);
    }

    try {
        if (!fs.existsSync(config)) return undefined;
        const raw = fs.readFileSync(config, "utf8");
        return readBucket(raw);
    } catch {
        return undefined;
    }
}

function getServiceAccountFromFile(): FirebaseEnv | null {
    const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const candidates = [
        envPath,
        path.join(process.cwd(), "QUEENS_SNS KEY.json"),
        path.join(process.cwd(), "..", "QUEENS_SNS KEY.json"),
    ].filter((p): p is string => !!p);

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const raw = fs.readFileSync(candidate, "utf8");
            const parsed = JSON.parse(raw) as {
                type?: string;
                project_id?: string;
                client_email?: string;
                private_key?: string;
            };
            if (parsed.type !== "service_account") continue;
            if (!parsed.project_id || !parsed.client_email || !parsed.private_key) continue;
            return {
                projectId: parsed.project_id,
                clientEmail: parsed.client_email,
                privateKey: parsed.private_key,
            };
        } catch {
            // ignore invalid file
        }
    }

    return null;
}

function getFirebaseEnv(): FirebaseEnv {
    const projectId =
        process.env.FIREBASE_PROJECT_ID
        || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
        || process.env.GCLOUD_PROJECT
        || process.env.GOOGLE_CLOUD_PROJECT
        || getProjectIdFromFirebaseConfig();
    const storageBucket =
        process.env.FIREBASE_STORAGE_BUCKET
        || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        || getStorageBucketFromFirebaseConfig();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    return { projectId, clientEmail, privateKey, storageBucket };
}

let cachedAdmin: typeof import("firebase-admin") | null = null;

function getFirebaseAdmin(): typeof import("firebase-admin") | null {
    if (cachedAdmin) return cachedAdmin;
    try {
        // Avoid static import so Turbopack doesn't externalize firebase-admin.
        // eslint-disable-next-line no-eval
        const req = eval("require");
        cachedAdmin = req("firebase-admin");
        return cachedAdmin;
    } catch {
        return null;
    }
}

function initFirebaseAdmin(): FirebaseApp.App | null {
    const admin = getFirebaseAdmin();
    if (!admin) return null;

    try {
        const fileEnv = getServiceAccountFromFile();
        const env = getFirebaseEnv();
        const {
            projectId,
            clientEmail,
            privateKey,
            storageBucket,
        } = fileEnv
            ? {
                projectId: fileEnv.projectId || env.projectId,
                clientEmail: fileEnv.clientEmail || env.clientEmail,
                privateKey: fileEnv.privateKey || env.privateKey,
                storageBucket: env.storageBucket,
            }
            : env;

        if (admin.apps.length > 0) return admin.apps[0];

        if (clientEmail && privateKey) {
            return admin.initializeApp({
                credential: admin.credential.cert({
                    projectId,
                    clientEmail,
                    privateKey,
                }),
                projectId,
                storageBucket,
            } as AppOptions);
        }

        if (projectId) {
            return admin.initializeApp({ projectId, storageBucket } as AppOptions);
        }

        if (process.env.FIREBASE_CONFIG || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) {
            return admin.initializeApp();
        }

        if (process.env.NODE_ENV === "production") {
            // In Firebase Hosting/Functions, default credentials should be available.
            return admin.initializeApp();
        }

        return null;
    } catch (error) {
        console.error("Firebase admin init failed:", error);
        return null;
    }
}

export const firebaseAdminApp = initFirebaseAdmin();
export const db = firebaseAdminApp ? getFirebaseAdmin()?.firestore(firebaseAdminApp) ?? null : null;
export const storageBucket = (() => {
    if (!firebaseAdminApp) return null;
    try {
        return getFirebaseAdmin()?.storage(firebaseAdminApp).bucket() ?? null;
    } catch {
        return null;
    }
})();
export const isFirebaseConfigured = !!db;
