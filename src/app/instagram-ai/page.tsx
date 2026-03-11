"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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

type AngleType = string;

type SuggestedAngle = {
  type: AngleType;
  label: string;
  hook: string;
  description: string;
};

type SuggestAnglesResponse = {
  angles?: unknown;
  error?: string;
};

type PlanGenerationContext = {
  festival: UnifiedFestival;
  content: string;
};

type FailureKind = "generation" | "upload";
type FailureSource = "local" | "queue";

type FailureEvent = {
  id: string;
  kind: FailureKind;
  stage: string;
  message: string;
  createdAt: string;
  source: FailureSource;
  festivalTitle?: string | null;
  recordId?: string | null;
};

type FailureReasonSummary = {
  key: string;
  title: string;
  guide: string;
  count: number;
  latestAt: string;
  latestStage: string;
  latestMessage: string;
  latestFestivalTitle: string | null;
};

type FestivalResearchSnapshot = {
  ticketPrice?: string;
  venue?: string;
  lineup?: string;
  performanceSchedule?: string;
  bookingSite?: string;
  sourceUrl?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  price?: string;
  homepage?: string;
  description?: string;
  details?: Array<{ label: string; value: string }>;
};

type FestivalResearchResultItem = {
  festivalId?: string;
  title?: string;
  status?: "updated" | "unchanged" | "not-found" | "no-match" | "error";
  searchedAt?: string;
  updatedFields?: string[];
  researched?: FestivalResearchSnapshot;
  message?: string;
};

type GenerationResearchReport = {
  festivalId: string;
  festivalTitle: string;
  status: "updated" | "unchanged" | "not-found" | "no-match" | "error";
  searchedAt: string;
  updatedFields: string[];
  researched: FestivalResearchSnapshot | null;
  message: string;
};

const MAX_LOCAL_FAILURE_EVENTS = 40;
const normalizeSuggestedAngles = (value: unknown): SuggestedAngle[] => {
  if (!Array.isArray(value)) return [] as SuggestedAngle[];

  const normalized = value
    .map((item): SuggestedAngle | null => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const type = typeof raw.type === "string" && raw.type.trim()
        ? raw.type.trim()
        : "CUSTOM";
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      const hook = typeof raw.hook === "string" ? raw.hook.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      if (!label && !hook && !description) return null;
      return { type, label, hook, description };
    })
    .filter((item): item is SuggestedAngle => Boolean(item));

  return normalized.slice(0, 3);
};

const buildAngleHintsContent = (angles: SuggestedAngle[]) => {
  if (angles.length === 0) return "";
  const lines = angles.map((angle, index) =>
    `${index + 1}. ${angle.label}(${angle.type})\n- hook: ${angle.hook}\n- description: ${angle.description}`,
  );
  return `[추천 콘텐츠 앵글]\n${lines.join("\n")}`;
};

const sanitizeFailureMessage = (value: string | null | undefined) => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const isAiQuotaErrorMessage = (value: string | null | undefined) => {
  const normalized = sanitizeFailureMessage(value).toLowerCase();
  if (!normalized) return false;
  return [
    "quota",
    "429",
    "resource_exhausted",
    "rate limit",
    "too many requests",
    "quota exceeded",
  ].some((token) => normalized.includes(token));
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const classifyFailureReason = (message: string, kind: FailureKind) => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("unauthorized")
    || normalized.includes("id token")
    || normalized.includes("invalid token")
    || normalized.includes("로그인")
  ) {
    return {
      title: "로그인 인증 문제",
      guide: "로그인 상태가 만료됐을 수 있습니다. 다시 로그인 후 재시도해주세요.",
    };
  }

  if (
    normalized.includes("quota")
    || normalized.includes("rate limit")
    || normalized.includes("resource_exhausted")
    || normalized.includes("429")
  ) {
    return {
      title: "AI 호출 한도 초과",
      guide: "생성 요청이 많아 일시 제한되었습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  if (
    normalized.includes("json")
    || normalized.includes("parse")
    || normalized.includes("slides array")
    || normalized.includes("response does not include")
  ) {
    return {
      title: "AI 응답 형식 오류",
      guide: "AI 출력 형식이 깨졌습니다. 다시 생성하면 대부분 자동 복구됩니다.",
    };
  }

  if (
    normalized.includes("content is required")
    || normalized.includes("본문 정보가 부족")
    || normalized.includes("행사 본문 정보")
  ) {
    return {
      title: "입력 데이터 부족",
      guide: "행사 본문/설명 데이터를 더 채운 뒤 다시 생성해주세요.",
    };
  }

  if (
    normalized.includes("caption is required")
    || normalized.includes("게시할 캡션")
    || normalized.includes("캡션을 입력")
  ) {
    return {
      title: "캡션 누락",
      guide: "업로드 전에 캡션을 입력하거나 AI 캡션 생성을 먼저 실행해주세요.",
    };
  }

  if (
    normalized.includes("imageurl")
    || normalized.includes("포스터 이미지")
    || normalized.includes("image url")
    || normalized.includes("valid image")
  ) {
    return {
      title: "이미지 설정 오류",
      guide: "게시 이미지 URL 또는 포스터 이미지가 유효한지 확인해주세요.",
    };
  }

  if (
    normalized.includes("scheduledfor must be a future datetime")
    || normalized.includes("예약 시각은 현재보다 미래")
    || normalized.includes("future datetime")
  ) {
    return {
      title: "예약 시간 오류",
      guide: "현재 시각 이후의 예약 시간을 다시 지정해주세요.",
    };
  }

  if (
    normalized.includes("permission")
    || normalized.includes("oauth")
    || normalized.includes("권한")
    || normalized.includes("연결")
  ) {
    return {
      title: "계정 권한/연동 오류",
      guide: "사이드바에서 계정 연결 상태와 권한 승인을 다시 확인해주세요.",
    };
  }

  return kind === "generation"
    ? {
      title: "게시글 생성 실패",
      guide: "입력 데이터를 확인하고 다시 생성해보세요.",
    }
    : {
      title: "업로드 처리 실패",
      guide: "게시 계정 연결 상태를 확인한 뒤 다시 업로드해주세요.",
    };
};

const summarizeFailureReasons = (events: FailureEvent[]) => {
  const buckets = new Map<string, FailureReasonSummary>();

  for (const event of events) {
    const reason = classifyFailureReason(event.message, event.kind);
    const key = `${event.kind}:${reason.title}`;
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, {
        key,
        title: reason.title,
        guide: reason.guide,
        count: 1,
        latestAt: event.createdAt,
        latestStage: event.stage,
        latestMessage: event.message,
        latestFestivalTitle: event.festivalTitle || null,
      });
      continue;
    }

    prev.count += 1;
    if (toTimestamp(event.createdAt) > toTimestamp(prev.latestAt)) {
      prev.latestAt = event.createdAt;
      prev.latestStage = event.stage;
      prev.latestMessage = event.message;
      prev.latestFestivalTitle = event.festivalTitle || null;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return toTimestamp(b.latestAt) - toTimestamp(a.latestAt);
  });
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

const mergeFestivalResearchSnapshot = (
  base: UnifiedFestival,
  snapshot: FestivalResearchSnapshot | null | undefined,
): UnifiedFestival => {
  if (!snapshot) return base;
  const next = { ...base };

  const location = typeof snapshot.location === "string" && snapshot.location.trim()
    ? snapshot.location.trim()
    : (typeof snapshot.venue === "string" && snapshot.venue.trim() ? snapshot.venue.trim() : "");
  if (location) next.location = location;

  const lineup = typeof snapshot.lineup === "string" ? snapshot.lineup.trim() : "";
  if (lineup) next.lineup = lineup;

  const price = typeof snapshot.price === "string" && snapshot.price.trim()
    ? snapshot.price.trim()
    : (typeof snapshot.ticketPrice === "string" && snapshot.ticketPrice.trim() ? snapshot.ticketPrice.trim() : "");
  if (price) next.price = price;

  const homepage = typeof snapshot.homepage === "string" && snapshot.homepage.trim()
    ? snapshot.homepage.trim()
    : (typeof snapshot.bookingSite === "string" && snapshot.bookingSite.trim() ? snapshot.bookingSite.trim() : "");
  if (homepage) next.homepage = homepage;

  const description = typeof snapshot.description === "string" ? snapshot.description.trim() : "";
  if (description) next.description = description;

  const startDate = typeof snapshot.startDate === "string" ? snapshot.startDate.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) next.startDate = startDate;

  const endDate = typeof snapshot.endDate === "string" ? snapshot.endDate.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) next.endDate = endDate;

  if (Array.isArray(snapshot.details) && snapshot.details.length > 0) {
    const details = snapshot.details
      .map((item) => ({
        label: typeof item?.label === "string" ? item.label.trim() : "",
        value: typeof item?.value === "string" ? item.value.trim() : "",
      }))
      .filter((item) => item.label.length > 0 && item.value.length > 0);
    if (details.length > 0) {
      next.details = details;
    }
  }

  return next;
};

const RESEARCH_STATUS_LABEL: Record<GenerationResearchReport["status"], string> = {
  updated: "반영 완료",
  unchanged: "변경 없음",
  "no-match": "자료 미탐색",
  "not-found": "대상 없음",
  error: "오류",
};

const RESEARCH_STATUS_TONE: Record<GenerationResearchReport["status"], string> = {
  updated: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unchanged: "border-slate-200 bg-slate-100 text-slate-700",
  "no-match": "border-amber-200 bg-amber-50 text-amber-700",
  "not-found": "border-violet-200 bg-violet-50 text-violet-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

const RESEARCH_FIELD_LABEL: Record<string, string> = {
  ticketPrice: "티켓 가격",
  venue: "공연 장소",
  performanceSchedule: "공연 일정",
  bookingSite: "예매처",
  location: "장소",
  startDate: "시작일",
  endDate: "종료일",
  description: "행사 소개",
  lineup: "라인업",
  price: "티켓 가격",
  homepage: "홈페이지",
  details: "상세 정보",
  sourceUrl: "원문 링크",
  publishedDate: "게시일",
  publishedAt: "게시 시각",
  imageUrl: "이미지",
  genre: "장르",
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
const RESEARCH_TIMEOUT_MS = 6_500;
const SUGGEST_ANGLES_TIMEOUT_MS = 10_000;

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
  const [suggestedPlanAngles, setSuggestedPlanAngles] = useState<SuggestedAngle[]>([]);
  const [selectedPlanAngle, setSelectedPlanAngle] = useState<SuggestedAngle | null>(null);
  const [showPlanAngleSelector, setShowPlanAngleSelector] = useState(false);
  const [isLoadingPlanAngles, setIsLoadingPlanAngles] = useState(false);
  const [pendingPlanGeneration, setPendingPlanGeneration] = useState<PlanGenerationContext | null>(null);
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
  const [latestResearchReport, setLatestResearchReport] = useState<GenerationResearchReport | null>(null);
  const [isResearchReportOpen, setIsResearchReportOpen] = useState(true);
  const [localFailureEvents, setLocalFailureEvents] = useState<FailureEvent[]>([]);
  const [isFailureDetailsOpen, setIsFailureDetailsOpen] = useState(false);
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
  const failureCardRef = useRef<HTMLElement | null>(null);

  const selectedFestival = useMemo(
    () => {
      if (createMode && fixedFestivalData) {
        return fixedFestivalData;
      }
      return festivals.find((festival) => festival.id === selectedFestivalId) ?? null;
    },
    [createMode, festivals, fixedFestivalData, selectedFestivalId],
  );

  useEffect(() => {
    setSuggestedPlanAngles([]);
    setSelectedPlanAngle(null);
    setShowPlanAngleSelector(false);
    setIsLoadingPlanAngles(false);
    setPendingPlanGeneration(null);
  }, [selectedFestival?.id]);

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

  const registerFailureEvent = useCallback((event: {
    kind: FailureKind;
    stage: string;
    message: string;
    festivalTitle?: string | null;
    source?: FailureSource;
    recordId?: string | null;
    createdAt?: string;
  }) => {
    const normalizedMessage = sanitizeFailureMessage(event.message);
    if (!normalizedMessage) return;
    const now = event.createdAt || new Date().toISOString();
    const id = `${event.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    setLocalFailureEvents((prev) => [
      {
        id,
        kind: event.kind,
        stage: event.stage,
        message: normalizedMessage,
        createdAt: now,
        source: event.source || "local",
        festivalTitle: event.festivalTitle || null,
        recordId: event.recordId || null,
      },
      ...prev,
    ].slice(0, MAX_LOCAL_FAILURE_EVENTS));
  }, []);

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

  const researchFestivalForGeneration = useCallback(async (festival: UnifiedFestival) => {
    const requestStartedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);

    try {
      const updateRes = await fetch("/api/festivals/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ festivalIds: [festival.id] }),
        signal: controller.signal,
      });

      const updateData = (await updateRes.json().catch(() => ({}))) as {
        error?: string;
        results?: FestivalResearchResultItem[];
      };

      if (!updateRes.ok) {
        throw new Error(updateData.error || "행사 자료 조사에 실패했습니다.");
      }

      const researchResult = Array.isArray(updateData.results) ? updateData.results[0] : null;
      if (researchResult?.status === "error") {
        const rawMessage = researchResult.message || "행사 자료 조사 중 오류가 발생했습니다.";
        if (isAiQuotaErrorMessage(rawMessage)) {
          const notice = "AI 조사 호출 한도에 도달해 기존 행사 정보로 생성합니다.";
          setLatestResearchReport({
            festivalId: festival.id,
            festivalTitle: festival.title,
            status: "unchanged",
            searchedAt: researchResult.searchedAt || requestStartedAt,
            updatedFields: [],
            researched: null,
            message: notice,
          });
          setIsResearchReportOpen(true);
          setStickyErrorMessage(notice);
          registerFailureEvent({
            kind: "generation",
            stage: "행사 자료 조사",
            message: notice,
            festivalTitle: festival.title,
          });
          return festival;
        }
        throw new Error(rawMessage);
      }

      if (researchResult?.status === "no-match" || researchResult?.status === "not-found") {
        const notice = researchResult.message || "추가 자료를 찾지 못해 기존 행사 정보로 생성합니다.";
        setLatestResearchReport({
          festivalId: festival.id,
          festivalTitle: festival.title,
          status: researchResult.status,
          searchedAt: researchResult.searchedAt || requestStartedAt,
          updatedFields: Array.isArray(researchResult.updatedFields) ? researchResult.updatedFields : [],
          researched: researchResult.researched || null,
          message: notice,
        });
        setIsResearchReportOpen(true);
        setStickyErrorMessage(notice);
        registerFailureEvent({
          kind: "generation",
          stage: "행사 자료 조사",
          message: notice,
          festivalTitle: festival.title,
        });
        return festival;
      }

      const mergedFestival = mergeFestivalResearchSnapshot(festival, researchResult?.researched || null);
      const nextStatus = researchResult?.status === "updated" ? "updated" : "unchanged";
      const nextMessage = researchResult?.message
        || (nextStatus === "updated"
          ? "Gemini 조사 결과를 반영해 행사 정보를 보강했습니다."
          : "Gemini 조사 결과를 확인했지만 기존 정보와 차이가 거의 없었습니다.");
      setLatestResearchReport({
        festivalId: festival.id,
        festivalTitle: festival.title,
        status: nextStatus,
        searchedAt: researchResult?.searchedAt || requestStartedAt,
        updatedFields: Array.isArray(researchResult?.updatedFields) ? researchResult.updatedFields : [],
        researched: researchResult?.researched || null,
        message: nextMessage,
      });
      setIsResearchReportOpen(true);
      return mergedFestival;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setLatestResearchReport({
          festivalId: festival.id,
          festivalTitle: festival.title,
          status: "unchanged",
          searchedAt: requestStartedAt,
          updatedFields: [],
          researched: null,
          message: "조사 시간이 길어 기존 행사 정보로 바로 생성합니다.",
        });
        setIsResearchReportOpen(true);
        return festival;
      }
      const message = error instanceof Error ? error.message : "행사 자료 조사 중 오류가 발생했습니다.";
      if (isAiQuotaErrorMessage(message)) {
        const notice = "AI 조사 호출 한도에 도달해 기존 행사 정보로 생성합니다.";
        setLatestResearchReport({
          festivalId: festival.id,
          festivalTitle: festival.title,
          status: "unchanged",
          searchedAt: requestStartedAt,
          updatedFields: [],
          researched: null,
          message: notice,
        });
        setIsResearchReportOpen(true);
        setStickyErrorMessage(notice);
        registerFailureEvent({
          kind: "generation",
          stage: "행사 자료 조사",
          message: notice,
          festivalTitle: festival.title,
        });
        return festival;
      }
      setLatestResearchReport({
        festivalId: festival.id,
        festivalTitle: festival.title,
        status: "error",
        searchedAt: requestStartedAt,
        updatedFields: [],
        researched: null,
        message,
      });
      setIsResearchReportOpen(true);
      setStickyErrorMessage(message);
      registerFailureEvent({
        kind: "generation",
        stage: "행사 자료 조사",
        message,
        festivalTitle: festival.title,
      });
      return festival;
    } finally {
      clearTimeout(timeoutId);
    }
  }, [registerFailureEvent]);

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
      const nextMessage = "캡션을 만들 행사 데이터를 먼저 선택해주세요.";
      setErrorMessage(nextMessage);
      registerFailureEvent({
        kind: "generation",
        stage: "AI 캡션 생성",
        message: nextMessage,
      });
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
      const nextMessage = error instanceof Error ? error.message : "AI 캡션 생성에 실패했습니다.";
      setErrorMessage(nextMessage);
      registerFailureEvent({
        kind: "generation",
        stage: "AI 캡션 생성",
        message: nextMessage,
        festivalTitle: selectedFestival?.title || null,
      });
    } finally {
      setIsCaptionGenerating(false);
    }
  }, [captionStyle, captionTone, registerFailureEvent, selectedFestival]);

  const executePlanGeneration = useCallback(async (
    context: PlanGenerationContext,
    angleSelection: SuggestedAngle | null,
  ) => {
    setIsPlanGenerating(true);
    setErrorMessage(null);

    try {
      const headers = await buildAuthHeaders(true);
      const angleHints = buildAngleHintsContent(suggestedPlanAngles);
      const selectedAngleBlock = angleSelection
        ? `[선택 앵글]\n- type: ${angleSelection.type}\n- label: ${angleSelection.label}\n- hook: ${angleSelection.hook}\n- description: ${angleSelection.description}`
        : "";
      const contentWithAngleHints = [
        context.content,
        angleHints || null,
        selectedAngleBlock || null,
      ].filter(Boolean).join("\n\n");

      setFeedbackMessage("기획안과 캡션을 생성하고 있습니다...");
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: contentWithAngleHints,
          angleHints: suggestedPlanAngles,
          ...(angleSelection ? {
            angle: angleSelection.type,
            angleHook: angleSelection.hook,
          } : {}),
          style: planStyle,
          target: planTarget,
          aspectRatio: planAspectRatio,
          genre: context.festival.genre,
          source: context.festival.source,
          sourceLabel: context.festival.sourceLabel || context.festival.source,
          imageUrl: context.festival.imageUrl,
          slideCount: planSlideCount,
          tone: captionTone,
          captionStyle,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        slides?: Array<Record<string, unknown>>;
        caption?: string;
        draftId?: string | null;
        validationIssues?: string[];
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
            : (index === 0 ? context.festival.imageUrl : undefined);
          const renderedImageUrl = typeof slide.renderedImageUrl === "string" && slide.renderedImageUrl.trim()
            ? slide.renderedImageUrl.trim()
            : undefined;
          return {
            id: `${context.festival.id}-${index + 1}`,
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
      const validationIssues = Array.isArray(data.validationIssues)
        ? data.validationIssues
            .map((issue) => sanitizeFailureMessage(typeof issue === "string" ? issue : null))
            .filter((issue): issue is string => Boolean(issue))
        : [];
      if (validationIssues.length > 0) {
        const summary = validationIssues.slice(0, 3).join(" / ");
        registerFailureEvent({
          kind: "generation",
          stage: "기획안 생성 보정",
          message: summary,
          festivalTitle: context.festival.title,
        });
        setStickyErrorMessage(`AI 보정 이슈: ${summary}`);
      }

      setFeedbackMessage("기획안과 캡션을 생성했습니다.");
      setShowPlanAngleSelector(false);
      setPendingPlanGeneration(null);
    } catch (error) {
      console.error(error);
      const nextMessage = error instanceof Error ? error.message : "기획안 생성에 실패했습니다.";
      setErrorMessage(nextMessage);
      registerFailureEvent({
        kind: "generation",
        stage: "기획안+캡션 생성",
        message: nextMessage,
        festivalTitle: context.festival.title,
      });
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
    registerFailureEvent,
    suggestedPlanAngles,
  ]);

  const handleGeneratePlanAndCaption = useCallback(async () => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    if (!selectedFestival) {
      const nextMessage = "기획안을 생성할 행사 정보를 찾지 못했습니다.";
      setErrorMessage(nextMessage);
      registerFailureEvent({
        kind: "generation",
        stage: "기획안+캡션 생성",
        message: nextMessage,
      });
      return;
    }

    setIsPlanGenerating(true);
    setIsLoadingPlanAngles(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    setLatestResearchReport(null);
    setSuggestedPlanAngles([]);
    setSelectedPlanAngle(null);
    setShowPlanAngleSelector(true);
    setPendingPlanGeneration(null);

    try {
      setFeedbackMessage("선택한 행사 자료를 조사하고 있습니다...");
      const festivalForGeneration = await researchFestivalForGeneration(selectedFestival);
      const content = buildFestivalPlanContent(festivalForGeneration);
      if (!content.trim()) {
        throw new Error("행사 본문 정보가 부족해서 기획안을 생성할 수 없습니다.");
      }

      setPendingPlanGeneration({
        festival: festivalForGeneration,
        content,
      });

      const headers = await buildAuthHeaders(true);
      setFeedbackMessage("콘텐츠 앵글을 생성하고 있습니다...");

      let nextAngles: SuggestedAngle[] = [];
      const suggestAnglesController = new AbortController();
      const suggestAnglesTimeoutId = setTimeout(() => suggestAnglesController.abort(), SUGGEST_ANGLES_TIMEOUT_MS);
      try {
        const suggestAnglesRes = await fetch("/api/suggest-angles", {
          method: "POST",
          headers,
          body: JSON.stringify({ content }),
          signal: suggestAnglesController.signal,
        });
        const suggestAnglesData = (await suggestAnglesRes.json().catch(() => ({}))) as SuggestAnglesResponse;
        if (!suggestAnglesRes.ok) {
          setSuggestedPlanAngles([
            { type: "VIBE", label: "감성/분위기", hook: "이번 시즌 꼭 가야 할 이유", description: "분위기와 경험을 중심으로 한 앵글" },
            { type: "LINEUP", label: "라인업", hook: "이 라인업 보고도 안 가면 후회", description: "아티스트 기대감을 자극하는 앵글" },
            { type: "SCARCITY", label: "희소성", hook: "딱 이번뿐, 놓치면 1년 기다려야 해", description: "희소성으로 클릭을 유도하는 앵글" },
          ]);
          setFeedbackMessage("추천 앵글을 선택한 뒤 생성을 진행하세요.");
          return;
        }
        nextAngles = normalizeSuggestedAngles(suggestAnglesData.angles);
      } catch (suggestAnglesError) {
        console.warn("Failed to load suggested angles:", suggestAnglesError);
      } finally {
        clearTimeout(suggestAnglesTimeoutId);
      }

      setSuggestedPlanAngles(nextAngles);
      if (nextAngles.length > 0) {
        setFeedbackMessage("추천 앵글을 선택한 뒤 생성을 진행하세요.");
      } else {
        setFeedbackMessage("추천 앵글이 없어도 'AI한테 맡기기'로 생성할 수 있습니다.");
      }
    } catch (error) {
      console.error(error);
      const nextMessage = error instanceof Error ? error.message : "기획안 생성에 실패했습니다.";
      setErrorMessage(nextMessage);
      registerFailureEvent({
        kind: "generation",
        stage: "기획안+캡션 생성",
        message: nextMessage,
        festivalTitle: selectedFestival?.title || null,
      });
      setShowPlanAngleSelector(false);
      setPendingPlanGeneration(null);
    } finally {
      setIsLoadingPlanAngles(false);
      setIsPlanGenerating(false);
    }
  }, [
    buildAuthHeaders,
    registerFailureEvent,
    researchFestivalForGeneration,
    selectedFestival,
    user,
  ]);

  const handleGenerateWithSelectedPlanAngle = useCallback(async () => {
    if (!selectedPlanAngle) {
      setShowPlanAngleSelector(true);
      return;
    }
    if (!pendingPlanGeneration) {
      setErrorMessage("먼저 기획안+캡션 생성하기를 눌러 앵글을 추천받아 주세요.");
      return;
    }
    await executePlanGeneration(pendingPlanGeneration, selectedPlanAngle);
  }, [executePlanGeneration, pendingPlanGeneration, selectedPlanAngle]);

  const handleGeneratePlanWithoutAngle = useCallback(async () => {
    if (!pendingPlanGeneration) {
      setErrorMessage("먼저 기획안+캡션 생성하기를 눌러 앵글을 추천받아 주세요.");
      return;
    }
    await executePlanGeneration(pendingPlanGeneration, null);
  }, [executePlanGeneration, pendingPlanGeneration]);

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
      const stageLabel = mode === "now" ? "즉시 게시" : "예약 게시";
      const reportUploadFailure = (message: string) => {
        setErrorMessage(message);
        registerFailureEvent({
          kind: "upload",
          stage: stageLabel,
          message,
          festivalTitle: selectedFestival?.title || null,
        });
      };

      if (!user) {
        window.location.href = "/login";
        return;
      }
      if (!isConnected || !selectionInfo?.igUserId) {
        reportUploadFailure("인스타그램 계정 연결/전환은 사이드바의 연결 계정에서 설정해주세요.");
        return;
      }
      if (!selectedFestival?.imageUrl) {
        reportUploadFailure("게시에 사용할 포스터 이미지가 없는 행사입니다.");
        return;
      }
      if (!captionText.trim()) {
        reportUploadFailure("게시할 캡션을 입력해주세요.");
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
        reportUploadFailure("예약 시각은 현재보다 미래여야 합니다.");
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
            const failureMessage = data.post.lastError || "인스타그램 게시에 실패했습니다.";
            reportUploadFailure(failureMessage);
          } else {
            setFeedbackMessage("게시 요청을 접수했습니다.");
          }
        } else {
          setFeedbackMessage("예약 게시를 저장했습니다.");
        }

        await refreshAutomationData();
      } catch (error) {
        console.error(error);
        const nextMessage = error instanceof Error ? error.message : "게시 요청에 실패했습니다.";
        reportUploadFailure(nextMessage);
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
      registerFailureEvent,
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
    if (!isFailureDetailsOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!failureCardRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!failureCardRef.current.contains(target)) {
        setIsFailureDetailsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFailureDetailsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFailureDetailsOpen]);

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
      setLocalFailureEvents([]);
      setIsFailureDetailsOpen(false);
      return;
    }

    if (initializedUserRef.current === user.uid) {
      return;
    }
    initializedUserRef.current = user.uid;
    setQueueStatusFilter("all");
    setQueueModeFilter("all");
    setQueuePage(1);
    setLocalFailureEvents([]);
    setIsFailureDetailsOpen(false);
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

  useEffect(() => {
    if (authLoading || !user) return;

    const runAutoDispatch = async () => {
      await dispatchScheduledPosts();
      await fetchQueue();
    };

    void runAutoDispatch();
    const intervalId = window.setInterval(() => {
      void runAutoDispatch();
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authLoading, dispatchScheduledPosts, fetchQueue, user]);

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

  const connectedIgUsername = (selectionInfo?.igUsername || pages[0]?.igUsername || "").replace(/^@/, "").trim();
  const connectedInstagramUrl = connectedIgUsername
    ? `https://www.instagram.com/${encodeURIComponent(connectedIgUsername)}/`
    : null;
  const connectedInstagramIconLabel = connectedIgUsername
    ? `@${connectedIgUsername} 인스타그램 프로필 열기`
    : "인스타그램 열기";

  const previewAccountName = (selectionInfo?.igUsername
    || pages[0]?.igUsername
    || selectionInfo?.pageName
    || pages[0]?.name
    || "instagram_account").replace(/^@/, "");

  const latestPublished = queue.find((item) => item.status === "published") ?? null;
  const queueUploadFailureEvents = useMemo<FailureEvent[]>(
    () => queue
      .filter((item) => item.status === "failed")
      .map((item) => ({
        id: `queue-${item.id}`,
        kind: "upload",
        stage: item.publishMode === "scheduled" ? "예약 게시" : "즉시 게시",
        message: sanitizeFailureMessage(item.lastError || "인스타그램 업로드 처리 중 오류가 발생했습니다."),
        createdAt: item.failedAt || item.updatedAt || item.createdAt || new Date().toISOString(),
        source: "queue",
        festivalTitle: item.festivalTitle || null,
        recordId: item.id,
      })),
    [queue],
  );

  const generationFailureEvents = useMemo(
    () => localFailureEvents
      .filter((event) => event.kind === "generation")
      .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))
      .slice(0, 20),
    [localFailureEvents],
  );

  const uploadFailureEvents = useMemo(() => {
    const merged = [
      ...localFailureEvents.filter((event) => event.kind === "upload"),
      ...queueUploadFailureEvents,
    ];
    return merged
      .filter((event) => Boolean(sanitizeFailureMessage(event.message)))
      .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))
      .slice(0, 20);
  }, [localFailureEvents, queueUploadFailureEvents]);

  const generationFailureSummaries = useMemo(
    () => summarizeFailureReasons(generationFailureEvents).slice(0, 4),
    [generationFailureEvents],
  );
  const uploadFailureSummaries = useMemo(
    () => summarizeFailureReasons(uploadFailureEvents).slice(0, 4),
    [uploadFailureEvents],
  );

  const latestFailureEvent = useMemo(() => {
    const combined = [...generationFailureEvents, ...uploadFailureEvents];
    if (combined.length === 0) return null;
    return combined.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))[0];
  }, [generationFailureEvents, uploadFailureEvents]);

  const latestFailureReason = latestFailureEvent
    ? classifyFailureReason(latestFailureEvent.message, latestFailureEvent.kind)
    : null;
  const totalFailureCount = generationFailureEvents.length + uploadFailureEvents.length;

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
            key: "connection",
            label: "연결 상태",
            value: isConnected ? "연결됨" : "미연결",
            icon: Link2,
            tone: isConnected ? "text-emerald-600 bg-emerald-50" : "text-slate-500 bg-slate-100",
          },
          {
            key: "account",
            label: "게시 계정",
            value: connectedAccountLabel,
            icon: Instagram,
            tone: "text-pink-600 bg-pink-50",
            iconHref: connectedInstagramUrl,
            iconLabel: connectedInstagramIconLabel,
          },
          {
            key: "scheduled",
            label: "예약 게시",
            value: String(queueCounts.scheduled),
            icon: CalendarClock,
            tone: "text-amber-600 bg-amber-50",
          },
          {
            key: "published",
            label: "게시 완료",
            value: String(queueCounts.published),
            icon: CheckCircle2,
            tone: "text-emerald-600 bg-emerald-50",
          },
          {
            key: "failure",
            label: "실패/오류",
            value: String(queueCounts.failed),
            icon: AlertTriangle,
            tone: "text-rose-600 bg-rose-50",
            isFailureCard: true,
          },
        ].map((item) => {
          const isFailureCard = Boolean(item.isFailureCard);
          return (
            <section
              key={item.key}
              ref={isFailureCard ? failureCardRef : undefined}
              className={cn("rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm", isFailureCard && "relative")}
            >
              {item.iconHref ? (
                <a
                  href={item.iconHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={item.iconLabel}
                  title={item.iconLabel}
                  className={cn(
                    "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300 focus-visible:ring-offset-2",
                    item.tone,
                  )}
                >
                  <item.icon className="h-5 w-5" />
                </a>
              ) : (
                <div className={cn("mb-4 flex h-12 w-12 items-center justify-center rounded-2xl", item.tone)}>
                  <item.icon className="h-5 w-5" />
                </div>
              )}
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{item.label}</div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-2xl font-black text-slate-900">{item.value}</div>
                {isFailureCard && (
                  <button
                    type="button"
                    onClick={() => setIsFailureDetailsOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 transition hover:bg-rose-100"
                    aria-expanded={isFailureDetailsOpen}
                    aria-label={isFailureDetailsOpen ? "실패 원인 상세 닫기" : "실패 원인 상세 열기"}
                  >
                    원인 보기
                    {isFailureDetailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {isFailureCard && isFailureDetailsOpen && (
                <div className="absolute left-0 right-0 top-full z-40 mt-3 rounded-[1.4rem] border border-rose-200 bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.2)] xl:left-auto xl:w-[460px]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-rose-500">실패 원인 상세</div>
                      <p className="mt-1 text-sm font-black text-slate-900">최근 실패 {totalFailureCount}건</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFailureDetailsOpen(false)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50"
                    >
                      닫기
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <article className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-black text-slate-900">게시글 생성 실패</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-700">
                          {generationFailureEvents.length}건
                        </span>
                      </div>
                      {generationFailureSummaries.length === 0 ? (
                        <p className="mt-2 text-[11px] font-bold text-slate-500">최근 생성 실패가 없습니다.</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {generationFailureSummaries.map((summary) => (
                            <div key={summary.key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-black text-slate-900">{summary.title}</p>
                                <span className="text-[10px] font-black text-slate-500">{summary.count}건</span>
                              </div>
                              <p className="mt-1 text-[11px] font-bold text-slate-500">{summary.guide}</p>
                              <p className="mt-1 text-[10px] font-bold text-slate-400">
                                최근 {formatDateTime(summary.latestAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>

                    <article className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-black text-slate-900">업로드/발행 실패</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-700">
                          {uploadFailureEvents.length}건
                        </span>
                      </div>
                      {uploadFailureSummaries.length === 0 ? (
                        <p className="mt-2 text-[11px] font-bold text-slate-500">최근 업로드 실패가 없습니다.</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {uploadFailureSummaries.map((summary) => (
                            <div key={summary.key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-black text-slate-900">{summary.title}</p>
                                <span className="text-[10px] font-black text-slate-500">{summary.count}건</span>
                              </div>
                              <p className="mt-1 text-[11px] font-bold text-slate-500">{summary.guide}</p>
                              <p className="mt-1 text-[10px] font-bold text-slate-400">
                                최근 {formatDateTime(summary.latestAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>

                    {latestFailureEvent && latestFailureReason && (
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-rose-500">최근 오류 상세</div>
                        <div className="mt-1 text-[11px] font-black text-slate-900">
                          {latestFailureEvent.kind === "generation" ? "생성 실패" : "업로드 실패"} · {latestFailureEvent.stage}
                          {latestFailureEvent.festivalTitle ? ` · ${latestFailureEvent.festivalTitle}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] font-bold text-slate-600">{latestFailureReason.guide}</div>
                        <div className="mt-2 rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[11px] font-bold leading-relaxed text-rose-700">
                          {latestFailureEvent.message}
                        </div>
                        <div className="mt-1 text-[10px] font-bold text-slate-400">{formatDateTime(latestFailureEvent.createdAt)}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
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

              {(feedbackMessage || errorMessage || stickyErrorMessage || latestResearchReport) && (
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
                  {latestResearchReport && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <button
                        type="button"
                        onClick={() => setIsResearchReportOpen((prev) => !prev)}
                        className="flex w-full items-start justify-between gap-4 text-left"
                      >
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">AI 조사 결과</div>
                          <div className="mt-1 text-sm font-black text-slate-900">{latestResearchReport.festivalTitle}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">
                            조사 시각 {formatDateTime(latestResearchReport.searchedAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[10px] font-black",
                              RESEARCH_STATUS_TONE[latestResearchReport.status],
                            )}
                          >
                            {RESEARCH_STATUS_LABEL[latestResearchReport.status]}
                          </span>
                          {isResearchReportOpen ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {isResearchReportOpen && (
                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                            {latestResearchReport.message}
                          </div>
                          {latestResearchReport.updatedFields.length > 0 && (
                            <div className="text-xs font-bold text-emerald-700">
                              반영된 항목: {latestResearchReport.updatedFields.map((field) => RESEARCH_FIELD_LABEL[field] || field).join(", ")}
                            </div>
                          )}
                          {!latestResearchReport.researched && (
                            <div className="text-xs font-bold text-slate-500">
                              이번 조사에서 확보된 추가 텍스트 정보가 없습니다.
                            </div>
                          )}
                          {latestResearchReport.researched && (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {(latestResearchReport.researched.performanceSchedule
                                || latestResearchReport.researched.startDate
                                || latestResearchReport.researched.endDate) && (
                                <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                                  공연 일정: {latestResearchReport.researched.performanceSchedule
                                    || `${latestResearchReport.researched.startDate || "-"} ~ ${latestResearchReport.researched.endDate || "-"}`}
                                </div>
                              )}
                              {(latestResearchReport.researched.venue || latestResearchReport.researched.location) && (
                                <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                                  공연 장소: {latestResearchReport.researched.venue || latestResearchReport.researched.location}
                                </div>
                              )}
                              {latestResearchReport.researched.lineup && (
                                <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                                  라인업: {latestResearchReport.researched.lineup}
                                </div>
                              )}
                              {(latestResearchReport.researched.ticketPrice || latestResearchReport.researched.price) && (
                                <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                                  티켓 가격: {latestResearchReport.researched.ticketPrice || latestResearchReport.researched.price}
                                </div>
                              )}
                              {(() => {
                                const bookingSite = latestResearchReport.researched.bookingSite || latestResearchReport.researched.homepage;
                                if (!bookingSite) return null;
                                if (/^https?:\/\//i.test(bookingSite)) {
                                  return (
                                    <a
                                      href={bookingSite}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-pink-600 hover:text-pink-700"
                                    >
                                      예매처 확인
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  );
                                }
                                return (
                                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                                    예매처: {bookingSite}
                                  </div>
                                );
                              })()}
                              {latestResearchReport.researched.homepage
                                && latestResearchReport.researched.homepage !== latestResearchReport.researched.bookingSite
                                && /^https?:\/\//i.test(latestResearchReport.researched.homepage) && (
                                  <a
                                    href={latestResearchReport.researched.homepage}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-sky-600 hover:text-sky-700"
                                  >
                                    공식 홈페이지
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              {latestResearchReport.researched.sourceUrl && (
                                <a
                                  href={latestResearchReport.researched.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-sky-600 hover:text-sky-700"
                                >
                                  조사 원문 보기
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {latestResearchReport.researched.description && (
                                <div className="sm:col-span-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold leading-relaxed text-slate-700">
                                  조사 요약: {latestResearchReport.researched.description}
                                </div>
                              )}
                              {Array.isArray(latestResearchReport.researched.details) && latestResearchReport.researched.details.length > 0 && (
                                <div className="sm:col-span-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">추출된 상세 정보</div>
                                  <div className="mt-1 space-y-1 text-xs font-bold text-slate-700">
                                    {latestResearchReport.researched.details.map((detail) => (
                                      <div key={`${detail.label}-${detail.value}`}>{detail.label}: {detail.value}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {createMode && showPlanAngleSelector && (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">추천 앵글 선택</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    원하는 앵글을 고르거나, AI 자동 생성으로 바로 진행할 수 있습니다.
                  </div>

                  {isLoadingPlanAngles ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={`plan-angle-skeleton-${index}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
                          <div className="mt-3 h-5 w-full animate-pulse rounded bg-slate-200" />
                          <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-slate-200" />
                        </div>
                      ))}
                    </div>
                  ) : suggestedPlanAngles.length > 0 ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {suggestedPlanAngles.map((item) => {
                        const isSelected = selectedPlanAngle?.type === item.type;
                        return (
                          <button
                            key={`${item.type}-${item.hook}`}
                            type="button"
                            onClick={() => setSelectedPlanAngle(item)}
                            className={cn(
                              "rounded-xl border px-3 py-3 text-left transition-all",
                              isSelected
                                ? "border-pink-500 bg-pink-50 ring-2 ring-pink-200"
                                : "border-slate-200 bg-white hover:border-slate-300",
                            )}
                          >
                            <div className={cn("text-[11px] font-black", isSelected ? "text-pink-700" : "text-slate-700")}>
                              {item.label}
                            </div>
                            <div className={cn("mt-2 text-sm font-black leading-snug", isSelected ? "text-pink-800" : "text-slate-900")}>
                              {item.hook}
                            </div>
                            <div className="mt-2 text-[11px] font-bold text-slate-500">
                              {item.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700">
                      추천 앵글을 불러오지 못했습니다. 아래 &quot;AI한테 맡기기&quot;로 계속 진행할 수 있습니다.
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleGenerateWithSelectedPlanAngle(); }}
                      disabled={isPlanGenerating || isLoadingPlanAngles || !selectedPlanAngle}
                      className="inline-flex items-center justify-center rounded-xl bg-pink-600 px-4 py-2 text-xs font-black text-white transition-all hover:bg-pink-700 disabled:bg-pink-300"
                    >
                      이 앵글로 생성하기
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleGeneratePlanWithoutAngle(); }}
                      disabled={isPlanGenerating || isLoadingPlanAngles}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-60"
                    >
                      AI한테 맡기기
                    </button>
                  </div>
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
