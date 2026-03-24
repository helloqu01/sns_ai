"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PartyPopper,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { META_OAUTH_RESULT_STORAGE_KEY, readStoredMetaOauthResult } from "@/lib/meta-oauth-client";
import { dispatchMetaActiveAccountChanged } from "@/lib/meta-account-client";

const CANVA_OAUTH_RESULT_STORAGE_KEY = "canva_oauth_result";

const sidebarItems = [
  { icon: LayoutDashboard, label: "대시보드", href: "/" },
  { icon: Sparkles, label: "인스타그램 AI", href: "/instagram-ai" },
  { icon: PartyPopper, label: "페스티벌 정보", href: "/festivals" },
  { icon: LayoutTemplate, label: "카드뉴스 갤러리", href: "/gallery" },
  { icon: BarChart3, label: "분석", href: "/analytics" },
  { icon: CalendarDays, label: "예약 발행", href: "/schedule" },
];

type SidebarAccount = {
  id: string;
  flow: "facebook" | "instagram" | null;
  igUserId: string | null;
  igUsername: string | null;
  pageName: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  status?: string | null;
  connected?: boolean;
  reconnectRequired?: boolean;
  active: boolean;
};

type CanvaStatus = {
  connected: boolean;
  expiresAt: string | null;
  source: string | null;
};

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  theme: "light" | "dark";
  onThemeToggle: () => void;
};

type SidebarRouteLinkProps = {
  collapsed: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  navButtonClass: (active: boolean) => string;
  renderTooltip: (label: string) => React.ReactNode;
  iconClassName?: string;
  textClassName?: string;
};

const toTimestamp = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
};

const formatDateTime = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCanvaSourceLabel = (source: string | null) => {
  switch (source) {
    case "integration":
      return "사용자 연동";
    case "runtime":
      return "런타임 토큰";
    case "env":
      return "환경 토큰";
    default:
      return "연결 안됨";
  }
};

const isAccountConnected = (account: SidebarAccount) => {
  const expiresAt = toTimestamp(account.expiresAt);
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return false;
  }
  if (typeof account.connected === "boolean") {
    return account.connected;
  }
  return account.status !== "disconnected";
};

const SidebarRouteLink = React.memo(function SidebarRouteLink({
  collapsed,
  href,
  icon: Icon,
  label,
  navButtonClass,
  renderTooltip,
  iconClassName = "h-5 w-5 shrink-0",
  textClassName = "text-[15px] font-bold",
}: SidebarRouteLinkProps) {
  const pathname = usePathname();

  return (
    <Link
      href={href}
      className={navButtonClass(pathname === href)}
      title={collapsed ? label : undefined}
    >
      <Icon className={iconClassName} />
      {!collapsed && <span className={textClassName}>{label}</span>}
      {renderTooltip(label)}
    </Link>
  );
});

SidebarRouteLink.displayName = "SidebarRouteLink";

export const Sidebar = React.memo(function Sidebar({ collapsed, onToggle, theme, onThemeToggle }: SidebarProps) {
  const { user, signOut } = useAuth();

  const [accounts, setAccounts] = useState<SidebarAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsMessage, setAccountsMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [reconnectingAccountId, setReconnectingAccountId] = useState<string | null>(null);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null);

  const [canvaStatus, setCanvaStatus] = useState<CanvaStatus>({
    connected: false,
    expiresAt: null,
    source: null,
  });
  const [canvaLoading, setCanvaLoading] = useState(false);
  const [canvaError, setCanvaError] = useState<string | null>(null);
  const [canvaMessage, setCanvaMessage] = useState<string | null>(null);
  const [isCanvaConnecting, setIsCanvaConnecting] = useState(false);
  const accountsRef = useRef<SidebarAccount[]>([]);
  const canvaStatusRef = useRef<CanvaStatus>({ connected: false, expiresAt: null, source: null });
  const loadedAccountsUidRef = useRef<string | null>(null);
  const loadedCanvaUidRef = useRef<string | null>(null);
  const accountsRequestRef = useRef<Promise<SidebarAccount[]> | null>(null);
  const canvaRequestRef = useRef<Promise<CanvaStatus | null> | null>(null);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    canvaStatusRef.current = canvaStatus;
  }, [canvaStatus]);

  const renderTooltip = (label: string) => {
    void label;
    return null;
  };

  const navButtonClass = (active: boolean) =>
    cn(
      "group relative flex items-center rounded-2xl transition-all duration-200",
      collapsed ? "justify-center px-0 py-3.5" : "gap-4 px-4 py-3.5",
      active
        ? "bg-black/25 text-white shadow-lg ring-1 ring-white/20"
        : "text-white/85 hover:bg-white/12 hover:text-white",
    );

  const fetchAccounts = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      if (!user) {
        loadedAccountsUidRef.current = null;
        accountsRequestRef.current = null;
        setAccounts([]);
        setAccountsError(null);
        return [] as SidebarAccount[];
      }
      if (!options?.force && loadedAccountsUidRef.current === user.uid && accountsRef.current.length > 0) {
        return accountsRef.current;
      }
      if (!options?.force && accountsRequestRef.current) {
        return accountsRequestRef.current;
      }

      if (!options?.silent) {
        setAccountsLoading(true);
      }
      setAccountsError(null);

      const request = (async () => {
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/accounts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { accounts?: SidebarAccount[]; error?: string };
        if (!res.ok) {
          setAccountsError(data.error || "연결 계정을 불러오지 못했습니다.");
          return accountsRef.current;
        }
        const nextAccounts = Array.isArray(data.accounts) ? data.accounts : [];
        setAccounts(nextAccounts);
        loadedAccountsUidRef.current = user.uid;
        return nextAccounts;
      })();

      accountsRequestRef.current = request;

      try {
        return await request;
      } catch {
        setAccountsError("연결 계정을 불러오지 못했습니다.");
        return accountsRef.current;
      } finally {
        accountsRequestRef.current = null;
        if (!options?.silent) {
          setAccountsLoading(false);
        }
      }
    },
    [user],
  );

  const fetchCanvaStatus = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      if (!user) {
        loadedCanvaUidRef.current = null;
        canvaRequestRef.current = null;
        setCanvaStatus({ connected: false, expiresAt: null, source: null });
        setCanvaError(null);
        return null;
      }
      if (!options?.force && loadedCanvaUidRef.current === user.uid && canvaStatusRef.current.source !== null) {
        return canvaStatusRef.current;
      }
      if (!options?.force && canvaRequestRef.current) {
        return canvaRequestRef.current;
      }
      if (!options?.silent) {
        setCanvaLoading(true);
      }
      setCanvaError(null);

      const request = (async () => {
        const token = await user.getIdToken();
        const res = await fetch("/api/canva/oauth/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as {
          connected?: boolean;
          expiresAt?: string | null;
          source?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setCanvaError(data.error || "Canva 연결 상태를 불러오지 못했습니다.");
          return canvaStatusRef.current;
        }
        const nextStatus: CanvaStatus = {
          connected: false,
          expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
          source: typeof data.source === "string" ? data.source : null,
        };
        const expiresAt = toTimestamp(nextStatus.expiresAt);
        nextStatus.connected = Boolean(data.connected) && !(expiresAt !== null && expiresAt <= Date.now());
        setCanvaStatus(nextStatus);
        loadedCanvaUidRef.current = user.uid;
        return nextStatus;
      })();

      canvaRequestRef.current = request;

      try {
        return await request;
      } catch {
        setCanvaError("Canva 연결 상태를 불러오지 못했습니다.");
        return canvaStatusRef.current;
      } finally {
        canvaRequestRef.current = null;
        if (!options?.silent) {
          setCanvaLoading(false);
        }
      }
    },
    [user],
  );

  const startMetaOAuth = useCallback(
    async (accountId: string | null) => {
      if (!user) {
        window.location.href = "/login";
        return;
      }

      setAccountsError(null);
      setAccountsMessage(null);
      setIsConnecting(true);
      setReconnectingAccountId(accountId);

      const popupName = `meta_oauth_${Date.now()}`;
      const popup = window.open(
        "about:blank",
        popupName,
        "width=520,height=720,menubar=no,toolbar=no,location=no,status=no",
      );

      if (popup) {
        try {
          popup.document.write(
            "<!doctype html><title>Meta 로그인</title><div style='font-family:sans-serif;padding:16px'>로그인 준비 중...</div>",
          );
        } catch {
          // ignore
        }
      }

      try {
        let token = await user.getIdToken();
        if (!token || token.split(".").length !== 3) {
          token = await user.getIdToken(true);
        }
        if (!token || token.split(".").length !== 3) {
          throw new Error("firebase_id_token_invalid");
        }

        const res = await fetch("/api/meta/oauth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ idToken: token }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; session?: string };
        if (!res.ok) {
          const detail = [data.error, data.detail].filter(Boolean).join(" - ");
          setAccountsError(detail || "계정 연결에 실패했습니다.");
          setIsConnecting(false);
          setReconnectingAccountId(null);
          if (popup) popup.close();
          return;
        }

        const oauthStartUrl = new URL(`${window.location.origin}/api/meta/oauth/start`);
        oauthStartUrl.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}`);
        if (popup) {
          oauthStartUrl.searchParams.set("mode", "popup");
        }
        if (data.session) {
          oauthStartUrl.searchParams.set("session", data.session);
        }

        if (!popup) {
          window.location.href = oauthStartUrl.toString();
          return;
        }
        popup.location.href = oauthStartUrl.toString();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        setAccountsError(detail ? `계정 연결에 실패했습니다. (${detail})` : "계정 연결에 실패했습니다.");
        setIsConnecting(false);
        setReconnectingAccountId(null);
        if (popup) popup.close();
        return;
      }

      const watcher = window.setInterval(() => {
        if (!popup || popup.closed) {
          window.clearInterval(watcher);
          setIsConnecting(false);
          setReconnectingAccountId(null);
        }
      }, 500);
    },
    [user],
  );

  const startCanvaOAuth = useCallback(async () => {
    if (!user) {
      window.location.href = "/login";
      return;
    }

    setCanvaError(null);
    setCanvaMessage(null);
    setIsCanvaConnecting(true);

    const popupName = `canva_oauth_${Date.now()}`;
    const popup = window.open(
      "about:blank",
      popupName,
      "width=560,height=760,menubar=no,toolbar=no,location=no,status=no",
    );
    if (popup) {
      try {
        popup.document.write(
          "<!doctype html><title>Canva 연결</title><div style='font-family:sans-serif;padding:16px'>Canva 연결 준비 중...</div>",
        );
      } catch {
        // ignore
      }
    }

    try {
      const token = await user.getIdToken(true);
      const res = await fetch("/api/canva/oauth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) {
        const detail = [data.error, data.detail].filter(Boolean).join(" - ");
        setCanvaError(detail || "Canva 연결 준비에 실패했습니다.");
        setIsCanvaConnecting(false);
        if (popup) popup.close();
        return;
      }
    } catch {
      setCanvaError("Canva 연결 준비에 실패했습니다.");
      setIsCanvaConnecting(false);
      if (popup) popup.close();
      return;
    }

    if (!popup) {
      setIsCanvaConnecting(false);
      window.location.href = "/api/canva/oauth/start";
      return;
    }

    popup.location.href = "/api/canva/oauth/start?mode=popup";
    const watcher = window.setInterval(() => {
      if (!popup || popup.closed) {
        window.clearInterval(watcher);
        setIsCanvaConnecting(false);
        void fetchCanvaStatus({ silent: true });
      }
    }, 500);
  }, [fetchCanvaStatus, user]);

  const activateAccount = useCallback(
    async (accountId: string) => {
      if (!user) return;

      setActivatingAccountId(accountId);
      setAccountsError(null);
      setAccountsMessage(null);

      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/accounts/active", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ accountId }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setAccountsError(data.error || "계정 전환에 실패했습니다.");
          return;
        }

        setAccounts((prev) =>
          prev.map((account) => ({
            ...account,
            active: account.id === accountId,
          })),
        );
        dispatchMetaActiveAccountChanged({ accountId });
        setAccountsMessage("활성 계정을 변경했습니다.");
      } catch {
        setAccountsError("계정 전환에 실패했습니다.");
      } finally {
        setActivatingAccountId(null);
      }
    },
    [user],
  );

  const removeAccount = useCallback(
    async (account: SidebarAccount) => {
      if (!user) return;

      const confirmed = window.confirm(
        account.active
          ? "현재 사용 중인 계정을 제거합니다. 남은 연결 계정이 있으면 자동으로 전환됩니다. 계속할까요?"
          : "이 연결 계정을 제거할까요?",
      );
      if (!confirmed) {
        return;
      }

      setRemovingAccountId(account.id);
      setAccountsError(null);
      setAccountsMessage(null);

      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/accounts", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ accountId: account.id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          activeAccountId?: string | null;
        };
        if (!res.ok || !data.ok) {
          setAccountsError(data.error || "계정 제거에 실패했습니다.");
          return;
        }

        const nextAccounts = await fetchAccounts({ silent: true, force: true });
        dispatchMetaActiveAccountChanged({ accountId: data.activeAccountId || nextAccounts.find((item) => item.active)?.id || null });
        setAccountsMessage("계정 연결을 제거했습니다.");
      } catch {
        setAccountsError("계정 제거에 실패했습니다.");
      } finally {
        setRemovingAccountId(null);
      }
    },
    [fetchAccounts, user],
  );

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((left, right) => {
      if (left.active && !right.active) return -1;
      if (!left.active && right.active) return 1;
      const leftConnected = isAccountConnected(left);
      const rightConnected = isAccountConnected(right);
      if (leftConnected && !rightConnected) return -1;
      if (!leftConnected && rightConnected) return 1;
      const leftConnectedAt = toTimestamp(left.connectedAt) || 0;
      const rightConnectedAt = toTimestamp(right.connectedAt) || 0;
      return rightConnectedAt - leftConnectedAt;
    });
  }, [accounts]);

  useEffect(() => {
    if (!user) {
      loadedAccountsUidRef.current = null;
      loadedCanvaUidRef.current = null;
      accountsRequestRef.current = null;
      canvaRequestRef.current = null;
      setAccounts([]);
      setAccountsError(null);
      setAccountsMessage(null);
      setIsConnecting(false);
      setReconnectingAccountId(null);
      setRemovingAccountId(null);
      setCanvaStatus({ connected: false, expiresAt: null, source: null });
      setCanvaError(null);
      setCanvaMessage(null);
      setIsCanvaConnecting(false);
      return;
    }
    void Promise.all([fetchAccounts(), fetchCanvaStatus()]);
  }, [fetchAccounts, fetchCanvaStatus, user]);

  useEffect(() => {
    const readStoredCanvaOauthResult = () => {
      try {
        const raw = localStorage.getItem(CANVA_OAUTH_RESULT_STORAGE_KEY);
        if (!raw) return null;
        localStorage.removeItem(CANVA_OAUTH_RESULT_STORAGE_KEY);
        const parsed = JSON.parse(raw) as {
          type?: string;
          success?: boolean;
          error?: string | null;
          errorDescription?: string | null;
        };
        return parsed;
      } catch {
        return null;
      }
    };

    const applyMetaOauthResult = (data: {
      type?: string;
      success?: boolean;
      error?: string | null;
      errorDescription?: string | null;
    }) => {
      if (data?.type !== "meta_oauth") return;

      setIsConnecting(false);
      setReconnectingAccountId(null);

      if (data.success) {
        void fetchAccounts({ silent: true, force: true }).then((nextAccounts) => {
          if (nextAccounts.length === 0) {
            setAccountsMessage(null);
            setAccountsError("계정 연결은 완료됐지만 사용 가능한 인스타그램 계정을 찾지 못했습니다. 권한/계정 유형을 확인해 주세요.");
            return;
          }
          setAccountsMessage("계정 연결이 완료되었습니다.");
          const activeAccount = nextAccounts.find((account) => account.active);
          if (activeAccount) {
            dispatchMetaActiveAccountChanged({ accountId: activeAccount.id });
          }
        });
        return;
      }

      const detail = [data.error, data.errorDescription].filter(Boolean).join(" - ");
      setAccountsError(detail ? `계정 연결 실패: ${detail}` : "계정 연결에 실패했습니다.");
    };

    const applyCanvaOauthResult = (data: {
      type?: string;
      success?: boolean;
      error?: string | null;
      errorDescription?: string | null;
    }) => {
      if (data?.type !== "canva_oauth") return;

      setIsCanvaConnecting(false);

      if (data.success) {
        setCanvaMessage("Canva 연결이 완료되었습니다.");
        setCanvaError(null);
        void fetchCanvaStatus({ silent: true, force: true });
        return;
      }

      const detail = [data.error, data.errorDescription].filter(Boolean).join(" - ");
      setCanvaError(detail ? `Canva 연결 실패: ${detail}` : "Canva 연결에 실패했습니다.");
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as {
        type?: string;
        success?: boolean;
        error?: string | null;
        errorDescription?: string | null;
      };
      applyMetaOauthResult(payload);
      applyCanvaOauthResult(payload);
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.newValue) return;
      if (event.key === META_OAUTH_RESULT_STORAGE_KEY) {
        const stored = readStoredMetaOauthResult();
        if (stored) {
          applyMetaOauthResult(stored);
        }
      }
      if (event.key === CANVA_OAUTH_RESULT_STORAGE_KEY) {
        const stored = readStoredCanvaOauthResult();
        if (stored) {
          applyCanvaOauthResult(stored);
        }
      }
    };

    const stored = readStoredMetaOauthResult();
    if (stored) {
      applyMetaOauthResult(stored);
    }
    const storedCanva = readStoredCanvaOauthResult();
    if (storedCanva) {
      applyCanvaOauthResult(storedCanva);
    }

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [fetchAccounts, fetchCanvaStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("canva_connected");

    if (connected === "1") {
      setCanvaMessage("Canva 연결이 완료되었습니다.");
      setCanvaError(null);
      setIsCanvaConnecting(false);
      void fetchCanvaStatus({ silent: true, force: true });
    } else if (connected === "0") {
      const detail = [params.get("error"), params.get("error_description")].filter(Boolean).join(" - ");
      setCanvaError(detail ? `Canva 연결 실패: ${detail}` : "Canva 연결에 실패했습니다.");
      setIsCanvaConnecting(false);
      void fetchCanvaStatus({ silent: true, force: true });
    }

    if (connected) {
      const url = new URL(window.location.href);
      url.searchParams.delete("canva_connected");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      window.history.replaceState({}, "", url.toString());
    }
  }, [fetchCanvaStatus]);

  return (
    <aside
      style={{
        background: "var(--sidebar-gradient)",
        boxShadow: "var(--sidebar-shadow)",
      }}
      className={cn(
        "fixed left-0 top-0 z-50 flex h-full flex-col overflow-x-hidden text-white transition-all duration-300",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className={cn("border-b border-white/15", collapsed ? "p-3" : "p-3.5")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/20 backdrop-blur-md">
              <span className="text-lg font-black italic">IA</span>
            </div>
            <button
              onClick={onToggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white"
              title="사이드바 펼치기"
              aria-label="사이드바 펼치기"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/20 backdrop-blur-md">
                <span className="text-lg font-black italic">IA</span>
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-black leading-none tracking-tight">Insta AI Studio</h1>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/65">AI Marketing Tool</p>
              </div>
            </div>
            <button
              onClick={onToggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white"
              title="사이드바 접기"
              aria-label="사이드바 접기"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className={cn("flex-1 overflow-x-hidden overflow-y-auto", collapsed ? "px-2.5 py-4" : "px-4 py-5")}>
        <nav className="space-y-1.5">
          {sidebarItems.map((item) => (
            <SidebarRouteLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              navButtonClass={navButtonClass}
              renderTooltip={renderTooltip}
            />
          ))}
        </nav>

        {!collapsed && (
          <section className="mt-5 rounded-2xl border border-white/20 bg-white/10 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/75">연결 계정</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void startMetaOAuth(null)}
                  disabled={isConnecting || Boolean(removingAccountId)}
                  className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1 text-[10px] font-black text-white hover:bg-white/20 disabled:opacity-50"
                >
                  {isConnecting && reconnectingAccountId === null ? "연결 중..." : "계정 추가"}
                </button>
                <button
                  onClick={() => void Promise.all([fetchAccounts({ force: true }), fetchCanvaStatus({ force: true })])}
                  disabled={accountsLoading || canvaLoading}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-50"
                  title="연결 상태 새로고침"
                  aria-label="연결 상태 새로고침"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", (accountsLoading || canvaLoading) && "animate-spin")} />
                </button>
              </div>
            </div>

            {accountsLoading && accounts.length === 0 && (
              <div className="rounded-xl border border-white/20 bg-white/5 px-3 py-3 text-[11px] font-bold text-white/75">
                계정 목록을 불러오는 중입니다...
              </div>
            )}

            {!accountsLoading && sortedAccounts.length === 0 && (
              <div className="space-y-2 rounded-xl border border-dashed border-white/25 bg-white/5 px-3 py-3">
                <div className="text-[11px] font-bold text-white/70">연결된 인스타그램 계정이 없습니다.</div>
                <button
                  onClick={() => void startMetaOAuth(null)}
                  disabled={isConnecting}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/25 disabled:opacity-50"
                >
                  {isConnecting ? "연결 중..." : "계정 연결"}
                </button>
              </div>
            )}

            {sortedAccounts.length > 0 && (
              <div className="space-y-2">
                {sortedAccounts.map((account) => {
                  const connected = isAccountConnected(account);
                  const isActive = account.active;
                  const label = account.igUsername ? `@${account.igUsername}` : account.pageName || account.id;
                  const subLabel = account.pageName && account.igUsername ? account.pageName : account.id;

                  return (
                    <article
                      key={account.id}
                      className={cn(
                        "rounded-xl border px-2.5 py-2.5",
                        isActive
                          ? "border-white/35 bg-white/20"
                          : connected
                            ? "border-white/20 bg-white/10"
                            : "border-amber-300/50 bg-amber-100/10",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black text-white">{label}</div>
                          <div className="mt-1 truncate text-[10px] font-bold text-white/70">{subLabel}</div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {connected ? (
                            isActive ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-100/20 px-2 py-1 text-[10px] font-black text-emerald-100">
                                <CheckCircle2 className="h-3 w-3" />
                                사용중
                              </span>
                            ) : (
                              <button
                                onClick={() => void activateAccount(account.id)}
                                disabled={Boolean(activatingAccountId) || isConnecting || Boolean(removingAccountId)}
                                className="rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-[10px] font-black text-white hover:bg-white/20 disabled:opacity-50"
                              >
                                {activatingAccountId === account.id ? "전환 중..." : "선택"}
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => void startMetaOAuth(account.id)}
                              disabled={isConnecting || Boolean(activatingAccountId) || Boolean(removingAccountId)}
                              className="rounded-lg border border-amber-200/70 bg-amber-100/20 px-2 py-1 text-[10px] font-black text-amber-100 hover:bg-amber-100/35 disabled:opacity-50"
                            >
                              {isConnecting && reconnectingAccountId === account.id ? "연동 중..." : "재연동"}
                            </button>
                          )}

                          <button
                            onClick={() => void removeAccount(account)}
                            disabled={Boolean(activatingAccountId) || isConnecting || Boolean(removingAccountId)}
                            className="rounded-lg border border-white/20 bg-black/15 px-2 py-1 text-[10px] font-black text-white/80 hover:bg-black/25 hover:text-white disabled:opacity-50"
                          >
                            {removingAccountId === account.id ? "제거 중..." : "제거"}
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 space-y-1 text-[10px] font-bold">
                        <div className={cn(connected ? "text-emerald-100" : "text-amber-100")}>
                          {connected ? "연결됨" : "미연결"}
                        </div>
                        <div className="break-words text-white/65">
                          만료 {formatDateTime(account.expiresAt) || "-"}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {accountsMessage && (
              <div className="mt-2 text-[11px] font-black text-emerald-200">{accountsMessage}</div>
            )}
            {accountsError && (
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5" />
                {accountsError}
              </div>
            )}

            <div className="my-3 h-px bg-white/15" />

            <article
              className={cn(
                "rounded-xl border px-2.5 py-2.5",
                canvaStatus.connected
                  ? "border-white/20 bg-white/10"
                  : "border-amber-300/50 bg-amber-100/10",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1 text-xs font-black text-white">
                    <Palette className="h-3.5 w-3.5" />
                    Canva
                  </div>
                  <div className="mt-1 truncate text-[10px] font-bold text-white/70">
                    {getCanvaSourceLabel(canvaStatus.source)}
                  </div>
                </div>
                <button
                  onClick={() => void startCanvaOAuth()}
                  disabled={isCanvaConnecting}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[10px] font-black disabled:opacity-50",
                    canvaStatus.connected
                      ? "border border-white/30 bg-white/10 text-white hover:bg-white/20"
                      : "border border-amber-200/70 bg-amber-100/20 text-amber-100 hover:bg-amber-100/35",
                  )}
                >
                  {isCanvaConnecting ? "연동 중..." : canvaStatus.connected ? "재연동" : "연결"}
                </button>
              </div>

              <div className="mt-2 space-y-1 text-[10px] font-bold">
                <div className={cn(canvaStatus.connected ? "text-emerald-100" : "text-amber-100")}>
                  {canvaStatus.connected ? "연결됨" : "미연결"}
                </div>
                <div className="break-words text-white/65">
                  만료 {formatDateTime(canvaStatus.expiresAt) || "-"}
                </div>
              </div>
            </article>

            {canvaMessage && (
              <div className="mt-2 text-[11px] font-black text-emerald-200">{canvaMessage}</div>
            )}
            {canvaError && (
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5" />
                {canvaError}
              </div>
            )}
          </section>
        )}
      </div>

      <div className={cn("border-t border-white/15", collapsed ? "px-2.5 py-4" : "px-4 py-5")}>
        <div className={cn("rounded-2xl border border-white/20 bg-white/10", collapsed ? "p-2" : "p-3")}>
          {!collapsed && (
            <div className="mb-2.5 rounded-xl border border-white/20 bg-black/10 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">로그인 계정</div>
              <div className="mt-1 truncate text-xs font-black text-white">
                {user?.email || user?.displayName || "로그인 필요"}
              </div>
            </div>
          )}

          <div className={cn("grid gap-2", collapsed ? "grid-cols-1" : "grid-cols-3")}>
            <button
              onClick={onThemeToggle}
              className={cn(
                "group relative inline-flex h-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white",
              )}
              title={theme === "light" ? "다크 모드" : "라이트 모드"}
              aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}
            >
              {theme === "light" ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
              {renderTooltip(theme === "light" ? "다크 모드" : "라이트 모드")}
            </button>

            <Link
              href="/settings"
              className={cn(
                "group relative inline-flex h-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white",
              )}
              title="계정 관리"
            >
              <Settings className="h-4 w-4 shrink-0" />
              {renderTooltip("계정 관리")}
            </Link>

            {user ? (
              <button
                onClick={() => signOut()}
                className={cn(
                  "group relative inline-flex h-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white",
                )}
                title="로그아웃"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {renderTooltip("로그아웃")}
              </button>
            ) : (
              <Link
                href="/login"
                className={cn(
                  "group relative inline-flex h-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white",
                )}
                title="로그인"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {renderTooltip("로그인")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
});

Sidebar.displayName = "Sidebar";
