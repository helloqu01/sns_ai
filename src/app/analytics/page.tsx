"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Link2,
  RefreshCw,
  Rocket,
  Lock,
  X,
  TrendingUp,
  Activity,
  Eye,
  MessageCircle,
  Heart,
  Bookmark,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { META_OAUTH_RESULT_STORAGE_KEY, readStoredMetaOauthResult } from "@/lib/meta-oauth-client";
import { META_ACTIVE_ACCOUNT_CHANGED_EVENT, dispatchMetaActiveAccountChanged } from "@/lib/meta-account-client";

type InstagramPost = {
  id: string;
  caption: string;
  previewUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentCount: number | null;
};

type InsightsSummary = {
  reach: number | null;
  impressions: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  likes: number;
  comments: number;
  saves: number | null;
  shares: number | null;
};

type InsightsDaily = {
  date: string;
  reach: number | null;
  impressions: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatShortDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  });
};

const truncateCaption = (value: string, max = 110) => {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
};

const steps = [
  { title: "인스타그램 계정 연결", desc: "비즈니스/크리에이터 계정 및 Meta 권한 연결" },
  { title: "게시글 발행 연동", desc: "발행 완료 시 media_id 저장" },
  { title: "인사이트 수집 파이프라인", desc: "일 단위로 성과지표 업데이트" },
];

const connectFlow = [
  {
    title: "Instagram 로그인",
    desc: "Instagram 계정으로 로그인 후 권한 승인",
    detailTitle: "Instagram 로그인",
    detailDesc: "Instagram 계정으로 로그인하고 Instagram Graph API 권한을 승인합니다.",
    actionLabel: "Instagram 로그인 시작",
  },
  {
    title: "계정 확인",
    desc: "연결된 Instagram 계정 확인",
    detailTitle: "계정 확인",
    detailDesc: "연결된 인스타그램 계정을 확인하고 저장합니다.",
    actionLabel: "계정 확인",
  },
  {
    title: "연결 완료",
    desc: "토큰 저장 및 연결 상태 확인",
    detailTitle: "연결 완료",
    detailDesc: "연결이 완료되었습니다. 이제 성과 데이터를 수집할 수 있습니다.",
    actionLabel: "완료",
  },
];

export default function AnalyticsPage() {
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);
  const [pages, setPages] = useState<{ id: string; name: string; igUserId?: string | null; igUsername?: string | null }[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<{
    pageId: string;
    pageName: string;
    igUserId: string;
    igUsername?: string | null;
    selectedAt?: string | null;
  } | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [postsFetchedAt, setPostsFetchedAt] = useState<string | null>(null);
  const [insightsSummary, setInsightsSummary] = useState<InsightsSummary | null>(null);
  const [insightsDaily, setInsightsDaily] = useState<InsightsDaily[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsFetchedAt, setInsightsFetchedAt] = useState<string | null>(null);
  const { user, loading } = useAuth();

  const formattedConnectedAt = useMemo(() => {
    if (!connectedAt) return null;
    const date = new Date(connectedAt);
    if (Number.isNaN(date.getTime())) return connectedAt;
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [connectedAt]);

  const postMetrics = useMemo(() => {
    const totals = posts.reduce(
      (acc, post) => {
        acc.postCount += 1;
        acc.totalLikes += post.likeCount ?? 0;
        acc.totalComments += post.commentCount ?? 0;
        return acc;
      },
      { postCount: 0, totalLikes: 0, totalComments: 0 },
    );
    const totalEngagement = totals.totalLikes + totals.totalComments;
    const averageLikes = totals.postCount > 0 ? Math.round(totals.totalLikes / totals.postCount) : 0;
    const averageComments = totals.postCount > 0 ? Math.round(totals.totalComments / totals.postCount) : 0;
    return { ...totals, totalEngagement, averageLikes, averageComments };
  }, [posts]);

  const metricCards = useMemo(() => {
    const ready = Boolean(user) && isConnected && !postsLoading && !insightsLoading;
    const numberOrDash = (value: number | null | undefined) => {
      if (!ready || typeof value !== "number" || !Number.isFinite(value)) return "-";
      return value.toLocaleString("ko-KR");
    };

    const likes = typeof insightsSummary?.likes === "number" ? insightsSummary.likes : postMetrics.totalLikes;
    const comments = typeof insightsSummary?.comments === "number" ? insightsSummary.comments : postMetrics.totalComments;
    const saves = typeof insightsSummary?.saves === "number" ? insightsSummary.saves : null;
    const shares = typeof insightsSummary?.shares === "number" ? insightsSummary.shares : null;
    const totalEngagement = typeof insightsSummary?.totalInteractions === "number"
      ? insightsSummary.totalInteractions
      : likes + comments + (saves ?? 0) + (shares ?? 0);

    return [
      { label: "도달", value: numberOrDash(insightsSummary?.reach), icon: Eye },
      { label: "참여", value: numberOrDash(totalEngagement), icon: Activity },
      { label: "좋아요", value: numberOrDash(likes), icon: Heart },
      { label: "댓글", value: numberOrDash(comments), icon: MessageCircle },
      { label: "저장", value: numberOrDash(saves), icon: Bookmark },
      { label: "공유", value: numberOrDash(shares), icon: Send },
    ];
  }, [insightsLoading, insightsSummary, isConnected, postMetrics.totalComments, postMetrics.totalLikes, postsLoading, user]);

  const chartPosts = useMemo(() => posts.slice(0, 7).reverse(), [posts]);
  const chartData = useMemo(() => {
    if (insightsDaily.length > 0) {
      return insightsDaily.slice(-7).map((point) => {
        const value = point.reach ?? point.impressions ?? point.totalInteractions ?? point.accountsEngaged ?? 0;
        return {
          id: point.date,
          value,
          label: formatShortDate(point.date),
          title: `도달 ${value.toLocaleString("ko-KR")} · ${formatDateTime(point.date)}`,
        };
      });
    }
    return chartPosts.map((post) => {
      const value = (post.likeCount ?? 0) + (post.commentCount ?? 0);
      return {
        id: post.id,
        value,
        label: formatShortDate(post.timestamp),
        title: `참여 ${value.toLocaleString("ko-KR")} · ${formatDateTime(post.timestamp)}`,
      };
    });
  }, [chartPosts, insightsDaily]);

  const chartMetricLabel = insightsDaily.length > 0 ? "도달(일별)" : "참여(게시물)";
  const chartMax = useMemo(() => {
    const max = Math.max(
      1,
      ...chartData.map((point) => point.value),
    );
    return max;
  }, [chartData]);

  const rankedPosts = useMemo(() => {
    return [...posts]
      .sort((left, right) => {
        const leftValue = (left.likeCount ?? 0) + (left.commentCount ?? 0);
        const rightValue = (right.likeCount ?? 0) + (right.commentCount ?? 0);
        return rightValue - leftValue;
      })
      .slice(0, 20);
  }, [posts]);

  const fetchStatus = async () => {
    try {
      if (!user) {
        setIsConnected(false);
        setConnectedAt(null);
        return;
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/oauth/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setIsConnected(!!data.connected);
      setConnectedAt(data.connectedAt ?? null);
      setExpiresAt(data.expiresAt ?? null);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchPages = async () => {
    if (!user) return;
    setPagesLoading(true);
    setPagesError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/pages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPagesError(data?.error || "페이지 정보를 불러오지 못했습니다.");
        return;
      }
      const data = await res.json();
      setPages(Array.isArray(data.pages) ? data.pages : []);
    } catch (error) {
      console.error(error);
      setPagesError("페이지 정보를 불러오지 못했습니다.");
    } finally {
      setPagesLoading(false);
    }
  };

  const fetchSelection = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/selection", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.selected) {
        setSelectionInfo(data.selected);
        setSelectedPageId(data.selected.pageId);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const fetchPosts = useCallback(async () => {
    if (!user) {
      setPosts([]);
      setPostsError(null);
      setPostsFetchedAt(null);
      return;
    }

    setPostsLoading(true);
    setPostsError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/posts?limit=24", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { posts?: InstagramPost[]; error?: string };
      if (!res.ok) {
        setPosts([]);
        setPostsError(typeof data.error === "string" ? data.error : "게시글 정보를 불러오지 못했습니다.");
        return;
      }

      setPosts(Array.isArray(data.posts) ? data.posts : []);
      setPostsFetchedAt(new Date().toISOString());
    } catch (error) {
      setPosts([]);
      setPostsError("게시글 정보를 불러오지 못했습니다.");
    } finally {
      setPostsLoading(false);
    }
  }, [user]);

  const fetchInsights = useCallback(async () => {
    if (!user) {
      setInsightsSummary(null);
      setInsightsDaily([]);
      setInsightsError(null);
      setInsightsFetchedAt(null);
      return;
    }

    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/insights?days=7&posts=12&mediaInsights=8", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        summary?: InsightsSummary;
        daily?: InsightsDaily[];
        error?: string;
      };
      if (!res.ok) {
        setInsightsSummary(null);
        setInsightsDaily([]);
        setInsightsError(typeof data.error === "string" ? data.error : "인사이트 정보를 불러오지 못했습니다.");
        return;
      }

      setInsightsSummary(data.summary ?? null);
      setInsightsDaily(Array.isArray(data.daily) ? data.daily : []);
      setInsightsFetchedAt(new Date().toISOString());
    } catch {
      setInsightsSummary(null);
      setInsightsDaily([]);
      setInsightsError("인사이트 정보를 불러오지 못했습니다.");
    } finally {
      setInsightsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!loading) {
      fetchStatus();
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setConnectMessage("계정 연결이 완료되었습니다.");
    }
    if (params.get("connected") === "0") {
      setConnectMessage("계정 연결에 실패했습니다. 다시 시도해주세요.");
    }
    if (params.get("connected")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      window.history.replaceState({}, "", url.toString());
    }

    const applyOauthResult = (data: {
        type?: string;
        success?: boolean;
        error?: string | null;
        errorDescription?: string | null;
      }) => {
      if (data?.type !== "meta_oauth") return;
      if (data.success) {
        setConnectMessage("계정 연결이 완료되었습니다.");
        fetchStatus();
        setIsConnectOpen(false);
      } else {
        const detail = [data.error, data.errorDescription].filter(Boolean).join(" - ");
        setConnectMessage(detail ? `계정 연결 실패: ${detail}` : "계정 연결에 실패했습니다. 다시 시도해주세요.");
      }
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      applyOauthResult(event.data as {
        type?: string;
        success?: boolean;
        error?: string | null;
        errorDescription?: string | null;
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== META_OAUTH_RESULT_STORAGE_KEY || !event.newValue) return;
      const stored = readStoredMetaOauthResult();
      if (stored) {
        applyOauthResult(stored);
      }
    };

    const stored = readStoredMetaOauthResult();
    if (stored) {
      applyOauthResult(stored);
    }
    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loading, user]);

  useEffect(() => {
    if (isConnectOpen && isConnected && user) {
      fetchPages();
      fetchSelection();
    }
  }, [isConnectOpen, isConnected, user]);

  useEffect(() => {
    if (!user || !isConnected) {
      setPosts([]);
      setPostsError(null);
      setPostsFetchedAt(null);
      setInsightsSummary(null);
      setInsightsDaily([]);
      setInsightsError(null);
      setInsightsFetchedAt(null);
      return;
    }
    void Promise.all([fetchPosts(), fetchInsights()]);
  }, [fetchInsights, fetchPosts, isConnected, user]);

  useEffect(() => {
    const handleActiveAccountChanged = () => {
      if (!user) {
        setPosts([]);
        setPostsError(null);
        setPostsFetchedAt(null);
        setInsightsSummary(null);
        setInsightsDaily([]);
        setInsightsError(null);
        setInsightsFetchedAt(null);
        return;
      }
      void Promise.all([fetchStatus(), fetchSelection(), fetchPosts(), fetchInsights()]);
    };

    window.addEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, [fetchInsights, fetchPosts, isConnected, user]);

  const handleNextStep = () => {
    setActiveStep((prev) => Math.min(prev + 1, connectFlow.length - 1));
  };

  const handlePrevStep = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  const handleConnectAction = async () => {
    setModalMessage(null);
    if (!user) {
      window.location.href = "/login";
      return;
    }
    if (activeStep === 0) {
      let popup: Window | null = null;
      setModalMessage("Meta 로그인 창을 여는 중...");
      const popupName = `meta_oauth_${Date.now()}`;
      popup = window.open(
        "about:blank",
        popupName,
        "width=520,height=720,menubar=no,toolbar=no,location=no,status=no"
      );
      if (popup) {
        try {
          popup.document.write(
            "<!doctype html><title>Meta 로그인</title><div style='font-family:sans-serif;padding:16px'>로그인 준비 중...</div>"
          );
        } catch {
          // ignore cross-origin or blocked write
        }
      }
      try {
        setModalMessage("Meta 로그인 준비 중...");
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/oauth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          session?: string;
        };
        if (!res.ok) {
          const errorMsg = [data?.error, data?.detail].filter(Boolean).join(" - ") || "로그인 토큰 검증에 실패했습니다.";
          setConnectMessage(errorMsg);
          setModalMessage(errorMsg);
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
          setModalMessage("팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.");
          window.location.href = oauthStartUrl.toString();
        } else {
          popup.location.href = oauthStartUrl.toString();
        }
        return;
      } catch (error) {
        const errorMsg = "로그인 토큰 검증에 실패했습니다.";
        setConnectMessage(errorMsg);
        setModalMessage(errorMsg);
        if (popup) popup.close();
        return;
      }
    }
    if (activeStep === 1) {
      if (!selectedPageId) {
        setConnectMessage("연결할 계정을 선택해주세요.");
        return;
      }
      try {
        setSavingSelection(true);
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/selection", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pageId: selectedPageId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setConnectMessage(data?.error || "계정 선택 저장에 실패했습니다.");
          return;
        }
        setSelectionInfo(data.selected);
        setConnectMessage("계정 선택이 저장되었습니다.");
        setActiveStep(2);
        dispatchMetaActiveAccountChanged({ accountId: data.selected.pageId });
        await Promise.all([fetchPosts(), fetchInsights()]);
      } catch (error) {
        setConnectMessage("계정 선택 저장에 실패했습니다.");
      } finally {
        setSavingSelection(false);
      }
      return;
    }
    if (activeStep === 2) {
      setIsConnectOpen(false);
      return;
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto min-h-screen pb-20">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-pink-600" />
            성과 분석
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1">
            계정 연결 이후 게시글 성과지표를 한눈에 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-600">
            계정 연결/전환은 사이드바에서 관리
          </div>
          <button
            onClick={() => void Promise.all([fetchPosts(), fetchInsights()])}
            disabled={!user || !isConnected || postsLoading || insightsLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-white bg-pink-600 hover:bg-pink-700 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", (postsLoading || insightsLoading) && "animate-spin")} />
            데이터 새로고침
          </button>
        </div>
      </header>

      <div className="glassmorphism p-5 rounded-3xl border-none shadow-md mb-8 flex items-center gap-4">
        <div className="w-10 h-10 rounded-2xl bg-pink-50 flex items-center justify-center">
          <Lock className="w-5 h-5 text-pink-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-slate-900">
            현재 상태: {!user ? "로그인 필요" : isConnected ? "계정 연결됨" : "계정 미연결"}
          </p>
          <p className="text-xs font-bold text-slate-400 mt-1">
            {!user
              ? "계정 연결을 시작하려면 먼저 로그인해야 합니다."
              : isConnected
                ? `연결 완료 ${formattedConnectedAt ?? ""}`.trim()
                : "계정 연결 및 발행 연동을 완료하면 성과지표가 자동으로 표시됩니다."}
          </p>
          {connectMessage && (
            <p className="text-xs font-bold text-pink-600 mt-2">{connectMessage}</p>
          )}
          {user && isConnected && insightsError && (
            <p className="text-xs font-bold text-amber-600 mt-2">{insightsError}</p>
          )}
          {user && isConnected && (postsFetchedAt || insightsFetchedAt) && !postsError && (
            <p className="text-[11px] font-bold text-slate-400 mt-2">
              최근 수집 {formatDateTime(insightsFetchedAt || postsFetchedAt)}
            </p>
          )}
        </div>
        <div className="px-4 py-2 rounded-xl text-xs font-black text-white bg-slate-900">
          {!user ? "로그인 필요" : isConnected ? "사이드바에서 계정 관리" : "사이드바에서 계정 연결"}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-10">
        <div className="xl:col-span-8">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {metricCards.map((metric) => (
              <div key={metric.label} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                    <metric.icon className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{metric.label}</p>
                    <p className="text-xl font-black text-slate-900">{metric.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-white rounded-[2rem] border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">성과 추이</p>
                <p className="text-lg font-black text-slate-900">주간 성과 그래프</p>
                <p className="mt-1 text-[11px] font-bold text-slate-400">{chartMetricLabel}</p>
              </div>
              <button className="text-xs font-black text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
                기간 변경
              </button>
            </div>
            <div className="h-56 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-sm font-bold text-slate-400">
              {(postsLoading || insightsLoading) ? (
                <div className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  데이터를 불러오는 중...
                </div>
              ) : !user ? (
                "로그인 후 그래프가 표시됩니다."
              ) : !isConnected ? (
                "계정 연결 후 그래프가 표시됩니다."
              ) : chartData.length === 0 && (postsError || insightsError) ? (
                postsError || insightsError
              ) : chartData.length === 0 ? (
                "표시할 게시글 데이터가 없습니다."
              ) : (
                <div className="flex h-full w-full items-end gap-2 px-2 py-3">
                  {chartData.map((point) => {
                    const heightPct = Math.max(6, Math.round((point.value / chartMax) * 100));
                    return (
                      <div key={point.id} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                        <div
                          className="w-full rounded-xl bg-pink-200"
                          style={{ height: `${heightPct}%` }}
                          title={point.title}
                        />
                        <div className="text-[10px] font-bold text-slate-400">{point.label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-pink-50 flex items-center justify-center">
                <Rocket className="w-5 h-5 text-pink-600" />
              </div>
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">준비 단계</p>
                <p className="text-lg font-black text-slate-900">분석 페이지 연결 절차</p>
              </div>
            </div>
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div key={step.title} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center">
                    {idx + 1}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">{step.title}</p>
                    <p className="text-xs font-bold text-slate-400">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Link2 className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">연결 준비</p>
                <p className="text-lg font-black text-slate-900">필수 체크리스트</p>
              </div>
            </div>
            <ul className="text-xs font-bold text-slate-500 space-y-2">
              {[
                "인스타그램 비즈니스/크리에이터 계정",
                "Instagram Graph API 권한 승인",
                "발행 완료 이벤트 저장",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className={cn("w-1.5 h-1.5 rounded-full bg-pink-500")}></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">게시글별 성과</p>
            <p className="text-lg font-black text-slate-900">
              {postsLoading ? "게시글을 불러오는 중..." : rankedPosts.length > 0 ? `상위 게시글 ${rankedPosts.length}건` : "표시할 게시글이 없습니다"}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-400">참여(좋아요+댓글) 기준으로 정렬됩니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void Promise.all([fetchPosts(), fetchInsights()])}
              disabled={!user || !isConnected || postsLoading || insightsLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", (postsLoading || insightsLoading) && "animate-spin")} />
              새로고침
            </button>
            <TrendingUp className="w-5 h-5 text-slate-400" />
          </div>
        </div>

        {!user && (
          <div className="h-40 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-sm font-bold text-slate-400">
            로그인 후 게시글 성과를 확인할 수 있습니다.
          </div>
        )}

        {user && !isConnected && (
          <div className="h-40 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-sm font-bold text-slate-400">
            계정을 연결하면 게시글 리스트가 표시됩니다.
          </div>
        )}

        {user && isConnected && postsError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {postsError}
          </div>
        )}

        {user && isConnected && !postsLoading && !postsError && rankedPosts.length === 0 && (
          <div className="h-40 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-sm font-bold text-slate-400">
            불러온 게시글이 없습니다.
          </div>
        )}

        {user && isConnected && rankedPosts.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="divide-y divide-slate-100">
              {rankedPosts.map((post) => {
                const engagement = (post.likeCount ?? 0) + (post.commentCount ?? 0);
                const caption = truncateCaption(post.caption);
                return (
                  <div key={post.id} className="flex items-start justify-between gap-4 bg-white px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                        {post.previewUrl ? (
                          <img src={post.previewUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-900">{caption || "캡션 없음"}</div>
                        <div className="mt-1 text-xs font-bold text-slate-400">
                          {formatDateTime(post.timestamp)} · {post.id}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-xs font-black text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-4 w-4 text-rose-500" />
                        {(post.likeCount ?? 0).toLocaleString("ko-KR")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-4 w-4 text-slate-500" />
                        {(post.commentCount ?? 0).toLocaleString("ko-KR")}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-700">
                        참여 {engagement.toLocaleString("ko-KR")}
                      </span>
                      {post.permalink && (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          aria-label="게시물 열기"
                          title="게시물 열기"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isConnectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setIsConnectOpen(false)}
          />
          <div className="relative w-full max-w-5xl bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">계정 연결 흐름</p>
                <h2 className="text-xl font-black text-slate-900 mt-1">인스타그램 계정 연결</h2>
              </div>
              <button
                onClick={() => setIsConnectOpen(false)}
                className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-8">
              <div className="space-y-4">
                {connectFlow.map((step, idx) => {
                  const isActive = idx === activeStep;
                  return (
                    <button
                      key={step.title}
                      onClick={() => setActiveStep(idx)}
                      className={cn(
                        "w-full text-left p-4 rounded-2xl border transition-all",
                        isActive
                          ? "border-pink-500 bg-pink-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full text-xs font-black flex items-center justify-center",
                            isActive ? "bg-pink-600 text-white" : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">{step.title}</p>
                          <p className="text-xs font-bold text-slate-400">{step.desc}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">단계 상세</p>
                  <p className="text-lg font-black text-slate-900 mt-2">
                    {connectFlow[activeStep].detailTitle}
                  </p>
                  <p className="text-sm font-bold text-slate-500 mt-2 leading-relaxed">
                    {connectFlow[activeStep].detailDesc}
                  </p>
                  {modalMessage && (
                    <div className="mt-4 text-xs font-bold text-rose-500">{modalMessage}</div>
                  )}

                  {activeStep === 0 && (
                    <div className="mt-6 space-y-3">
                      {[
                        "필요 권한: instagram_business_basic",
                        "필요 권한: instagram_business_manage_insights",
                        "필요 권한: instagram_business_content_publish",
                      ].map((item) => (
                        <div key={item} className="text-xs font-bold text-slate-500 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                          {item}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeStep === 1 && (
                    <div className="mt-6 space-y-3">
                      {pagesLoading && (
                        <div className="text-xs font-bold text-slate-400">계정 정보를 불러오는 중...</div>
                      )}
                      {pagesError && (
                        <div className="text-xs font-bold text-rose-500">{pagesError}</div>
                      )}
                      {!pagesLoading && !pagesError && pages.length === 0 && (
                        <div className="text-xs font-bold text-slate-400">
                          연결 가능한 계정이 없습니다.
                        </div>
                      )}
                      {!pagesLoading && pages.length > 0 && (
                        <div className="space-y-2">
                          {pages.map((page) => (
                            <button
                              key={page.id}
                              onClick={() => setSelectedPageId(page.id)}
                              className={cn(
                                "w-full text-left px-4 py-3 rounded-xl border text-xs font-black transition-all",
                                selectedPageId === page.id
                                  ? "border-pink-500 bg-white"
                                  : "border-slate-200 bg-slate-50 hover:border-slate-300"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-slate-800">{page.name}</span>
                                <span className="text-[10px] font-black text-slate-400">
                                  {page.igUsername ? `@${page.igUsername}` : page.igUserId ? "IG 연결됨" : "IG 없음"}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeStep === 2 && (
                    <div className="mt-6 space-y-3 text-xs font-bold text-slate-500">
                      <div>연결이 완료되었습니다.</div>
                      {selectionInfo ? (
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <p className="text-xs font-black text-slate-500">연결된 계정</p>
                          <p className="text-sm font-black text-slate-900 mt-1">
                            {selectionInfo.igUsername ? `@${selectionInfo.igUsername}` : selectionInfo.igUserId}
                          </p>
                          <p className="text-xs font-bold text-slate-400 mt-1">
                            {selectionInfo.pageName}
                          </p>
                        </div>
                      ) : (
                        <div>이제 게시글 발행과 인사이트 수집을 진행할 수 있습니다.</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-8 flex items-center justify-between gap-3">
                  <button
                    onClick={handlePrevStep}
                    disabled={activeStep === 0}
                    className="px-4 py-2 rounded-xl text-xs font-black border border-slate-200 text-slate-500 disabled:opacity-40"
                  >
                    이전 단계
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleConnectAction}
                    disabled={activeStep === 1 && (!selectedPageId || savingSelection)}
                    className="px-4 py-2 rounded-xl text-xs font-black text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingSelection ? "저장 중..." : connectFlow[activeStep].actionLabel}
                  </button>
                  <button
                    onClick={handleNextStep}
                    disabled={activeStep === connectFlow.length - 1 || (activeStep === 1 && !selectionInfo)}
                    className="px-4 py-2 rounded-xl text-xs font-black text-white bg-pink-600 hover:bg-pink-700 disabled:bg-pink-300"
                  >
                    다음 단계
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
