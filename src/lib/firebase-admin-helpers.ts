import { firebaseAdminApp } from "@/lib/firebase-admin";

export function getFirebaseAdmin(): typeof import("firebase-admin") | null {
  try {
    // eslint-disable-next-line no-eval
    const req = eval("require");
    const admin = req("firebase-admin");
    // Ensure default app is initialized before using admin.auth().
    try {
      admin.app(); // Throws if default app is missing.
    } catch {
      try {
        if (!firebaseAdminApp) {
          const projectId =
            process.env.FIREBASE_PROJECT_ID
            || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
            || process.env.GCLOUD_PROJECT
            || process.env.GOOGLE_CLOUD_PROJECT;
          if (projectId) {
            admin.initializeApp({ projectId });
          } else {
            admin.initializeApp();
          }
        } else if (admin?.apps?.length === 0) {
          admin.initializeApp();
        }
      } catch (error) {
        console.error("Firebase admin lazy init failed:", error);
        return null;
      }
    }
    return admin;
  } catch {
    return null;
  }
}
