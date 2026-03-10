"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return localStorage.getItem("app_sidebar_collapsed") === "1";
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return localStorage.getItem("app_theme") === "dark" ? "dark" : "light";
  });

  const isLoginPage = pathname === "/login";
  const isVerifiedUser = Boolean(user?.emailVerified);
  const appBackgroundClass = "app-shell-bg";

  useEffect(() => {
    localStorage.setItem("app_sidebar_collapsed", isSidebarCollapsed ? "1" : "0");
  }, [isSidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("app_theme", theme);
  }, [theme]);

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const handleThemeToggle = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !isLoginPage) {
      router.replace("/login");
      return;
    }
    if (user && !isVerifiedUser && !isLoginPage) {
      router.replace("/login?verify=required");
      return;
    }
    if (user && isVerifiedUser && isLoginPage) {
      router.replace("/");
    }
  }, [loading, user, isLoginPage, isVerifiedUser, router]);

  if (isLoginPage) {
    return (
      <div className="app-shell-bg min-h-screen transition-colors duration-300">
        <div className="flex justify-end px-6 pt-6 sm:px-10">
          <button
            onClick={handleThemeToggle}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2 text-xs font-black text-slate-700 shadow-sm transition-all hover:bg-white"
            aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}
            title={theme === "light" ? "다크 모드" : "라이트 모드"}
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === "light" ? "다크 모드" : "라이트 모드"}
          </button>
        </div>
        <main className="px-6 pb-10 pt-4 sm:p-10">{children}</main>
      </div>
    );
  }

  if (loading || !user || !isVerifiedUser) {
    return (
      <div className="app-shell-bg flex min-h-screen items-center justify-center transition-colors duration-300">
        <div className="text-sm font-bold text-slate-400">로그인 확인 중...</div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen ${appBackgroundClass} transition-colors duration-300`}>
      <Sidebar
        collapsed={isSidebarCollapsed}
        onToggle={handleSidebarToggle}
        theme={theme}
        onThemeToggle={handleThemeToggle}
      />
      <main
        className={cn(
          "flex-1 overflow-x-hidden p-10 transition-all duration-300",
          isSidebarCollapsed ? "ml-20" : "ml-64",
        )}
      >
        {children}
      </main>
    </div>
  );
}
