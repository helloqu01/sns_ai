"use client";

import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Search, FileText, Users, MousePointer2, Sparkles, Rocket, CalendarClock,
  Image as ImageIcon, Layout, Save, Calendar, RefreshCw, Info, X, Check, ExternalLink, ChevronLeft, ChevronRight,
  Type, Minus, Plus, ChevronDown, RotateCcw, RotateCw
} from 'lucide-react';
import { CarouselPreview, Slide } from '@/components/carousel-preview';
import { CaptionEditor } from '@/components/caption-editor';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth-provider';
import { UnifiedFestival, FestivalSource } from '@/types/festival';

const aspectRatios = ['1:1', '4:5', '16:9', '9:16', '3:4'];
const styles = ['카드뉴스', '홍보물', '정보전달', '감성에세이'];
const targets = ['1020 MZ세대', '3040 직장인', '학부모', '예비 신혼부부'];
const captionToneOptions = [
  { id: 'professional', label: '전문적', description: '신뢰감 있는 정보형 톤' },
  { id: 'friendly', label: '친근한', description: '부드럽고 쉽게 읽히는 톤' },
  { id: 'trendy', label: '트렌디', description: '감각적이고 힙한 톤' },
];
const captionStyleOptions = [
  { id: 'SCARCITY',  label: '희소성',      description: '놓치면 후회하는 긴박감' },
  { id: 'LINEUP',    label: '라인업',      description: '아티스트 기대감 자극' },
  { id: 'VIBE',      label: '감성/분위기', description: '경험과 분위기 중심' },
  { id: 'TIP',       label: '실용/꿀팁',   description: '저장하고 싶은 정보' },
  { id: 'VALUE',     label: '가성비',      description: '합리적 선택 어필' },
  { id: 'TREND',     label: '트렌드',      description: 'MZ 감성 유행 편승' },
  { id: 'TOGETHER',  label: '동행/공유',   description: '함께 가고 싶은 감정' },
  { id: 'STORY',     label: '스토리',      description: '브랜드 서사와 역사' },
];
const filterOptions: { id: 'all' | 'today' | 'this-week' | '60-days'; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'today', label: '오늘' },
  { id: 'this-week', label: '이번주' },
  { id: '60-days', label: '60일 이내' },
];
const sortOptions: { id: 'date-asc' | 'date-desc'; label: string }[] = [
  { id: 'date-asc', label: '빠른순' },
  { id: 'date-desc', label: '늦은순' },
];
const FESTIVALS_PER_PAGE = 30;
const INTEREST_SCORE_THRESHOLD = 0;
const SHOW_FESTIVAL_SOURCE_SECTION = false;
const SUGGESTED_ANGLE_TYPES = new Set([
  'SCARCITY',
  'LINEUP',
  'VIBE',
  'TIP',
  'VALUE',
  'TREND',
  'TOGETHER',
  'STORY',
]);

type CanvaTemplateOption = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  viewUrl: string | null;
  createUrl: string | null;
  updatedAt: number | null;
};

type CanvaTemplateThumbnailProps = {
  template: CanvaTemplateOption;
  className?: string;
  imageClassName?: string;
  compact?: boolean;
};

const CANVA_TEMPLATE_THUMBNAIL_STALE_MS = 12 * 60 * 1000;
const CANVA_DEV_REDIRECT_URI = 'http://127.0.0.1:3002/api/canva/oauth/callback';
const CANVA_PROD_REDIRECT_URI = 'https://queens-sns.web.app/api/canva/oauth/callback';

const templateUpdatedAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const formatTemplateUpdatedAt = (updatedAt: number | null) => {
  if (typeof updatedAt !== 'number') {
    return '수정일 정보 없음';
  }

  const date = new Date(updatedAt * 1000);
  if (Number.isNaN(date.getTime())) {
    return '수정일 정보 없음';
  }

  return `최근 수정 ${templateUpdatedAtFormatter.format(date)}`;
};

function CanvaTemplateThumbnail({
  template,
  className,
  imageClassName,
  compact = false,
}: CanvaTemplateThumbnailProps) {
  const [hasImageError, setHasImageError] = useState(false);
  const canRenderImage = Boolean(template.thumbnailUrl) && !hasImageError;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.75rem] bg-[linear-gradient(145deg,#fff1f6_0%,#ffffff_38%,#fff7ed_100%)]',
        className,
      )}
    >
      {canRenderImage ? (
        <>
          <img
            src={template.thumbnailUrl || ''}
            alt={`${template.title} 템플릿 썸네일`}
            className={cn('h-full w-full object-cover', imageClassName)}
            onError={() => setHasImageError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-white/10" />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/80 bg-white/85 shadow-lg shadow-rose-100">
            <ImageIcon className="h-6 w-6 text-pink-500" />
          </div>
          <div className="space-y-1">
            <p className={cn('font-black text-slate-800', compact ? 'text-xs' : 'text-sm')}>
              썸네일 준비 중
            </p>
            <p className={cn('font-bold text-slate-500', compact ? 'text-[10px]' : 'text-[11px]')}>
              Canva 미리보기를 아직 불러오지 못했습니다.
            </p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/35 to-transparent" />
    </div>
  );
}

type SavedCardnewsSlide = {
  title?: string | null;
  body?: string | null;
  keywords?: string | null;
  image?: string | null;
  renderedImageUrl?: string | null;
  textPosition?: "top" | "center" | "bottom" | null;
  textOffsetX?: number | null;
  textOffsetY?: number | null;
  titleOffsetX?: number | null;
  titleOffsetY?: number | null;
  bodyOffsetX?: number | null;
  bodyOffsetY?: number | null;
  titleTextStyle?: {
    fontFamily?: string | null;
    fontSize?: number | null;
    color?: string | null;
    fontWeight?: number | null;
  } | null;
  bodyTextStyle?: {
    fontFamily?: string | null;
    fontSize?: number | null;
    color?: string | null;
    fontWeight?: number | null;
  } | null;
};

type SavedCardnewsItem = {
  id: string;
  status?: "draft" | "published";
  title?: string;
  slides?: SavedCardnewsSlide[];
  content?: string | null;
  style?: string | null;
  target?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  imageUrl?: string | null;
  genre?: string | null;
  aspectRatio?: string | null;
  tone?: string | null;
  captionStyle?: string | null;
  caption?: string | null;
};

type SavedCardnewsItemResponse = {
  item?: SavedCardnewsItem;
  error?: string;
};

export type ContentStudioPublishPayload = {
  caption: string;
  imageUrl?: string | null;
  backgroundImageUrl?: string | null;
  aspectRatio?: string | null;
  festivalId?: string | null;
  festivalTitle?: string | null;
  slideImageUrls?: string[];
  slides?: Array<{
    title?: string | null;
    body?: string | null;
    content?: string | null;
    image?: string | null;
    renderedImageUrl?: string | null;
    textPosition?: "top" | "center" | "bottom" | null;
    textOffsetX?: number | null;
    textOffsetY?: number | null;
    titleOffsetX?: number | null;
    titleOffsetY?: number | null;
    bodyOffsetX?: number | null;
    bodyOffsetY?: number | null;
    titleTextStyle?: {
      fontFamily?: string | null;
      fontSize?: number | null;
      color?: string | null;
      fontWeight?: number | null;
    } | null;
    bodyTextStyle?: {
      fontFamily?: string | null;
      fontSize?: number | null;
      color?: string | null;
      fontWeight?: number | null;
    } | null;
  }>;
};

type AngleType = 'SCARCITY' | 'LINEUP' | 'VIBE' | 'TIP' | 'VALUE' | 'TREND' | 'TOGETHER' | 'STORY';

type SuggestedAngle = {
  type: AngleType;
  label: string;
  hook: string;
  description: string;
};

type angle = SuggestedAngle;

type SuggestAnglesResponse = {
  angles?: unknown;
  error?: string;
};

type InsightsSummaryPayload = {
  reach?: number | null;
};

type InsightsDailyPayload = {
  reach?: number | null;
};

type InsightsPayload = {
  summary?: InsightsSummaryPayload | null;
  daily?: InsightsDailyPayload[];
  error?: string;
};

const FALLBACK_SUGGESTED_ANGLES: SuggestedAngle[] = [
  { type: 'VIBE', label: '감성/분위기', hook: '이번 시즌 꼭 가야 할 이유', description: '분위기와 경험을 중심으로 한 앵글' },
  { type: 'LINEUP', label: '라인업', hook: '이 라인업 보고도 안 가면 후회', description: '아티스트 기대감을 자극하는 앵글' },
  { type: 'SCARCITY', label: '희소성', hook: '딱 이번뿐, 놓치면 1년 기다려야 해', description: '희소성으로 클릭을 유도하는 앵글' },
];
const SUGGEST_ANGLES_TIMEOUT_MS = 10_000;
const SUGGEST_ANGLES_CACHE_TTL_MS = 10 * 60 * 1000;
const buildSuggestedAnglesCacheKey = (content: string) =>
  content.replace(/\s+/g, ' ').trim().slice(0, 1200).toLowerCase();
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const formatCompactNumber = (value: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return compactNumberFormatter.format(value);
};

interface ContentStudioProps {
  embedded?: boolean;
  selectedCardnewsId?: string | null;
  autoFestivalId?: string;
  autoFestivalData?: {
    id?: string | null;
    title?: string | null;
    location?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    genre?: string | null;
    source?: string | null;
    sourceLabel?: string | null;
    imageUrl?: string | null;
  };
  autoTrigger?: boolean;
  autoCurationIds?: string[];
  autoCurationTheme?: string;
  autoCurationTrigger?: boolean;
  onPublishNow?: (payload: ContentStudioPublishPayload) => Promise<void> | void;
  onSaveToQueue?: (payload: ContentStudioPublishPayload) => Promise<void> | void;
  isPublishingNow?: boolean;
  isScheduling?: boolean;
  authLoading?: boolean;
}

const asSuggestedAngleType = (value: unknown): AngleType | null => {
  if (typeof value !== 'string') return null;
  return SUGGESTED_ANGLE_TYPES.has(value) ? (value as AngleType) : null;
};

const normalizeSuggestedAngles = (value: unknown): SuggestedAngle[] => {
  if (!Array.isArray(value)) return [] as SuggestedAngle[];

  const normalized = value
    .map((item): SuggestedAngle | null => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const type = asSuggestedAngleType(raw.type);
      const label = typeof raw.label === 'string' ? raw.label.trim() : '';
      const hook = typeof raw.hook === 'string' ? raw.hook.trim() : '';
      const description = typeof raw.description === 'string' ? raw.description.trim() : '';
      if (!type || !label || !hook || !description) return null;
      return { type, label, hook, description };
    })
    .filter((item): item is SuggestedAngle => Boolean(item));

  return normalized.slice(0, 3);
};

const buildAngleHintsContent = (angles: SuggestedAngle[]) => {
  if (angles.length === 0) return '';
  const lines = angles.map((angle, index) =>
    `${index + 1}. ${angle.label}(${angle.type})\n- hook: ${angle.hook}\n- description: ${angle.description}`,
  );
  return `[추천 콘텐츠 앵글]\n${lines.join('\n')}`;
};

const getSlideEditorAspectRatioClass = (aspectRatio: string) => {
  switch (aspectRatio) {
    case '1:1':
      return 'aspect-square';
    case '16:9':
      return 'aspect-video';
    case '9:16':
      return 'aspect-[9/16]';
    case '3:4':
      return 'aspect-[3/4]';
    default:
      return 'aspect-[4/5]';
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getDefaultTextOffsetY = (slide: Slide, index: number) => {
  if (slide.textPosition === 'top') return 24;
  if (slide.textPosition === 'center') return 50;
  if (slide.textPosition === 'bottom') return 78;
  return index === 0 ? 78 : 50;
};

const resolveSlideTextOffset = (slide: Slide, index: number) => ({
  x: typeof slide.textOffsetX === 'number' ? clamp(slide.textOffsetX, 8, 92) : 38,
  y: typeof slide.textOffsetY === 'number' ? clamp(slide.textOffsetY, 10, 90) : getDefaultTextOffsetY(slide, index),
});

const resolveTextPositionFromOffsetY = (offsetY: number): "top" | "center" | "bottom" => {
  if (offsetY <= 36) return 'top';
  if (offsetY >= 64) return 'bottom';
  return 'center';
};

type SlideTextLayerKey = 'title' | 'body';

type SlideTextStyleConfig = {
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: number;
};

const SLIDE_EDITOR_FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'inherit', label: 'inherit' },
  { value: 'Pretendard Variable, sans-serif', label: 'Pretendard' },
  { value: '"Noto Sans KR", sans-serif', label: 'Noto Sans KR' },
  { value: '"Nanum Gothic", sans-serif', label: 'Nanum Gothic' },
  { value: '"Gowun Batang", serif', label: 'Gowun Batang' },
];

const SLIDE_EDITOR_COLOR_OPTIONS = [
  '#000000',
  '#ffffff',
  '#334155',
  '#64748b',
  '#94a3b8',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
];

const SLIDE_EDITOR_WEIGHT_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'L', value: 300 },
  { label: 'N', value: 400 },
  { label: 'M', value: 500 },
  { label: 'SB', value: 600 },
  { label: 'B', value: 700 },
];

const SLIDE_EDITOR_SIZE_PRESETS = [12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
const DEFAULT_TEXT_LAYER = 'title';

const asFiniteNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeSlideTextStyleInput = (
  value: unknown,
  fallback: SlideTextStyleConfig,
) => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const fontFamily = typeof source.fontFamily === 'string' && source.fontFamily.trim().length > 0
    ? source.fontFamily.trim()
    : fallback.fontFamily;
  const fontSize = asFiniteNumber(source.fontSize);
  const color = typeof source.color === 'string' && source.color.trim().length > 0
    ? source.color.trim()
    : fallback.color;
  const fontWeight = asFiniteNumber(source.fontWeight);

  return {
    fontFamily,
    fontSize: clamp(fontSize ?? fallback.fontSize, 12, 96),
    color,
    fontWeight: clamp(fontWeight ?? fallback.fontWeight, 200, 900),
  } satisfies SlideTextStyleConfig;
};

const getDefaultLayerStyle = (layer: SlideTextLayerKey, isCoverSlide: boolean) => {
  if (layer === 'title') {
    return {
      fontFamily: 'inherit',
      fontSize: isCoverSlide ? 54 : 42,
      color: '#ffffff',
      fontWeight: 800,
    } satisfies SlideTextStyleConfig;
  }

  return {
    fontFamily: 'inherit',
    fontSize: isCoverSlide ? 28 : 26,
    color: '#f8fafc',
    fontWeight: 600,
  } satisfies SlideTextStyleConfig;
};

const resolveSlideLayerOffset = (
  slide: Slide,
  index: number,
  layer: SlideTextLayerKey,
) => {
  const base = resolveSlideTextOffset(slide, index);
  if (layer === 'title') {
    return {
      x: typeof slide.titleOffsetX === 'number' ? clamp(slide.titleOffsetX, 8, 92) : base.x,
      y: typeof slide.titleOffsetY === 'number' ? clamp(slide.titleOffsetY, 10, 90) : base.y,
    };
  }
  return {
    x: typeof slide.bodyOffsetX === 'number' ? clamp(slide.bodyOffsetX, 8, 92) : base.x,
    y: typeof slide.bodyOffsetY === 'number' ? clamp(slide.bodyOffsetY, 10, 90) : clamp(base.y + 16, 10, 90),
  };
};

const resolveSlideLayerStyle = (
  slide: Slide,
  index: number,
  layer: SlideTextLayerKey,
) => {
  const fallback = getDefaultLayerStyle(layer, index === 0);
  const source = layer === 'title' ? slide.titleTextStyle : slide.bodyTextStyle;
  return normalizeSlideTextStyleInput(source, fallback);
};

export default function ContentStudio(props: ContentStudioProps) {
  const {
    embedded = false,
    selectedCardnewsId = null,
    autoFestivalData,
    autoTrigger = false,
    autoCurationIds = [],
    autoCurationTheme = '이번 주 공연 소식',
    autoCurationTrigger = false,
    onPublishNow,
    onSaveToQueue,
    isPublishingNow = false,
    isScheduling = false,
    authLoading: externalAuthLoading = false,
  } = props;

  // --- Content Creation State ---
  const [inputText, setInputText] = useState('');
  const [style, setStyle] = useState('카드뉴스');
  const [target, setTarget] = useState('1020 MZ세대');
  const [slideCount, setSlideCount] = useState(6);
  const [ratio, setRatio] = useState('4:5');
  const [captionTone, setCaptionTone] = useState('friendly');
  const [captionStyleMode, setCaptionStyleMode] = useState('');
  const [isCaptionGenerating, setIsCaptionGenerating] = useState(false);

  const [genre, setGenre] = useState('');
  const [source, setSource] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSlides, setGeneratedSlides] = useState<Slide[]>([]);
  const [captionText, setCaptionText] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [suggestedAngles, setSuggestedAngles] = useState<angle[]>([]);
  const [selectedAngle, setSelectedAngle] = useState<angle | null>(null);
  const [isLoadingAngles, setIsLoadingAngles] = useState(false);
  const [showAngleSelector, setShowAngleSelector] = useState(false);
  const [showAllAngles, setShowAllAngles] = useState(false);
  const [isCurationMode, setIsCurationMode] = useState(false);
  const [curationFestivals, setCurationFestivals] = useState<UnifiedFestival[]>([]);
  const [curationTheme, setCurationTheme] = useState('이번 주 공연 소식');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccessAt, setPublishSuccessAt] = useState<number | null>(null);
  const [isSendingToCanva, setIsSendingToCanva] = useState(false);
  const [canvaError, setCanvaError] = useState<string | null>(null);
  const [canvaEditUrl, setCanvaEditUrl] = useState<string | null>(null);
  const [canvaTemplates, setCanvaTemplates] = useState<CanvaTemplateOption[]>([]);
  const [isCanvaTemplatesLoading, setIsCanvaTemplatesLoading] = useState(false);
  const [selectedCanvaTemplateId, setSelectedCanvaTemplateId] = useState('');
  const [canvaTemplatesError, setCanvaTemplatesError] = useState<string | null>(null);
  const [canvaReconnectRequired, setCanvaReconnectRequired] = useState(false);
  const [isCanvaReconnectLoading, setIsCanvaReconnectLoading] = useState(false);
  const [isCanvaTemplatePickerOpen, setIsCanvaTemplatePickerOpen] = useState(false);
  const [pickerCanvaTemplateId, setPickerCanvaTemplateId] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [canvaTemplatesFetchedAt, setCanvaTemplatesFetchedAt] = useState<number | null>(null);
  const [canvaRedirectUri, setCanvaRedirectUri] = useState<string>('');
  const [publishedCardnewsCount, setPublishedCardnewsCount] = useState<number | null>(null);
  const [draftCardnewsCount, setDraftCardnewsCount] = useState<number | null>(null);
  const [averageReach, setAverageReach] = useState<number | null>(null);
  const [isAverageReachLoading, setIsAverageReachLoading] = useState(false);
  const [selectedSavedContentId, setSelectedSavedContentId] = useState<string | null>(null);
  const [isSavedContentLoading, setIsSavedContentLoading] = useState(false);
  const [savedContentError, setSavedContentError] = useState<string | null>(null);
  const [activeSlideEditorIndex, setActiveSlideEditorIndex] = useState(0);
  const [activeTextLayer, setActiveTextLayer] = useState<SlideTextLayerKey>(DEFAULT_TEXT_LAYER);
  const [openEditorSection, setOpenEditorSection] = useState<'background' | SlideTextLayerKey>('title');
  const [isSlideEditorModalOpen, setIsSlideEditorModalOpen] = useState(false);
  const [isTextDragActive, setIsTextDragActive] = useState(false);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const { user, loading: authLoading } = useAuth();

  // --- Festivals State ---
  const [festivals, setFestivals] = useState<UnifiedFestival[]>([]);
  const [isFestivalsLoading, setIsFestivalsLoading] = useState(true);
  const [activeSource] = useState<FestivalSource>('FESTIVAL_LIFE');
  const [filter, setFilter] = useState<'all' | 'today' | 'this-week' | '60-days'>('all');
  const [genreFilter, setGenreFilter] = useState<string>('전체');
  const [sortBy, setSortBy] = useState<'date-asc' | 'date-desc'>('date-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const festivalListRef = useRef<HTMLDivElement | null>(null);
  const suggestedAnglesCacheRef = useRef<Map<string, { angles: angle[]; expiresAt: number }>>(new Map());
  const autoTriggeredRef = useRef(false);
  const autoCurationTriggeredRef = useRef(false);
  const autoCurationGenerateRef = useRef(false);
  const draftAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveInFlightRef = useRef(false);
  const previousGeneratedSlidesLengthRef = useRef(0);
  const slidePreviewCanvasRef = useRef<HTMLDivElement | null>(null);
  const slideTextDragRef = useRef<{
    pointerId: number;
    layer: SlideTextLayerKey;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const autoCurationIdsKey = useMemo(
    () => autoCurationIds.map((id) => id.trim()).filter(Boolean).join('|'),
    [autoCurationIds],
  );

  const fetchFestivals = async (refresh = false) => {
    setIsFestivalsLoading(true);
    try {
      const res = await fetch(`/api/festivals${refresh ? '?refresh=true' : ''}`);
      const headerUpdated = res.headers.get("x-festivals-last-updated");
      const data = await res.json();
      setFestivals(Array.isArray(data) ? data : []);
      if (headerUpdated) {
        setLastUpdated(headerUpdated);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsFestivalsLoading(false);
    }
  };

  const fetchDashboardStats = useCallback(async (options?: { refresh?: boolean }) => {
    if (!user) {
      setPublishedCardnewsCount(null);
      setDraftCardnewsCount(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      const url = options?.refresh ? '/api/stats?refresh=1' : '/api/stats';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setPublishedCardnewsCount(typeof data.publishedCardnewsCount === 'number' ? data.publishedCardnewsCount : 0);
      setDraftCardnewsCount(typeof data.draftCardnewsCount === 'number' ? data.draftCardnewsCount : 0);
    } catch (error) {
      console.error(error);
    }
  }, [user]);

  const fetchAverageReach = useCallback(async () => {
    if (!user) {
      setAverageReach(null);
      return;
    }

    setIsAverageReachLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/meta/insights?days=7&posts=12&mediaInsights=0', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as InsightsPayload;

      if (!res.ok) {
        setAverageReach(null);
        return;
      }

      const reachSeries = Array.isArray(data.daily)
        ? data.daily
          .map((entry) => (typeof entry?.reach === 'number' && Number.isFinite(entry.reach) ? entry.reach : null))
          .filter((value): value is number => typeof value === 'number')
        : [];

      if (reachSeries.length > 0) {
        const reachSum = reachSeries.reduce((sum, value) => sum + value, 0);
        setAverageReach(Math.round(reachSum / reachSeries.length));
        return;
      }

      if (typeof data.summary?.reach === 'number' && Number.isFinite(data.summary.reach)) {
        setAverageReach(Math.round(data.summary.reach));
        return;
      }

      setAverageReach(null);
    } catch (error) {
      console.error(error);
      setAverageReach(null);
    } finally {
      setIsAverageReachLoading(false);
    }
  }, [user]);

  const buildAuthHeaders = useCallback(async (json = false, forceRefresh = false) => {
    const headers: Record<string, string> = {};
    if (json) {
      headers['Content-Type'] = 'application/json';
    }
    if (user) {
      const token = await user.getIdToken(forceRefresh);
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [user]);

  const normalizeSlidesForPersistence = useCallback((slides: Slide[]) => (
    slides.map((slide, index) => {
      const titleOffset = resolveSlideLayerOffset(slide, index, 'title');
      const bodyOffset = resolveSlideLayerOffset(slide, index, 'body');
      const titleTextStyle = resolveSlideLayerStyle(slide, index, 'title');
      const bodyTextStyle = resolveSlideLayerStyle(slide, index, 'body');

      return {
        title:
          typeof slide.title === 'string' && slide.title.trim().length > 0
            ? slide.title.trim()
            : `슬라이드 ${index + 1}`,
        body:
          typeof slide.body === 'string'
            ? slide.body
            : (typeof slide.content === 'string' ? slide.content : ''),
        keywords: typeof slide.keywords === 'string' ? slide.keywords : '',
        image:
          typeof slide.image === 'string' && slide.image.trim().length > 0
            ? slide.image.trim()
            : null,
        renderedImageUrl:
          typeof slide.renderedImageUrl === 'string' && slide.renderedImageUrl.trim().length > 0
            ? slide.renderedImageUrl.trim()
            : null,
        textPosition:
          slide.textPosition === 'top' || slide.textPosition === 'center' || slide.textPosition === 'bottom'
            ? slide.textPosition
            : resolveTextPositionFromOffsetY(titleOffset.y),
        textOffsetX:
          typeof slide.textOffsetX === 'number'
            ? clamp(slide.textOffsetX, 8, 92)
            : titleOffset.x,
        textOffsetY:
          typeof slide.textOffsetY === 'number'
            ? clamp(slide.textOffsetY, 10, 90)
            : titleOffset.y,
        titleOffsetX: titleOffset.x,
        titleOffsetY: titleOffset.y,
        bodyOffsetX: bodyOffset.x,
        bodyOffsetY: bodyOffset.y,
        titleTextStyle,
        bodyTextStyle,
      };
    })
  ), []);

  const handleCaptionTextChange = useCallback((nextText: string) => {
    setCaptionText(nextText);
    if (generatedSlides.length > 0) {
      setIsDraftDirty(true);
      setDraftSaveError(null);
    }
  }, [generatedSlides.length]);

  const handleRatioChange = useCallback((nextRatio: string) => {
    setRatio(nextRatio);
    if (generatedSlides.length > 0) {
      setIsDraftDirty(true);
      setDraftSaveError(null);
    }
  }, [generatedSlides.length]);

  const updateGeneratedSlideField = useCallback((
    index: number,
    field: 'title' | 'body' | 'keywords' | 'image',
    value: string,
  ) => {
    setGeneratedSlides((prev) => prev.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      if (field === 'title') {
        return { ...slide, title: value };
      }
      if (field === 'body') {
        return { ...slide, body: value };
      }
      if (field === 'keywords') {
        return { ...slide, keywords: value };
      }

      const nextImage = value.trim();
      return {
        ...slide,
        image: value,
        renderedImageUrl: nextImage ? undefined : slide.renderedImageUrl,
      };
    }));
    setIsDraftDirty(true);
    setDraftSaveError(null);
  }, []);

  const updateGeneratedSlideTextOffset = useCallback((
    index: number,
    textOffsetX: number,
    textOffsetY: number,
  ) => {
    const clampedX = clamp(textOffsetX, 8, 92);
    const clampedY = clamp(textOffsetY, 10, 90);
    const textPosition = resolveTextPositionFromOffsetY(clampedY);

    setGeneratedSlides((prev) => prev.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      return {
        ...slide,
        textOffsetX: clampedX,
        textOffsetY: clampedY,
        textPosition,
        titleOffsetX: clampedX,
        titleOffsetY: clampedY,
      };
    }));
    setIsDraftDirty(true);
    setDraftSaveError(null);
  }, []);

  const updateGeneratedSlideLayerOffset = useCallback((
    index: number,
    layer: SlideTextLayerKey,
    nextX: number,
    nextY: number,
  ) => {
    if (layer === 'title') {
      updateGeneratedSlideTextOffset(index, nextX, nextY);
      return;
    }

    const clampedX = clamp(nextX, 8, 92);
    const clampedY = clamp(nextY, 10, 90);
    setGeneratedSlides((prev) => prev.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      return {
        ...slide,
        bodyOffsetX: clampedX,
        bodyOffsetY: clampedY,
      };
    }));
    setIsDraftDirty(true);
    setDraftSaveError(null);
  }, [updateGeneratedSlideTextOffset]);

  const updateGeneratedSlideLayerStyle = useCallback((
    index: number,
    layer: SlideTextLayerKey,
    patch: Partial<SlideTextStyleConfig>,
  ) => {
    setGeneratedSlides((prev) => prev.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      const baseStyle = resolveSlideLayerStyle(slide, slideIndex, layer);
      const merged = normalizeSlideTextStyleInput(
        { ...baseStyle, ...patch },
        getDefaultLayerStyle(layer, slideIndex === 0),
      );
      if (layer === 'title') {
        return {
          ...slide,
          titleTextStyle: merged,
        };
      }
      return {
        ...slide,
        bodyTextStyle: merged,
      };
    }));
    setIsDraftDirty(true);
    setDraftSaveError(null);
  }, []);

  const saveDraftEdits = useCallback(async () => {
    if (!user || !draftId) return false;
    if (draftSaveInFlightRef.current) return false;
    draftSaveInFlightRef.current = true;
    setIsDraftSaving(true);
    setDraftSaveError(null);

    try {
      const token = await user.getIdToken();
      const url = new URL('/api/cardnews/item', window.location.origin);
      url.searchParams.set('id', draftId);
      const normalizedSlides = normalizeSlidesForPersistence(generatedSlides);
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: inputText,
          style,
          target,
          genre,
          source,
          sourceLabel,
          imageUrl: imageUrl || null,
          aspectRatio: ratio,
          tone: captionTone,
          captionStyle: captionStyleMode || null,
          caption: captionText,
          slides: normalizedSlides,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        item?: SavedCardnewsItem;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : '초안 저장에 실패했습니다.');
      }

      setIsDraftDirty(false);
      setDraftSavedAt(Date.now());
      if (typeof data.item?.id === 'string' && data.item.id.trim().length > 0 && data.item.status === 'draft') {
        setDraftId(data.item.id);
      }
      return true;
    } catch (error) {
      setDraftSaveError(error instanceof Error ? error.message : '초안 저장에 실패했습니다.');
      return false;
    } finally {
      draftSaveInFlightRef.current = false;
      setIsDraftSaving(false);
    }
  }, [
    captionStyleMode,
    captionText,
    captionTone,
    draftId,
    generatedSlides,
    genre,
    imageUrl,
    inputText,
    normalizeSlidesForPersistence,
    ratio,
    source,
    sourceLabel,
    style,
    target,
    user,
  ]);

  const loadSavedContentToPreview = useCallback(async (cardnewsId: string) => {
    if (!user) return;

    setIsSavedContentLoading(true);
    setSavedContentError(null);

    try {
      const headers = await buildAuthHeaders();
      const url = new URL('/api/cardnews/item', window.location.origin);
      url.searchParams.set('id', cardnewsId);
      const response = await fetch(url.toString(), { headers });
      const data = (await response.json().catch(() => ({}))) as SavedCardnewsItemResponse;

      if (!response.ok || !data.item) {
        throw new Error(data.error || '저장된 콘텐츠를 불러오지 못했습니다.');
      }

      const item = data.item;
      const nextSlides = Array.isArray(item.slides)
        ? item.slides.map((slide, index) => ({
          textPosition:
            slide?.textPosition === 'top' || slide?.textPosition === 'center' || slide?.textPosition === 'bottom'
              ? slide.textPosition
              : undefined,
          textOffsetX:
            typeof slide?.textOffsetX === 'number'
              ? clamp(slide.textOffsetX, 8, 92)
              : undefined,
          textOffsetY:
            typeof slide?.textOffsetY === 'number'
              ? clamp(slide.textOffsetY, 10, 90)
              : undefined,
          titleOffsetX:
            typeof slide?.titleOffsetX === 'number'
              ? clamp(slide.titleOffsetX, 8, 92)
              : undefined,
          titleOffsetY:
            typeof slide?.titleOffsetY === 'number'
              ? clamp(slide.titleOffsetY, 10, 90)
              : undefined,
          bodyOffsetX:
            typeof slide?.bodyOffsetX === 'number'
              ? clamp(slide.bodyOffsetX, 8, 92)
              : undefined,
          bodyOffsetY:
            typeof slide?.bodyOffsetY === 'number'
              ? clamp(slide.bodyOffsetY, 10, 90)
              : undefined,
          titleTextStyle: normalizeSlideTextStyleInput(
            slide?.titleTextStyle,
            getDefaultLayerStyle('title', index === 0),
          ),
          bodyTextStyle: normalizeSlideTextStyleInput(
            slide?.bodyTextStyle,
            getDefaultLayerStyle('body', index === 0),
          ),
          keywords: typeof slide?.keywords === 'string' ? slide.keywords : '',
          renderedImageUrl:
            typeof slide?.renderedImageUrl === 'string' && slide.renderedImageUrl.trim().length > 0
              ? slide.renderedImageUrl.trim()
              : undefined,
          id: `${item.id}-${index + 1}`,
          title: typeof slide?.title === 'string' && slide.title.trim() ? slide.title.trim() : `슬라이드 ${index + 1}`,
          body: typeof slide?.body === 'string' ? slide.body : '',
          content: typeof slide?.body === 'string' ? slide.body : '',
          image:
            (typeof slide?.image === 'string' && slide.image.trim().length > 0
              ? slide.image.trim()
              : undefined)
            || (typeof slide?.renderedImageUrl === 'string' && slide.renderedImageUrl.trim().length > 0
              ? slide.renderedImageUrl.trim()
              : undefined)
            || (index === 0 && typeof item.imageUrl === 'string' ? item.imageUrl : undefined),
        }))
        : [];

      setGeneratedSlides(nextSlides);
      setInputText(typeof item.content === 'string' ? item.content : '');
      setSource(typeof item.source === 'string' ? item.source : '');
      setSourceLabel(typeof item.sourceLabel === 'string' ? item.sourceLabel : '');
      setImageUrl(typeof item.imageUrl === 'string' ? item.imageUrl : '');
      setGenre(typeof item.genre === 'string' ? item.genre : '');
      setSelectedSavedContentId(item.id);
      setPublishError(null);
      setCanvaError(null);
      setCanvaEditUrl(null);
      setPublishSuccessAt(null);

      setStyle((prev) => {
        const next = typeof item.style === 'string' ? item.style.trim() : '';
        return next || prev;
      });
      setTarget((prev) => {
        const next = typeof item.target === 'string' ? item.target.trim() : '';
        return next || prev;
      });
      setRatio((prev) => {
        const next = typeof item.aspectRatio === 'string' ? item.aspectRatio.trim() : '';
        return aspectRatios.includes(next) ? next : prev;
      });
      setCaptionTone((prev) => {
        const next = typeof item.tone === 'string' ? item.tone.trim() : '';
        return captionToneOptions.some((option) => option.id === next) ? next : prev;
      });
      setCaptionStyleMode((prev) => {
        const next = typeof item.captionStyle === 'string' ? item.captionStyle.trim() : '';
        return captionStyleOptions.some((option) => option.id === next) ? next : prev;
      });
      setCaptionText(
        typeof item.caption === 'string'
          ? item.caption
          : '',
      );
      setDraftId(item.status === 'draft' ? item.id : null);
      setIsDraftDirty(false);
      setDraftSaveError(null);
      setDraftSavedAt(null);
    } catch (error) {
      setSavedContentError(error instanceof Error ? error.message : '저장된 콘텐츠를 불러오지 못했습니다.');
    } finally {
      setIsSavedContentLoading(false);
    }
  }, [buildAuthHeaders, user]);

  const isUnauthorizedCanvaResponse = (status: number, data: unknown) => {
    if (status !== 401 || !data || typeof data !== 'object') return false;
    const payload = data as { error?: unknown; errorCode?: unknown };
    return payload.errorCode === 'unauthorized' || payload.error === 'Unauthorized';
  };

  const isUnauthorizedCanvaPayload = (data: unknown) => {
    if (!data || typeof data !== 'object') return false;
    const payload = data as { error?: unknown; errorCode?: unknown };
    return payload.errorCode === 'unauthorized' || payload.error === 'Unauthorized';
  };

  const fetchCanvaWithRetry = async (input: RequestInfo | URL, init?: RequestInit, json = false) => {
    const request = async (forceRefresh: boolean) => {
      const headers = new Headers(init?.headers);
      const authHeaders = await buildAuthHeaders(json, forceRefresh);
      Object.entries(authHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
      const response = await fetch(input, { ...init, headers });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    };

    let result = await request(false);
    if (isUnauthorizedCanvaResponse(result.response.status, result.data) && user) {
      result = await request(true);
    }
    return result;
  };

  const fetchCanvaTemplates = async () => {
    if (authLoading) {
      return;
    }
    if (!user) {
      setCanvaTemplates([]);
      setSelectedCanvaTemplateId('');
      setCanvaReconnectRequired(true);
      setCanvaTemplatesError('로그인 후 Canva 템플릿을 불러올 수 있습니다.');
      return;
    }

    setIsCanvaTemplatesLoading(true);
    setCanvaTemplatesError(null);
    try {
      const { response, data } = await fetchCanvaWithRetry('/api/canva/templates');
      if (!response.ok) {
        if (isUnauthorizedCanvaPayload(data)) {
          setCanvaReconnectRequired(true);
          throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        }
        const reconnectRequired = Boolean(data?.reconnectRequired);
        setCanvaReconnectRequired(reconnectRequired);
        throw new Error(typeof data?.error === 'string' ? data.error : 'Canva 템플릿 조회에 실패했습니다.');
      }

      const templates = Array.isArray(data?.templates)
        ? data.templates
          .map((item: {
            id?: unknown;
            title?: unknown;
            thumbnailUrl?: unknown;
            viewUrl?: unknown;
            createUrl?: unknown;
            updatedAt?: unknown;
          }) => ({
            id: typeof item?.id === 'string' ? item.id : '',
            title: typeof item?.title === 'string' ? item.title : 'Untitled template',
            thumbnailUrl: typeof item?.thumbnailUrl === 'string' ? item.thumbnailUrl : null,
            viewUrl: typeof item?.viewUrl === 'string' ? item.viewUrl : null,
            createUrl: typeof item?.createUrl === 'string' ? item.createUrl : null,
            updatedAt: typeof item?.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : null,
          }))
          .filter((item: CanvaTemplateOption) => Boolean(item.id))
        : [];

      setCanvaTemplates(templates);
      setCanvaTemplatesFetchedAt(Date.now());
      setCanvaReconnectRequired(false);
      const defaultTemplateId = typeof data?.defaultTemplateId === 'string' ? data.defaultTemplateId : '';
      setSelectedCanvaTemplateId((prev) => {
        if (prev && templates.some((template: CanvaTemplateOption) => template.id === prev)) return prev;
        if (defaultTemplateId && templates.some((template: CanvaTemplateOption) => template.id === defaultTemplateId)) return defaultTemplateId;
        return templates[0]?.id || '';
      });

      if (templates.length === 0) {
        setCanvaTemplatesError('사용 가능한 Canva 템플릿이 없습니다. Data Autofill 필드가 있는 템플릿을 확인해 주세요.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Canva 템플릿 조회 중 오류가 발생했습니다.';
      setCanvaTemplatesError(message);
    } finally {
      setIsCanvaTemplatesLoading(false);
    }
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
    const hostname = loopbackHosts.has(url.hostname) ? '127.0.0.1' : url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const shouldIncludePort = !((url.protocol === 'https:' && port === '443') || (url.protocol === 'http:' && port === '80'));
    const origin = `${url.protocol}//${hostname}${shouldIncludePort ? `:${port}` : ''}`;
    setCanvaRedirectUri(`${origin}/api/canva/oauth/callback`);
  }, []);

  useEffect(() => {
    if (SHOW_FESTIVAL_SOURCE_SECTION || autoCurationTrigger) {
      fetchFestivals();
    }
  }, [autoCurationTrigger]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      setCanvaTemplates([]);
      setSelectedCanvaTemplateId('');
      setCanvaReconnectRequired(true);
      setCanvaTemplatesError('로그인 후 Canva 템플릿을 불러올 수 있습니다.');
      return;
    }
    fetchCanvaTemplates();
  }, [authLoading, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setPublishedCardnewsCount(null);
      setDraftCardnewsCount(null);
      setAverageReach(null);
      return;
    }
    void fetchDashboardStats();
    void fetchAverageReach();
  }, [authLoading, fetchAverageReach, fetchDashboardStats, user]);

  useEffect(() => {
    if (!selectedCardnewsId) {
      setSelectedSavedContentId(null);
      setSavedContentError(null);
      return;
    }
    if (authLoading || !user) return;
    void loadSavedContentToPreview(selectedCardnewsId);
  }, [authLoading, loadSavedContentToPreview, selectedCardnewsId, user]);

  useEffect(() => {
    setActiveSlideEditorIndex((prev) => {
      if (generatedSlides.length === 0) return 0;
      return Math.min(prev, generatedSlides.length - 1);
    });
  }, [generatedSlides.length]);

  useEffect(() => {
    setActiveTextLayer(DEFAULT_TEXT_LAYER);
  }, [activeSlideEditorIndex]);

  useEffect(() => {
    const prevLength = previousGeneratedSlidesLengthRef.current;
    if (prevLength === 0 && generatedSlides.length > 0) {
      setIsSlideEditorModalOpen(true);
    }
    if (generatedSlides.length === 0 && isSlideEditorModalOpen) {
      setIsSlideEditorModalOpen(false);
    }
    previousGeneratedSlidesLengthRef.current = generatedSlides.length;
  }, [generatedSlides.length, isSlideEditorModalOpen]);

  useEffect(() => {
    if (!isSlideEditorModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSlideEditorModalOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isSlideEditorModalOpen]);

  useEffect(() => {
    if (isSlideEditorModalOpen) return;
    slideTextDragRef.current = null;
    setIsTextDragActive(false);
    setActiveTextLayer(DEFAULT_TEXT_LAYER);
    setOpenEditorSection('title');
  }, [isSlideEditorModalOpen]);

  useEffect(() => () => {
    if (draftAutoSaveTimerRef.current) {
      clearTimeout(draftAutoSaveTimerRef.current);
      draftAutoSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isDraftDirty || !draftId || !user) {
      return;
    }
    if (draftAutoSaveTimerRef.current) {
      clearTimeout(draftAutoSaveTimerRef.current);
    }
    draftAutoSaveTimerRef.current = setTimeout(() => {
      void saveDraftEdits();
    }, 1200);

    return () => {
      if (draftAutoSaveTimerRef.current) {
        clearTimeout(draftAutoSaveTimerRef.current);
        draftAutoSaveTimerRef.current = null;
      }
    };
  }, [draftId, isDraftDirty, saveDraftEdits, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('canva_connected');

    if (connected === '1') {
      setCanvaReconnectRequired(false);
      setCanvaTemplatesError(null);
      setCanvaError(null);
      fetchCanvaTemplates();
    } else if (connected === '0') {
      const detail = [params.get('error'), params.get('error_description')].filter(Boolean).join(' - ');
      setCanvaReconnectRequired(true);
      setCanvaTemplatesError(detail ? `Canva 연결 실패: ${detail}` : 'Canva 연결에 실패했습니다. 다시 시도해 주세요.');
    }

    if (connected) {
      const url = new URL(window.location.href);
      url.searchParams.delete('canva_connected');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      window.history.replaceState({}, '', url.toString());
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        success?: boolean;
        error?: string;
        errorDescription?: string;
      };

      if (data?.type !== 'canva_oauth') return;

      setIsCanvaReconnectLoading(false);
      if (data.success) {
        setCanvaReconnectRequired(false);
        setCanvaTemplatesError(null);
        setCanvaError(null);
        fetchCanvaTemplates();
      } else {
        const detail = [data.error, data.errorDescription].filter(Boolean).join(' - ');
        setCanvaReconnectRequired(true);
        setCanvaTemplatesError(detail ? `Canva 연결 실패: ${detail}` : 'Canva 연결에 실패했습니다. 다시 시도해 주세요.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  const availableGenres = useMemo(() => {
    const sourceFestivals = festivals.filter(f => f.source === activeSource);
    const genres = new Set<string>();
    sourceFestivals.forEach(f => {
      if (f.genre) {
        f.genre.split(',').forEach(t => {
          const trimmed = t.trim();
          if (trimmed) genres.add(trimmed);
        });
      }
    });
    return ['전체', ...Array.from(genres)].slice(0, 15);
  }, [festivals, activeSource]);

  const selectedCanvaTemplate = useMemo(
    () => canvaTemplates.find((template) => template.id === selectedCanvaTemplateId) ?? null,
    [canvaTemplates, selectedCanvaTemplateId],
  );

  const pickerCanvaTemplate = useMemo(
    () => canvaTemplates.find((template) => template.id === pickerCanvaTemplateId) ?? null,
    [canvaTemplates, pickerCanvaTemplateId],
  );

  const filteredCanvaTemplates = useMemo(() => {
    const normalizedQuery = templateSearchQuery.trim().toLocaleLowerCase('ko-KR');
    if (!normalizedQuery) {
      return canvaTemplates;
    }

    return canvaTemplates.filter((template) =>
      template.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
    );
  }, [canvaTemplates, templateSearchQuery]);

  useEffect(() => {
    setGenreFilter('전체');
  }, [activeSource]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSource, filter, genreFilter, sortBy]);

  useEffect(() => {
    if (!isCanvaTemplatePickerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCanvaTemplatePickerOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCanvaTemplatePickerOpen]);

  useEffect(() => {
    if (!isCanvaTemplatePickerOpen) {
      return;
    }

    setPickerCanvaTemplateId((prev) => {
      if (prev && canvaTemplates.some((template) => template.id === prev)) {
        return prev;
      }
      if (selectedCanvaTemplateId && canvaTemplates.some((template) => template.id === selectedCanvaTemplateId)) {
        return selectedCanvaTemplateId;
      }
      return canvaTemplates[0]?.id || '';
    });
  }, [canvaTemplates, isCanvaTemplatePickerOpen, selectedCanvaTemplateId]);

  const filteredFestivals = festivals.filter(f => {
    if (f.source !== activeSource) return false;

    const today = new Date().toISOString().split('T')[0];
    let dateMatch = true;
    if (filter === 'today') dateMatch = f.startDate <= today && f.endDate >= today;
    else if (filter === 'this-week') {
      const d = new Date();
      const day = d.getDay();
      const diffToSun = (7 - day) % 7;
      const sun = new Date(d);
      sun.setDate(d.getDate() + diffToSun);
      const sunStr = sun.toISOString().split('T')[0];
      dateMatch = (f.startDate <= sunStr && f.endDate >= today);
    } else if (filter === '60-days') {
      const d = new Date();
      const future = new Date(d);
      future.setDate(d.getDate() + 60);
      const futureStr = future.toISOString().split('T')[0];
      dateMatch = (f.startDate >= today && f.startDate <= futureStr);
    }

    let genreMatch = true;
    if (genreFilter !== '전체') {
      genreMatch = f.genre.includes(genreFilter);
    }

    return dateMatch && genreMatch;
  });

  const hasInterestScore = filteredFestivals.some(f => typeof f.interestScore === 'number');

  const rankedFestivals = hasInterestScore
    ? filteredFestivals
      .filter(f => (f.interestScore ?? 0) >= INTEREST_SCORE_THRESHOLD)
      .sort((a, b) => (b.interestScore ?? 0) - (a.interestScore ?? 0))
    : filteredFestivals.sort((a, b) => {
      const dateA = new Date(a.startDate).getTime();
      const dateB = new Date(b.startDate).getTime();
      return sortBy === 'date-asc' ? dateA - dateB : dateB - dateA;
    });

  const totalPages = Math.max(1, Math.ceil(rankedFestivals.length / FESTIVALS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedFestivals = rankedFestivals.slice(
    (safeCurrentPage - 1) * FESTIVALS_PER_PAGE,
    safeCurrentPage * FESTIVALS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    festivalListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applySuggestedAngles = useCallback((angles: angle[]) => {
    setSuggestedAngles(angles);
    if (angles.length > 0) {
      setSelectedAngle(angles[0]);
      setCaptionStyleMode(angles[0].type);
    }
  }, []);

  const requestSuggestedAngles = useCallback(async (contentOverride?: string) => {
    const targetContent = (contentOverride ?? inputText).trim();
    if (!targetContent) {
      setSuggestedAngles([]);
      setSelectedAngle(null);
      setShowAngleSelector(false);
      setShowAllAngles(false);
      return [] as angle[];
    }

    const cacheKey = buildSuggestedAnglesCacheKey(targetContent);
    const cached = suggestedAnglesCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setShowAngleSelector(true);
      setIsLoadingAngles(false);
      setShowAllAngles(false);
      applySuggestedAngles(cached.angles);
      return cached.angles;
    }
    if (cached) {
      suggestedAnglesCacheRef.current.delete(cacheKey);
    }

    setShowAngleSelector(true);
    setIsLoadingAngles(true);
    setSelectedAngle(null);
    setShowAllAngles(false);

    try {
      const headers = await buildAuthHeaders(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUGGEST_ANGLES_TIMEOUT_MS);
      try {
        const suggestAnglesResponse = await fetch('/api/suggest-angles', {
          method: 'POST',
          headers,
          body: JSON.stringify({ content: targetContent }),
          signal: controller.signal,
        });
        const suggestAnglesData = (await suggestAnglesResponse.json().catch(() => ({}))) as SuggestAnglesResponse;
        let nextAngles: angle[] = [];
        if (!suggestAnglesResponse.ok) {
          nextAngles = FALLBACK_SUGGESTED_ANGLES;
        } else {
          nextAngles = normalizeSuggestedAngles(suggestAnglesData.angles);
        }
        if (nextAngles.length === 0) {
          nextAngles = FALLBACK_SUGGESTED_ANGLES;
        }
        suggestedAnglesCacheRef.current.set(cacheKey, {
          angles: nextAngles,
          expiresAt: Date.now() + SUGGEST_ANGLES_CACHE_TTL_MS,
        });
        applySuggestedAngles(nextAngles);
        return nextAngles;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (suggestAnglesError) {
      console.warn('Failed to load suggested angles:', suggestAnglesError);
      applySuggestedAngles(FALLBACK_SUGGESTED_ANGLES);
      return FALLBACK_SUGGESTED_ANGLES;
    } finally {
      setIsLoadingAngles(false);
    }
  }, [applySuggestedAngles, buildAuthHeaders, inputText]);

  useEffect(() => {
    if (!autoTrigger || !autoFestivalData || autoTriggeredRef.current) return;
    if (!autoFestivalData.title) return;

    autoTriggeredRef.current = true;

    const parts = [
      autoFestivalData.title,
      autoFestivalData.location ? `장소: ${autoFestivalData.location}` : null,
      autoFestivalData.startDate && autoFestivalData.endDate
        ? `기간: ${autoFestivalData.startDate} ~ ${autoFestivalData.endDate}`
        : null,
      autoFestivalData.genre ? `장르: ${autoFestivalData.genre}` : null,
    ].filter(Boolean);

    const nextInputText = parts.join('\n');
    setInputText(nextInputText);
    if (autoFestivalData.genre) setGenre(autoFestivalData.genre);
    if (autoFestivalData.source) setSource(autoFestivalData.source as FestivalSource);
    if (autoFestivalData.imageUrl) setImageUrl(autoFestivalData.imageUrl);

    void requestSuggestedAngles(nextInputText);
  }, [autoTrigger, autoFestivalData, requestSuggestedAngles]);

  useEffect(() => {
    autoCurationTriggeredRef.current = false;
    autoCurationGenerateRef.current = false;
  }, [autoCurationIdsKey, autoCurationTheme, autoCurationTrigger]);

  useEffect(() => {
    if (!autoCurationTrigger || autoCurationTriggeredRef.current) return;
    if (!Array.isArray(autoCurationIds) || autoCurationIds.length === 0) return;
    if (festivals.length === 0) return;

    const uniqueIds = Array.from(new Set(autoCurationIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const selected = uniqueIds
      .map((id) => festivals.find((festival) => festival.id === id))
      .filter((item): item is UnifiedFestival => Boolean(item))
      .slice(0, 8);

    autoCurationTriggeredRef.current = true;
    setIsCurationMode(true);
    setCurationTheme(autoCurationTheme.trim() || '이번 주 공연 소식');
    setCurationFestivals(selected);
  }, [autoCurationIds, autoCurationTheme, autoCurationTrigger, festivals]);

  // handleFestivalSelect 앞에 추가
  const handleFestivalClick = (f: UnifiedFestival) => {
    if (isCurationMode) {
      setCurationFestivals((prev) =>
        prev.find((x) => x.id === f.id)
          ? prev.filter((x) => x.id !== f.id)
          : [...prev, f].slice(0, 8),
      );
      return;
    }
    handleFestivalSelect(f);
  };

  const handleFestivalSelect = (f: UnifiedFestival) => {
    const buildInputText = (festival: UnifiedFestival) => {
      const detailsText = Array.isArray(festival.details) && festival.details.length > 0
        ? festival.details.map((d: { label: string; value: string }) =>
            `${d.label}: ${d.value}`).join('\n')
        : null;
      return [
        festival.title,
        festival.location ? `장소: ${festival.location}` : null,
        festival.startDate && festival.endDate ? `기간: ${festival.startDate} ~ ${festival.endDate}` : null,
        festival.lineup ? `라인업: ${festival.lineup}` : null,
        festival.price ? `티켓 가격: ${festival.price}` : null,
        festival.homepage ? `공식 홈페이지: ${festival.homepage}` : null,
        detailsText ? `상세 정보:\n${detailsText}` : null,
        festival.description ? `본문: ${festival.description.slice(0, 600)}` : null,
      ].filter(Boolean).join('\n');
    };

    const nextInputText = buildInputText(f);
    setInputText(nextInputText);
    setGenre(f.genre || '');
    setSource(f.source);
    setSourceLabel(f.sourceLabel || f.source);
    setImageUrl(f.imageUrl || '');
    void requestSuggestedAngles(nextInputText);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    void (async () => {
      try {
        const authHeaders = await buildAuthHeaders(true);
        const res = await fetch('/api/festivals/research', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ festivalIds: [f.id] }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const result = Array.isArray(data?.results) ? data.results[0] : null;
        if (!result?.researched) return;

        const enriched: UnifiedFestival = {
          ...f,
          lineup: result.researched.lineup || f.lineup || '',
          price: result.researched.ticketPrice || result.researched.price || f.price || '',
          location: result.researched.venue || result.researched.location || f.location || '',
          homepage: result.researched.bookingSite || result.researched.homepage || f.homepage || '',
          description: result.researched.description || f.description || '',
          details: Array.isArray(result.researched.details) && result.researched.details.length > 0
            ? result.researched.details
            : Array.isArray(f.details) ? f.details : [],
        };

        setInputText(buildInputText(enriched));
      } catch {
        // research 실패해도 기존 데이터로 계속 진행
      }
    })();
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleOpenCanvaTemplatePicker = async () => {
    setTemplateSearchQuery('');
    setPickerCanvaTemplateId(selectedCanvaTemplateId);
    setIsCanvaTemplatePickerOpen(true);

    const isStale = !canvaTemplatesFetchedAt || (Date.now() - canvaTemplatesFetchedAt) > CANVA_TEMPLATE_THUMBNAIL_STALE_MS;
    if (canvaTemplates.length === 0 || isStale) {
      await fetchCanvaTemplates();
    }
  };

  const handleCloseCanvaTemplatePicker = () => {
    setIsCanvaTemplatePickerOpen(false);
    setTemplateSearchQuery('');
    setPickerCanvaTemplateId('');
  };

  const handleConfirmCanvaTemplateSelection = () => {
    const nextTemplateId = pickerCanvaTemplateId || selectedCanvaTemplateId || canvaTemplates[0]?.id || '';
    if (!nextTemplateId) {
      return;
    }

    setSelectedCanvaTemplateId(nextTemplateId);
    handleCloseCanvaTemplatePicker();
  };

  const handleRegenerateCaption = async () => {
    if (!inputText && generatedSlides.length === 0) {
      return;
    }

    setIsCaptionGenerating(true);
    try {
      const response = await fetch('/api/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slides: generatedSlides,
          content: inputText,
          style,
          target,
          genre,
          source,
          sourceLabel,
          tone: captionTone,
          captionStyle: captionStyleMode,
          aspectRatio: ratio,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '캡션 생성에 실패했습니다.');
      }

      setCaptionText(typeof data?.caption === 'string' ? data.caption : '');
      if (draftId) {
        setIsDraftDirty(true);
        setDraftSaveError(null);
      }
    } catch (error) {
      console.error(error);
      alert('캡션 생성 중 오류가 발생했습니다.');
    } finally {
      setIsCaptionGenerating(false);
    }
  };

  const executeSlideGeneration = async (angleSelection: angle | null) => {
    if (!inputText) return;

    setIsGenerating(true);
    setPublishError(null);
    setPublishSuccessAt(null);
    setCanvaError(null);
    setCanvaEditUrl(null);

    try {
      const headers = await buildAuthHeaders(true);
      const angleHints = buildAngleHintsContent(suggestedAngles);
      const selectedAngleBlock = angleSelection
        ? `[사용자 선택 앵글]\n- type: ${angleSelection.type}\n- hook: ${angleSelection.hook}\n- description: ${angleSelection.description}`
        : '';
      const contentWithAngleHints = [
        inputText,
        angleHints || null,
        selectedAngleBlock || null,
      ].filter(Boolean).join('\n\n');

      const response = await fetch('/api/generate-slides', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: contentWithAngleHints,
          angleHints: suggestedAngles,
          ...(angleSelection ? {
            angle: angleSelection.type,
            angleHook: angleSelection.hook,
          } : {}),
          style,
          target,
          aspectRatio: ratio,
          genre,
          source,
          sourceLabel,
          imageUrl,
          slideCount,
          tone: captionTone,
          captionStyle: captionStyleMode,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate slides');

      const data = await response.json();
      setGeneratedSlides(data.slides || []);
      setCaptionText(typeof data.caption === 'string' ? data.caption : '');
      setDraftId(typeof data.draftId === 'string' ? data.draftId : null);
      setIsDraftDirty(false);
      setDraftSaveError(null);
      setDraftSavedAt(typeof data.draftId === 'string' ? Date.now() : null);
      setShowAngleSelector(false);
      if (Array.isArray(data.slides) && data.slides.length > 0 && data.draftId) {
        void fetchDashboardStats({ refresh: true });
      }
    } catch (error) {
      console.error(error);
      alert('기획안 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    // handleGenerate 함수 상단에 추가
    if (isCurationMode) {
      if (curationFestivals.length < 2) {
        alert('큐레이션 모드에서는 행사를 2개 이상 선택해주세요.');
        return;
      }
      setIsGenerating(true);
      try {
        const headers = await buildAuthHeaders(true);
        const response = await fetch('/api/generate-slides', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            mode: 'curation',
            theme: curationTheme,
            festivals: curationFestivals.map((f) => ({
              title: f.title,
              startDate: f.startDate,
              endDate: f.endDate,
              location: f.location,
              genre: f.genre,
              lineup: f.lineup || '',
              price: f.price || '',
              imageUrl: f.imageUrl || '',
            })),
            aspectRatio: ratio,
          }),
        });
        const data = await response.json();
        if (data.slides) {
          setGeneratedSlides(data.slides);
        }
        if (typeof data.caption === 'string') {
          setCaptionText(data.caption);
        }
        setDraftId(typeof data.draftId === 'string' ? data.draftId : null);
        setIsDraftDirty(false);
        setDraftSaveError(null);
        setDraftSavedAt(typeof data.draftId === 'string' ? Date.now() : null);
        if (typeof data.draftId === 'string' && data.draftId.trim().length > 0) {
          void fetchDashboardStats({ refresh: true });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    if (!inputText) return;
    setPublishError(null);
    setPublishSuccessAt(null);
    setCanvaError(null);
    setCanvaEditUrl(null);
    if (!showAngleSelector || suggestedAngles.length === 0) {
      await requestSuggestedAngles();
      return;
    }
    await executeSlideGeneration(selectedAngle);
  };

  useEffect(() => {
    if (!autoCurationTrigger) {
      autoCurationGenerateRef.current = false;
      return;
    }
    if (autoCurationGenerateRef.current) return;
    if (!isCurationMode) return;
    if (curationFestivals.length < 2) return;

    autoCurationGenerateRef.current = true;

    void (async () => {
      setIsGenerating(true);
      setPublishError(null);
      setPublishSuccessAt(null);
      setCanvaError(null);
      setCanvaEditUrl(null);
      try {
        const headers = await buildAuthHeaders(true);
        const response = await fetch('/api/generate-slides', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            mode: 'curation',
            theme: curationTheme,
            festivals: curationFestivals.map((festival) => ({
              title: festival.title,
              startDate: festival.startDate,
              endDate: festival.endDate,
              location: festival.location,
              genre: festival.genre,
              lineup: festival.lineup || '',
              price: festival.price || '',
              imageUrl: festival.imageUrl || '',
            })),
            aspectRatio: ratio,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : '큐레이션 카드뉴스 생성에 실패했습니다.');
        }
        if (Array.isArray(data?.slides)) {
          setGeneratedSlides(data.slides);
        }
        if (typeof data?.caption === 'string') {
          setCaptionText(data.caption);
        }
        if (typeof data?.draftId === 'string') {
          setDraftId(data.draftId);
        }
        setIsDraftDirty(false);
        setDraftSaveError(null);
        setDraftSavedAt(typeof data?.draftId === 'string' ? Date.now() : null);
        if (typeof data?.draftId === 'string' && data.draftId.trim().length > 0) {
          void fetchDashboardStats({ refresh: true });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsGenerating(false);
      }
    })();
  }, [autoCurationTrigger, isCurationMode, curationFestivals, curationTheme, buildAuthHeaders, fetchDashboardStats, ratio]);

  const handlePublish = async () => {
    if (!draftId) return;
    setIsPublishing(true);
    setPublishError(null);
    try {
      const headers = await buildAuthHeaders(true);
      const res = await fetch('/api/cardnews/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({ draftId }),
      });
      if (!res.ok) {
        throw new Error('Failed to publish cardnews');
      }
      setDraftId(null);
      setPublishSuccessAt(Date.now());
      await fetchDashboardStats({ refresh: true });
    } catch (error) {
      console.error(error);
      setPublishError('발행 처리에 실패했습니다.');
    } finally {
      setIsPublishing(false);
    }
  };

  const activeSlide = generatedSlides[activeSlideEditorIndex] ?? null;
  const activeSlideTitle = (activeSlide?.title || `슬라이드 ${activeSlideEditorIndex + 1}`).trim();
  const activeSlideBody = (activeSlide?.body || activeSlide?.content || '').trim();
  const activeSlideImage = (activeSlide?.image || activeSlide?.renderedImageUrl || '').trim();
  const activeSlideTitleOffset = activeSlide
    ? resolveSlideLayerOffset(activeSlide, activeSlideEditorIndex, 'title')
    : { x: 38, y: 50 };
  const activeSlideBodyOffset = activeSlide
    ? resolveSlideLayerOffset(activeSlide, activeSlideEditorIndex, 'body')
    : { x: 38, y: 64 };
  const activeSlideTitleStyle = activeSlide
    ? resolveSlideLayerStyle(activeSlide, activeSlideEditorIndex, 'title')
    : getDefaultLayerStyle('title', activeSlideEditorIndex === 0);
  const activeSlideBodyStyle = activeSlide
    ? resolveSlideLayerStyle(activeSlide, activeSlideEditorIndex, 'body')
    : getDefaultLayerStyle('body', activeSlideEditorIndex === 0);
  const activeLayerOffset = activeTextLayer === 'title' ? activeSlideTitleOffset : activeSlideBodyOffset;
  const activeLayerStyle = activeTextLayer === 'title' ? activeSlideTitleStyle : activeSlideBodyStyle;
  const canMoveSlideBackward = activeSlideEditorIndex > 0;
  const canMoveSlideForward = activeSlideEditorIndex < generatedSlides.length - 1;
  const draftSavedTimeText = draftSavedAt
    ? new Date(draftSavedAt).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    : null;

  const hasPublishablePreview = generatedSlides.length > 0 && captionText.trim().length > 0;
  const moveActiveSlideEditor = useCallback((direction: 'prev' | 'next') => {
    setActiveSlideEditorIndex((prev) => {
      if (generatedSlides.length === 0) return 0;
      if (direction === 'prev') {
        return Math.max(0, prev - 1);
      }
      return Math.min(generatedSlides.length - 1, prev + 1);
    });
  }, [generatedSlides.length]);

  const handleSlideTextDragStart = useCallback((layer: SlideTextLayerKey, event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeSlide) return;
    const canvas = slidePreviewCanvasRef.current;
    if (!canvas) return;

    const { x, y } = resolveSlideLayerOffset(activeSlide, activeSlideEditorIndex, layer);
    slideTextDragRef.current = {
      pointerId: event.pointerId,
      layer,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: x,
      originY: y,
    };
    setActiveTextLayer(layer);
    setIsTextDragActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [activeSlide, activeSlideEditorIndex]);

  const handleSlideTextDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = slideTextDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const canvas = slidePreviewCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const deltaX = ((event.clientX - drag.startClientX) / rect.width) * 100;
    const deltaY = ((event.clientY - drag.startClientY) / rect.height) * 100;
    updateGeneratedSlideLayerOffset(
      activeSlideEditorIndex,
      drag.layer,
      drag.originX + deltaX,
      drag.originY + deltaY,
    );
    event.preventDefault();
  }, [activeSlideEditorIndex, updateGeneratedSlideLayerOffset]);

  const finishSlideTextDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!slideTextDragRef.current || slideTextDragRef.current.pointerId !== event.pointerId) {
      return;
    }
    slideTextDragRef.current = null;
    setIsTextDragActive(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const adjustSlideLayerFontSize = useCallback((layer: SlideTextLayerKey, delta: number) => {
    if (!activeSlide) return;
    const currentStyle = resolveSlideLayerStyle(activeSlide, activeSlideEditorIndex, layer);
    updateGeneratedSlideLayerStyle(activeSlideEditorIndex, layer, {
      fontSize: clamp(currentStyle.fontSize + delta, 12, 96),
    });
    setActiveTextLayer(layer);
  }, [activeSlide, activeSlideEditorIndex, updateGeneratedSlideLayerStyle]);

  const setSlideLayerFontSize = useCallback((layer: SlideTextLayerKey, nextSize: number) => {
    updateGeneratedSlideLayerStyle(activeSlideEditorIndex, layer, {
      fontSize: clamp(nextSize, 12, 96),
    });
    setActiveTextLayer(layer);
  }, [activeSlideEditorIndex, updateGeneratedSlideLayerStyle]);

  const setSlideLayerColor = useCallback((layer: SlideTextLayerKey, color: string) => {
    updateGeneratedSlideLayerStyle(activeSlideEditorIndex, layer, { color });
    setActiveTextLayer(layer);
  }, [activeSlideEditorIndex, updateGeneratedSlideLayerStyle]);

  const setSlideLayerWeight = useCallback((layer: SlideTextLayerKey, weight: number) => {
    updateGeneratedSlideLayerStyle(activeSlideEditorIndex, layer, { fontWeight: weight });
    setActiveTextLayer(layer);
  }, [activeSlideEditorIndex, updateGeneratedSlideLayerStyle]);

  const setSlideLayerFontFamily = useCallback((layer: SlideTextLayerKey, fontFamily: string) => {
    updateGeneratedSlideLayerStyle(activeSlideEditorIndex, layer, { fontFamily });
    setActiveTextLayer(layer);
  }, [activeSlideEditorIndex, updateGeneratedSlideLayerStyle]);

  const resetSlideLayerOffset = useCallback((layer: SlideTextLayerKey) => {
    if (!activeSlide) return;
    if (layer === 'title') {
      updateGeneratedSlideLayerOffset(
        activeSlideEditorIndex,
        'title',
        38,
        getDefaultTextOffsetY(activeSlide, activeSlideEditorIndex),
      );
    } else {
      const titleOffset = resolveSlideLayerOffset(activeSlide, activeSlideEditorIndex, 'title');
      updateGeneratedSlideLayerOffset(activeSlideEditorIndex, 'body', titleOffset.x, clamp(titleOffset.y + 16, 10, 90));
    }
    setActiveTextLayer(layer);
  }, [activeSlide, activeSlideEditorIndex, updateGeneratedSlideLayerOffset]);

  const buildExternalPublishPayload = useCallback((): ContentStudioPublishPayload => {
    const normalizedSlides = normalizeSlidesForPersistence(generatedSlides).map((slide) => ({
      ...slide,
      content: slide.body.trim(),
    }));

    const firstLineTitle = inputText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || null;
    const fallbackImageUrl = normalizedSlides[0]?.image || null;
    const resolvedImageUrl = (imageUrl || fallbackImageUrl || '').trim() || null;
    const slideImageUrls = normalizedSlides
      .map((slide) => slide.renderedImageUrl)
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .slice(0, 10);

    return {
      caption: captionText,
      imageUrl: resolvedImageUrl,
      aspectRatio: ratio,
      festivalTitle: firstLineTitle || sourceLabel || source || null,
      slideImageUrls,
      slides: normalizedSlides,
    };
  }, [captionText, generatedSlides, imageUrl, inputText, normalizeSlidesForPersistence, ratio, source, sourceLabel]);

  const handleSendToCanva = async () => {
    if (!generatedSlides.length) return;
    if (!selectedCanvaTemplateId) {
      setCanvaError('Canva 템플릿을 먼저 선택해 주세요.');
      return;
    }
    setIsSendingToCanva(true);
    setCanvaError(null);

    try {
      const { response, data } = await fetchCanvaWithRetry('/api/canva/autofill', {
        method: 'POST',
        body: JSON.stringify({
          slides: generatedSlides,
          caption: captionText,
          title: `${sourceLabel || source || '카드뉴스'} 카드뉴스`,
          brandTemplateId: selectedCanvaTemplateId,
        }),
      }, true);
      if (!response.ok) {
        if (isUnauthorizedCanvaPayload(data)) {
          setCanvaReconnectRequired(true);
          throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        }
        const reconnectRequired = Boolean(data?.reconnectRequired);
        setCanvaReconnectRequired(reconnectRequired);
        throw new Error(typeof data?.error === 'string' ? data.error : 'Canva 전송에 실패했습니다.');
      }
      setCanvaReconnectRequired(false);

      if (response.status === 202) {
        throw new Error('Canva 작업이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요.');
      }

      const editUrl = typeof data?.editUrl === 'string' ? data.editUrl : null;
      if (!editUrl) {
        throw new Error('Canva 편집 링크를 받지 못했습니다.');
      }

      setCanvaEditUrl(editUrl);
      window.open(editUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Canva 전송 중 오류가 발생했습니다.';
      setCanvaError(message);
    } finally {
      setIsSendingToCanva(false);
    }
  };

  const statsCards = useMemo(() => ([
    {
      label: '생성된 카드뉴스',
      value: publishedCardnewsCount === null ? '-' : publishedCardnewsCount.toLocaleString('ko-KR'),
      change: null as string | null,
      icon: FileText,
      color: 'text-pink-600',
      bg: 'bg-pink-50',
      href: '/gallery?status=published',
    },
    {
      label: '카드뉴스 초안',
      value: draftCardnewsCount === null ? '-' : draftCardnewsCount.toLocaleString('ko-KR'),
      change: null as string | null,
      icon: Save,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      href: '/gallery?status=draft',
    },
    {
      label: 'AI 캡션 생성',
      value: '342',
      change: '+28%',
      icon: Sparkles,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      href: null as string | null,
    },
    {
      label: '평균 도달률',
      value: isAverageReachLoading ? '-' : formatCompactNumber(averageReach),
      change: null as string | null,
      icon: Users,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      href: null as string | null,
    },
    {
      label: '예약된 게시물',
      value: '7',
      change: null as string | null,
      icon: MousePointer2,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      href: null as string | null,
    },
  ]), [averageReach, draftCardnewsCount, isAverageReachLoading, publishedCardnewsCount]);

  return (
    <div className={cn(!embedded && "max-w-[1400px] mx-auto min-h-screen pb-20")}>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6 mb-10">
        {statsCards.map((stat) => {
          const cardBody = (
            <div className="flex items-center gap-4 mb-4">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", stat.bg)}>
                <stat.icon className={cn("w-6 h-6", stat.color)} />
              </div>
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-black text-slate-900">{stat.value}</p>
                  {stat.change && (
                    <span className="text-[10px] font-black text-emerald-500">{stat.change}</span>
                  )}
                </div>
                {stat.href && (
                  <p className="mt-1 text-[10px] font-black text-slate-400">클릭해서 갤러리에서 보기</p>
                )}
              </div>
            </div>
          );

          if (stat.href) {
            return (
              <Link
                key={stat.label}
                href={stat.href}
                className="glassmorphism rounded-[2rem] border-none p-6 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                {cardBody}
              </Link>
            );
          }

          return (
            <div key={stat.label} className="glassmorphism p-6 rounded-[2rem] border-none shadow-md">
              {cardBody}
            </div>
          );
        })}
      </div>

      {/* Main Workspace Section */}
      <div className="mb-16 grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
        <div className="order-1 space-y-6 lg:sticky lg:top-6">
          <div className="glassmorphism overflow-hidden rounded-[2.2rem] border-none shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="border-b border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(255,241,246,0.98)_55%,rgba(255,247,237,0.92))] px-6 py-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.34em] text-pink-500/70">Creative Studio</div>
                  <h1 className="mt-2 flex items-center gap-2 text-[28px] font-black tracking-tight text-slate-950">
                    <Sparkles className="h-6 w-6 text-pink-600" />
                    기획안 + 캡션 스튜디오
                  </h1>
                  <p className="mt-2 max-w-sm text-sm font-bold leading-relaxed text-slate-500">
                    포맷, 배율, 캡션 톤까지 먼저 정하고 AI가 카드뉴스와 게시 문구를 한 번에 구성하게 하세요.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-white/80 bg-white/80 px-3 py-2 text-right shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Current</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{slideCount}장 · {ratio}</div>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-[1.7rem] border border-slate-100 bg-white/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Plan Settings</div>
                    <p className="mt-1 text-sm font-black text-slate-900">콘텐츠 방향과 레이아웃 기준</p>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                    텍스트 밀도 자동 반영
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">뉴스레터 스타일</label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full rounded-xl border-2 border-[var(--card-border)] bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-all focus:border-pink-500"
                    >
                      {styles.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">타겟 독자</label>
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="w-full rounded-xl border-2 border-[var(--card-border)] bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-all focus:border-pink-500"
                    >
                      {targets.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mt-4 rounded-[1.35rem] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">카드 비율</label>
                      <p className="mt-1 text-[11px] font-bold text-slate-500">선택한 배율에 맞춰 문장 길이와 정보 밀도를 조절합니다.</p>
                    </div>
                    <div className="text-sm font-black text-pink-600">{ratio}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {aspectRatios.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => handleRatioChange(item)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-xs font-black transition-all',
                          ratio === item
                            ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-200'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">슬라이드 수</label>
                    <span className="text-xs font-black text-pink-600">
                      {slideCount > 0 ? `${slideCount}장 고정` : 'AI 자율 결정'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="1"
                      value={slideCount}
                      onChange={(e) => setSlideCount(Number.parseInt(e.target.value, 10))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[#E91E63]"
                    />
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-slate-400">
                    {slideCount === 0
                      ? '슬라이더를 0으로 두면 AI가 콘텐츠 양에 맞게 자동으로 결정합니다.'
                      : `${slideCount}장으로 고정 생성합니다.`}
                  </div>
                </div>

                <div className="mt-4 rounded-[1.35rem] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">캡션 톤/스타일</label>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">기획안 + 캡션 생성 시 함께 적용됩니다.</p>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <p className="text-[11px] font-black text-slate-600">톤 선택</p>
                      <div className="mt-2 grid gap-2">
                        {captionToneOptions.map((toneOption) => (
                          <button
                            key={toneOption.id}
                            type="button"
                            onClick={() => setCaptionTone(toneOption.id)}
                            className={cn(
                              'flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all',
                              captionTone === toneOption.id
                                ? 'border-pink-200 bg-pink-50 shadow-sm'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
                            )}
                          >
                            <div>
                              <div className={cn('text-xs font-black', captionTone === toneOption.id ? 'text-pink-700' : 'text-slate-700')}>
                                {toneOption.label}
                              </div>
                              <div className="text-[10px] font-bold text-slate-400">{toneOption.description}</div>
                            </div>
                            {captionTone === toneOption.id && <Check className="h-4 w-4 text-pink-600" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-black text-slate-600">앵글 선택</p>

                      {/* 추천 앵글 3개 카드 */}
                      {isLoadingAngles ? (
                        <div className="mt-2 text-[11px] text-slate-400">앵글 추천 중...</div>
                      ) : suggestedAngles.length > 0 ? (
                        <div className="mt-2 flex flex-col gap-2">
                          {suggestedAngles.map((item) => {
                            const isSelected = selectedAngle?.type === item.type;
                            return (
                              <button
                                key={item.type}
                                type="button"
                                onClick={() => {
                                  setSelectedAngle(item);
                                  setCaptionStyleMode(item.type);
                                }}
                                className={cn(
                                  'rounded-xl border px-3 py-2.5 text-left transition-all',
                                  isSelected
                                    ? 'border-pink-500 bg-pink-500 text-white shadow-lg'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-pink-300',
                                )}
                              >
                                <div className="text-[11px] font-black">{item.label}</div>
                                <div className={cn('mt-1 text-[10px] font-bold leading-relaxed', isSelected ? 'text-white/70' : 'text-slate-400')}>
                                  {item.hook}
                                </div>
                              </button>
                            );
                          })}

                          {/* 다른 앵글 더보기 버튼 */}
                          <button
                            type="button"
                            onClick={() => setShowAllAngles((prev) => !prev)}
                            className="mt-1 text-[11px] font-bold text-slate-400 hover:text-pink-500 transition-colors text-left"
                          >
                            {showAllAngles ? '▲ 접기' : '▼ 다른 앵글 더보기'}
                          </button>

                          {/* 8종 전체 그리드 (펼쳐졌을 때) */}
                          {showAllAngles && (
                            <div className="mt-1 grid grid-cols-2 gap-2">
                              {captionStyleOptions.map((option) => {
                                const isRecommended = suggestedAngles.some((a) => a.type === option.id);
                                const isSelected = selectedAngle?.type === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => {
                                      const matched = suggestedAngles.find((a) => a.type === option.id);
                                      const angleToSelect: angle = matched ?? {
                                        type: option.id as AngleType,
                                        label: option.label,
                                        hook: option.description,
                                        description: option.description,
                                      };
                                      setSelectedAngle(angleToSelect);
                                      setCaptionStyleMode(option.id);
                                    }}
                                    className={cn(
                                      'rounded-xl border px-3 py-2.5 text-left transition-all',
                                      isSelected
                                        ? 'border-pink-500 bg-pink-500 text-white shadow-lg'
                                        : isRecommended
                                          ? 'border-pink-300 bg-pink-50 text-pink-700 hover:border-pink-500'
                                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                    )}
                                  >
                                    <div className="text-[11px] font-black">{option.label}</div>
                                    <div className={cn('mt-1 text-[10px] font-bold leading-relaxed',
                                      isSelected ? 'text-white/70' : isRecommended ? 'text-pink-400' : 'text-slate-400'
                                    )}>
                                      {option.description}
                                      {isRecommended && <span className="ml-1">✦</span>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] text-slate-400">행사를 선택하면 앵글이 추천됩니다.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-slate-100 bg-white/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <div className="mb-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Creative Brief</div>
                  <p className="mt-1 text-sm font-black text-slate-900">카드뉴스에 넣을 원문이나 핵심 정보</p>
                </div>
                <textarea
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    setShowAngleSelector(false);
                    setSuggestedAngles([]);
                    setSelectedAngle(null);
                    setShowAllAngles(false);
                  }}
                  placeholder="행사 소개, 일정, 장소, 타겟 메시지 등을 입력하세요."
                  className="h-44 w-full resize-none rounded-[1.35rem] border-2 border-[var(--card-border)] bg-slate-50/80 p-4 text-sm font-medium outline-none transition-all focus:border-pink-500"
                />

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !inputText}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[1.2rem] bg-pink-600 py-4 text-sm font-black text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-700 active:scale-[0.99] disabled:bg-pink-300"
                >
                  {isGenerating ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-3 border-white/30 border-t-white" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  {isGenerating
                    ? (slideCount >= 10 ? '기획안과 캡션을 작성 중입니다. 잠시만 기다려 주세요...' : 'AI 에디터가 기획안과 캡션을 구성 중입니다...')
                    : selectedAngle
                    ? `"${selectedAngle.label}" 앵글로 생성하기`
                    : showAngleSelector
                    ? '기획안+캡션 생성하기'
                    : '앵글 추천받기'
                  }
                </button>
              </div>

            </div>
          </div>
        </div>

        <div className="order-2 glassmorphism relative overflow-hidden rounded-[2.25rem] border-none p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)] sm:p-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.18),transparent_50%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),transparent_42%)]" />
          <div className="relative z-10">
            <div className="mb-6 flex flex-col gap-4 border-b border-white/70 pb-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.34em] text-slate-400">Preview Workspace</div>
                <h2 className="mt-2 text-[26px] font-black tracking-tight text-slate-950">카드뉴스 미리보기</h2>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  생성된 슬라이드와 캡션을 실시간으로 확인하고, 페이지 편집 팝업에서 바로 수정할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 text-[11px] font-black text-slate-600">
                  포맷 {ratio}
                </div>
                <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 text-[11px] font-black text-slate-600">
                  슬라이드 {generatedSlides.length || slideCount}장
                </div>
                {selectedSavedContentId && (
                  <div className="rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-[11px] font-black text-pink-700">
                    저장 콘텐츠 불러옴
                  </div>
                )}
              </div>
            </div>

            {isSavedContentLoading && (
              <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-black text-sky-700">
                저장된 콘텐츠를 미리보기로 불러오는 중입니다...
              </div>
            )}

            {savedContentError && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700">
                {savedContentError}
              </div>
            )}

            {isGenerating ? (
              <div className="flex min-h-[620px] flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-200 bg-white/70 text-center">
                <div className="relative mb-6 flex h-18 w-18 items-center justify-center rounded-[1.75rem] bg-pink-100">
                  <Sparkles className="h-9 w-9 animate-bounce text-pink-600" />
                  <div className="absolute inset-0 animate-ping rounded-[1.75rem] border-2 border-pink-400 opacity-20" />
                </div>
                <h3 className="text-lg font-black text-slate-900">AI가 기획안과 캡션을 구성하고 있습니다</h3>
                <p className="mt-2 max-w-md text-sm font-bold leading-relaxed text-slate-500">
                  선택한 배율과 스타일을 반영해 슬라이드 구조, 텍스트 밀도, 캡션 톤까지 함께 정리하는 중입니다.
                </p>
              </div>
            ) : generatedSlides.length > 0 ? (
              <div className="grid gap-6 xl:grid-cols-[minmax(320px,390px)_minmax(0,1fr)]">
                <div className="rounded-[2rem] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Instagram Mockup</div>
                      <p className="mt-1 text-sm font-black text-slate-900">현재 캡션과 슬라이드를 피드 형태로 확인</p>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                      {ratio}
                    </div>
                  </div>
                  <CarouselPreview slides={generatedSlides} aspectRatio={ratio} caption={captionText} />
                  {(onPublishNow || onSaveToQueue) && (
                    <div className="mt-4 flex flex-col gap-3">
                      <button
                        onClick={() => {
                          const payload = buildExternalPublishPayload();
                          void onPublishNow?.(payload);
                        }}
                        disabled={!onPublishNow || !hasPublishablePreview || externalAuthLoading || authLoading || isPublishingNow || isScheduling}
                        className="inline-flex items-center justify-center gap-2 rounded-[1.25rem] bg-pink-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-700 disabled:opacity-50"
                      >
                        {isPublishingNow ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                        지금 인스타그램에 게시
                      </button>
                      <button
                        onClick={() => {
                          const payload = buildExternalPublishPayload();
                          void onSaveToQueue?.(payload);
                        }}
                        disabled={!onSaveToQueue || !hasPublishablePreview || externalAuthLoading || authLoading || isScheduling || isPublishingNow}
                        className="inline-flex items-center justify-center gap-2 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-3.5 text-sm font-black text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                      >
                        {isScheduling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                        예약 큐에 저장
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-[2rem] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Caption Studio</div>
                        <p className="mt-1 text-sm font-black text-slate-900">생성된 캡션 초안을 바로 다듬기</p>
                      </div>
                      <div className="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-[10px] font-black text-pink-600">
                        {captionText ? 'AI 초안 있음' : '초안 대기'}
                      </div>
                    </div>
                    <CaptionEditor
                      text={captionText}
                      onTextChange={handleCaptionTextChange}
                      tone={captionTone}
                      onToneChange={setCaptionTone}
                      styleMode={captionStyleMode}
                      onStyleModeChange={setCaptionStyleMode}
                      onGenerateCaption={() => { void handleRegenerateCaption(); }}
                      isGeneratingCaption={isCaptionGenerating}
                      showToneAndStyleControls={false}
                      compact
                      embedded
                    />
                  </div>

                  <div className="rounded-[2rem] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Slide Editor</div>
                        <p className="mt-1 text-sm font-black text-slate-900">레퍼런스형 팝업 편집기로 슬라이드 전체를 한 번에 수정</p>
                      </div>
                      <div
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black',
                          isDraftSaving
                            ? 'border-sky-100 bg-sky-50 text-sky-700'
                            : isDraftDirty
                              ? 'border-amber-100 bg-amber-50 text-amber-700'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-700',
                        )}
                      >
                        {isDraftSaving ? '자동 저장 중' : isDraftDirty ? '저장 대기' : '저장됨'}
                      </div>
                    </div>

                    <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                      카드뉴스가 생성되면 편집 팝업이 자동으로 열립니다. 닫은 뒤에는 아래 버튼으로 다시 열 수 있습니다.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsSlideEditorModalOpen(true)}
                        disabled={generatedSlides.length === 0}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        페이지 편집 팝업 열기
                      </button>
                      <div className="text-[11px] font-bold text-slate-500">
                        {generatedSlides.length > 0
                          ? `현재 ${activeSlideEditorIndex + 1} / ${generatedSlides.length} 페이지`
                          : '생성된 슬라이드가 없습니다.'}
                      </div>
                    </div>

                    {draftSaveError && (
                      <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600">
                        {draftSaveError}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[2rem] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Delivery Actions</div>
                        <p className="mt-1 text-sm font-black text-slate-900">최종 문구와 편집본을 반영해 발행 단계를 진행</p>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                        {draftId ? '초안 저장됨' : publishSuccessAt ? '발행 완료' : '초안 대기'}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        onClick={handlePublish}
                        disabled={!draftId || isPublishing}
                        className="inline-flex items-center gap-2 rounded-[1.1rem] bg-slate-900 px-5 py-3 text-sm font-black text-white transition-all hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        {isPublishing ? '발행 처리 중...' : '발행 완료 처리'}
                      </button>
                    </div>

                    {publishError && (
                      <div className="mt-4 rounded-[1.2rem] border border-rose-100 bg-rose-50 px-4 py-3 text-[11px] font-bold text-rose-500">
                        {publishError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[620px] flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-200 bg-white/70 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-white shadow-lg shadow-pink-50">
                  <Layout className="h-10 w-10 text-pink-400" />
                </div>
                <h3 className="text-xl font-black text-slate-900">카드뉴스 미리보기</h3>
                <p className="mt-2 max-w-sm text-sm font-bold leading-relaxed text-slate-500">
                  왼쪽에서 브리프와 캡션 톤을 정한 뒤 생성하면, 여기에서 결과를 확인하고 바로 편집할 수 있습니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Festival List Section */}
      {SHOW_FESTIVAL_SOURCE_SECTION && (
      <div className="mt-6 pt-10 border-t-2 border-slate-100 border-dashed">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Calendar className="w-6 h-6 text-pink-600" />
              페스티벌 정보 소스
            </h2>
            <p className="text-slate-500 font-bold text-sm mt-1">카드를 클릭하여 좌측 기획안 폼에 정보를 자동으로 입력하세요.</p>
          </div>
          <button
            onClick={() => fetchFestivals(true)}
            disabled={isFestivalsLoading}
            className="p-3 text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-xl transition-all disabled:opacity-50 border-2 border-transparent hover:border-pink-100"
            title="데이터 새로고침"
          >
            <RefreshCw className={`w-5 h-5 ${isFestivalsLoading ? 'animate-spin' : ''}`} />
          </button>
          <div className="text-[10px] font-bold text-slate-400 text-right">
            <div>마지막 업데이트: {lastUpdated ? formatDateTime(lastUpdated) : "알 수 없음"}</div>
          </div>
        </div>

        <div className="flex bg-slate-200/50 p-1.5 rounded-2xl w-fit shadow-inner mb-8">
          <div className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold bg-white text-slate-900 shadow-md scale-[1.02]">
            <Sparkles className="w-4 h-4 text-pink-500" />
            페스티벌 라이프
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
          {/* Sub Filters (Sticky) */}
          <div className="sticky top-0 z-20 bg-white p-6 border-b border-slate-100 shadow-sm">
            <div className="flex flex-wrap items-center gap-8">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">일정 필터</label>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  {filterOptions.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setFilter(item.id)}
                      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${filter === item.id
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">정렬</label>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  {sortOptions.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSortBy(item.id)}
                      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${sortBy === item.id
                        ? 'bg-pink-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 flex-1 min-w-[300px]">
                <div className="flex flex-wrap gap-2 pt-6">
                  {availableGenres.map(g => (
                    <button
                      key={g}
                      onClick={() => setGenreFilter(g)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${genreFilter === g
                        ? 'bg-pink-50 border-pink-200 text-pink-700 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs font-bold text-slate-400">
              총 {filteredFestivals.length}건 · 페이지 {safeCurrentPage}/{totalPages} · 페이지당 {FESTIVALS_PER_PAGE}건
            </p>
          </div>

          {/* Festival Gallery (Scrollable) */}
          <div ref={festivalListRef} className="max-h-[72vh] overflow-y-auto px-6 py-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-black text-slate-600">행사 선택</p>
              <button
                type="button"
                onClick={() => {
                  setIsCurationMode((prev) => !prev);
                  setCurationFestivals([]);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-[10px] font-black transition-all',
                  isCurationMode
                    ? 'border-pink-500 bg-pink-500 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-pink-300',
                )}
              >
                {isCurationMode ? '✦ 큐레이션 모드' : '큐레이션 모드'}
              </button>
            </div>

            {isCurationMode && (
              <div className="mb-3 rounded-xl border border-pink-100 bg-pink-50 p-3">
                <p className="text-[10px] font-black text-pink-700">큐레이션 모드</p>
                <p className="mt-1 text-[10px] font-bold text-pink-500">
                  여러 행사를 클릭해서 선택하세요. 선택한 행사들을 하나의 카드뉴스로 묶습니다.
                </p>
                <div className="mt-2">
                  <input
                    type="text"
                    value={curationTheme}
                    onChange={(e) => setCurationTheme(e.target.value)}
                    placeholder="테마 입력 (예: 이번 주 공연 소식)"
                    className="w-full rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-[11px] font-bold outline-none focus:border-pink-400"
                  />
                </div>
                {curationFestivals.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {curationFestivals.map((f) => (
                      <span
                        key={f.id}
                        className="flex items-center gap-1 rounded-full bg-pink-200 px-2 py-0.5 text-[10px] font-black text-pink-800"
                      >
                        {f.title.slice(0, 10)}
                        <button
                          type="button"
                          onClick={() => setCurationFestivals((prev) => prev.filter((x) => x.id !== f.id))}
                          className="text-pink-600 hover:text-pink-900"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isFestivalsLoading && festivals.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="aspect-[3/4] bg-white border border-slate-200 rounded-3xl p-4 animate-pulse">
                    <div className="w-full h-full bg-slate-100 rounded-2xl" />
                  </div>
                ))}
              </div>
            ) : filteredFestivals.length === 0 ? (
              <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-200 border-dashed">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                  <Info className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-black text-slate-900 mb-2">데이터가 없습니다</h3>
                <p className="text-slate-500 font-medium text-sm">조건에 맞는 페스티벌이 없습니다.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-x-5 gap-y-10">
                  {paginatedFestivals.map((festival) => (
                    <div
                      key={festival.id}
                      onClick={() => handleFestivalClick(festival)}
                      className="group cursor-pointer"
                    >
                      <div className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-slate-200 shadow-sm border-2 border-slate-100 group-hover:shadow-xl group-hover:border-pink-300 group-hover:-translate-y-1 transition-all duration-300">
                        <img
                          src={festival.imageUrl || "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80"}
                          alt={festival.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-50 group-hover:opacity-70 transition-opacity" />

                        <div className="absolute top-3 left-3 flex flex-col gap-2">
                          <div className="bg-black/40 backdrop-blur-xl border border-white/20 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-all">
                            <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse"></div>
                            <span className="text-[9px] font-black text-white/90 uppercase tracking-wider">
                              @{festival.sourceLabel}
                            </span>
                          </div>
                        </div>

                        <div className="absolute bottom-4 left-4 right-4 text-white">
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {festival.genre.split(',').slice(0, 2).map((tag, idx) => (
                              <span key={idx} className="px-2 py-1 bg-white/20 backdrop-blur-md rounded-lg text-[9px] font-black uppercase tracking-tight border border-white/10">
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                          <h3 className="text-base font-black leading-tight line-clamp-2 drop-shadow-md">
                            {festival.title}
                          </h3>
                        </div>
                      </div>
                      <div className="mt-3 px-1 space-y-1">
                        <p className="text-xs font-bold text-slate-800 line-clamp-1">{festival.location}</p>
                        <p className="text-[11px] font-bold text-slate-400">{festival.startDate} ~ {festival.endDate}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => handlePageChange(page)}
                        className={`min-w-9 h-9 px-3 rounded-lg text-sm font-black transition-all ${page === safeCurrentPage
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {isSlideEditorModalOpen && generatedSlides.length > 0 && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slide-editor-modal-title"
        >
          <button
            type="button"
            aria-label="페이지 편집 모달 닫기"
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setIsSlideEditorModalOpen(false)}
          />

          <div className="relative z-10 flex max-h-[95vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-[1.6rem] border border-slate-200 bg-[#f8fafc] shadow-[0_40px_120px_rgba(15,23,42,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-4">
                <div id="slide-editor-modal-title" className="text-[34px] font-black leading-none tracking-tight text-slate-900">
                  {activeSlideEditorIndex + 1}페이지 편집
                </div>
                <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => moveActiveSlideEditor('prev')}
                    disabled={!canMoveSlideBackward}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-slate-500 transition-all hover:border-slate-200 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-[80px] text-center text-[30px] font-black leading-none tracking-tight text-slate-700">
                    {activeSlideEditorIndex + 1} / {generatedSlides.length}
                  </div>
                  <button
                    type="button"
                    onClick={() => moveActiveSlideEditor('next')}
                    disabled={!canMoveSlideForward}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-slate-500 transition-all hover:border-slate-200 hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400"
                  title="되돌리기 (준비 중)"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400"
                  title="다시 실행 (준비 중)"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => { void saveDraftEdits(); }}
                  disabled={!draftId || isDraftSaving || !isDraftDirty}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-40"
                >
                  <Save className={cn('h-4 w-4', isDraftSaving && 'animate-pulse')} />
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (draftId && isDraftDirty && !isDraftSaving) {
                      void saveDraftEdits();
                    }
                    setIsSlideEditorModalOpen(false);
                  }}
                  className="rounded-xl bg-[#7c3aed] px-4 py-2.5 text-sm font-black text-white transition-all hover:bg-[#6d28d9]"
                >
                  저장 후 닫기
                </button>
                <button
                  type="button"
                  onClick={() => setIsSlideEditorModalOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:text-slate-900"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs font-black text-amber-700">
              편집 중에는 페이지를 벗어나지 마세요. 변경사항이 사라질 수 있습니다.
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_430px]">
              <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_rgba(15,23,42,0.08)] sm:p-4">
                <div className="h-full overflow-y-auto">
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-900 p-2.5 sm:p-3.5">
                    {activeSlide ? (
                      <div
                        ref={slidePreviewCanvasRef}
                        className={cn(
                          'relative mx-auto w-full overflow-hidden rounded-[1rem] border border-white/15 shadow-[0_28px_75px_rgba(2,6,23,0.55)]',
                          getSlideEditorAspectRatioClass(ratio),
                          ratio === '16:9' ? 'max-w-[760px]' : 'max-w-[560px]',
                        )}
                      >
                        {activeSlideImage ? (
                          <img
                            src={activeSlideImage}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(244,114,182,0.55),transparent_44%),radial-gradient(circle_at_85%_14%,rgba(96,165,250,0.45),transparent_42%),linear-gradient(150deg,#0f172a_0%,#1e293b_55%,#334155_100%)]" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-black/70" />

                        <div className="absolute left-3 top-3 z-30 rounded-full border border-white/45 bg-black/40 px-2.5 py-1 text-[10px] font-black text-white/90">
                          텍스트를 드래그해서 위치 이동
                        </div>

                        <div
                          role="button"
                          tabIndex={0}
                          onPointerDown={(event) => handleSlideTextDragStart('title', event)}
                          onPointerMove={handleSlideTextDragMove}
                          onPointerUp={finishSlideTextDrag}
                          onPointerCancel={finishSlideTextDrag}
                          onClick={() => {
                            setActiveTextLayer('title');
                            setOpenEditorSection('title');
                          }}
                          className={cn(
                            'absolute z-20 w-[min(88%,560px)] cursor-grab select-none rounded-2xl border px-4 py-3 text-white transition-all',
                            activeTextLayer === 'title'
                              ? 'border-[#8b5cf6] bg-black/38 shadow-[0_14px_42px_rgba(139,92,246,0.35)]'
                              : 'border-white/25 bg-black/35 shadow-[0_10px_30px_rgba(2,6,23,0.42)]',
                            isTextDragActive && activeTextLayer === 'title' && 'cursor-grabbing',
                          )}
                          style={{
                            left: `${activeSlideTitleOffset.x}%`,
                            top: `${activeSlideTitleOffset.y}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/70">TITLE</p>
                          <h3
                            className="mt-2 whitespace-pre-wrap leading-tight"
                            style={{
                              fontFamily: activeSlideTitleStyle.fontFamily === 'inherit' ? undefined : activeSlideTitleStyle.fontFamily,
                              fontSize: `${activeSlideTitleStyle.fontSize}px`,
                              color: activeSlideTitleStyle.color,
                              fontWeight: activeSlideTitleStyle.fontWeight,
                            }}
                          >
                            {activeSlideTitle || `슬라이드 ${activeSlideEditorIndex + 1}`}
                          </h3>
                        </div>

                        {activeSlideBody ? (
                          <div
                            role="button"
                            tabIndex={0}
                            onPointerDown={(event) => handleSlideTextDragStart('body', event)}
                            onPointerMove={handleSlideTextDragMove}
                            onPointerUp={finishSlideTextDrag}
                            onPointerCancel={finishSlideTextDrag}
                            onClick={() => {
                              setActiveTextLayer('body');
                              setOpenEditorSection('body');
                            }}
                            className={cn(
                              'absolute z-20 w-[min(86%,540px)] cursor-grab select-none rounded-2xl border px-4 py-3 text-white transition-all',
                              activeTextLayer === 'body'
                                ? 'border-[#8b5cf6] bg-black/38 shadow-[0_14px_42px_rgba(139,92,246,0.35)]'
                                : 'border-white/20 bg-black/32 shadow-[0_10px_28px_rgba(2,6,23,0.36)]',
                              isTextDragActive && activeTextLayer === 'body' && 'cursor-grabbing',
                            )}
                            style={{
                              left: `${activeSlideBodyOffset.x}%`,
                              top: `${activeSlideBodyOffset.y}%`,
                              transform: 'translate(-50%, -50%)',
                            }}
                          >
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/70">BODY</p>
                            <p
                              className="mt-2 whitespace-pre-wrap leading-relaxed"
                              style={{
                                fontFamily: activeSlideBodyStyle.fontFamily === 'inherit' ? undefined : activeSlideBodyStyle.fontFamily,
                                fontSize: `${activeSlideBodyStyle.fontSize}px`,
                                color: activeSlideBodyStyle.color,
                                fontWeight: activeSlideBodyStyle.fontWeight,
                              }}
                            >
                              {activeSlideBody}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/35 text-sm font-black text-white/75">
                        편집할 슬라이드를 선택하세요.
                      </div>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-7">
                    {generatedSlides.map((slide, index) => {
                      const isActive = index === activeSlideEditorIndex;
                      const thumbTitle = (slide.title || `슬라이드 ${index + 1}`).trim();
                      const thumbImage = (slide.image || slide.renderedImageUrl || '').trim();
                      return (
                        <button
                          key={slide.id || `${index}-${thumbTitle}`}
                          type="button"
                          onClick={() => setActiveSlideEditorIndex(index)}
                          className={cn(
                            'group relative overflow-hidden rounded-xl border text-left transition-all',
                            isActive ? 'border-[#8b5cf6] ring-2 ring-[#c4b5fd]' : 'border-slate-200 hover:border-slate-300',
                          )}
                        >
                          <div className="relative aspect-[3/4] bg-slate-100">
                            {thumbImage ? (
                              <img src={thumbImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                            ) : (
                              <div className="absolute inset-0 bg-[linear-gradient(145deg,#f8fafc_0%,#e2e8f0_100%)]" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                            <div className="absolute left-2 top-2 rounded-full border border-white/60 bg-black/40 px-1.5 py-0.5 text-[9px] font-black text-white">
                              {index + 1}
                            </div>
                            <div className="absolute inset-x-2 bottom-2 line-clamp-2 text-[10px] font-black leading-tight text-white drop-shadow">
                              {thumbTitle || `슬라이드 ${index + 1}`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_rgba(15,23,42,0.08)] sm:p-4">
                <div className="h-full overflow-y-auto pr-0.5">
                  <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <button type="button" className="border-b-2 border-slate-900 bg-white px-3 py-2.5 text-sm font-black text-slate-900">
                      편집
                    </button>
                    <button type="button" disabled className="px-3 py-2.5 text-sm font-black text-slate-400">
                      AI 디자이너
                    </button>
                  </div>

                  {activeSlide ? (
                    <div className="mt-3 space-y-3">
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setOpenEditorSection((prev) => (prev === 'background' ? 'title' : 'background'))}
                          className="flex w-full items-center justify-between gap-3 px-3 py-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                              <ImageIcon className="h-4 w-4" />
                            </span>
                            <span className="text-sm font-black text-slate-800">Cover Background Image</span>
                          </div>
                          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', openEditorSection === 'background' && 'rotate-180')} />
                        </button>
                        {openEditorSection === 'background' && (
                          <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2">
                            <div className="flex gap-2">
                              <input
                                value={typeof activeSlide.image === 'string' ? activeSlide.image : ''}
                                onChange={(event) => updateGeneratedSlideField(activeSlideEditorIndex, 'image', event.target.value)}
                                placeholder="https://..."
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#8b5cf6]"
                              />
                              <button
                                type="button"
                                onClick={() => updateGeneratedSlideField(activeSlideEditorIndex, 'image', '')}
                                disabled={!activeSlideImage}
                                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40"
                              >
                                삭제
                              </button>
                            </div>
                            <input
                              value={activeSlide.keywords || ''}
                              onChange={(event) => updateGeneratedSlideField(activeSlideEditorIndex, 'keywords', event.target.value)}
                              placeholder="검색 키워드"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#8b5cf6]"
                            />
                          </div>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-xl border border-[#c4b5fd] bg-[#faf8ff]">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenEditorSection((prev) => (prev === 'title' ? 'body' : 'title'));
                            setActiveTextLayer('title');
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                              <Type className="h-4 w-4" />
                            </span>
                            <span className="text-sm font-black text-slate-800">{activeSlideTitle || '슬라이드 제목'}</span>
                          </div>
                          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', openEditorSection === 'title' && 'rotate-180')} />
                        </button>
                        {openEditorSection === 'title' && (
                          <div className="space-y-3 border-t border-[#ddd6fe] px-3 pb-3 pt-2">
                            <textarea
                              value={activeSlide.title || ''}
                              onChange={(event) => updateGeneratedSlideField(activeSlideEditorIndex, 'title', event.target.value)}
                              rows={3}
                              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-base font-black text-slate-700 outline-none transition-all focus:border-[#8b5cf6]"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <p className="text-[11px] font-black text-slate-500">폰트</p>
                                <select
                                  value={activeSlideTitleStyle.fontFamily}
                                  onChange={(event) => setSlideLayerFontFamily('title', event.target.value)}
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[#8b5cf6]"
                                >
                                  {SLIDE_EDITOR_FONT_OPTIONS.map((fontOption) => (
                                    <option key={fontOption.value} value={fontOption.value}>
                                      {fontOption.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <p className="text-[11px] font-black text-slate-500">크기</p>
                                <div className="mt-1 flex items-center gap-2">
                                  <button type="button" onClick={() => adjustSlideLayerFontSize('title', -2)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"><Minus className="h-4 w-4" /></button>
                                  <div className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-center text-sm font-black text-slate-700">
                                    {Math.round(activeSlideTitleStyle.fontSize)}
                                  </div>
                                  <button type="button" onClick={() => adjustSlideLayerFontSize('title', 2)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"><Plus className="h-4 w-4" /></button>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              {SLIDE_EDITOR_SIZE_PRESETS.map((sizePreset) => (
                                <button
                                  key={`title-size-${sizePreset}`}
                                  type="button"
                                  onClick={() => setSlideLayerFontSize('title', sizePreset)}
                                  className={cn(
                                    'rounded-md border px-2 py-1 text-xs font-black transition-all',
                                    Math.round(activeSlideTitleStyle.fontSize) === sizePreset
                                      ? 'border-[#8b5cf6] bg-[#ede9fe] text-[#6d28d9]'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                  )}
                                >
                                  {sizePreset}
                                </button>
                              ))}
                            </div>

                            <div>
                              <p className="text-[11px] font-black text-slate-500">색상</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {SLIDE_EDITOR_COLOR_OPTIONS.map((color) => (
                                  <button
                                    key={`title-color-${color}`}
                                    type="button"
                                    onClick={() => setSlideLayerColor('title', color)}
                                    className={cn(
                                      'h-7 w-7 rounded-full border-2 transition-all',
                                      activeSlideTitleStyle.color.toLowerCase() === color.toLowerCase()
                                        ? 'border-[#8b5cf6] scale-110'
                                        : 'border-white',
                                    )}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-5 gap-1.5">
                              {SLIDE_EDITOR_WEIGHT_OPTIONS.map((weightOption) => (
                                <button
                                  key={`title-weight-${weightOption.value}`}
                                  type="button"
                                  onClick={() => setSlideLayerWeight('title', weightOption.value)}
                                  className={cn(
                                    'rounded-lg border py-1.5 text-xs font-black transition-all',
                                    activeSlideTitleStyle.fontWeight === weightOption.value
                                      ? 'border-[#8b5cf6] bg-[#8b5cf6] text-white'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                  )}
                                >
                                  {weightOption.label}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                              <p className="text-xs font-black text-slate-600">X {Math.round(activeSlideTitleOffset.x)} · Y {Math.round(activeSlideTitleOffset.y)}</p>
                              <button type="button" onClick={() => resetSlideLayerOffset('title')} className="text-xs font-black text-[#6d28d9]">
                                기본 위치
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenEditorSection((prev) => (prev === 'body' ? 'title' : 'body'));
                            setActiveTextLayer('body');
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                              <Type className="h-4 w-4" />
                            </span>
                            <span className="text-sm font-black text-slate-800">{activeSlideBody || '본문 문구'}</span>
                          </div>
                          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', openEditorSection === 'body' && 'rotate-180')} />
                        </button>
                        {openEditorSection === 'body' && (
                          <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2">
                            <textarea
                              value={activeSlide.body || activeSlide.content || ''}
                              onChange={(event) => updateGeneratedSlideField(activeSlideEditorIndex, 'body', event.target.value)}
                              rows={4}
                              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#8b5cf6]"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <p className="text-[11px] font-black text-slate-500">폰트</p>
                                <select
                                  value={activeSlideBodyStyle.fontFamily}
                                  onChange={(event) => setSlideLayerFontFamily('body', event.target.value)}
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[#8b5cf6]"
                                >
                                  {SLIDE_EDITOR_FONT_OPTIONS.map((fontOption) => (
                                    <option key={`body-font-${fontOption.value}`} value={fontOption.value}>
                                      {fontOption.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <p className="text-[11px] font-black text-slate-500">크기</p>
                                <div className="mt-1 flex items-center gap-2">
                                  <button type="button" onClick={() => adjustSlideLayerFontSize('body', -2)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"><Minus className="h-4 w-4" /></button>
                                  <div className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-center text-sm font-black text-slate-700">
                                    {Math.round(activeSlideBodyStyle.fontSize)}
                                  </div>
                                  <button type="button" onClick={() => adjustSlideLayerFontSize('body', 2)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"><Plus className="h-4 w-4" /></button>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              {SLIDE_EDITOR_SIZE_PRESETS.map((sizePreset) => (
                                <button
                                  key={`body-size-${sizePreset}`}
                                  type="button"
                                  onClick={() => setSlideLayerFontSize('body', sizePreset)}
                                  className={cn(
                                    'rounded-md border px-2 py-1 text-xs font-black transition-all',
                                    Math.round(activeSlideBodyStyle.fontSize) === sizePreset
                                      ? 'border-[#8b5cf6] bg-[#ede9fe] text-[#6d28d9]'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                  )}
                                >
                                  {sizePreset}
                                </button>
                              ))}
                            </div>

                            <div>
                              <p className="text-[11px] font-black text-slate-500">색상</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {SLIDE_EDITOR_COLOR_OPTIONS.map((color) => (
                                  <button
                                    key={`body-color-${color}`}
                                    type="button"
                                    onClick={() => setSlideLayerColor('body', color)}
                                    className={cn(
                                      'h-7 w-7 rounded-full border-2 transition-all',
                                      activeSlideBodyStyle.color.toLowerCase() === color.toLowerCase()
                                        ? 'border-[#8b5cf6] scale-110'
                                        : 'border-white',
                                    )}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-5 gap-1.5">
                              {SLIDE_EDITOR_WEIGHT_OPTIONS.map((weightOption) => (
                                <button
                                  key={`body-weight-${weightOption.value}`}
                                  type="button"
                                  onClick={() => setSlideLayerWeight('body', weightOption.value)}
                                  className={cn(
                                    'rounded-lg border py-1.5 text-xs font-black transition-all',
                                    activeSlideBodyStyle.fontWeight === weightOption.value
                                      ? 'border-[#8b5cf6] bg-[#8b5cf6] text-white'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                  )}
                                >
                                  {weightOption.label}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                              <p className="text-xs font-black text-slate-600">X {Math.round(activeSlideBodyOffset.x)} · Y {Math.round(activeSlideBodyOffset.y)}</p>
                              <button type="button" onClick={() => resetSlideLayerOffset('body')} className="text-xs font-black text-[#6d28d9]">
                                기본 위치
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs font-black text-slate-500">
                      편집할 슬라이드를 선택하세요.
                    </div>
                  )}

                  <div className="mt-3 text-[10px] font-bold text-slate-400">
                    {draftSavedTimeText ? `마지막 저장 ${draftSavedTimeText}` : '아직 저장 이력이 없습니다.'}
                    <br />
                    {draftId ? `Draft ID: ${draftId}` : '초안이 없어 자동 저장이 비활성화됩니다.'}
                    <br />
                    {activeTextLayer === 'title' ? '현재 선택: 제목 텍스트' : '현재 선택: 본문 텍스트'}
                    {' · '}
                    {`폰트 ${Math.round(activeLayerStyle.fontSize)}px`}
                    {' · '}
                    {`위치 ${Math.round(activeLayerOffset.x)}, ${Math.round(activeLayerOffset.y)}`}
                  </div>

                  {draftSaveError && (
                    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600">
                      {draftSaveError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCanvaTemplatePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="canva-template-picker-title"
        >
          <button
            type="button"
            aria-label="Canva 템플릿 선택 모달 닫기"
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-md"
            onClick={handleCloseCanvaTemplatePicker}
          />

          <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(255,247,250,0.92))] shadow-[0_40px_140px_rgba(15,23,42,0.3)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.22),transparent_55%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.16),transparent_45%)]" />

            <div className="relative flex items-start justify-between gap-6 border-b border-white/60 px-6 py-5 sm:px-8">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.32em] text-slate-400">Canva Picker</div>
                <h2 id="canva-template-picker-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  템플릿을 이미지로 보고 선택하세요
                </h2>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  현재 디자인 톤에 맞는 템플릿을 고른 뒤 바로 Canva Autofill로 보낼 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseCanvaTemplatePicker}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/85 text-slate-500 transition-all hover:border-slate-300 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 min-[900px]:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="order-1 min-w-0 overflow-hidden border-b border-slate-200/70 bg-[radial-gradient(circle_at_top,_rgba(236,72,153,0.28),transparent_32%),linear-gradient(180deg,#111827_0%,#0f172a_52%,#111827_100%)] min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:border-white/10">
                <div className="relative h-full overflow-y-auto p-6 text-white sm:p-8">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/55">Selected Preview</div>
                  <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black text-white/80">
                    {pickerCanvaTemplate ? '선택 준비 완료' : '템플릿 대기'}
                  </div>
                </div>

                {pickerCanvaTemplate ? (
                  <>
                    <div className="mx-auto mt-5 w-full max-w-[300px] overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-2 shadow-[0_22px_60px_rgba(0,0,0,0.35)] sm:max-w-[340px]">
                      <CanvaTemplateThumbnail
                        template={pickerCanvaTemplate}
                        className="aspect-[4/5] rounded-[1.5rem] bg-white/90"
                        imageClassName="object-contain p-2"
                      />
                    </div>

                    <div className="mt-6 space-y-4">
                      <div>
                        <p className="text-xl font-black leading-tight text-white">{pickerCanvaTemplate.title}</p>
                        <p className="mt-2 text-sm font-bold text-white/60">
                          {formatTemplateUpdatedAt(pickerCanvaTemplate.updatedAt)}
                        </p>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Workflow</p>
                        <p className="mt-3 text-sm font-bold leading-relaxed text-white/80">
                          이 템플릿을 선택하면 현재 생성된 슬라이드 텍스트가 Canva의 Data Autofill 필드로 바로 들어갑니다.
                        </p>
                        {pickerCanvaTemplate.viewUrl && (
                          <a
                            href={pickerCanvaTemplate.viewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-1.5 text-xs font-black text-white transition-opacity hover:opacity-80"
                          >
                            Canva에서 원본 열기
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                  </>
                ) : (
                  <div className="mt-10 rounded-[2rem] border border-dashed border-white/15 bg-white/6 px-6 py-12 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10">
                      <Layout className="h-7 w-7 text-white/70" />
                    </div>
                    <p className="mt-5 text-lg font-black text-white">템플릿을 선택해 주세요</p>
                    <p className="mt-2 text-sm font-bold text-white/55">
                      오른쪽 카드에서 원하는 스타일을 고르면 여기에서 크게 미리 볼 수 있습니다.
                    </p>
                  </div>
                )}
                </div>
              </div>

              <div className="order-2 min-w-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.92))]">
                <div className="h-full overflow-y-auto p-6 sm:p-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={templateSearchQuery}
                      onChange={(e) => setTemplateSearchQuery(e.target.value)}
                      placeholder="템플릿 이름 검색"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-11 py-3 text-sm font-bold text-slate-800 outline-none transition-all focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { void fetchCanvaTemplates(); }}
                    disabled={isCanvaTemplatesLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isCanvaTemplatesLoading && 'animate-spin')} />
                    {isCanvaTemplatesLoading ? '동기화 중...' : '템플릿 새로고침'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold text-slate-500">
                    총 {canvaTemplates.length}개 템플릿
                    {templateSearchQuery.trim() && ` · 검색 결과 ${filteredCanvaTemplates.length}개`}
                  </p>
                  <p className="text-[11px] font-bold text-slate-400">
                    Canva 보안 정책상 썸네일은 일정 시간이 지나면 다시 불러와야 할 수 있습니다.
                  </p>
                </div>

                {canvaTemplatesError && (
                  <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">
                    {canvaTemplatesError}
                  </div>
                )}

                {isCanvaTemplatesLoading && canvaTemplates.length === 0 ? (
                  <div className="mt-6 grid grid-cols-1 gap-3">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className="grid grid-cols-[112px,1fr] gap-4 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white p-3 animate-pulse">
                        <div className="h-[132px] rounded-[1.2rem] bg-slate-100" />
                        <div className="py-2">
                          <div className="h-4 w-2/3 rounded-full bg-slate-100" />
                          <div className="mt-2 h-3 w-1/2 rounded-full bg-slate-100" />
                          <div className="mt-5 h-3 w-full rounded-full bg-slate-100" />
                          <div className="mt-2 h-3 w-4/5 rounded-full bg-slate-100" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredCanvaTemplates.length === 0 ? (
                  <div className="mt-6 rounded-[2rem] border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
                      <Search className="h-6 w-6" />
                    </div>
                    <p className="mt-5 text-lg font-black text-slate-900">검색 결과가 없습니다</p>
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      다른 키워드로 검색하거나 템플릿 목록을 새로고침해 보세요.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 grid grid-cols-1 gap-3">
                    {filteredCanvaTemplates.map((template) => {
                      const isPickerSelected = template.id === pickerCanvaTemplateId;
                      const isCurrentSelected = template.id === selectedCanvaTemplateId;

                      return (
                        <button
                          type="button"
                          key={template.id}
                          onClick={() => setPickerCanvaTemplateId(template.id)}
                          className={cn(
                            'group grid grid-cols-[112px,1fr] gap-4 overflow-hidden rounded-[1.6rem] border bg-white p-3 text-left shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition-all',
                            isPickerSelected
                              ? 'border-pink-300 ring-4 ring-pink-100 shadow-[0_24px_48px_rgba(236,72,153,0.16)]'
                              : 'border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_24px_48px_rgba(15,23,42,0.08)]',
                          )}
                        >
                          <div className="relative">
                            <CanvaTemplateThumbnail
                              template={template}
                              className="h-[132px] w-[112px] rounded-[1.2rem] border border-slate-100"
                              imageClassName="transition-transform duration-500 group-hover:scale-[1.03]"
                            />
                            <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
                              {isCurrentSelected && (
                                <span className="rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[9px] font-black text-slate-900 shadow-sm">
                                  현재 사용 중
                                </span>
                              )}
                              {isPickerSelected && (
                                <span className="rounded-full bg-slate-950 px-2 py-1 text-[9px] font-black text-white shadow-lg">
                                  선택됨
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex min-w-0 flex-col justify-between py-1 pr-1">
                            <div>
                              <p className="line-clamp-2 text-sm font-black leading-snug text-slate-900">{template.title}</p>
                              <p className="mt-2 text-[11px] font-bold text-slate-500">
                                {formatTemplateUpdatedAt(template.updatedAt)}
                              </p>
                              <p className="mt-4 text-[11px] font-bold leading-relaxed text-slate-500">
                                클릭하면 왼쪽 프리뷰 영역에서 크게 확인할 수 있습니다.
                              </p>
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-3">
                              <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                                템플릿 미리보기
                              </div>
                              <div className={cn(
                                'rounded-full border px-2.5 py-1 text-[10px] font-black',
                                isPickerSelected
                                  ? 'border-pink-200 bg-pink-50 text-pink-600'
                                  : 'border-slate-200 bg-slate-50 text-slate-500',
                              )}>
                                {isPickerSelected ? '선택됨' : '선택 가능'}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/70 bg-white/75 px-6 py-4 backdrop-blur-sm sm:px-8">
              <div className="text-[11px] font-bold text-slate-500">
                {pickerCanvaTemplate
                  ? `선택 예정: ${pickerCanvaTemplate.title}`
                  : '오른쪽 리스트에서 템플릿을 선택하면 왼쪽 프리뷰에 표시됩니다.'}
              </div>
              <button
                type="button"
                onClick={handleConfirmCanvaTemplateSelection}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Check className="h-4 w-4" />
                완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
