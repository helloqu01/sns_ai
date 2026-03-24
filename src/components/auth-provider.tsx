"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebase-client";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser ?? null);
  const [loading, setLoading] = useState(Boolean(auth && !auth.currentUser));

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const firebaseAuth = auth;

    let active = true;
    const safetyTimeoutId = setTimeout(() => {
      if (!active) return;
      console.warn("Auth state check timed out; forcing loading=false.");
      setUser(firebaseAuth.currentUser);
      setLoading(false);
    }, 6000);

    try {
      const unsubscribe = onAuthStateChanged(
        firebaseAuth,
        (nextUser) => {
          if (!active) return;
          clearTimeout(safetyTimeoutId);
          setUser(nextUser);
          setLoading(false);
        },
        (error) => {
          if (!active) return;
          clearTimeout(safetyTimeoutId);
          console.error("Auth state check failed:", error);
          setUser(firebaseAuth.currentUser);
          setLoading(false);
        },
      );

      return () => {
        active = false;
        clearTimeout(safetyTimeoutId);
        unsubscribe();
      };
    } catch (error) {
      clearTimeout(safetyTimeoutId);
      console.error("Auth subscription setup failed:", error);
      setLoading(false);
      return () => {
        active = false;
      };
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signOut: () => (auth ? firebaseSignOut(auth) : Promise.resolve()),
  }), [user, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
