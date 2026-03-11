"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { META_ACTIVE_ACCOUNT_CHANGED_EVENT } from "@/lib/meta-account-client";
import { cn } from "@/lib/utils";
import type { InstagramPublishingRecord } from "@/types/instagram-publishing";

type ViewMode = "month" | "week";
type SideTab = "scheduled" | "ops";

type PublishingResponse = {
  posts?: InstagramPublishingRecord[];
  error?: string;
};

const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const KST_TIMEZONE = "Asia/Seoul";
const KST_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;

const formatKoreanDate = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: KST_TIMEZONE, ...options }).format(date);

const getKSTDate = (date = new Date()) => {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const getKoreanMonthLabel = (date: Date) =>
  formatKoreanDate(date, { year: "numeric", month: "long" });

const getKoreanDateLabelWithYear = (date: Date) =>
  formatKoreanDate(date, { year: "numeric", month: "long", day: "numeric" });

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const addWeeks = (date: Date, weeks: number) => addDays(date, weeks * 7);

const getMondayIndex = (day: number) => (day + 6) % 7;
const getStartOfWeek = (date: Date) => addDays(date, -getMondayIndex(date.getDay()));
const getEndOfWeek = (date: Date) => addDays(date, 6 - getMondayIndex(date.getDay()));

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

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

const getDateKey = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getPrimaryDate = (post: InstagramPublishingRecord) =>
  post.scheduledFor || post.publishedAt || post.failedAt || post.createdAt;

const getKstMonthRange = (date: Date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    from: new Date(Date.UTC(year, month, 1) - KST_UTC_OFFSET_MS).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 1) - KST_UTC_OFFSET_MS).toISOString(),
  };
};

const getKstDayRange = (date: Date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    from: new Date(Date.UTC(year, month, day) - KST_UTC_OFFSET_MS).toISOString(),
    to: new Date(Date.UTC(year, month, day + 1) - KST_UTC_OFFSET_MS).toISOString(),
  };
};

const statusBadgeClass = (status: InstagramPublishingRecord["status"]) => {
  switch (status) {
    case "scheduled":
      return "bg-amber-50 text-amber-700";
    case "publishing":
      return "bg-sky-50 text-sky-700";
    case "published":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const statusLabel = (status: InstagramPublishingRecord["status"]) => {
  switch (status) {
    case "scheduled":
      return "예약";
    case "publishing":
      return "게시 중";
    case "published":
      return "게시 완료";
    case "failed":
      return "실패";
    default:
      return "대기";
  }
};

export default function SchedulePage() {
  const { user, loading: authLoading } = useAuth();

  const today = useMemo(() => getKSTDate(), []);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(() => getKSTDate());
  const [selectedDate, setSelectedDate] = useState<Date>(() => getKSTDate());
  const [activeTab, setActiveTab] = useState<SideTab>("scheduled");
  const [queue, setQueue] = useState<InstagramPublishingRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<InstagramPublishingRecord[]>([]);
  const [selectedPostsLoading, setSelectedPostsLoading] = useState(false);
  const [selectedPostsError, setSelectedPostsError] = useState<string | null>(null);
  const [selectedPostsFetched, setSelectedPostsFetched] = useState(false);
  const [cancelingPostId, setCancelingPostId] = useState<string | null>(null);

  const buildAuthHeaders = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (!user) return headers;
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }, [user]);

  const fetchQueue = useCallback(async (referenceDate: Date) => {
    if (!user) {
      setQueue([]);
      setQueueError(null);
      return;
    }
    setQueueLoading(true);
    setQueueError(null);
    try {
      const headers = await buildAuthHeaders();
      const monthRange = getKstMonthRange(referenceDate);
      const searchParams = new URLSearchParams({
        limit: "100",
        from: monthRange.from,
        to: monthRange.to,
      });
      const res = await fetch(`/api/meta/publishing?${searchParams.toString()}`, { headers });
      const data = (await res.json().catch(() => ({}))) as PublishingResponse;
      if (!res.ok) {
        setQueueError(data.error || "예약 데이터를 불러오지 못했습니다.");
        return;
      }
      setQueue(Array.isArray(data.posts) ? data.posts : []);
      setQueueError(null);
    } catch {
      setQueueError("예약 데이터를 불러오지 못했습니다.");
    } finally {
      setQueueLoading(false);
    }
  }, [buildAuthHeaders, user]);

  const fetchSelectedDatePosts = useCallback(async (date: Date) => {
    if (!user) {
      setSelectedPosts([]);
      setSelectedPostsError(null);
      setSelectedPostsFetched(false);
      return;
    }

    setSelectedPostsLoading(true);
    setSelectedPostsError(null);
    setSelectedPostsFetched(true);

    try {
      const headers = await buildAuthHeaders();
      const dayRange = getKstDayRange(date);
      const searchParams = new URLSearchParams({
        limit: "80",
        from: dayRange.from,
        to: dayRange.to,
      });
      const res = await fetch(`/api/meta/publishing?${searchParams.toString()}`, { headers });
      const data = (await res.json().catch(() => ({}))) as PublishingResponse;
      if (!res.ok) {
        setSelectedPosts([]);
        setSelectedPostsError(data.error || "선택한 날짜 데이터를 불러오지 못했습니다.");
        return;
      }
      setSelectedPosts(Array.isArray(data.posts) ? data.posts : []);
      setSelectedPostsError(null);
    } catch {
      setSelectedPosts([]);
      setSelectedPostsError("선택한 날짜 데이터를 불러오지 못했습니다.");
    } finally {
      setSelectedPostsLoading(false);
    }
  }, [buildAuthHeaders, user]);

  const dispatchScheduledPosts = useCallback(async (silent = true) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/publishing/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 1 }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!silent) {
          setQueueError(data.error || "예약 발행 실행에 실패했습니다.");
        }
      }
    } catch {
      if (!silent) {
        setQueueError("예약 발행 실행에 실패했습니다.");
      }
    }
  }, [user]);

  const cancelScheduledPost = useCallback(async (postId: string) => {
    if (!user) return;
    const confirmed = window.confirm("이 예약 항목을 취소할까요?");
    if (!confirmed) return;

    setCancelingPostId(postId);
    setQueueError(null);
    setSelectedPostsError(null);
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch(`/api/meta/publishing?id=${encodeURIComponent(postId)}`, {
        method: "DELETE",
        headers,
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        const message = data.error || "예약 취소에 실패했습니다.";
        setQueueError(message);
        setSelectedPostsError(message);
        return;
      }
      await fetchQueue(currentDate);
      if (selectedPostsFetched) {
        await fetchSelectedDatePosts(selectedDate);
      }
    } catch {
      const message = "예약 취소에 실패했습니다.";
      setQueueError(message);
      setSelectedPostsError(message);
    } finally {
      setCancelingPostId(null);
    }
  }, [buildAuthHeaders, currentDate, fetchQueue, fetchSelectedDatePosts, selectedDate, selectedPostsFetched, user]);

  const currentMonthKey = useMemo(
    () => `${currentDate.getFullYear()}-${currentDate.getMonth()}`,
    [currentDate],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setQueue([]);
      setQueueError(null);
      setSelectedPosts([]);
      setSelectedPostsError(null);
      setSelectedPostsFetched(false);
      return;
    }
    setSelectedPosts([]);
    setSelectedPostsError(null);
    setSelectedPostsFetched(false);
    void fetchQueue(currentDate);
  }, [authLoading, currentMonthKey, fetchQueue, user]);

  useEffect(() => {
    const handleActiveAccountChanged = () => {
      if (!user) {
        setQueue([]);
        setSelectedPosts([]);
        setSelectedPostsError(null);
        setSelectedPostsFetched(false);
        return;
      }
      void fetchQueue(currentDate);
      if (selectedPostsFetched) {
        void fetchSelectedDatePosts(selectedDate);
      }
    };

    window.addEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, [currentDate, fetchQueue, fetchSelectedDatePosts, selectedDate, selectedPostsFetched, user]);

  useEffect(() => {
    if (authLoading || !user) return;

    const runAutoDispatch = async () => {
      await dispatchScheduledPosts(true);
      await fetchQueue(currentDate);
      if (selectedPostsFetched) {
        await fetchSelectedDatePosts(selectedDate);
      }
    };

    void runAutoDispatch();
    const intervalId = window.setInterval(() => {
      void runAutoDispatch();
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    authLoading,
    currentDate,
    dispatchScheduledPosts,
    fetchQueue,
    fetchSelectedDatePosts,
    selectedDate,
    selectedPostsFetched,
    user,
  ]);

  const monthCells = useMemo(() => {
    const firstDay = startOfMonth(currentDate);
    const lastDay = endOfMonth(currentDate);
    const startDate = getStartOfWeek(firstDay);
    const endDate = getEndOfWeek(lastDay);
    const cells: { date: Date; isCurrentMonth: boolean }[] = [];
    let cursor = new Date(startDate);
    while (cursor.getTime() <= endDate.getTime()) {
      cells.push({
        date: new Date(cursor),
        isCurrentMonth: cursor.getMonth() === currentDate.getMonth(),
      });
      cursor = addDays(cursor, 1);
    }
    return cells;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const weekStart = getStartOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [currentDate]);

  const weekRangeLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    return `${getKoreanDateLabelWithYear(start)} - ${getKoreanDateLabelWithYear(end)}`;
  }, [weekDays]);

  const postsByDate = useMemo(() => {
    const map = new Map<string, InstagramPublishingRecord[]>();
    queue.forEach((post) => {
      const key = getDateKey(getPrimaryDate(post));
      if (!key) return;
      const existing = map.get(key) || [];
      existing.push(post);
      map.set(key, existing);
    });

    map.forEach((posts, key) => {
      map.set(
        key,
        [...posts].sort((left, right) => {
          const leftTime = new Date(getPrimaryDate(left) || 0).getTime();
          const rightTime = new Date(getPrimaryDate(right) || 0).getTime();
          return leftTime - rightTime;
        }),
      );
    });

    return map;
  }, [queue]);

  const selectedDatePosts = useMemo(() => {
    const posts = selectedPosts;
    if (activeTab === "scheduled") {
      return posts.filter((post) => post.status === "scheduled" || post.status === "published");
    }
    return posts.filter((post) => post.status === "queued" || post.status === "publishing" || post.status === "failed");
  }, [activeTab, selectedPosts]);

  const handlePrev = () => {
    setCurrentDate((prev) => (viewMode === "month" ? addMonths(prev, -1) : addWeeks(prev, -1)));
  };

  const handleNext = () => {
    setCurrentDate((prev) => (viewMode === "month" ? addMonths(prev, 1) : addWeeks(prev, 1)));
  };

  const handleToday = () => {
    const now = getKSTDate();
    setCurrentDate(now);
    setSelectedDate(now);
    void fetchSelectedDatePosts(now);
  };

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    void fetchSelectedDatePosts(date);
  };

  const queueStats = useMemo(
    () => ({
      scheduled: queue.filter((post) => post.status === "scheduled").length,
      published: queue.filter((post) => post.status === "published").length,
      failed: queue.filter((post) => post.status === "failed").length,
      pending: queue.filter((post) => post.status === "queued" || post.status === "publishing").length,
    }),
    [queue],
  );

  return (
    <div className="max-w-[1400px] mx-auto min-h-screen pb-20">
      <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">콘텐츠 캘린더</h1>
          <p className="mt-1 text-sm font-bold text-slate-400">인스타그램 예약 게시와 발행 이력을 날짜 기준으로 관리합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void dispatchScheduledPosts(false).then(() => {
              return fetchQueue(currentDate);
            })}
            disabled={queueLoading || !user || authLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", queueLoading && "animate-spin")} />
            예약 상태 갱신
          </button>
          <Link
            href="/instagram-ai"
            className="inline-flex items-center gap-2 rounded-2xl bg-pink-600 px-5 py-3 text-xs font-black text-white hover:bg-pink-700"
          >
            <CalendarDays className="h-4 w-4" />
            새 콘텐츠 예약
          </Link>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "예약 게시", value: queueStats.scheduled, tone: "bg-amber-50 text-amber-700" },
          { label: "게시 완료", value: queueStats.published, tone: "bg-emerald-50 text-emerald-700" },
          { label: "실패", value: queueStats.failed, tone: "bg-rose-50 text-rose-700" },
          { label: "진행 중", value: queueStats.pending, tone: "bg-sky-50 text-sky-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className={cn("inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest", item.tone)}>
              {item.label}
            </div>
            <div className="mt-3 text-3xl font-black text-slate-900">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-600">선택한 날짜 예약/발행 건수</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedPostsLoading ? (
              <span className="text-xs font-bold text-slate-400">선택한 날짜 데이터를 불러오는 중입니다.</span>
            ) : selectedPostsError ? (
              <span className="text-xs font-bold text-rose-500">{selectedPostsError}</span>
            ) : selectedPostsFetched && selectedDatePosts.length > 0 ? (
              selectedDatePosts.map((post) => (
                <span
                  key={post.id}
                  className="rounded-full border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-600"
                >
                  {post.festivalTitle || "제목 없음"}
                </span>
              ))
            ) : selectedPostsFetched ? (
              <span className="text-xs font-bold text-slate-400">선택한 날짜에 등록된 게시물이 없습니다.</span>
            ) : (
              <span className="text-xs font-bold text-slate-400">날짜를 눌러 게시/예약 내역을 조회하세요.</span>
            )}
          </div>
        </div>
      </div>

      {queueError && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          {queueError}
        </div>
      )}

      {!authLoading && !user && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          예약 발행 현황을 보려면 먼저 로그인해주세요.
        </div>
      )}

      <div className="flex flex-col gap-8 xl:flex-row">
        <div className="flex-1 overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("week")}
                className={cn(
                  "rounded-xl border px-4 py-2 text-xs font-black transition-all",
                  viewMode === "week"
                    ? "border-pink-600 bg-pink-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                주간
              </button>
              <button
                onClick={() => setViewMode("month")}
                className={cn(
                  "rounded-xl border px-4 py-2 text-xs font-black transition-all",
                  viewMode === "month"
                    ? "border-pink-600 bg-pink-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                월간
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handlePrev}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50"
              >
                <ChevronLeft className="h-5 w-5 text-slate-600" />
              </button>
              <div className="text-lg font-black text-slate-900">
                {viewMode === "month" ? getKoreanMonthLabel(currentDate) : weekRangeLabel}
              </div>
              <button
                onClick={handleNext}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50"
              >
                <ChevronRight className="h-5 w-5 text-slate-600" />
              </button>
              <button
                onClick={handleToday}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                오늘
              </button>
            </div>
          </div>

          {viewMode === "month" ? (
            <div className="p-6">
              <div className="mb-2 grid grid-cols-7 text-center text-xs font-black text-slate-900">
                {dayLabels.map((day) => (
                  <div key={day} className="py-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2" style={{ gridAutoRows: "minmax(88px, 1fr)" }}>
                {monthCells.map((cell) => {
                  const isToday = isSameDay(cell.date, today);
                  const isSelected = isSameDay(cell.date, selectedDate);
                  const isOutsideMonth = !cell.isCurrentMonth;
                  const key = new Intl.DateTimeFormat("en-CA", {
                    timeZone: KST_TIMEZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(cell.date);
                  const posts = postsByDate.get(key) || [];

                  return (
                    <button
                      key={cell.date.toISOString()}
                      onClick={() => handleSelectDate(cell.date)}
                      className={cn(
                        "flex flex-col items-start rounded-2xl border px-3 py-2 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-200",
                        cell.isCurrentMonth ? "bg-white" : "bg-slate-50",
                        isSelected && "border-pink-500 ring-2 ring-pink-200",
                        isToday && "border-pink-200 bg-pink-50",
                      )}
                    >
                      <span className={cn("text-xs font-black", isOutsideMonth ? "text-slate-300" : "text-slate-900")}>
                        {cell.date.getDate()}
                      </span>
                      <div className="mt-auto w-full">
                        {posts.length > 0 ? (
                          <div className="space-y-1">
                            <span className="inline-flex rounded-full bg-slate-900 px-2 py-1 text-[10px] font-black text-white">
                              {posts.length}건
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {posts.slice(0, 3).map((post) => (
                                <span
                                  key={post.id}
                                  className={cn("h-2 w-2 rounded-full", post.status === "published"
                                    ? "bg-emerald-500"
                                    : post.status === "scheduled"
                                      ? "bg-amber-500"
                                      : post.status === "failed"
                                        ? "bg-rose-500"
                                        : "bg-sky-500")}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-slate-300">비어 있음</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="mb-4 grid grid-cols-7 gap-2 text-center">
                {weekDays.map((day) => {
                  const key = new Intl.DateTimeFormat("en-CA", {
                    timeZone: KST_TIMEZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(day);
                  const posts = postsByDate.get(key) || [];
                  const isToday = isSameDay(day, today);
                  const isSelected = isSameDay(day, selectedDate);

                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => handleSelectDate(day)}
                      className={cn(
                        "rounded-2xl border p-3 transition-all",
                        isSelected ? "border-pink-500 bg-pink-50" : "border-slate-100 bg-white",
                        isToday && "ring-2 ring-pink-100",
                      )}
                    >
                      <div className="text-[10px] font-black text-slate-400">{dayLabels[getMondayIndex(day.getDay())]}</div>
                      <div className="mt-1 text-xl font-black text-slate-900">{day.getDate()}</div>
                      <div className="mt-3 text-[11px] font-bold text-slate-500">{posts.length}건</div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {weekDays.map((day) => {
                  const key = new Intl.DateTimeFormat("en-CA", {
                    timeZone: KST_TIMEZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(day);
                  const posts = postsByDate.get(key) || [];
                  return (
                    <div key={day.toISOString()} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900">{getKoreanDateLabelWithYear(day)}</div>
                        <div className="text-xs font-bold text-slate-400">{posts.length}건</div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {posts.length > 0 ? (
                          posts.map((post) => (
                            <div key={post.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black", statusBadgeClass(post.status))}>
                                  {statusLabel(post.status)}
                                </span>
                                <span className="text-xs font-black text-slate-800">{post.festivalTitle || "제목 없음"}</span>
                              </div>
                              <div className="mt-2 text-xs font-bold text-slate-500">{formatDateTime(getPrimaryDate(post))}</div>
                              {(post.status === "scheduled" || post.status === "queued") && (
                                <button
                                  onClick={() => void cancelScheduledPost(post.id)}
                                  disabled={cancelingPostId === post.id}
                                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  {cancelingPostId === post.id ? "취소 중..." : "예약 취소"}
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-xs font-bold text-slate-400">등록된 게시물이 없습니다.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="w-full xl:w-[380px]">
          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white">
            <div className="flex">
              <button
                onClick={() => setActiveTab("scheduled")}
                className={cn(
                  "flex-1 border-b-2 py-4 text-sm font-black",
                  activeTab === "scheduled" ? "border-pink-600 bg-pink-600 text-white" : "border-transparent text-slate-500",
                )}
              >
                예약·발행
              </button>
              <button
                onClick={() => setActiveTab("ops")}
                className={cn(
                  "flex-1 border-b-2 py-4 text-sm font-black",
                  activeTab === "ops" ? "border-pink-600 bg-pink-600 text-white" : "border-transparent text-slate-500",
                )}
              >
                실패·진행
              </button>
            </div>

            <div className="p-4">
              <Link
                href="/instagram-ai"
                className="block w-full rounded-xl bg-pink-600 py-3 text-center text-sm font-black text-white transition-all hover:bg-pink-700"
              >
                새 콘텐츠 예약
              </Link>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                {["예약", "게시 완료", "실패", "게시 중", "대기"].map((label) => (
                  <span key={label} className="rounded-full border border-slate-100 bg-slate-50 px-3 py-1.5">
                    {label}
                  </span>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                {selectedPostsLoading ? (
                  <div className="py-10 text-center text-sm font-bold text-slate-400">
                    선택한 날짜 내역을 불러오는 중입니다...
                  </div>
                ) : selectedPostsError ? (
                  <div className="py-10 text-center text-sm font-bold text-rose-500">
                    {selectedPostsError}
                  </div>
                ) : !selectedPostsFetched ? (
                  <div className="py-10 text-center text-sm font-bold text-slate-400">
                    달력에서 날짜를 선택하면 내역을 불러옵니다.
                  </div>
                ) : selectedDatePosts.length > 0 ? (
                  selectedDatePosts.map((post) => (
                    <article key={post.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black", statusBadgeClass(post.status))}>
                          {statusLabel(post.status)}
                        </span>
                        <span className="text-xs font-black text-slate-900">
                          {post.publishMode === "scheduled" ? "예약 게시" : "즉시 게시"}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-black text-slate-900">{post.festivalTitle || "제목 없음"}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">{formatDateTime(getPrimaryDate(post))}</div>
                      {post.lastError && <div className="mt-2 text-xs font-bold text-rose-500">{post.lastError}</div>}
                      {(post.status === "scheduled" || post.status === "queued") && (
                        <button
                          onClick={() => void cancelScheduledPost(post.id)}
                          disabled={cancelingPostId === post.id}
                          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {cancelingPostId === post.id ? "취소 중..." : "예약 취소"}
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="py-10 text-center text-sm font-bold text-slate-400">
                    선택한 날짜에 표시할 게시물이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5">
            <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">선택한 날짜</div>
            <div className="text-lg font-black text-slate-900">{getKoreanDateLabelWithYear(selectedDate)}</div>
            <div className="mt-3 text-xs font-bold text-slate-400">
              예약 시각이 있는 게시물은 예약일 기준, 완료/실패 항목은 처리 시각 기준으로 표시됩니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
