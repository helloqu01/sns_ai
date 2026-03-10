"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, LayoutTemplate, Pencil, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CarouselPreview, type Slide as CarouselSlide } from "@/components/carousel-preview";
import { cn } from "@/lib/utils";

type CardnewsStatusFilter = "all" | "draft" | "published";
type CardnewsStatus = "draft" | "published";

type CardnewsSummary = {
  id: string;
  status: CardnewsStatus;
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

type CardnewsSlide = {
  title: string;
  body: string;
  keywords?: string;
  renderedImageUrl?: string | null;
};

type CardnewsDetail = {
  id: string;
  status: CardnewsStatus;
  title: string;
  customTitle: string | null;
  slideCount: number;
  imageUrl: string | null;
  previewImageUrl: string | null;
  sourceLabel: string | null;
  source: string | null;
  content: string | null;
  style: string | null;
  target: string | null;
  genre: string | null;
  aspectRatio: string | null;
  tone: string | null;
  captionStyle: string | null;
  caption: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  slides: CardnewsSlide[];
};

type CardnewsItemResponse = {
  item?: CardnewsDetail;
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

const statusLabel = (status: CardnewsStatus) => (status === "published" ? "발행됨" : "초안");

const statusTone = (status: CardnewsStatus) => {
  return status === "published"
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";
};

const cloneDetail = (item: CardnewsDetail): CardnewsDetail => ({
  ...item,
  slides: item.slides.map((slide) => ({ ...slide })),
});

export default function GalleryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<CardnewsSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CardnewsStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasFetched, setHasFetched] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CardnewsDetail | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draftDetail, setDraftDetail] = useState<CardnewsDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchList = useCallback(async (options: { page: number; status: CardnewsStatusFilter }) => {
    if (!user) return;

    const nextPage = Math.max(1, options.page);
    const nextStatus = options.status;
    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const url = new URL(`${window.location.origin}/api/cardnews/list`);
      url.searchParams.set("page", String(nextPage));
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("status", nextStatus);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as CardnewsListResponse;
      if (!res.ok) {
        setError(data.error || "카드뉴스 목록을 불러오지 못했습니다.");
        setItems([]);
        return;
      }

      const nextItems = Array.isArray(data.items) ? data.items : [];
      const resolvedPage = typeof data.pagination?.page === "number" ? Math.max(1, data.pagination.page) : nextPage;
      const resolvedTotal = typeof data.pagination?.total === "number" ? Math.max(0, data.pagination.total) : nextItems.length;
      const resolvedTotalPages = typeof data.pagination?.totalPages === "number"
        ? Math.max(1, data.pagination.totalPages)
        : 1;

      setItems(nextItems);
      setPage(resolvedPage);
      setTotalItems(resolvedTotal);
      setTotalPages(resolvedTotalPages);
      setHasFetched(true);
    } catch {
      setItems([]);
      setError("카드뉴스 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [pageSize, user]);

  const openDetail = useCallback(async (id: string) => {
    if (!user) return;

    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setEditMode(false);

    try {
      const token = await user.getIdToken();
      const url = new URL(`${window.location.origin}/api/cardnews/item`);
      url.searchParams.set("id", id);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as CardnewsItemResponse;
      if (!res.ok || !data.item) {
        setDetail(null);
        setDraftDetail(null);
        setDetailError(data.error || "상세 정보를 불러오지 못했습니다.");
        return;
      }
      setDetail(data.item);
      setDraftDetail(cloneDetail(data.item));
    } catch {
      setDetail(null);
      setDraftDetail(null);
      setDetailError("상세 정보를 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }, [user]);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setDraftDetail(null);
    setDetailError(null);
    setEditMode(false);
    setSaving(false);
    setDeleting(false);
  }, []);

  const updateDraftField = useCallback((key: keyof CardnewsDetail, value: string) => {
    setDraftDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
  }, []);

  const updateSlideField = useCallback((index: number, key: keyof CardnewsSlide, value: string) => {
    setDraftDetail((prev) => {
      if (!prev) return prev;
      const nextSlides = [...prev.slides];
      const target = nextSlides[index];
      if (!target) return prev;
      nextSlides[index] = { ...target, [key]: value };
      return { ...prev, slides: nextSlides };
    });
  }, []);

  const saveDetail = useCallback(async () => {
    if (!user || !selectedId || !draftDetail) return;

    setSaving(true);
    setDetailError(null);
    try {
      const token = await user.getIdToken();
      const url = new URL(`${window.location.origin}/api/cardnews/item`);
      url.searchParams.set("id", selectedId);
      const res = await fetch(url.toString(), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: draftDetail.status,
          customTitle: draftDetail.customTitle,
          sourceLabel: draftDetail.sourceLabel,
          imageUrl: draftDetail.imageUrl,
          source: draftDetail.source,
          content: draftDetail.content,
          style: draftDetail.style,
          target: draftDetail.target,
          genre: draftDetail.genre,
          aspectRatio: draftDetail.aspectRatio,
          tone: draftDetail.tone,
          captionStyle: draftDetail.captionStyle,
          caption: draftDetail.caption,
          slides: draftDetail.slides,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CardnewsItemResponse & { ok?: boolean };
      if (!res.ok || !data.item) {
        setDetailError(data.error || "저장에 실패했습니다.");
        return;
      }

      setDetail(data.item);
      setDraftDetail(cloneDetail(data.item));
      setItems((prev) =>
        prev.map((row) =>
          row.id === data.item?.id
            ? {
              ...row,
              status: data.item.status,
              title: data.item.title,
              sourceLabel: data.item.sourceLabel,
              imageUrl: data.item.previewImageUrl || data.item.imageUrl,
              slideCount: data.item.slideCount,
              updatedAt: data.item.updatedAt,
              publishedAt: data.item.publishedAt,
            }
            : row,
        ),
      );
      setEditMode(false);
    } catch {
      setDetailError("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [draftDetail, selectedId, user]);

  const deleteDetail = useCallback(async () => {
    if (!user || !selectedId) return;
    const confirmed = window.confirm("이 카드뉴스를 삭제할까요? 삭제 후 복구할 수 없습니다.");
    if (!confirmed) return;

    setDeleting(true);
    setDetailError(null);
    try {
      const token = await user.getIdToken();
      const url = new URL(`${window.location.origin}/api/cardnews/item`);
      url.searchParams.set("id", selectedId);
      const res = await fetch(url.toString(), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDetailError(data.error || "삭제에 실패했습니다.");
        return;
      }

      closeDetail();
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchList({ page: nextPage, status });
    } catch {
      setDetailError("삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }, [closeDetail, fetchList, items.length, page, selectedId, status, user]);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const haystack = `${item.title} ${item.sourceLabel || ""} ${item.id}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [items, query]);

  const previewSlides = useMemo<CarouselSlide[]>(() => {
    if (!draftDetail) return [];
    return draftDetail.slides.map((slide, index) => ({
      id: `${draftDetail.id}-${index + 1}`,
      title: slide.title?.trim() || `슬라이드 ${index + 1}`,
      body: slide.body || "",
      image: index === 0 ? (draftDetail.imageUrl || undefined) : undefined,
    }));
  }, [draftDetail]);

  const previewCaption = useMemo(() => {
    if (!draftDetail) return "";
    if (typeof draftDetail.caption === "string" && draftDetail.caption.trim().length > 0) {
      return draftDetail.caption;
    }
    if (typeof draftDetail.content === "string") {
      return draftDetail.content;
    }
    return "";
  }, [draftDetail]);

  const isReady = Boolean(user);
  const modalOpen = Boolean(selectedId);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setHasFetched(false);
      setError(null);
      return;
    }
    setStatus("all");
    setPage(1);
    void fetchList({ page: 1, status: "all" });
  }, [fetchList, user]);

  return (
    <div className="mx-auto max-w-[1400px] min-h-screen pb-20">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-600">
            <LayoutTemplate className="h-4 w-4 text-pink-600" />
            Cardnews Gallery
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">카드뉴스 갤러리</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">
            생성된 카드뉴스를 게시판 형태로 관리하고, 상세보기에서 수정/저장/삭제할 수 있습니다.
          </p>
        </div>
        <button
          onClick={() => void fetchList({ page, status })}
          disabled={!isReady || loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          새로고침
        </button>
      </header>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "draft", "published"] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                  void fetchList({ page: 1, status: value });
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
            로그인 후 카드뉴스 갤러리를 확인할 수 있습니다.
          </div>
        )}

        {isReady && !hasFetched && !loading && !error && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
            새로고침을 눌러 생성된 카드뉴스를 불러오세요.
          </div>
        )}

        {isReady && error && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        {isReady && hasFetched && !loading && !error && items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
            표시할 카드뉴스가 없습니다.
          </div>
        )}

        {isReady && visibleItems.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
            <div className="grid grid-cols-[minmax(0,1fr)_92px_140px_90px_110px] gap-0 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
              <div>제목</div>
              <div className="text-center">상태</div>
              <div className="text-center">업데이트</div>
              <div className="text-center">슬라이드</div>
              <div className="text-center">상세보기</div>
            </div>
            <div className="divide-y divide-slate-100 bg-white">
              {visibleItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_92px_140px_90px_110px] items-center gap-0 px-5 py-4">
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
                      onClick={() => void openDetail(item.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      상세
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
                  void fetchList({ page: nextPage, status });
                }}
                disabled={page <= 1 || loading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                이전
              </button>
              <button
                onClick={() => {
                  const nextPage = Math.min(totalPages, page + 1);
                  setPage(nextPage);
                  void fetchList({ page: nextPage, status });
                }}
                disabled={page >= totalPages || loading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-8">
          <div className="absolute inset-0 bg-slate-900/45" onClick={closeDetail} />
          <div className="relative z-10 flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">상세 보기</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">
                  {detail?.title || draftDetail?.title || "카드뉴스"}
                </h2>
              </div>
              <button
                onClick={closeDetail}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading && (
                <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">
                  상세 정보를 불러오는 중...
                </div>
              )}

              {!detailLoading && detailError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                  {detailError}
                </div>
              )}

              {!detailLoading && !detailError && draftDetail && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 xl:sticky xl:top-0 xl:self-start">
                    <div className="mb-3">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">카드뉴스 미리보기</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {editMode ? "수정 중 변경사항이 실시간으로 반영됩니다." : "현재 저장된 카드뉴스 상태입니다."}
                      </p>
                    </div>
                    {previewSlides.length > 0 ? (
                      <div className="mx-auto w-full max-w-[300px]">
                        <CarouselPreview
                          slides={previewSlides}
                          aspectRatio={draftDetail.aspectRatio || "4:5"}
                          caption={previewCaption}
                        />
                      </div>
                    ) : (
                      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 text-sm font-bold text-slate-400">
                        미리보기할 슬라이드가 없습니다.
                      </div>
                    )}
                  </section>

                  <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">상태</p>
                      {editMode ? (
                        <select
                          value={draftDetail.status}
                          onChange={(event) => {
                            setDraftDetail((prev) => (prev ? { ...prev, status: event.target.value as CardnewsStatus } : prev));
                          }}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-pink-300"
                        >
                          <option value="draft">초안</option>
                          <option value="published">발행됨</option>
                        </select>
                      ) : (
                        <p className="mt-2 text-sm font-black text-slate-800">{statusLabel(draftDetail.status)}</p>
                      )}
                      <p className="mt-3 text-[11px] font-bold text-slate-400">생성: {formatDateTime(draftDetail.createdAt)}</p>
                      <p className="text-[11px] font-bold text-slate-400">업데이트: {formatDateTime(draftDetail.updatedAt)}</p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4 lg:col-span-2">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">기본 정보</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">제목</label>
                          <input
                            value={draftDetail.customTitle ?? ""}
                            onChange={(event) => updateDraftField("customTitle", event.target.value)}
                            disabled={!editMode}
                            placeholder="커스텀 제목 입력"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">출처 라벨</label>
                          <input
                            value={draftDetail.sourceLabel ?? ""}
                            onChange={(event) => updateDraftField("sourceLabel", event.target.value)}
                            disabled={!editMode}
                            placeholder="예: KOPIS"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">대표 이미지 URL</label>
                          <input
                            value={draftDetail.imageUrl ?? ""}
                            onChange={(event) => updateDraftField("imageUrl", event.target.value)}
                            disabled={!editMode}
                            placeholder="https://..."
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">원문 콘텐츠</p>
                    <textarea
                      value={draftDetail.content ?? ""}
                      onChange={(event) => updateDraftField("content", event.target.value)}
                      disabled={!editMode}
                      rows={4}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">캡션</p>
                    <textarea
                      value={draftDetail.caption ?? ""}
                      onChange={(event) => updateDraftField("caption", event.target.value)}
                      disabled={!editMode}
                      rows={4}
                      placeholder="인스타그램 캡션을 입력하세요."
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                    />
                  </div>

                  {draftDetail.imageUrl && (
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                      <img src={draftDetail.imageUrl} alt="" className="h-52 w-full object-cover" />
                    </div>
                  )}

                  <div className="space-y-4">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                      슬라이드 ({draftDetail.slides.length})
                    </p>
                    {draftDetail.slides.map((slide, index) => (
                      <div key={`${draftDetail.id}-slide-${index}`} className="rounded-2xl border border-slate-200 p-4">
                        <p className="text-xs font-black text-slate-500">슬라이드 {index + 1}</p>
                        <div className="mt-2 grid grid-cols-1 gap-3">
                          <div>
                            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">제목</label>
                            <input
                              value={slide.title}
                              onChange={(event) => updateSlideField(index, "title", event.target.value)}
                              disabled={!editMode}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">본문</label>
                            <textarea
                              value={slide.body}
                              onChange={(event) => updateSlideField(index, "body", event.target.value)}
                              disabled={!editMode}
                              rows={3}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400">키워드</label>
                            <input
                              value={slide.keywords ?? ""}
                              onChange={(event) => updateSlideField(index, "keywords", event.target.value)}
                              disabled={!editMode}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-pink-300 disabled:bg-slate-50"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <div className="text-xs font-bold text-slate-400">{selectedId}</div>
              <div className="flex items-center gap-2">
                {!editMode && (
                  <button
                    onClick={() => setEditMode(true)}
                    disabled={detailLoading || Boolean(detailError) || !draftDetail}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" />
                    수정
                  </button>
                )}
                {editMode && (
                  <button
                    onClick={() => {
                      if (!detail) return;
                      setDraftDetail(cloneDetail(detail));
                      setEditMode(false);
                    }}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    취소
                  </button>
                )}
                {editMode && (
                  <button
                    onClick={() => void saveDetail()}
                    disabled={saving || deleting || !draftDetail}
                    className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-xs font-black text-white hover:bg-pink-700 disabled:opacity-50"
                  >
                    <Save className={cn("h-4 w-4", saving && "animate-pulse")} />
                    저장
                  </button>
                )}
                <button
                  onClick={() => void deleteDetail()}
                  disabled={deleting || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className={cn("h-4 w-4", deleting && "animate-pulse")} />
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
