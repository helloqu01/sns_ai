"use client";

import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, FileText, Users, MousePointer2, Sparkles,
  Image as ImageIcon, Layout, Save, Calendar, RefreshCw, Info, X, Check, ExternalLink
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

const FALLBACK_SUGGESTED_ANGLES: SuggestedAngle[] = [
  { type: 'VIBE', label: '감성/분위기', hook: '이번 시즌 꼭 가야 할 이유', description: '분위기와 경험을 중심으로 한 앵글' },
  { type: 'LINEUP', label: '라인업', hook: '이 라인업 보고도 안 가면 후회', description: '아티스트 기대감을 자극하는 앵글' },
  { type: 'SCARCITY', label: '희소성', hook: '딱 이번뿐, 놓치면 1년 기다려야 해', description: '희소성으로 클릭을 유도하는 앵글' },
];
const SUGGEST_ANGLES_TIMEOUT_MS = 10_000;
const SUGGEST_ANGLES_CACHE_TTL_MS = 10 * 60 * 1000;
const buildSuggestedAnglesCacheKey = (content: string) =>
  content.replace(/\s+/g, ' ').trim().slice(0, 1200).toLowerCase();

type ContentStudioProps = {
  embedded?: boolean;
  selectedCardnewsId?: string | null;
};

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

export default function ContentStudio({ embedded = false, selectedCardnewsId = null }: ContentStudioProps) {
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
  const [selectedSavedContentId, setSelectedSavedContentId] = useState<string | null>(null);
  const [isSavedContentLoading, setIsSavedContentLoading] = useState(false);
  const [savedContentError, setSavedContentError] = useState<string | null>(null);
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
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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

  const fetchDashboardStats = async () => {
    if (!user) {
      setPublishedCardnewsCount(null);
      setDraftCardnewsCount(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setPublishedCardnewsCount(typeof data.publishedCardnewsCount === 'number' ? data.publishedCardnewsCount : 0);
      setDraftCardnewsCount(typeof data.draftCardnewsCount === 'number' ? data.draftCardnewsCount : 0);
    } catch (error) {
      console.error(error);
    }
  };

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
          id: `${item.id}-${index + 1}`,
          title: typeof slide?.title === 'string' && slide.title.trim() ? slide.title.trim() : `슬라이드 ${index + 1}`,
          body: typeof slide?.body === 'string' ? slide.body : '',
          image: index === 0 && typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
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
    if (SHOW_FESTIVAL_SOURCE_SECTION) {
      fetchFestivals();
    }
  }, []);

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
    if (!selectedCardnewsId) {
      setSelectedSavedContentId(null);
      setSavedContentError(null);
      return;
    }
    if (authLoading || !user) return;
    void loadSavedContentToPreview(selectedCardnewsId);
  }, [authLoading, loadSavedContentToPreview, selectedCardnewsId, user]);

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

  const handleFestivalSelect = (f: UnifiedFestival) => {
    const detailsText = Array.isArray(f.details) && f.details.length > 0
      ? f.details.map((d: { label: string; value: string }) =>
          `${d.label}: ${d.value}`).join('\n')
      : null;

    const parts = [
      f.title,
      f.location ? `장소: ${f.location}` : null,
      f.startDate && f.endDate ? `기간: ${f.startDate} ~ ${f.endDate}` : null,
      f.lineup ? `라인업: ${f.lineup}` : null,
      f.price ? `티켓 가격: ${f.price}` : null,
      f.homepage ? `공식 홈페이지: ${f.homepage}` : null,
      detailsText ? `상세 정보:\n${detailsText}` : null,
      f.description ? `본문: ${f.description.slice(0, 600)}` : null,
    ].filter(Boolean);

    const nextInputText = parts.join('\n');

    setInputText(nextInputText);
    setGenre(f.genre || '');
    setSource(f.source);
    setSourceLabel(f.sourceLabel || f.source);
    setImageUrl(f.imageUrl || '');
    void requestSuggestedAngles(nextInputText);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      setShowAngleSelector(false);
      if (Array.isArray(data.slides) && data.slides.length > 0 && data.draftId) {
        setDraftCardnewsCount((prev) => (typeof prev === 'number' ? prev + 1 : 1));
      }
    } catch (error) {
      console.error(error);
      alert('기획안 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
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
      await fetchDashboardStats();
    } catch (error) {
      console.error(error);
      setPublishError('발행 처리에 실패했습니다.');
    } finally {
      setIsPublishing(false);
    }
  };

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

  return (
    <div className={cn(!embedded && "max-w-[1400px] mx-auto min-h-screen pb-20")}>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6 mb-10">
        {[
          { label: '생성된 카드뉴스', value: publishedCardnewsCount === null ? '-' : publishedCardnewsCount.toLocaleString('ko-KR'), change: '+12%', icon: FileText, color: 'text-pink-600', bg: 'bg-pink-50' },
          { label: '카드뉴스 초안', value: draftCardnewsCount === null ? '-' : draftCardnewsCount.toLocaleString('ko-KR'), change: null, icon: Save, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'AI 캡션 생성', value: '342', change: '+28%', icon: Sparkles, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: '평균 도달률', value: '4.8K', change: '+15%', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: '예약된 게시물', value: '7', change: null, icon: MousePointer2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        ].map((stat, i) => (
          <div key={i} className="glassmorphism p-6 rounded-[2rem] border-none shadow-md">
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
              </div>
            </div>
          </div>
        ))}
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
                        onClick={() => setRatio(item)}
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

                <div className="mt-4 rounded-[1.35rem] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-end justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">슬라이드 개수</label>
                    <span className="text-xl font-black leading-none text-pink-600">{slideCount}<span className="ml-1 text-xs font-bold text-slate-400">장</span></span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={slideCount}
                    onChange={(e) => setSlideCount(parseInt(e.target.value))}
                    className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[#E91E63]"
                  />
                  <div className="mt-3 flex justify-between text-[10px] font-bold uppercase tracking-tighter text-slate-400">
                    <span>초간결</span>
                    <span>표준</span>
                    <span>딥다이브</span>
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
                    : (showAngleSelector ? '기획안+캡션 생성하기' : '앵글 추천받기')
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
                  생성된 슬라이드와 캡션을 실시간으로 확인하고, 선택한 Canva 템플릿으로 바로 넘길 수 있습니다.
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
                <div className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700">
                  Canva 연동
                </div>
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
                  {canvaEditUrl && (
                    <a
                      href={canvaEditUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-black text-emerald-600 underline hover:text-emerald-700"
                    >
                      Canva 편집 링크 다시 열기
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
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
                      onTextChange={setCaptionText}
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

                  <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,250,0.9))] p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Canva Template</div>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {selectedCanvaTemplate ? '선택된 템플릿으로 바로 전송할 수 있습니다.' : 'Canva 템플릿을 선택해 주세요.'}
                        </p>
                      </div>
                      <div className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                        {canvaTemplates.length}개
                      </div>
                    </div>

                    {selectedCanvaTemplate ? (
                      <div className="mt-4 rounded-[1.5rem] border border-slate-100 bg-white/90 p-3 shadow-sm">
                        <div className="flex items-start gap-3">
                          <CanvaTemplateThumbnail
                            template={selectedCanvaTemplate}
                            className="h-[118px] w-[92px] shrink-0 rounded-[1.25rem] border border-white/80 shadow-inner"
                            imageClassName="object-cover"
                            compact
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-[15px] font-black leading-snug text-slate-900">
                                  {selectedCanvaTemplate.title}
                                </p>
                                <p className="mt-2 text-[11px] font-bold text-slate-500">
                                  {formatTemplateUpdatedAt(selectedCanvaTemplate.updatedAt)}
                                </p>
                              </div>
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                                <Check className="h-4 w-4" />
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <div className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                                Autofill Ready
                              </div>
                              <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                                캡션 포함 전달
                              </div>
                            </div>

                            <p className="mt-3 text-[11px] font-bold leading-relaxed text-slate-500">
                              슬라이드 텍스트와 수정된 캡션이 함께 Canva 데이터 필드에 채워집니다.
                            </p>

                            {selectedCanvaTemplate.viewUrl && (
                              <a
                                href={selectedCanvaTemplate.viewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-black text-slate-700 transition-colors hover:text-pink-600"
                              >
                                원본 템플릿 보기
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-[1.5rem] border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center">
                        <p className="text-sm font-black text-slate-700">선택된 템플릿이 없습니다</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">
                          모달에서 이미지와 이름을 보고 템플릿을 고를 수 있습니다.
                        </p>
                      </div>
                    )}

                    <div className="mt-4 flex flex-col gap-2 rounded-[1.4rem] border border-slate-100 bg-white/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => { void handleOpenCanvaTemplatePicker(); }}
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-[11px] font-black text-white transition-all hover:bg-slate-800"
                        >
                          <Layout className="h-3.5 w-3.5" />
                          템플릿 선택
                        </button>
                        <button
                          onClick={() => { void fetchCanvaTemplates(); }}
                          disabled={isCanvaTemplatesLoading || isCanvaReconnectLoading}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-black text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', isCanvaTemplatesLoading && 'animate-spin')} />
                          {isCanvaTemplatesLoading ? '목록 갱신 중...' : '목록 갱신'}
                        </button>
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 sm:text-right">
                        {canvaReconnectRequired
                          ? 'Canva 연결/재연결은 사이드바의 연결 계정에서 진행해 주세요.'
                          : '썸네일이 오래되면 모달을 열 때 자동으로 새로 불러옵니다.'}
                      </div>
                    </div>
                    <div className="mt-3 rounded-[1.35rem] border border-sky-100 bg-sky-50/90 px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm">
                          <Info className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-black text-slate-700">
                            Canva Authorized redirects에 아래 두 주소가 등록되어 있어야 로컬/배포 재인증이 모두 정상 동작합니다.
                          </p>
                          <div className="mt-2 space-y-2">
                            <div className="rounded-xl border border-sky-100 bg-white px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">Local</div>
                              <div className="mt-1 font-mono text-[11px] font-bold text-slate-700 break-all">
                                {CANVA_DEV_REDIRECT_URI}
                              </div>
                            </div>
                            <div className="rounded-xl border border-sky-100 bg-white px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">Production</div>
                              <div className="mt-1 font-mono text-[11px] font-bold text-slate-700 break-all">
                                {CANVA_PROD_REDIRECT_URI}
                              </div>
                            </div>
                          </div>
                          <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">
                            현재 재인증에 사용될 주소는 {canvaRedirectUri || CANVA_DEV_REDIRECT_URI} 입니다. 로컬 개발은 `127.0.0.1:3002` 기준으로 여는 편이 가장 안정적입니다.
                          </p>
                        </div>
                      </div>
                    </div>
                    {canvaTemplatesError && (
                      <div className="mt-3 text-[11px] font-bold text-rose-500">{canvaTemplatesError}</div>
                    )}
                  </div>

                  <div className="rounded-[2rem] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Delivery Actions</div>
                        <p className="mt-1 text-sm font-black text-slate-900">최종 문구를 반영해 Canva 또는 발행 단계로 이동</p>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
                        {draftId ? '초안 저장됨' : publishSuccessAt ? '발행 완료' : '초안 대기'}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        onClick={handleSendToCanva}
                        disabled={isSendingToCanva || generatedSlides.length === 0 || !selectedCanvaTemplateId || canvaReconnectRequired}
                        className="inline-flex items-center gap-2 rounded-[1.1rem] bg-emerald-600 px-5 py-3 text-sm font-black text-white transition-all hover:bg-emerald-700 disabled:bg-emerald-300"
                      >
                        {canvaReconnectRequired ? 'Canva 재연결 필요' : (isSendingToCanva ? 'Canva 전송 중...' : 'Canva에서 수정')}
                      </button>
                      <button
                        onClick={handlePublish}
                        disabled={!draftId || isPublishing}
                        className="inline-flex items-center gap-2 rounded-[1.1rem] bg-slate-900 px-5 py-3 text-sm font-black text-white transition-all hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        {isPublishing ? '발행 처리 중...' : '발행 완료 처리'}
                      </button>
                    </div>

                    {canvaError && (
                      <div className="mt-4 rounded-[1.2rem] border border-rose-100 bg-rose-50 px-4 py-3 text-[11px] font-bold text-rose-500">
                        {canvaError}
                      </div>
                    )}
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
                  왼쪽에서 브리프와 캡션 톤을 정한 뒤 생성하면, 여기에서 결과와 Canva 전달 상태를 한 번에 확인할 수 있습니다.
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
                      onClick={() => handleFestivalSelect(festival)}
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
