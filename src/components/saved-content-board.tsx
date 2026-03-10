"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

type CardnewsStatusFilter = "all" | "draft" | "published";

type CardnewsSummary = {
  id: string;
  status: "draft" | "published";
  title: string;
  slideCount: number;
  imageUrl: string | null;
  sourceLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
};

type CardnewsListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type CardnewsListResponse = {
  items?: CardnewsSummary[];
  pagination?: Partial<CardnewsListPagination>;
  error?: string;
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

const statusTone = (status: CardnewsSummary["status"]) => {
  return status === "published"
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";
};

const statusLabel = (status: CardnewsSummary["status"]) => (status === "published" ? "발행됨" : "초안");

export function SavedContentBoard({
  title = "저장된 콘텐츠",
  pageSize = 10,
  className,
  selectedItemId = null,
  onSelectItem,
}: {
  title?: string;
  pageSize?: number;
  className?: string;
  selectedItemId?: string | null;
  onSelectItem?: (item: CardnewsSummary) => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<CardnewsSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CardnewsStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchItems = useCallback(async (options?: { page?: number; status?: CardnewsStatusFilter }) => {
    if (!user) return;

    const requestPage = Math.max(1, options?.page ?? page);
    const requestStatus = options?.status ?? status;

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const url = new URL(`${window.location.origin}/api/cardnews/list`);
      url.searchParams.set("page", String(requestPage));
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("status", requestStatus);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as CardnewsListResponse;
      if (!res.ok) {
        setError(data.error || "저장된 콘텐츠를 불러오지 못했습니다.");
        setItems([]);
        return;
      }

      const nextItems = Array.isArray(data.items) ? data.items : [];
      const nextPage = typeof data.pagination?.page === "number" && Number.isFinite(data.pagination.page)
        ? Math.max(1, data.pagination.page)
        : requestPage;
      const nextTotal = typeof data.pagination?.total === "number" && Number.isFinite(data.pagination.total)
        ? Math.max(0, data.pagination.total)
        : nextItems.length;
      const nextTotalPages = typeof data.pagination?.totalPages === "number" && Number.isFinite(data.pagination.totalPages)
        ? Math.max(1, data.pagination.totalPages)
        : 1;

      setItems(nextItems);
      setPage(nextPage);
      setTotalItems(nextTotal);
      setTotalPages(nextTotalPages);
    } catch {
      setError("저장된 콘텐츠를 불러오지 못했습니다.");
      setItems([]);
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  }, [page, pageSize, status, user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setError(null);
      setPage(1);
      setTotalItems(0);
      setTotalPages(1);
      setHasFetched(false);
      return;
    }
    if (hasFetched || loading) return;
    void fetchItems({ page: 1, status });
  }, [fetchItems, hasFetched, loading, status, user]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => {
      const haystack = `${item.title} ${item.sourceLabel || ""}`.toLowerCase();
      return haystack.includes(normalizedQuery) || item.id.toLowerCase().includes(normalizedQuery);
    });
  }, [items, query]);

  const isReady = Boolean(user);

  return (
    <section className={cn("rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Saved Contents</div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{title}</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">AI로 생성한 카드뉴스 초안과 발행 내역을 확인합니다.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "draft", "published"] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setStatus(value);
                setPage(1);
                void fetchItems({ page: 1, status: value });
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-black transition-all",
                status === value
                  ? "border-pink-600 bg-pink-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {value === "all" ? "전체" : value === "draft" ? "초안" : "발행됨"}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="현재 페이지 검색..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-xs font-bold text-slate-700 outline-none transition-all focus:border-pink-300"
          />
        </div>
      </div>

      {!isReady && (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
          로그인 후 저장된 콘텐츠를 확인할 수 있습니다.
        </div>
      )}

      {isReady && error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {isReady && hasFetched && !loading && !error && items.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
          표시할 콘텐츠가 없습니다.
        </div>
      )}

      {isReady && visibleItems.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <div className="grid grid-cols-[minmax(0,1fr)_92px_120px_90px_96px] gap-0 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
            <div>제목</div>
            <div className="text-center">상태</div>
            <div className="text-center">업데이트</div>
            <div className="text-center">슬라이드</div>
            <div className="text-center">선택</div>
          </div>
          <div className="divide-y divide-slate-100 bg-white">
            {visibleItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_92px_120px_90px_96px] items-center gap-0 px-5 py-4",
                  selectedItemId === item.id && "bg-pink-50/60",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-900">{item.title}</div>
                  <div className="mt-1 truncate text-xs font-bold text-slate-400">{item.id}</div>
                </div>
                <div className="text-center">
                  <span className={cn("inline-flex rounded-full px-3 py-1 text-[10px] font-black", statusTone(item.status))}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="text-center text-xs font-bold text-slate-500">
                  {formatDateTime(item.updatedAt)}
                </div>
                <div className="text-center text-xs font-black text-slate-700">{item.slideCount}</div>
                <div className="text-center">
                  <button
                    onClick={() => onSelectItem?.(item)}
                    disabled={!onSelectItem}
                    className={cn(
                      "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-[11px] font-black transition-all",
                      selectedItemId === item.id
                        ? "border-pink-200 bg-pink-100 text-pink-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      !onSelectItem && "cursor-default opacity-60",
                    )}
                  >
                    {selectedItemId === item.id ? "선택됨" : "선택"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isReady && hasFetched && !error && totalItems > 0 && (
        <div className="mt-5 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-400">
            총 {totalItems.toLocaleString("ko-KR")}개 · {page}/{totalPages} 페이지
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const nextPage = Math.max(1, page - 1);
                setPage(nextPage);
                void fetchItems({ page: nextPage });
              }}
              disabled={page <= 1}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              이전
            </button>
            <button
              onClick={() => {
                const nextPage = Math.min(totalPages, page + 1);
                setPage(nextPage);
                void fetchItems({ page: nextPage });
              }}
              disabled={page >= totalPages}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
