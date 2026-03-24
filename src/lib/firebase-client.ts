import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
};

export const isFirebaseClientConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.appId
);

let app = null;
if (isFirebaseClientConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

export const auth: Auth | null = app ? getAuth(app) : null;

let persistenceReadyPromise: Promise<void> = Promise.resolve();

if (auth && typeof window !== "undefined") {
  persistenceReadyPromise = setPersistence(auth, browserLocalPersistence)
    .catch((error) => {
      console.warn("Failed to enable browser local auth persistence. Falling back to memory persistence.", error);
      return setPersistence(auth, inMemoryPersistence);
    })
    .catch((fallbackError) => {
      console.warn("Failed to configure Firebase auth persistence.", fallbackError);
    });
}

export const authPersistenceReady = persistenceReadyPromise;
