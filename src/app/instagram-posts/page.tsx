"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Heart,
  Images,
  Link2,
  MessageCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { META_OAUTH_RESULT_STORAGE_KEY, readStoredMetaOauthResult } from "@/lib/meta-oauth-client";
import { META_ACTIVE_ACCOUNT_CHANGED_EVENT, dispatchMetaActiveAccountChanged } from "@/lib/meta-account-client";
import { cn } from "@/lib/utils";

type InstagramPost = {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentCount: number | null;
};

type AccountInfo = {
  flow: "facebook" | "instagram";
  pageName: string | null;
  igUserId: string | null;
  igUsername: string | null;
};

type PostsResponse = {
  account: AccountInfo;
  posts: InstagramPost[];
  nextCursor: string | null;
};

type PageInfo = {
  id: string;
  name: string;
  igUserId?: string | null;
  igUsername?: string | null;
};

type SelectionInfo = {
  pageId: string;
  pageName: string;
  igUserId: string;
  igUsername?: string | null;
  selectedAt?: string | null;
};

const connectFlow = [
  {
    title: "Instagram 로그인",
    desc: "Meta 권한 승인",
    detailTitle: "Instagram 로그인",
    detailDesc: "Instagram 계정으로 로그인하고 권한을 승인합니다.",
    actionLabel: "Instagram 로그인 시작",
  },
  {
    title: "계정 선택",
    desc: "연결 계정 저장",
    detailTitle: "연결 계정 선택",
    detailDesc: "조회할 인스타 계정을 선택하고 저장합니다.",
    actionLabel: "선택 저장",
  },
  {
    title: "완료",
    desc: "연결 완료",
    detailTitle: "연결 완료",
    detailDesc: "계정 연결이 완료되었습니다. 게시물을 조회할 수 있습니다.",
    actionLabel: "닫기",
  },
];

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

const truncateCaption = (value: string, max = 140) => {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
};

const parseErrorMessage = (data: unknown, fallback: string) => {
  if (typeof data === "object" && data && "error" in data) {
    const errorValue = (data as { error?: unknown }).error;
    if (typeof errorValue === "string" && errorValue) {
      return errorValue;
    }
  }
  return fallback;
};

const isConnectionError = (message: string, status: number) => {
  if (status !== 400) return false;
  const value = message.toLowerCase();
  return value.includes("not connected") || value.includes("no instagram account selected");
};

export default function InstagramPostsPage() {
  const { user, loading: authLoading } = useAuth();

  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);

  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);
  const [modalMessage, setModalMessage] = useState<string | null>(null);

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!user) {
      setIsConnected(false);
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/oauth/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setIsConnected(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { connected?: boolean };
      setIsConnected(Boolean(data.connected));
    } catch {
      setIsConnected(false);
    }
  }, [user]);

  const fetchPages = useCallback(async () => {
    if (!user) return;
    setPagesLoading(true);
    setPagesError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/pages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { pages?: PageInfo[]; error?: string };
      if (!res.ok) {
        setPagesError(data.error || "계정 정보를 불러오지 못했습니다.");
        return;
      }
      setPages(Array.isArray(data.pages) ? data.pages : []);
    } catch {
      setPagesError("계정 정보를 불러오지 못했습니다.");
    } finally {
      setPagesLoading(false);
    }
  }, [user]);

  const fetchSelection = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/selection", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { selected?: SelectionInfo | null };
      if (data.selected) {
        setSelectionInfo(data.selected);
        setSelectedPageId(data.selected.pageId);
      } else {
        setSelectionInfo(null);
      }
    } catch {
      // ignore
    }
  }, [user]);

  const fetchPosts = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/posts?limit=18", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as Partial<PostsResponse> & { error?: string };
      if (!res.ok) {
        const message = parseErrorMessage(data, "게시물 정보를 불러오지 못했습니다.");
        setError(message);
        setPosts([]);
        setNeedsConnection(isConnectionError(message, res.status));
        return;
      }
      setPosts(Array.isArray(data.posts) ? data.posts : []);
      setAccount(data.account ?? null);
      setNeedsConnection(false);
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      setError("게시물 정보를 불러오지 못했습니다.");
      setPosts([]);
      setNeedsConnection(false);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setPosts([]);
      setAccount(null);
      setError(null);
      setNeedsConnection(false);
      setIsConnected(false);
      setSelectionInfo(null);
      setSelectedPageId(null);
      return;
    }
    fetchStatus();
    fetchSelection();
    fetchPosts();
  }, [authLoading, user, fetchStatus, fetchSelection, fetchPosts]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setConnectMessage("계정 연결이 완료되었습니다.");
      setIsConnected(true);
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
  }, []);

  useEffect(() => {
    const applyOauthResult = (data: {
      type?: string;
      success?: boolean;
      error?: string | null;
      errorDescription?: string | null;
    }) => {
      if (data?.type !== "meta_oauth") return;
      if (data.success) {
        setConnectMessage("계정 연결이 완료되었습니다.");
        setModalMessage(null);
        setIsConnected(true);
        setActiveStep(1);
        fetchStatus();
        fetchPages();
        fetchSelection();
        return;
      }

      const detail = [data.error, data.errorDescription].filter(Boolean).join(" - ");
      setConnectMessage(detail ? `계정 연결 실패: ${detail}` : "계정 연결에 실패했습니다. 다시 시도해주세요.");
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
  }, [fetchPages, fetchSelection, fetchStatus]);

  useEffect(() => {
    if (!isConnectOpen || !user) return;
    if (isConnected) {
      setActiveStep(selectionInfo ? 2 : 1);
      fetchPages();
      fetchSelection();
      return;
    }
    setActiveStep(0);
  }, [isConnectOpen, isConnected, selectionInfo, fetchPages, fetchSelection, user]);

  useEffect(() => {
    const handleActiveAccountChanged = () => {
      if (!user) return;
      void Promise.all([fetchStatus(), fetchSelection(), fetchPosts()]);
    };

    window.addEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, [fetchPosts, fetchSelection, fetchStatus, user]);

  const handleConnectAction = async () => {
    setModalMessage(null);
    if (!user) {
      window.location.href = "/login";
      return;
    }
    if (activeStep === 0) {
      let popup: Window | null = null;
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
          const errorMsg = [data.error, data.detail].filter(Boolean).join(" - ") || "로그인 토큰 검증에 실패했습니다.";
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
          return;
        }
        popup.location.href = oauthStartUrl.toString();
        return;
      } catch {
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
        const data = (await res.json().catch(() => ({}))) as { selected?: SelectionInfo; error?: string };
        if (!res.ok || !data.selected) {
          setConnectMessage(data.error || "계정 선택 저장에 실패했습니다.");
          return;
        }
        setSelectionInfo(data.selected);
        setSelectedPageId(data.selected.pageId);
        setIsConnected(true);
        setNeedsConnection(false);
        setConnectMessage("계정 연결이 완료되었습니다.");
        setActiveStep(2);
        dispatchMetaActiveAccountChanged({ accountId: data.selected.pageId });
        await fetchPosts();
      } catch {
        setConnectMessage("계정 선택 저장에 실패했습니다.");
      } finally {
        setSavingSelection(false);
      }
      return;
    }

    setIsConnectOpen(false);
  };

  const lastUpdatedLabel = useMemo(() => formatDateTime(lastUpdatedAt), [lastUpdatedAt]);

  return (
    <div className="max-w-[1400px] mx-auto min-h-screen pb-20">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Images className="w-6 h-6 text-pink-600" />
            인스타 게시물 조회
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1">
            연결된 인스타 계정의 최신 게시물을 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-4 py-2 rounded-xl text-xs font-black text-slate-700 border border-slate-200 bg-slate-50">
            계정 연결/전환은 사이드바에서 관리
          </div>
          <button
            onClick={fetchPosts}
            disabled={!user || isLoading}
            className="px-4 py-2 rounded-xl text-xs font-black text-white bg-pink-600 hover:bg-pink-700 disabled:bg-pink-300 transition-all inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>
      </header>

      <section className="bg-white rounded-[2rem] border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">연결 상태</p>
            <p className="text-base font-black text-slate-900 mt-1">{isConnected ? "연결됨" : "미연결"}</p>
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">연결 계정</p>
            <p className="text-base font-black text-slate-900 mt-1">
              {selectionInfo?.igUsername
                ? `@${selectionInfo.igUsername}`
                : account?.igUsername
                  ? `@${account.igUsername}`
                  : selectionInfo?.igUserId || account?.igUserId || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">페이지</p>
            <p className="text-base font-black text-slate-900 mt-1">
              {selectionInfo?.pageName || account?.pageName || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">마지막 조회</p>
            <p className="text-base font-black text-slate-900 mt-1">{lastUpdatedLabel}</p>
          </div>
        </div>
        {connectMessage && (
          <p className="mt-4 text-xs font-bold text-pink-600">{connectMessage}</p>
        )}
      </section>

      {authLoading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-400">
          로그인 상태를 확인 중입니다...
        </div>
      )}

      {!authLoading && !user && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-bold text-amber-700">
          게시물을 조회하려면 먼저 로그인해주세요.
        </div>
      )}

      {!authLoading && user && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-bold text-rose-700">{error}</p>
          {needsConnection && (
            <div className="mt-3 text-xs font-black text-slate-600">
              사이드바의 연결 계정에서 인스타그램을 연결한 뒤 다시 조회해 주세요.
            </div>
          )}
        </div>
      )}

      {!authLoading && user && !error && !isLoading && posts.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-400 text-center">
          조회된 게시물이 없습니다.
        </div>
      )}

      {isLoading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-400 text-center">
          게시물을 불러오는 중입니다...
        </div>
      )}

      {!isLoading && posts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {posts.map((post) => (
            <article key={post.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="aspect-square bg-slate-100">
                {post.previewUrl ? (
                  <div
                    className="w-full h-full bg-center bg-cover"
                    style={{ backgroundImage: `url(${post.previewUrl})` }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-bold">
                    미리보기 없음
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                    {post.mediaType || "MEDIA"}
                  </span>
                  <span className="text-xs font-bold text-slate-400">{formatDateTime(post.timestamp)}</span>
                </div>

                <p className="text-sm font-semibold text-slate-800 leading-relaxed min-h-[56px]">
                  {truncateCaption(post.caption) || "캡션 없음"}
                </p>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs font-black text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5" />
                      {post.likeCount ?? "-"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="w-3.5 h-3.5" />
                      {post.commentCount ?? "-"}
                    </span>
                  </div>
                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-black text-pink-600 hover:text-pink-700"
                    >
                      원문
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="text-xs font-bold text-slate-300">링크 없음</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

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
                  <p className="text-lg font-black text-slate-900 mt-2">{connectFlow[activeStep].detailTitle}</p>
                  <p className="text-sm font-bold text-slate-500 mt-2 leading-relaxed">{connectFlow[activeStep].detailDesc}</p>

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
                        <div className="text-xs font-bold text-slate-400">연결 가능한 계정이 없습니다.</div>
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
                          <p className="text-xs font-bold text-slate-400 mt-1">{selectionInfo.pageName}</p>
                        </div>
                      ) : (
                        <div>게시물 조회를 시작할 수 있습니다.</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-8 flex items-center justify-between gap-3">
                  <button
                    onClick={() => setActiveStep((prev) => Math.max(prev - 1, 0))}
                    disabled={activeStep === 0}
                    className="px-4 py-2 rounded-xl text-xs font-black border border-slate-200 text-slate-500 disabled:opacity-40"
                  >
                    이전 단계
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleConnectAction}
                    disabled={activeStep === 1 && (!selectedPageId || savingSelection)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-black border transition-all",
                      activeStep === 2
                        ? "text-white bg-pink-600 border-pink-600 hover:bg-pink-700"
                        : "text-slate-700 border-slate-200 bg-white hover:bg-slate-50",
                      activeStep === 1 && (!selectedPageId || savingSelection) ? "opacity-50 cursor-not-allowed" : ""
                    )}
                  >
                    {savingSelection ? "저장 중..." : connectFlow[activeStep].actionLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed right-10 bottom-8 z-40 px-4 py-3 rounded-full text-xs font-black text-white bg-slate-900 shadow-lg inline-flex items-center gap-2">
        <Link2 className="w-4 h-4" />
        사이드바에서 계정 연결
      </div>
    </div>
  );
}
