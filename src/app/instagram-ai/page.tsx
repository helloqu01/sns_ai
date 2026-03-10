"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Instagram,
  Link2,
  RefreshCw,
  Rocket,
  AlertTriangle,
  CalendarPlus2,
  LayoutDashboard,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CaptionEditor } from "@/components/caption-editor";
import { META_ACTIVE_ACCOUNT_CHANGED_EVENT, dispatchMetaActiveAccountChanged } from "@/lib/meta-account-client";
import { cn } from "@/lib/utils";
import { fetchFestivalsFromApi } from "@/lib/festival-client-cache";
import type { FestivalSource, UnifiedFestival } from "@/types/festival";
import type { InstagramPublishingRecord } from "@/types/instagram-publishing";
import ContentStudio from "@/components/content-studio";
import { SavedContentBoard } from "@/components/saved-content-board";
import { CarouselPreview, type Slide } from "@/components/carousel-preview";

type QueueCounts = {
  total: number;
  queued: number;
  scheduled: number;
  publishing: number;
  published: number;
  failed: number;
};

type QueueStatusFilter = "all" | "scheduled" | "published" | "failed" | "in-progress";

type QueueModeFilter = "all" | "now" | "scheduled";

type QueuePagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

type FixedFestivalInput = {
  id?: string | null;
  title?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  genre?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
};

type ConnectedAccount = {
  id: string;
  flow: "facebook" | "instagram" | null;
  igUserId: string | null;
  igUsername: string | null;
  pageName: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

type ConnectedPostPreview = {
  id: string;
  caption: string;
  previewUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
};

type QueueResponse = {
  posts?: InstagramPublishingRecord[];
  counts?: unknown;
  pagination?: Partial<QueuePagination>;
  error?: string;
};

const toDateTimeLocalValue = (date: Date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const createDefaultScheduleValue = () => {
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  nextHour.setSeconds(0, 0);
  return toDateTimeLocalValue(nextHour);
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

const buildDraftCaption = (festival: UnifiedFestival | null) => {
  if (!festival) return "";
  return [
    `${festival.title}`,
    `${festival.startDate} - ${festival.endDate}`,
    `${festival.location}`,
    "",
    "#페스티벌 #인스타그램 #자동게시",
  ].join("\n");
};

const buildFestivalPlanContent = (festival: UnifiedFestival) => {
  const detailLines = Array.isArray(festival.details)
    ? festival.details
      .map((detail) => {
        const label = typeof detail?.label === "string" ? detail.label.trim() : "";
        const value = typeof detail?.value === "string" ? detail.value.trim() : "";
        if (!label || !value) return null;
        return `${label}: ${value}`;
      })
      .filter((line): line is string => Boolean(line))
    : [];

  return [
    `행사명: ${festival.title}`,
    `행사 일정: ${festival.startDate} ~ ${festival.endDate}`,
    `행사 장소: ${festival.location}`,
    festival.description ? `행사 소개: ${festival.description}` : null,
    festival.lineup ? `라인업: ${festival.lineup}` : null,
    festival.price ? `티켓 가격: ${festival.price}` : null,
    festival.contact ? `연락처: ${festival.contact}` : null,
    festival.homepage ? `홈페이지: ${festival.homepage}` : null,
    detailLines.length > 0 ? `추가 정보:\n${detailLines.join("\n")}` : null,
  ].filter(Boolean).join("\n");
};

const statusLabelMap: Record<InstagramPublishingRecord["status"], string> = {
  queued: "대기",
  scheduled: "예약됨",
  publishing: "게시 중",
  published: "게시 완료",
  failed: "실패",
};

const statusToneMap: Record<InstagramPublishingRecord["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  scheduled: "bg-amber-50 text-amber-700",
  publishing: "bg-sky-50 text-sky-700",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};

const QUEUE_PAGE_SIZE = 5;
const KST_TIMEZONE = "Asia/Seoul";
const PLAN_STYLE_OPTIONS = ["카드뉴스", "홍보물", "정보전달", "감성에세이"];
const PLAN_TARGET_OPTIONS = ["1020 MZ세대", "3040 직장인", "학부모", "예비 신혼부부"];
const PLAN_ASPECT_RATIOS = ["1:1", "4:5", "16:9", "9:16", "3:4"];

const getKstTodayDateText = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const normalizeDateText = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.slice(0, 10).replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const normalizeFestivalSource = (value: string | null | undefined): FestivalSource => {
  if (value === "KOPIS" || value === "FESTIVAL_LIFE" || value === "WEB_CRAWL" || value === "MANUAL") {
    return value;
  }
  return "MANUAL";
};

const toFixedFestival = (input: FixedFestivalInput | null | undefined): UnifiedFestival | null => {
  if (!input) return null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return null;

  const startDate = normalizeDateText(input.startDate) || getKstTodayDateText();
  const endDate = normalizeDateText(input.endDate) || startDate;
  const location = typeof input.location === "string" && input.location.trim().length > 0
    ? input.location.trim()
    : "상세 정보 참조";
  const id = typeof input.id === "string" && input.id.trim().length > 0
    ? input.id.trim()
    : `fixed-${title}-${startDate}`;

  return {
    id,
    title,
    location,
    startDate,
    endDate,
    imageUrl: typeof input.imageUrl === "string" ? input.imageUrl.trim() : "",
    source: normalizeFestivalSource(input.source),
    sourceLabel: typeof input.sourceLabel === "string" ? input.sourceLabel.trim() : undefined,
    sourceUrl: typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : undefined,
    genre: typeof input.genre === "string" ? input.genre.trim() : "",
  };
};

const normalizeQueueCounts = (value: unknown): QueueCounts => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const readNumber = (key: keyof QueueCounts) => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };
  return {
    total: readNumber("total"),
    queued: readNumber("queued"),
    scheduled: readNumber("scheduled"),
    publishing: readNumber("publishing"),
    published: readNumber("published"),
    failed: readNumber("failed"),
  };
};

export default function InstagramAiPage() {
  const { user, loading: authLoading } = useAuth();
  const createModeRef = useRef<boolean>(
    typeof window !== "undefined" ? window.location.pathname === "/create" : false,
  );
  const fixedFestivalQueryRef = useRef<FixedFestivalInput | null>(
    (() => {
      if (typeof window === "undefined" || window.location.pathname !== "/create") return null;
      const params = new URLSearchParams(window.location.search);
      return {
        id: params.get("festivalId"),
        title: params.get("title"),
        location: params.get("location"),
        startDate: params.get("start"),
        endDate: params.get("end"),
        genre: params.get("genre"),
        source: params.get("source"),
        sourceLabel: params.get("sourceLabel"),
        sourceUrl: params.get("sourceUrl"),
        imageUrl: params.get("imageUrl"),
      };
    })(),
  );
  const createMode = createModeRef.current;
  const fixedFestivalData = useMemo(
    () => (createMode ? toFixedFestival(fixedFestivalQueryRef.current) : null),
    [createMode],
  );
  const preferredFestivalIdRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("festivalId")?.trim() || null
      : null,
  );
  const preferredFestivalMetaRef = useRef<{
    title: string;
    start: string;
    end: string;
    location: string;
  } | null>(
    (() => {
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams(window.location.search);
      if (params.get("festivalId")?.trim()) return null;
      const title = params.get("title")?.trim() || "";
      const start = params.get("start")?.trim() || "";
      const end = params.get("end")?.trim() || "";
      const location = params.get("location")?.trim() || "";
      if (!title || !start || !end || !location) return null;
      return { title, start, end, location };
    })(),
  );

  const [activeTab, setActiveTab] = useState<"automation" | "studio">("automation");
  const [festivals, setFestivals] = useState<UnifiedFestival[]>([]);
  const [festivalsLoading, setFestivalsLoading] = useState(true);
  const [selectedFestivalId, setSelectedFestivalId] = useState("");
  const [captionText, setCaptionText] = useState("");
  const [captionTone, setCaptionTone] = useState("friendly");
  const [captionStyle, setCaptionStyle] = useState("balanced");
  const [planStyle, setPlanStyle] = useState(PLAN_STYLE_OPTIONS[0]);
  const [planTarget, setPlanTarget] = useState(PLAN_TARGET_OPTIONS[0]);
  const [planAspectRatio, setPlanAspectRatio] = useState("4:5");
  const [planSlideCount, setPlanSlideCount] = useState(6);
  const [generatedPlanSlides, setGeneratedPlanSlides] = useState<Slide[]>([]);
  const [generatedPlanSlidesDirty, setGeneratedPlanSlidesDirty] = useState(false);
  const [isPlanGenerating, setIsPlanGenerating] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(createDefaultScheduleValue);
  const [isCaptionGenerating, setIsCaptionGenerating] = useState(false);
  const [isPublishingNow, setIsPublishingNow] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [queue, setQueue] = useState<InstagramPublishingRecord[]>([]);
  const [queueCounts, setQueueCounts] = useState<QueueCounts>({
    total: 0,
    queued: 0,
    scheduled: 0,
    publishing: 0,
    published: 0,
    failed: 0,
  });
  const [queueLoading, setQueueLoading] = useState(false);
  const [cancelingQueueId, setCancelingQueueId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stickyErrorMessage, setStickyErrorMessage] = useState<string | null>(null);
  const [queueStatusFilter, setQueueStatusFilter] = useState<QueueStatusFilter>("all");
  const [queueModeFilter, setQueueModeFilter] = useState<QueueModeFilter>("all");
  const [queuePage, setQueuePage] = useState(1);
  const [queuePagination, setQueuePagination] = useState<QueuePagination>({
    page: 1,
    pageSize: QUEUE_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const [isConnected, setIsConnected] = useState(false);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [recentPosts, setRecentPosts] = useState<ConnectedPostPreview[]>([]);
  const [recentPostsLoading, setRecentPostsLoading] = useState(false);
  const [selectedSavedCardnewsId, setSelectedSavedCardnewsId] = useState<string | null>(null);
  const initializedUserRef = useRef<string | null>(null);

  const selectedFestival = useMemo(
    () => {
      if (createMode && fixedFestivalData) {
        return fixedFestivalData;
      }
      return festivals.find((festival) => festival.id === selectedFestivalId) ?? null;
    },
    [createMode, festivals, fixedFestivalData, selectedFestivalId],
  );

  const buildAuthHeaders = useCallback(
    async (json = false) => {
      const headers: Record<string, string> = {};
      if (json) {
        headers["Content-Type"] = "application/json";
      }
      if (user) {
        const token = await user.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    },
    [user],
  );

  const fetchFestivals = useCallback(async () => {
    if (createMode && fixedFestivalData) {
      setFestivals([fixedFestivalData]);
      setSelectedFestivalId(fixedFestivalData.id);
      setFestivalsLoading(false);
      return;
    }

    setFestivalsLoading(true);
    try {
      const { festivals: items } = await fetchFestivalsFromApi();
      const todayText = getKstTodayDateText();
      const upcomingOnly = items.filter((festival) => {
        const endDate = normalizeDateText(festival.endDate) || normalizeDateText(festival.startDate);
        if (!endDate) return true;
        return endDate >= todayText;
      });

      setFestivals(upcomingOnly);
      setSelectedFestivalId((prev) => {
        const preferredFestivalId = preferredFestivalIdRef.current;
        if (preferredFestivalId && upcomingOnly.some((festival) => festival.id === preferredFestivalId)) {
          preferredFestivalIdRef.current = null;
          preferredFestivalMetaRef.current = null;
          return preferredFestivalId;
        }

        const preferredMeta = preferredFestivalMetaRef.current;
        if (preferredMeta) {
          const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
          const matched = upcomingOnly.find((festival) => {
            const titleMatched = normalize(festival.title) === normalize(preferredMeta.title);
            const startMatched = normalizeDateText(festival.startDate) === normalizeDateText(preferredMeta.start);
            const endMatched = normalizeDateText(festival.endDate) === normalizeDateText(preferredMeta.end);
            const locationMatched = normalize(festival.location) === normalize(preferredMeta.location);
            return titleMatched && startMatched && endMatched && locationMatched;
          });
          if (matched) {
            preferredFestivalIdRef.current = null;
            preferredFestivalMetaRef.current = null;
            return matched.id;
          }
        }

        if (prev && upcomingOnly.some((festival) => festival.id === prev)) {
          return prev;
        }
        return upcomingOnly[0]?.id || "";
      });
    } catch (error) {
      console.error(error);
    } finally {
      setFestivalsLoading(false);
    }
  }, [createMode, fixedFestivalData]);

  const fetchStatus = useCallback(async () => {
    if (!user) {
      setIsConnected(false);
      return false;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/oauth/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setIsConnected(false);
        return false;
      }
      const data = (await res.json().catch(() => ({}))) as { connected?: boolean };
      const connected = Boolean(data.connected);
      setIsConnected(connected);
      return connected;
    } catch {
      setIsConnected(false);
      return false;
    }
  }, [user]);

  const fetchPages = useCallback(async () => {
    if (!user) return [] as PageInfo[];
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
        return [] as PageInfo[];
      }
      const nextPages = Array.isArray(data.pages) ? data.pages : [];
      setPages(nextPages);
      return nextPages;
    } catch {
      setPagesError("계정 정보를 불러오지 못했습니다.");
      return [] as PageInfo[];
    } finally {
      setPagesLoading(false);
    }
  }, [user]);

  const fetchSelection = useCallback(async () => {
    if (!user) return null;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/selection", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as { selected?: SelectionInfo | null };
      if (data.selected) {
        setSelectionInfo(data.selected);
        return data.selected;
      } else {
        setSelectionInfo(null);
        return null;
      }
    } catch {
      // ignore
      return null;
    }
  }, [user]);

  const fetchAccounts = useCallback(async () => {
    if (!user) {
      setAccounts([]);
      return [] as ConnectedAccount[];
    }

    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/accounts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { accounts?: ConnectedAccount[]; error?: string };
      if (!res.ok) {
        setAccountsError(data.error || "연결 계정 목록을 불러오지 못했습니다.");
        setAccounts([]);
        return [] as ConnectedAccount[];
      }
      const nextAccounts = Array.isArray(data.accounts) ? data.accounts : [];
      setAccounts(nextAccounts);
      return nextAccounts;
    } catch {
      setAccountsError("연결 계정 목록을 불러오지 못했습니다.");
      setAccounts([]);
      return [] as ConnectedAccount[];
    } finally {
      setAccountsLoading(false);
    }
  }, [user]);

  const saveSelection = useCallback(
    async (pageId: string, successMessage?: string | null) => {
      if (!user) return null;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/meta/selection", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pageId }),
        });

        const data = (await res.json().catch(() => ({}))) as { selected?: SelectionInfo; error?: string };
        if (!res.ok || !data.selected) {
          setConnectMessage(data.error || "계정 연결 상태를 저장하지 못했습니다.");
          return null;
        }

        setSelectionInfo(data.selected);
        setIsConnected(true);
        dispatchMetaActiveAccountChanged({ accountId: data.selected.pageId });
        if (successMessage) {
          setConnectMessage(successMessage);
        }
        return data.selected;
      } catch {
        setConnectMessage("계정 연결 상태를 저장하지 못했습니다.");
        return null;
      }
    },
    [user],
  );

  const syncConnectedAccount = useCallback(
    async (options?: { showSuccessMessage?: boolean }) => {
      const connected = await fetchStatus();
      if (!connected) {
        setPages([]);
        setSelectionInfo(null);
        return false;
      }

      const [availablePages, selected] = await Promise.all([fetchPages(), fetchSelection()]);
      const selectionIsValid = selected
        ? availablePages.some((page) => page.id === selected.pageId)
        : false;
      if (selected && selectionIsValid) {
        if (options?.showSuccessMessage) {
          setConnectMessage("계정 연결이 완료되었습니다.");
        }
        return true;
      }

      const primaryPage = availablePages.find((page) => page.igUserId) ?? availablePages[0] ?? null;
      if (!primaryPage) {
        if (options?.showSuccessMessage) {
          setConnectMessage("계정 연결은 완료됐지만 사용할 인스타그램 계정을 찾지 못했습니다.");
        }
        return true;
      }

      return Boolean(
        await saveSelection(
          primaryPage.id,
          options?.showSuccessMessage
            ? selected
              ? "로그인 계정이 변경되어 게시 계정을 다시 설정했습니다."
              : "계정 연결이 완료되었습니다."
            : null,
        ),
      );
    },
    [fetchPages, fetchSelection, fetchStatus, saveSelection],
  );

  const fetchQueue = useCallback(async (options?: {
    page?: number;
    status?: QueueStatusFilter;
    mode?: QueueModeFilter;
  }) => {
    if (!user) {
      setQueue([]);
      setQueueCounts({
        total: 0,
        queued: 0,
        scheduled: 0,
        publishing: 0,
        published: 0,
        failed: 0,
      });
      setQueuePagination({
        page: 1,
        pageSize: QUEUE_PAGE_SIZE,
        total: 0,
        totalPages: 1,
      });
      return;
    }

    const requestPage = Math.max(1, options?.page ?? queuePage);
    const requestStatus = options?.status ?? queueStatusFilter;
    const requestMode = options?.mode ?? queueModeFilter;

    setQueueLoading(true);
    try {
      const headers = await buildAuthHeaders();
      const searchParams = new URLSearchParams({
        page: String(requestPage),
        pageSize: String(QUEUE_PAGE_SIZE),
        status: requestStatus,
        mode: requestMode,
      });
      const res = await fetch(`/api/meta/publishing?${searchParams.toString()}`, { headers });
      const data = (await res.json().catch(() => ({}))) as QueueResponse;
      if (!res.ok) {
        setErrorMessage(data.error || "게시/예약 내역을 불러오지 못했습니다.");
        return;
      }
      setQueue(Array.isArray(data.posts) ? data.posts : []);
      setQueueCounts(normalizeQueueCounts(data.counts));
      const nextPagination = {
        page: typeof data.pagination?.page === "number" && Number.isFinite(data.pagination.page)
          ? Math.max(1, data.pagination.page)
          : requestPage,
        pageSize: typeof data.pagination?.pageSize === "number" && Number.isFinite(data.pagination.pageSize)
          ? Math.max(1, data.pagination.pageSize)
          : QUEUE_PAGE_SIZE,
        total: typeof data.pagination?.total === "number" && Number.isFinite(data.pagination.total)
          ? Math.max(0, data.pagination.total)
          : Array.isArray(data.posts) ? data.posts.length : 0,
        totalPages: typeof data.pagination?.totalPages === "number" && Number.isFinite(data.pagination.totalPages)
          ? Math.max(1, data.pagination.totalPages)
          : 1,
      } satisfies QueuePagination;
      setQueuePagination(nextPagination);
      setQueuePage(nextPagination.page);
      setErrorMessage(null);
    } catch (error) {
      console.error(error);
      setErrorMessage("게시/예약 내역을 불러오지 못했습니다.");
    } finally {
      setQueueLoading(false);
    }
  }, [buildAuthHeaders, queueModeFilter, queuePage, queueStatusFilter, user]);

  const fetchRecentPosts = useCallback(async () => {
    if (!user) {
      setRecentPosts([]);
      return [] as ConnectedPostPreview[];
    }

    setRecentPostsLoading(true);
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch("/api/meta/posts?limit=2", { headers });
      const data = (await res.json().catch(() => ({}))) as { posts?: ConnectedPostPreview[] };
      if (!res.ok) {
        setRecentPosts([]);
        return [] as ConnectedPostPreview[];
      }

      const posts = Array.isArray(data.posts) ? data.posts.slice(0, 2) : [];
      setRecentPosts(posts);
      return posts;
    } catch {
      setRecentPosts([]);
      return [] as ConnectedPostPreview[];
    } finally {
      setRecentPostsLoading(false);
    }
  }, [buildAuthHeaders, user]);

  const refreshConnectionPreview = useCallback(
    async (options?: { showSuccessMessage?: boolean }) => {
      const connected = await syncConnectedAccount(options);
      if (!connected) {
        setRecentPosts([]);
        setAccounts([]);
        return false;
      }

      await fetchAccounts();
      await fetchRecentPosts();
      return true;
    },
    [fetchAccounts, fetchRecentPosts, syncConnectedAccount],
  );

  const setActiveAccount = useCallback(
    async (accountId: string) => {
      if (!user) return;
      setAccountsError(null);
      try {
        const headers = await buildAuthHeaders(true);
        const res = await fetch("/api/meta/accounts/active", {
          method: "POST",
          headers,
          body: JSON.stringify({ accountId }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setAccountsError(data.error || "계정 전환에 실패했습니다.");
          return;
        }

        dispatchMetaActiveAccountChanged({ accountId });
        await refreshConnectionPreview();
        setConnectMessage("게시 계정을 변경했습니다.");
      } catch {
        setAccountsError("계정 전환에 실패했습니다.");
      }
    },
    [buildAuthHeaders, refreshConnectionPreview, user],
  );

  const dispatchScheduledPosts = useCallback(async () => {
    if (!user) return;
    try {
      const headers = await buildAuthHeaders(true);
      await fetch("/api/meta/publishing/dispatch", {
        method: "POST",
        headers,
        body: JSON.stringify({ limit: 1 }),
      });
    } catch (error) {
      console.error(error);
    }
  }, [buildAuthHeaders, user]);

  const refreshAutomationData = useCallback(async () => {
    await dispatchScheduledPosts();
    await Promise.all([fetchFestivals(), fetchQueue(), refreshConnectionPreview()]);
  }, [dispatchScheduledPosts, fetchFestivals, fetchQueue, refreshConnectionPreview]);

  const handleGenerateCaption = useCallback(async () => {
    if (!selectedFestival) {
      setErrorMessage("캡션을 만들 행사 데이터를 먼저 선택해주세요.");
      return;
    }

    setIsCaptionGenerating(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const res = await fetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          festivals: [selectedFestival],
          tone: captionTone,
          captionStyle,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { caption?: string; error?: string };
      if (!res.ok || !data.caption) {
        throw new Error(data.error || "AI 캡션 생성에 실패했습니다.");
      }
      setCaptionText(data.caption);
      setFeedbackMessage("AI 캡션을 생성했습니다.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : "AI 캡션 생성에 실패했습니다.");
    } finally {
      setIsCaptionGenerating(false);
    }
  }, [captionStyle, captionTone, selectedFestival]);

  const handleGeneratePlanAndCaption = useCallback(async () => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    if (!selectedFestival) {
      setErrorMessage("기획안을 생성할 행사 정보를 찾지 못했습니다.");
      return;
    }

    const content = buildFestivalPlanContent(selectedFestival);
    if (!content.trim()) {
      setErrorMessage("행사 본문 정보가 부족해서 기획안을 생성할 수 없습니다.");
      return;
    }

    setIsPlanGenerating(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          style: planStyle,
          target: planTarget,
          aspectRatio: planAspectRatio,
          genre: selectedFestival.genre,
          source: selectedFestival.source,
          sourceLabel: selectedFestival.sourceLabel || selectedFestival.source,
          imageUrl: selectedFestival.imageUrl,
          slideCount: planSlideCount,
          tone: captionTone,
          captionStyle,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        slides?: Array<Record<string, unknown>>;
        caption?: string;
        draftId?: string | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "기획안 생성에 실패했습니다.");
      }

      const slides = Array.isArray(data.slides)
        ? data.slides.map((slide, index) => {
          const title = typeof slide.title === "string" && slide.title.trim()
            ? slide.title.trim()
            : `슬라이드 ${index + 1}`;
          const body = typeof slide.body === "string"
            ? slide.body
            : (typeof slide.content === "string" ? slide.content : "");
          const image = typeof slide.image === "string" && slide.image.trim()
            ? slide.image
            : (index === 0 ? selectedFestival.imageUrl : undefined);
          const renderedImageUrl = typeof slide.renderedImageUrl === "string" && slide.renderedImageUrl.trim()
            ? slide.renderedImageUrl.trim()
            : undefined;
          return {
            id: `${selectedFestival.id}-${index + 1}`,
            title,
            body,
            image,
            renderedImageUrl,
          } satisfies Slide;
        })
        : [];

      setGeneratedPlanSlides(slides);
      setGeneratedPlanSlidesDirty(false);
      if (typeof data.caption === "string") {
        setCaptionText(data.caption);
      }
      if (typeof data.draftId === "string" && data.draftId.trim().length > 0) {
        setSelectedSavedCardnewsId(data.draftId);
      }
      setFeedbackMessage("기획안과 캡션을 생성했습니다.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : "기획안 생성에 실패했습니다.");
    } finally {
      setIsPlanGenerating(false);
    }
  }, [
    buildAuthHeaders,
    captionStyle,
    captionTone,
    planAspectRatio,
    planSlideCount,
    planStyle,
    planTarget,
    selectedFestival,
    user,
  ]);

  const updateGeneratedPlanSlide = useCallback(
    (index: number, field: "title" | "body", value: string) => {
      setGeneratedPlanSlidesDirty(true);
      setGeneratedPlanSlides((prev) => prev.map((slide, slideIndex) => {
        if (slideIndex !== index) return slide;
        if (field === "title") {
          return { ...slide, title: value };
        }
        return { ...slide, body: value };
      }));
    },
    [],
  );

  const buildSlideRenderUrl = useCallback(
    (slide: Slide, index: number) => {
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams();
      params.set("title", (slide.title || `슬라이드 ${index + 1}`).slice(0, 80));
      params.set("body", (slide.body || slide.content || "").slice(0, 260));
      params.set("ratio", planAspectRatio);
      params.set("index", String(index + 1));
      if (selectedFestival?.imageUrl) {
        params.set("bg", selectedFestival.imageUrl);
      }
      return `${window.location.origin}/api/cardnews/slide-image?${params.toString()}`;
    },
    [planAspectRatio, selectedFestival?.imageUrl],
  );

  const submitPublishing = useCallback(
    async (mode: "now" | "schedule") => {
      if (!user) {
        window.location.href = "/login";
        return;
      }
      if (!isConnected || !selectionInfo?.igUserId) {
        setErrorMessage("인스타그램 계정 연결/전환은 사이드바의 연결 계정에서 설정해주세요.");
        return;
      }
      if (!selectedFestival?.imageUrl) {
        setErrorMessage("게시에 사용할 포스터 이미지가 없는 행사입니다.");
        return;
      }
      if (!captionText.trim()) {
        setErrorMessage("게시할 캡션을 입력해주세요.");
        return;
      }

      const scheduledForIso =
        mode === "schedule"
          ? (() => {
              const parsed = new Date(scheduleAt);
              if (Number.isNaN(parsed.getTime())) return null;
              return parsed.toISOString();
            })()
          : null;

      if (mode === "schedule" && (!scheduledForIso || new Date(scheduledForIso).getTime() <= Date.now())) {
        setErrorMessage("예약 시각은 현재보다 미래여야 합니다.");
        return;
      }

      setErrorMessage(null);
      setFeedbackMessage(null);

      if (mode === "now") {
        setIsPublishingNow(true);
      } else {
        setIsScheduling(true);
      }

      try {
        const headers = await buildAuthHeaders(true);
        const reusableRenderedSlideUrls = !generatedPlanSlidesDirty
          ? generatedPlanSlides
              .map((slide) =>
                typeof slide.renderedImageUrl === "string" && slide.renderedImageUrl.trim().length > 0
                  ? slide.renderedImageUrl.trim()
                  : null,
              )
              .filter((url): url is string => Boolean(url))
              .slice(0, 10)
          : [];
        const fallbackSlideImageUrls = reusableRenderedSlideUrls.length > 0
          ? reusableRenderedSlideUrls
          : generatedPlanSlides
              .map((slide, index) => {
                if (typeof slide.image === "string" && slide.image.trim().length > 0) {
                  return slide.image.trim();
                }
                if (createMode) {
                  return buildSlideRenderUrl(slide, index) || selectedFestival.imageUrl;
                }
                return selectedFestival.imageUrl;
              })
              .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
              .slice(0, 10);
        const payload = {
          caption: captionText.trim(),
          imageUrl: selectedFestival.imageUrl,
          slideImageUrls: fallbackSlideImageUrls,
          slides: reusableRenderedSlideUrls.length > 0
            ? undefined
            : generatedPlanSlides.map((slide) => ({
                title: slide.title,
                body: slide.body || slide.content || "",
              })),
          aspectRatio: planAspectRatio,
          backgroundImageUrl: selectedFestival.imageUrl,
          festivalId: selectedFestival.id,
          festivalTitle: selectedFestival.title,
          mode: mode === "now" ? "publish" : "schedule",
          scheduledFor: scheduledForIso,
        };

        const res = await fetch("/api/meta/publishing", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        const data = (await res.json().catch(() => ({}))) as {
          post?: InstagramPublishingRecord;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || "게시 요청에 실패했습니다.");
        }

        if (mode === "now") {
          if (data.post?.status === "published") {
            setFeedbackMessage("인스타그램에 즉시 게시했습니다.");
          } else if (data.post?.status === "failed") {
            setErrorMessage(data.post.lastError || "인스타그램 게시에 실패했습니다.");
          } else {
            setFeedbackMessage("게시 요청을 접수했습니다.");
          }
        } else {
          setFeedbackMessage("예약 게시를 저장했습니다.");
        }

        await refreshAutomationData();
      } catch (error) {
        console.error(error);
        setErrorMessage(error instanceof Error ? error.message : "게시 요청에 실패했습니다.");
      } finally {
        setIsPublishingNow(false);
        setIsScheduling(false);
      }
    },
    [
      buildAuthHeaders,
      buildSlideRenderUrl,
      captionText,
      createMode,
      generatedPlanSlides,
      isConnected,
      refreshAutomationData,
      scheduleAt,
      selectedFestival,
      selectionInfo?.igUserId,
      user,
    ],
  );

  const handleCancelScheduledPost = useCallback(
    async (postId: string) => {
      if (!user) return;
      const confirmed = window.confirm("이 예약 항목을 취소할까요?");
      if (!confirmed) return;

      setCancelingQueueId(postId);
      setErrorMessage(null);
      setFeedbackMessage(null);
      try {
        const headers = await buildAuthHeaders();
        const res = await fetch(`/api/meta/publishing?id=${encodeURIComponent(postId)}`, {
          method: "DELETE",
          headers,
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setErrorMessage(data.error || "예약 취소에 실패했습니다.");
          return;
        }
        setFeedbackMessage("예약을 취소했습니다.");
        await fetchQueue({
          page: queuePage,
          status: queueStatusFilter,
          mode: queueModeFilter,
        });
      } catch {
        setErrorMessage("예약 취소에 실패했습니다.");
      } finally {
        setCancelingQueueId(null);
      }
    },
    [buildAuthHeaders, fetchQueue, queueModeFilter, queuePage, queueStatusFilter, user],
  );

  useEffect(() => {
    if (!selectedFestival) return;
    setCaptionText((prev) => (prev.trim().length > 0 ? prev : buildDraftCaption(selectedFestival)));
  }, [selectedFestival]);

  useEffect(() => {
    if (!errorMessage) return;
    setStickyErrorMessage(errorMessage);
  }, [errorMessage]);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      initializedUserRef.current = null;
      setFestivals([]);
      setSelectedFestivalId("");
      setFestivalsLoading(false);
      setQueueStatusFilter("all");
      setQueueModeFilter("all");
      setQueuePage(1);
      setQueue([]);
      setAccounts([]);
      setAccountsError(null);
      setPages([]);
      setSelectionInfo(null);
      setRecentPosts([]);
      setIsConnected(false);
      setPagesError(null);
      setSelectedSavedCardnewsId(null);
      setGeneratedPlanSlides([]);
      setGeneratedPlanSlidesDirty(false);
      setIsPlanGenerating(false);
      setStickyErrorMessage(null);
      return;
    }

    if (initializedUserRef.current === user.uid) {
      return;
    }
    initializedUserRef.current = user.uid;
    setQueueStatusFilter("all");
    setQueueModeFilter("all");
    setQueuePage(1);
    void Promise.all([
      fetchFestivals(),
      fetchQueue({ page: 1, status: "all", mode: "all" }),
      refreshConnectionPreview(),
    ]);
  }, [authLoading, fetchFestivals, fetchQueue, refreshConnectionPreview, user]);

  useEffect(() => {
    const handleActiveAccountChanged = () => {
      setQueuePage(1);
      void Promise.all([
        refreshConnectionPreview(),
        fetchQueue({ page: 1 }),
      ]);
    };

    window.addEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, [fetchQueue, refreshConnectionPreview]);

  const scheduledPreviewLabel = useMemo(() => {
    if (!scheduleAt) return "-";
    const date = new Date(scheduleAt);
    if (Number.isNaN(date.getTime())) return "-";
    return formatDateTime(date.toISOString());
  }, [scheduleAt]);

  const activeAccountId = useMemo(() => {
    return accounts.find((account) => account.active)?.id || selectionInfo?.pageId || null;
  }, [accounts, selectionInfo?.pageId]);

  const connectedAccountLabel = selectionInfo?.igUsername
    ? `@${selectionInfo.igUsername}`
    : pages[0]?.igUsername
      ? `@${pages[0].igUsername}`
      : selectionInfo?.pageName || pages[0]?.name || "-";

  const connectedAccountMeta = selectionInfo?.pageName
    || pages[0]?.name
    || (pagesLoading ? "연결 계정을 확인하는 중입니다." : "연결된 계정 없음");

  const previewAccountName = (selectionInfo?.igUsername
    || pages[0]?.igUsername
    || selectionInfo?.pageName
    || pages[0]?.name
    || "instagram_account").replace(/^@/, "");

  const latestPublished = queue.find((item) => item.status === "published") ?? null;

  return (
    <div className="max-w-[1400px] mx-auto min-h-screen pb-20">
      <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-pink-600">
            <Instagram className="h-4 w-4" />
            Instagram AI
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">인스타그램 자동 게시 스튜디오</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
            행사 포스터 1장을 기준으로 캡션 생성, 즉시 게시, 예약 발행까지 한 화면에서 처리합니다.
            카드뉴스 기획/생성과 저장된 콘텐츠 확인은 아래의 콘텐츠 스튜디오 탭에서 진행할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void refreshAutomationData()}
            disabled={queueLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", queueLoading && "animate-spin")} />
            상태 새로고침
          </button>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "연결 상태",
            value: isConnected ? "연결됨" : "미연결",
            icon: Link2,
            tone: isConnected ? "text-emerald-600 bg-emerald-50" : "text-slate-500 bg-slate-100",
          },
          {
            label: "게시 계정",
            value: selectionInfo?.igUsername ? `@${selectionInfo.igUsername}` : selectionInfo?.pageName || "-",
            icon: Instagram,
            tone: "text-pink-600 bg-pink-50",
          },
          {
            label: "예약 게시",
            value: String(queueCounts.scheduled),
            icon: CalendarClock,
            tone: "text-amber-600 bg-amber-50",
          },
          {
            label: "게시 완료",
            value: String(queueCounts.published),
            icon: CheckCircle2,
            tone: "text-emerald-600 bg-emerald-50",
          },
          {
            label: "실패/오류",
            value: String(queueCounts.failed),
            icon: AlertTriangle,
            tone: "text-rose-600 bg-rose-50",
          },
        ].map((item) => (
          <section key={item.label} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className={cn("mb-4 flex h-12 w-12 items-center justify-center rounded-2xl", item.tone)}>
              <item.icon className="h-5 w-5" />
            </div>
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{item.label}</div>
            <div className="mt-2 text-2xl font-black text-slate-900">{item.value}</div>
          </section>
        ))}
      </div>

      {!createMode && (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab("automation")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black transition-all",
              activeTab === "automation"
                ? "border-pink-600 bg-pink-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            <Rocket className="h-4 w-4" />
            자동 게시
          </button>
          <button
            onClick={() => setActiveTab("studio")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black transition-all",
              activeTab === "studio"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            콘텐츠 스튜디오
          </button>
        </div>
      )}

      {createMode || activeTab === "automation" ? (
        <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Posting Profile</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">게시 계정과 자동화 상태</h2>
                  <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                    인스타그램 계정 연결/추가는 사이드바의 연결 계정에서만 관리합니다.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {!isConnected && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-600">
                      계정 연결은 사이드바에서 진행하세요.
                    </div>
                  )}
                  {isConnected && (
                    <button
                      onClick={() => void refreshConnectionPreview({ showSuccessMessage: true })}
                      disabled={pagesLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <RefreshCw className={cn("h-4 w-4", pagesLoading && "animate-spin")} />
                      게시 계정 동기화
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">연결 상태</div>
                  <div className="mt-2 text-lg font-black text-slate-900">
                    {isConnected ? "연결됨" : "미연결"}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">연결 계정</div>
                  <div className="mt-2 text-lg font-black text-slate-900">{connectedAccountLabel}</div>
                  <div className="mt-1 text-xs font-bold text-slate-400">{connectedAccountMeta}</div>
                  {isConnected && accounts.length > 1 && (
                    <div className="mt-3">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">계정 전환</div>
                      <select
                        value={activeAccountId || ""}
                        onChange={(event) => void setActiveAccount(event.target.value)}
                        disabled={accountsLoading || !activeAccountId}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60"
                      >
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.igUsername ? `@${account.igUsername}` : account.pageName || account.id}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-[11px] font-bold text-slate-400">
                        연결된 계정 {accounts.length}개
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">다음 예약</div>
                  <div className="mt-2 text-lg font-black text-slate-900">{scheduledPreviewLabel}</div>
                  <div className="mt-1 text-xs font-bold text-slate-400">현재 입력값 기준</div>
                </div>
              </div>

              {(connectMessage || pagesError || accountsError) && (
                <div className="mt-4 space-y-1">
                  {connectMessage && <div className="text-xs font-black text-pink-600">{connectMessage}</div>}
                  {pagesError && <div className="text-xs font-black text-rose-500">{pagesError}</div>}
                  {accountsError && <div className="text-xs font-black text-rose-500">{accountsError}</div>}
                </div>
              )}

              <div className="mt-6 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">최근 게시물</div>
                    <div className="mt-1 text-sm font-black text-slate-900">연결 계정의 최신 게시물 2개</div>
                  </div>
                  {isConnected && (
                    <button
                      onClick={() => void fetchRecentPosts()}
                      disabled={recentPostsLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", recentPostsLoading && "animate-spin")} />
                      갱신
                    </button>
                  )}
                </div>

                {!isConnected && (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs font-bold text-slate-400">
                    계정을 연결하면 최근 게시물 2개가 여기에 표시됩니다.
                  </div>
                )}

                {isConnected && recentPostsLoading && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-xs font-bold text-slate-400">
                    최근 게시물을 불러오는 중입니다...
                  </div>
                )}

                {isConnected && !recentPostsLoading && recentPosts.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs font-bold text-slate-400">
                    표시할 최근 게시물이 없습니다.
                  </div>
                )}

                {isConnected && !recentPostsLoading && recentPosts.length > 0 && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {recentPosts.map((post) => (
                      <article key={post.id} className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white">
                        <div className="aspect-[4/3] bg-slate-100">
                          {post.previewUrl ? (
                            <img src={post.previewUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs font-black text-slate-400">
                              미리보기 없음
                            </div>
                          )}
                        </div>
                        <div className="p-4">
                          <div className="line-clamp-2 text-sm font-black text-slate-900">
                            {post.caption || "캡션 없는 게시물"}
                          </div>
                          <div className="mt-2 text-[11px] font-bold text-slate-400">{formatDateTime(post.timestamp)}</div>
                          {post.permalink && (
                            <a
                              href={post.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1 text-xs font-black text-pink-600 hover:text-pink-700"
                            >
                              게시물 보기
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Auto Publishing</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">행사 포스터 자동 게시</h2>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    현재 자동 게시 기능은 선택한 행사 포스터 이미지를 단일 피드 게시물로 올립니다.
                  </p>
                </div>
                <Link
                  href="/schedule"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-100"
                >
                  <CalendarPlus2 className="h-4 w-4" />
                  예약 캘린더 보기
                </Link>
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
                <div className="rounded-[1.75rem] border border-slate-100 bg-[linear-gradient(180deg,#fff8fb_0%,#ffffff_100%)] p-5">
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {createMode ? "선택 행사" : "행사 선택"}
                  </label>
                  {createMode ? (
                    <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-black text-slate-900">
                      {selectedFestival?.title || "전달된 행사 정보가 없습니다."}
                    </div>
                  ) : (
                    <select
                      value={selectedFestivalId}
                      onChange={(event) => {
                        setSelectedFestivalId(event.target.value);
                        setFeedbackMessage(null);
                        setErrorMessage(null);
                      }}
                      className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition-all focus:border-pink-200"
                      disabled={festivalsLoading}
                    >
                      {festivalsLoading && <option>행사 로딩 중...</option>}
                      {!festivalsLoading && festivals.length === 0 && <option>표시할 행사가 없습니다.</option>}
                      {festivals.map((festival) => (
                        <option key={festival.id} value={festival.id}>
                          {festival.title}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-slate-100 bg-white">
                    <div className="aspect-[4/5] bg-slate-100">
                      {selectedFestival?.imageUrl ? (
                        <img
                          src={selectedFestival.imageUrl}
                          alt={selectedFestival.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs font-black text-slate-400">
                          사용할 포스터 이미지가 없습니다.
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="text-sm font-black text-slate-900">{selectedFestival?.title || "행사를 선택해주세요."}</div>
                      <div className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
                        {selectedFestival
                          ? `${selectedFestival.startDate} - ${selectedFestival.endDate} · ${selectedFestival.location}`
                          : "선택한 행사 정보가 여기에 표시됩니다."}
                      </div>
                      {selectedFestival?.sourceUrl && (
                        <a
                          href={selectedFestival.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs font-black text-pink-600 hover:text-pink-700"
                        >
                          원문 보기
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {createMode && (
                    <div className="mt-5 rounded-[1.5rem] border border-slate-100 bg-white p-4">
                      <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">기획안 설정</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">뉴스레터 스타일</label>
                          <select
                            value={planStyle}
                            onChange={(event) => setPlanStyle(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-pink-300"
                          >
                            {PLAN_STYLE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">타겟 독자</label>
                          <select
                            value={planTarget}
                            onChange={(event) => setPlanTarget(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-pink-300"
                          >
                            {PLAN_TARGET_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">카드 비율</label>
                        <div className="grid grid-cols-3 gap-2">
                          {PLAN_ASPECT_RATIOS.map((ratio) => (
                            <button
                              key={ratio}
                              type="button"
                              onClick={() => setPlanAspectRatio(ratio)}
                              className={cn(
                                "rounded-xl border px-3 py-2 text-[11px] font-black transition-all",
                                planAspectRatio === ratio
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                              )}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">슬라이드 개수</label>
                          <span className="text-xs font-black text-pink-600">{planSlideCount}장</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={planSlideCount}
                          onChange={(event) => setPlanSlideCount(Number.parseInt(event.target.value, 10))}
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[#E91E63]"
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-5 rounded-[1.5rem] border border-slate-100 bg-white p-4">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                      예약 시각
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(event) => setScheduleAt(event.target.value)}
                      className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition-all focus:border-pink-200"
                    />
                    <div className="mt-2 text-[11px] font-bold leading-relaxed text-slate-400">
                      브라우저의 현지 시간대로 입력되며 서버에는 ISO 기준으로 저장됩니다.
                    </div>
                  </div>
                </div>

                <CaptionEditor
                  text={captionText}
                  onTextChange={setCaptionText}
                  tone={captionTone}
                  onToneChange={setCaptionTone}
                  styleMode={captionStyle}
                  onStyleModeChange={setCaptionStyle}
                  onGenerateCaption={createMode ? handleGeneratePlanAndCaption : handleGenerateCaption}
                  isGeneratingCaption={createMode ? isPlanGenerating : isCaptionGenerating}
                  quickGenerateLabel={createMode ? "기획안+캡션 생성하기" : undefined}
                  generateButtonLabel={createMode ? "기획안+캡션 생성하기" : undefined}
                  generateButtonLoadingLabel={createMode ? "기획안+캡션 생성 중..." : undefined}
                  showQuickGenerateButton={!createMode}
                  embedded
                  compact
                  className="min-h-[620px]"
                />
              </div>

              {(feedbackMessage || errorMessage || stickyErrorMessage) && (
                <div className="mt-5 space-y-2">
                  {errorMessage && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                      {errorMessage}
                    </div>
                  )}
                  {!errorMessage && feedbackMessage && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                      {feedbackMessage}
                    </div>
                  )}
                  {!errorMessage && stickyErrorMessage && (
                    <div className="flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                      <span>최근 오류: {stickyErrorMessage}</span>
                      <button
                        type="button"
                        onClick={() => setStickyErrorMessage(null)}
                        className="shrink-0 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-700 hover:bg-amber-100"
                      >
                        닫기
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 md:flex-row">
                <button
                  onClick={() => void submitPublishing("now")}
                  disabled={authLoading || isPublishingNow || isScheduling}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-[1.25rem] bg-pink-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-700 disabled:opacity-50"
                >
                  {isPublishingNow ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  지금 인스타그램에 게시
                </button>
                <button
                  onClick={() => void submitPublishing("schedule")}
                  disabled={authLoading || isScheduling || isPublishingNow}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-sm font-black text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  {isScheduling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  예약 큐에 저장
                </button>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Publishing Queue</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">게시·예약 내역</h2>
                </div>
                <button
                  onClick={() => void refreshAutomationData()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  갱신
                </button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-[1.4rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">예약 중</div>
                  <div className="mt-2 text-xl font-black text-slate-900">{queueCounts.scheduled}</div>
                </div>
                <div className="rounded-[1.4rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">발행 완료</div>
                  <div className="mt-2 text-xl font-black text-slate-900">{queueCounts.published}</div>
                </div>
              </div>

              {latestPublished && (
                <div className="mt-5 rounded-[1.6rem] border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Latest Success</div>
                  <div className="mt-2 text-sm font-black text-slate-900">{latestPublished.festivalTitle || "최근 게시 완료"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{formatDateTime(latestPublished.publishedAt)}</div>
                  {latestPublished.permalink && (
                    <a
                      href={latestPublished.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-xs font-black text-emerald-700 hover:text-emerald-800"
                    >
                      게시물 열기
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 rounded-[1.6rem] border border-slate-100 bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { value: "all" as const, label: "전체" },
                        { value: "scheduled" as const, label: "예약" },
                        { value: "published" as const, label: "게시 완료" },
                        { value: "failed" as const, label: "실패" },
                        { value: "in-progress" as const, label: "진행/대기" },
                      ] satisfies { value: QueueStatusFilter; label: string }[]
                    ).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setQueueStatusFilter(option.value);
                          setQueuePage(1);
                          void fetchQueue({
                            page: 1,
                            status: option.value,
                            mode: queueModeFilter,
                          });
                        }}
                        className={cn(
                          "rounded-full border px-4 py-2 text-xs font-black transition-all",
                          queueStatusFilter === option.value
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 md:justify-end">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">유형</div>
                    <select
                      value={queueModeFilter}
                      onChange={(event) => {
                        const nextMode = event.target.value as QueueModeFilter;
                        setQueueModeFilter(nextMode);
                        setQueuePage(1);
                        void fetchQueue({
                          page: 1,
                          status: queueStatusFilter,
                          mode: nextMode,
                        });
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition-all focus:border-pink-300"
                    >
                      <option value="all">전체</option>
                      <option value="scheduled">예약 게시</option>
                      <option value="now">즉시 게시</option>
                    </select>
                  </div>
                </div>

                <div className="text-xs font-bold text-slate-400">
                  총 {queuePagination.total.toLocaleString("ko-KR")}개 · {queuePagination.page}/{queuePagination.totalPages} 페이지 · 페이지당 {queuePagination.pageSize}개
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {queueLoading && (
                  <div className="rounded-[1.4rem] border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">
                    내역을 불러오는 중입니다...
                  </div>
                )}

                {!queueLoading && queue.length === 0 && (
                  <div className="rounded-[1.4rem] border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-bold text-slate-400">
                    아직 게시 또는 예약된 항목이 없습니다.
                  </div>
                )}

                {!queueLoading &&
                  queue.length > 0 &&
                  queuePagination.total === 0 && (
                    <div className="rounded-[1.4rem] border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-bold text-slate-400">
                      필터 조건에 맞는 내역이 없습니다.
                    </div>
                  )}

                {!queueLoading &&
                  queue.map((item) => (
                    <article key={item.id} className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black", statusToneMap[item.status])}>
                              {statusLabelMap[item.status]}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {item.publishMode === "scheduled" ? "예약 게시" : "즉시 게시"}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-sm font-black text-slate-900">
                            {item.festivalTitle || "제목 없는 게시물"}
                          </div>
                          <div className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                            {item.scheduledFor
                              ? `예약 시각 ${formatDateTime(item.scheduledFor)}`
                              : item.publishedAt
                                ? `게시 완료 ${formatDateTime(item.publishedAt)}`
                                : `생성됨 ${formatDateTime(item.createdAt)}`}
                          </div>
                          {item.lastError && (
                            <div className="mt-2 text-xs font-bold text-rose-500">{item.lastError}</div>
                          )}
                          {(item.status === "scheduled" || item.status === "queued") && (
                            <button
                              onClick={() => void handleCancelScheduledPost(item.id)}
                              disabled={cancelingQueueId === item.id}
                              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {cancelingQueueId === item.id ? "취소 중..." : "예약 취소"}
                            </button>
                          )}
                          {item.permalink && (
                            <a
                              href={item.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1 text-xs font-black text-pink-600 hover:text-pink-700"
                            >
                              인스타 게시물 열기
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
              </div>

              {!queueLoading && queuePagination.total > 0 && (
                <div className="mt-5 flex items-center justify-between">
                  <button
                    onClick={() => {
                      const nextPage = Math.max(1, queuePagination.page - 1);
                      setQueuePage(nextPage);
                      void fetchQueue({
                        page: nextPage,
                        status: queueStatusFilter,
                        mode: queueModeFilter,
                      });
                    }}
                    disabled={queuePagination.page <= 1}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    이전
                  </button>
                  <button
                    onClick={() => {
                      const nextPage = Math.min(queuePagination.totalPages, queuePagination.page + 1);
                      setQueuePage(nextPage);
                      void fetchQueue({
                        page: nextPage,
                        status: queueStatusFilter,
                        mode: queueModeFilter,
                      });
                    }}
                    disabled={queuePagination.page >= queuePagination.totalPages}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    다음
                  </button>
                </div>
              )}
            </section>

            {createMode && generatedPlanSlides.length > 0 && (
              <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Cardnews Preview</div>
                <h2 className="mt-2 text-xl font-black text-slate-900">카드뉴스 미리보기</h2>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  기획안 생성 결과를 인스타 피드 형태로 바로 확인할 수 있습니다.
                </p>
                <div className="mt-5">
                  <CarouselPreview
                    slides={generatedPlanSlides}
                    aspectRatio={planAspectRatio}
                    caption={captionText}
                    accountName={previewAccountName}
                    accountLocation={connectedAccountMeta}
                  />
                </div>
                <div className="mt-6 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">기획안 편집</div>
                  <div className="mt-3 space-y-3">
                    {generatedPlanSlides.map((slide, index) => (
                      <div key={slide.id || `editable-slide-${index + 1}`} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="mb-2 text-[11px] font-black text-slate-400">슬라이드 {index + 1}</div>
                        <input
                          value={slide.title}
                          onChange={(event) => updateGeneratedPlanSlide(index, "title", event.target.value)}
                          placeholder="슬라이드 제목"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-800 outline-none focus:border-pink-300"
                        />
                        <textarea
                          value={slide.body || slide.content || ""}
                          onChange={(event) => updateGeneratedPlanSlide(index, "body", event.target.value)}
                          placeholder="슬라이드 본문"
                          className="mt-2 h-20 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold leading-relaxed text-slate-700 outline-none focus:border-pink-300"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Operational Note</div>
              <h2 className="mt-2 text-xl font-black text-slate-900">현재 자동 게시 방식</h2>
              <div className="mt-4 space-y-3 text-sm font-bold leading-relaxed text-slate-500">
                <p>현재 자동 게시 기능은 선택한 행사 포스터 이미지를 단일 피드 게시물로 업로드합니다.</p>
                <p>대시보드의 카드뉴스 슬라이드 데이터는 아직 이미지 렌더링 파이프라인이 없어서 인스타 API로 바로 전송되지는 않습니다.</p>
                <p>카드뉴스를 실제 이미지로 내보내는 단계가 연결되면 이 페이지에서도 멀티 슬라이드 자동 게시로 확장할 수 있습니다.</p>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <ContentStudio embedded selectedCardnewsId={selectedSavedCardnewsId} />
          <SavedContentBoard
            title="저장된 콘텐츠"
            pageSize={10}
            selectedItemId={selectedSavedCardnewsId}
            onSelectItem={(item) => setSelectedSavedCardnewsId(item.id)}
          />
        </div>
      )}

    </div>
  );
}
