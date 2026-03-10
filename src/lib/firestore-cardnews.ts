import { db, isFirebaseConfigured } from "@/lib/firebase-admin";

export const getUserCardnewsCollection = (uid: string) => {
  if (!db || !isFirebaseConfigured) {
    throw new Error("Firestore not configured");
  }
  return db.collection("users").doc(uid).collection("cardnews");
};

