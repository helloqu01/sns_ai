"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PartyPopper, Calendar, MapPin, RefreshCw, Info, ExternalLink, Sparkles, Plus, ArrowUp, Check } from 'lucide-react';
import { UnifiedFestival } from '@/types/festival';
import { fetchFestivalsFromApi } from '@/lib/festival-client-cache';

const filterOptions: { id: 'all' | 'today' | 'this-week' | '60-days'; label: string }[] = [
    { id: 'all', label: '전체' },
    { id: 'today', label: '오늘' },
    { id: 'this-week', label: '이번주' },
    { id: '60-days', label: '60일 이내' },
];
const sortOptions: { id: 'saved-desc' | 'date-asc' | 'date-desc'; label: string }[] = [
    { id: 'saved-desc', label: '최근 저장순' },
    { id: 'date-asc', label: '빠른순' },
    { id: 'date-desc', label: '늦은순' },
];
const sourceTabs: { id: 'all' | 'concert' | 'festival' | 'concert_k' | 'festival_o'; label: string }[] = [
    { id: 'all', label: '전체' },
    { id: 'concert', label: '국내공연' },
    { id: 'festival', label: '국내 페스티벌' },
    { id: 'concert_k', label: '내한공연' },
    { id: 'festival_o', label: '해외 페스티벌' },
];
const FESTIVALS_PER_PAGE = 30;
type FestivalSourceTab = (typeof sourceTabs)[number]["id"];
type NaverUpdateResultItem = {
    festivalId: string;
    title?: string;
    status: 'updated' | 'unchanged' | 'not-found' | 'no-match' | 'error';
    updatedFields?: string[];
    message?: string;
};
type NaverUpdateSummary = {
    updatedCount: number;
    unchangedCount: number;
    noMatchCount: number;
    notFoundCount: number;
    errorCount: number;
    results: NaverUpdateResultItem[];
};

const extractFestivalLifeDetailId = (sourceUrl: string) => {
    try {
        const parsed = new URL(sourceUrl.trim());
        if (!parsed.hostname.toLowerCase().includes("festivallife.kr")) return null;
        const idx = parsed.searchParams.get("idx")?.trim() || "";
        return idx.length > 0 ? idx : null;
    } catch {
        return null;
    }
};

const getFestivalIdentityKey = (festival: UnifiedFestival) => {
    if (festival.source === "FESTIVAL_LIFE" && festival.sourceUrl && festival.sourceUrl.trim().length > 0) {
        const detailId = extractFestivalLifeDetailId(festival.sourceUrl);
        if (detailId) {
            return `fl-detail:${detailId}`;
        }
    }

    if (festival.sourceUrl && festival.sourceUrl.trim().length > 0) {
        return `url:${festival.sourceUrl.trim()}`;
    }
    return `id:${festival.id}`;
};

const resolveFestivalSourceTab = (festival: UnifiedFestival): Exclude<FestivalSourceTab, 'all'> | null => {
    if (!festival.sourceUrl) return null;
    try {
        const parsed = new URL(festival.sourceUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        if (normalizedPath === '/concert') return 'concert';
        if (normalizedPath === '/festival') return 'festival';
        if (normalizedPath === '/concert_k') return 'concert_k';
        if (normalizedPath === '/festival_o') return 'festival_o';
        return null;
    } catch {
        return null;
    }
};

const matchesSourceTab = (festival: UnifiedFestival, activeTab: FestivalSourceTab) => {
    if (activeTab === 'all') return true;
    return resolveFestivalSourceTab(festival) === activeTab;
};

export default function FestivalsPage() {
    const [festivals, setFestivals] = useState<UnifiedFestival[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeSourceTab, setActiveSourceTab] = useState<FestivalSourceTab>('all');
    const [filter, setFilter] = useState<'all' | 'today' | 'this-week' | '60-days'>('all');
    const [genreFilter, setGenreFilter] = useState<string>('전체');
    const [sortBy, setSortBy] = useState<'saved-desc' | 'date-asc' | 'date-desc'>('saved-desc');
    const [selectedFestival, setSelectedFestival] = useState<UnifiedFestival | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const festivalListRef = useRef<HTMLDivElement | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [showScrollTopButton, setShowScrollTopButton] = useState(false);
    const [newFestivals, setNewFestivals] = useState<UnifiedFestival[]>([]);
    const [showNewFestivalsModal, setShowNewFestivalsModal] = useState(false);
    const [selectedFestivalIds, setSelectedFestivalIds] = useState<string[]>([]);
    const [isCurationMode, setIsCurationMode] = useState(false);
    const [curationTheme, setCurationTheme] = useState('이번 주 공연 소식');
    const [isNaverUpdating, setIsNaverUpdating] = useState(false);
    const [naverUpdateMessage, setNaverUpdateMessage] = useState<string | null>(null);
    const [showNaverUpdateModal, setShowNaverUpdateModal] = useState(false);
    const [naverUpdateSummary, setNaverUpdateSummary] = useState<NaverUpdateSummary | null>(null);

    const fetchFestivals = async (refresh = false) => {
        setIsLoading(true);
        try {
            const payload = await fetchFestivalsFromApi({
                refresh,
                refreshMode: refresh ? 'append' : 'replace',
            });
            setFestivals(payload.festivals);
            if (payload.lastUpdated) {
                setLastUpdated(payload.lastUpdated);
            }
            return payload;
        } catch (error) {
            console.error(error);
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    const getNewlyAddedFestivals = (previous: UnifiedFestival[], next: UnifiedFestival[]) => {
        const previousKeys = new Set(previous.map(getFestivalIdentityKey));
        return next.filter((festival) => !previousKeys.has(getFestivalIdentityKey(festival)));
    };

    const handleRefresh = async () => {
        const previousFestivals = festivals;
        const payload = await fetchFestivals(true);
        if (!payload) return;
        const addedFestivals = getNewlyAddedFestivals(previousFestivals, payload.festivals)
            .filter((festival) => matchesSourceTab(festival, activeSourceTab));
        const addedKeys = new Set(addedFestivals.map(getFestivalIdentityKey));
        const refreshedAt = new Date().toISOString();
        const nextFestivals = payload.festivals.map((festival) => (
            addedKeys.has(getFestivalIdentityKey(festival))
                ? { ...festival, updatedAt: refreshedAt }
                : festival
        ));
        setFestivals(nextFestivals);
        setNewFestivals(addedFestivals);
        setShowNewFestivalsModal(true);
    };

    const toggleFestivalSelection = (festivalId: string) => {
        setSelectedFestivalIds((prev) => (
            prev.includes(festivalId)
                ? prev.filter((id) => id !== festivalId)
                : [...prev, festivalId]
        ));
    };

    const clearFestivalSelection = () => {
        setSelectedFestivalIds([]);
    };

    const handleCurationPlanCreate = () => {
        if (selectedFestivalIds.length < 2) {
            alert('큐레이션 모드에서는 행사 2개 이상 선택해 주세요.');
            return;
        }

        const params = new URLSearchParams({
            autoplan: '1',
            curation: '1',
            curationTheme: curationTheme.trim() || '이번 주 공연 소식',
            curationIds: selectedFestivalIds.slice(0, 8).join(','),
        });
        window.location.href = `/instagram-ai?${params.toString()}`;
    };

    const handleSelectedNaverUpdate = async () => {
        if (selectedFestivalIds.length === 0 || isNaverUpdating) return;

        setIsNaverUpdating(true);
        setNaverUpdateMessage(null);
        setNaverUpdateSummary(null);

        try {
            const res = await fetch('/api/festivals/research', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    festivalIds: selectedFestivalIds,
                }),
            });

            const payload = await res.json().catch(() => null) as {
                error?: string;
                updatedCount?: number;
                unchangedCount?: number;
                noMatchCount?: number;
                notFoundCount?: number;
                errorCount?: number;
                results?: NaverUpdateResultItem[];
            } | null;

            if (!res.ok) {
                throw new Error(payload?.error || 'AI 조사 기반 업데이트 요청에 실패했습니다.');
            }

            const updated = payload?.updatedCount || 0;
            const unchanged = payload?.unchangedCount || 0;
            const noMatch = payload?.noMatchCount || 0;
            const notFound = payload?.notFoundCount || 0;
            const failed = payload?.errorCount || 0;
            const results = Array.isArray(payload?.results) ? payload.results : [];

            setNaverUpdateSummary({
                updatedCount: updated,
                unchangedCount: unchanged,
                noMatchCount: noMatch,
                notFoundCount: notFound,
                errorCount: failed,
                results,
            });
            setShowNaverUpdateModal(true);
            setNaverUpdateMessage(
                `완료: 갱신 ${updated}건 · 변경 없음 ${unchanged}건 · 검색 실패 ${noMatch}건 · 미존재 ${notFound}건 · 오류 ${failed}건`,
            );
            setSelectedFestivalIds([]);
            await fetchFestivals(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'AI 조사 업데이트 중 오류가 발생했습니다.';
            setNaverUpdateMessage(`실패: ${message}`);
        } finally {
            setIsNaverUpdating(false);
        }
    };

    useEffect(() => {
        fetchFestivals();
    }, []);

    useEffect(() => {
        setSelectedFestivalIds((prev) => {
            if (prev.length === 0) return prev;
            const existingIds = new Set(festivals.map((festival) => festival.id));
            const next = prev.filter((id) => existingIds.has(id));
            return next.length === prev.length ? prev : next;
        });
    }, [festivals]);

    useEffect(() => {
        if (!selectedFestival) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSelectedFestival(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedFestival]);

    // Get unique genres for the active source
    const availableGenres = useMemo(() => {
        const sourceFestivals = festivals.filter((festival) => matchesSourceTab(festival, activeSourceTab));
        const genres = new Set<string>();
        sourceFestivals.forEach(f => {
            if (f.genre) {
                // Genres can be comma separated native tags
                f.genre.split(',').forEach(t => {
                    const trimmed = t.trim();
                    if (trimmed) genres.add(trimmed);
                });
            }
        });
        return ['전체', ...Array.from(genres)].slice(0, 15); // Limit to 15 for UI clarity
    }, [activeSourceTab, festivals]);

    // Reset genre filter when source tab changes
    useEffect(() => {
        setGenreFilter('전체');
    }, [activeSourceTab]);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeSourceTab, filter, genreFilter, sortBy]);

    const filteredFestivals = festivals.filter(f => {
        // Source tab filtering
        if (!matchesSourceTab(f, activeSourceTab)) return false;

        // Date Filtering
        const today = new Date().toISOString().split('T')[0];
        let dateMatch = true;
        if (filter === 'today') dateMatch = f.startDate <= today && f.endDate >= today;
        else if (filter === 'this-week') {
            const d = new Date();
            const day = d.getDay(); // 0 (Sun) to 6 (Sat)
            const diffToSun = (7 - day) % 7;
            const sun = new Date(d);
            sun.setDate(d.getDate() + diffToSun);

            const sunStr = sun.toISOString().split('T')[0];
            // Event matches if it is occurring between now and Sunday
            dateMatch = (f.startDate <= sunStr && f.endDate >= today);
        } else if (filter === '60-days') {
            const d = new Date();
            const future = new Date(d);
            future.setDate(d.getDate() + 60);
            const futureStr = future.toISOString().split('T')[0];
            // Event matches if it starts within next 60 days
            dateMatch = (f.startDate >= today && f.startDate <= futureStr);
        }

        // Genre Filtering (Matching any of the tags if multiple)
        let genreMatch = true;
        if (genreFilter !== '전체') {
            genreMatch = f.genre.includes(genreFilter);
        }

        return dateMatch && genreMatch;
    }).sort((a, b) => {
        if (sortBy === 'saved-desc') {
            const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            if (updatedB !== updatedA) {
                return updatedB - updatedA;
            }

            const publishedA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const publishedB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            if (publishedB !== publishedA) {
                return publishedB - publishedA;
            }
        }

        const dateA = new Date(a.startDate).getTime();
        const dateB = new Date(b.startDate).getTime();
        return sortBy === 'date-asc' ? dateA - dateB : dateB - dateA;
    });

    const totalPages = Math.max(1, Math.ceil(filteredFestivals.length / FESTIVALS_PER_PAGE));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const pageStartIndex = (safeCurrentPage - 1) * FESTIVALS_PER_PAGE;
    const paginatedFestivals = filteredFestivals.slice(pageStartIndex, pageStartIndex + FESTIVALS_PER_PAGE);
    const paginationTokens = (() => {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }
        const tokens: Array<number | 'ellipsis'> = [1];
        const start = Math.max(2, safeCurrentPage - 1);
        const end = Math.min(totalPages - 1, safeCurrentPage + 1);
        if (start > 2) tokens.push('ellipsis');
        for (let page = start; page <= end; page += 1) {
            tokens.push(page);
        }
        if (end < totalPages - 1) tokens.push('ellipsis');
        tokens.push(totalPages);
        return tokens;
    })();

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleCreatePlan = (f: UnifiedFestival) => {
        const params = new URLSearchParams({
            autoplan: "1",
            festivalId: f.id,
            title: f.title,
            location: f.location,
            start: f.startDate,
            end: f.endDate,
            genre: f.genre || '',
            source: f.source,
            sourceLabel: f.sourceLabel || f.source,
            imageUrl: f.imageUrl || ''
        });
        window.location.href = `/instagram-ai?${params.toString()}`;
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

    const formatFestivalDateRange = (festival: UnifiedFestival) => {
        if (festival.startDate === festival.endDate) {
            return festival.startDate;
        }
        return `${festival.startDate} ~ ${festival.endDate}`;
    };

    const formatPublishedDate = (festival: UnifiedFestival) => {
        if (festival.publishedAt) {
            const parsed = new Date(festival.publishedAt);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toLocaleString("ko-KR", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                });
            }
        }

        return festival.publishedDate || "등록일 정보 없음";
    };

    const getExtraDetails = (festival: UnifiedFestival) => {
        const hiddenLabels = new Set(["일정", "장소", "라인업", "티켓 가격", "문의", "홈페이지"]);
        return (festival.details || []).filter((detail) => !hiddenLabels.has(detail.label));
    };

    const getNaverUpdateStatusLabel = (status: NaverUpdateResultItem['status']) => {
        switch (status) {
            case 'updated':
                return '갱신 완료';
            case 'unchanged':
                return '변경 없음';
            case 'no-match':
                return '검색 실패';
            case 'not-found':
                return '대상 없음';
            case 'error':
                return '오류';
            default:
                return status;
        }
    };

    const getNaverUpdateStatusClass = (status: NaverUpdateResultItem['status']) => {
        switch (status) {
            case 'updated':
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'unchanged':
                return 'bg-slate-100 text-slate-600 border-slate-200';
            case 'no-match':
                return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'not-found':
                return 'bg-violet-50 text-violet-700 border-violet-200';
            case 'error':
                return 'bg-rose-50 text-rose-700 border-rose-200';
            default:
                return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const formatUpdatedFields = (fields?: string[]) => {
        if (!Array.isArray(fields) || fields.length === 0) return '';
        const labels: Record<string, string> = {
            location: '장소',
            startDate: '시작일',
            endDate: '종료일',
            description: '본문',
            lineup: '라인업',
            price: '티켓 가격',
            homepage: '홈페이지',
            details: '상세 정보',
            sourceUrl: '원문 링크',
            publishedDate: '게시일',
            publishedAt: '게시 시각',
            imageUrl: '이미지',
            genre: '장르',
        };
        return fields.map((field) => labels[field] || field).join(', ');
    };

    const updateScrollTopButtonVisibility = useCallback(() => {
        const doc = document.documentElement;
        const hasScrollableHeight = doc.scrollHeight - doc.clientHeight > 24;
        setShowScrollTopButton(hasScrollableHeight && window.scrollY > 220);
    }, []);

    useEffect(() => {
        updateScrollTopButtonVisibility();
        window.addEventListener('scroll', updateScrollTopButtonVisibility, { passive: true });
        window.addEventListener('resize', updateScrollTopButtonVisibility);
        return () => {
            window.removeEventListener('scroll', updateScrollTopButtonVisibility);
            window.removeEventListener('resize', updateScrollTopButtonVisibility);
        };
    }, [updateScrollTopButtonVisibility]);

    useEffect(() => {
        updateScrollTopButtonVisibility();
    }, [updateScrollTopButtonVisibility, paginatedFestivals.length, filteredFestivals.length, isLoading]);

    return (
        <div className="min-h-screen bg-transparent pb-20">
            <main className="mx-auto max-w-[1680px] px-3 py-8 lg:px-5">
                <header className="mb-8">
                    <div className="inline-flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-pink-600">
                        <PartyPopper className="h-4 w-4" />
                        Festival Info
                    </div>
                    <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">페스티벌 정보</h1>
                    <p className="mt-2 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
                        전국 페스티벌/공연 정보를 한 곳에서 모아보고 카드뉴스 제작으로 바로 연결할 수 있습니다.
                    </p>
                </header>
                <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
                    {/* Sub Filters (Sticky) */}
                    <div className="sticky top-0 z-20 border-b border-slate-100 bg-white p-4 shadow-sm lg:p-5">
                        <div className="flex flex-wrap items-center gap-8">
                            <div className="space-y-3 min-w-[320px]">
                                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">리스트 구분</label>
                                <div className="flex flex-wrap gap-2">
                                    {sourceTabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveSourceTab(tab.id)}
                                            className={`px-4 py-2 rounded-xl text-xs font-black border transition-all ${
                                                activeSourceTab === tab.id
                                                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date Filter */}
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-3 pl-1">
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">일정 필터</label>
                                    <button
                                        onClick={handleRefresh}
                                        disabled={isLoading}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:border-pink-200 hover:text-pink-600 hover:bg-pink-50 transition-all disabled:opacity-50"
                                        title="데이터 새로고침"
                                    >
                                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                        새로고침
                                    </button>
                                    <div className="text-[10px] font-bold text-slate-400">
                                        마지막 업데이트: {lastUpdated ? formatDateTime(lastUpdated) : "알 수 없음"}
                                    </div>
                                </div>
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

                            {/* Sorting Filter */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">공연일 정렬</label>
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

                            {/* Dynamic Genre Filter */}
                            <div className="space-y-3 flex-1 min-w-[300px]">
                                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">상세 카테고리</label>
                                <div className="flex flex-wrap gap-2">
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
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-500">
                                선택 {selectedFestivalIds.length}건
                            </span>
                            <button
                                onClick={() => setSelectedFestivalIds(filteredFestivals.map((festival) => festival.id))}
                                disabled={filteredFestivals.length === 0 || isNaverUpdating}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-500 transition-all hover:border-pink-300 hover:text-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                전체 선택
                            </button>
                            <button
                                onClick={clearFestivalSelection}
                                disabled={selectedFestivalIds.length === 0 || isNaverUpdating}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-500 transition-all hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                선택 해제
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCurationMode((prev) => !prev);
                                    setSelectedFestivalIds([]);
                                }}
                                className={`rounded-full border px-3 py-1 text-[11px] font-black transition-all ${
                                    isCurationMode
                                        ? 'border-pink-500 bg-pink-500 text-white'
                                        : 'border-slate-200 bg-white text-slate-500 hover:border-pink-300'
                                }`}
                            >
                                {isCurationMode ? '✦ 큐레이션 모드' : '큐레이션 모드'}
                            </button>
                            {isCurationMode && (
                                <button
                                    onClick={handleCurationPlanCreate}
                                    disabled={selectedFestivalIds.length < 2}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-2 text-[11px] font-black text-white shadow-sm transition-all hover:bg-pink-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-100"
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    선택 항목 큐레이션 기획하기
                                </button>
                            )}
                            <button
                                onClick={handleSelectedNaverUpdate}
                                disabled={selectedFestivalIds.length === 0 || isNaverUpdating}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-2 text-[11px] font-black text-white transition-all hover:bg-pink-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${isNaverUpdating ? 'animate-spin' : ''}`} />
                                선택 항목 AI 조사 업데이트
                            </button>
                        </div>
                        {isCurationMode && (
                            <div className="mt-3 rounded-2xl border border-pink-100 bg-pink-50 px-3 py-3">
                                <p className="text-[10px] font-black text-pink-700">큐레이션 모드</p>
                                <p className="mt-1 text-[11px] font-bold text-pink-500">
                                    카드 우측 상단 체크 버튼으로 행사를 2개 이상 선택한 뒤 큐레이션 기획하기를 눌러주세요.
                                </p>
                                <input
                                    type="text"
                                    value={curationTheme}
                                    onChange={(event) => setCurationTheme(event.target.value)}
                                    placeholder="테마 입력 (예: 이번 주 공연 소식)"
                                    className="mt-2 w-full rounded-xl border border-pink-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-pink-400"
                                />
                            </div>
                        )}
                        {naverUpdateMessage && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <p className="text-[11px] font-bold text-slate-500">{naverUpdateMessage}</p>
                                {naverUpdateSummary && (
                                    <button
                                        onClick={() => setShowNaverUpdateModal(true)}
                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 transition-all hover:border-slate-300 hover:text-slate-700"
                                    >
                                        결과 상세 보기
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Grid (Scrollable) */}
                    <div ref={festivalListRef} className="p-4 lg:p-5">
                        {isLoading && festivals.length === 0 ? (
                            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                                {[...Array(8)].map((_, i) => (
                                    <div key={i} className="aspect-[3/4] bg-white border border-slate-200 rounded-3xl p-4 animate-pulse">
                                        <div className="w-full h-full bg-slate-100 rounded-2xl" />
                                    </div>
                                ))}
                            </div>
                        ) : filteredFestivals.length === 0 ? (
                            <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[40px] border border-slate-200 border-dashed">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                                    <Info className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-black text-slate-900 mb-2">데이터가 없습니다</h3>
                                <p className="text-slate-500 font-medium">선택한 조건에 맞는 정보가 아직 수집되지 않았습니다.</p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                                    {paginatedFestivals.map((festival) => {
                                        const isSelected = selectedFestivalIds.includes(festival.id);
                                        return (
                                            <div
                                                key={festival.id}
                                                onClick={() => {
                                                    if (isCurationMode) {
                                                        toggleFestivalSelection(festival.id);
                                                        return;
                                                    }
                                                    setSelectedFestival(festival);
                                                }}
                                                className="group cursor-pointer"
                                            >
                                                <div className={`relative aspect-[3/4] rounded-[32px] overflow-hidden bg-slate-200 shadow-lg border-4 group-hover:shadow-2xl group-hover:-translate-y-2 transition-all duration-500 ${isSelected ? 'border-pink-500 shadow-pink-200' : 'border-white'}`}>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleFestivalSelection(festival.id);
                                                        }}
                                                        className={`absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border text-white backdrop-blur-md transition-all ${isSelected ? 'border-pink-400 bg-pink-500' : 'border-white/60 bg-black/35 hover:bg-black/50'}`}
                                                        aria-label={isSelected ? '선택 해제' : '선택'}
                                                        title={isSelected ? '선택 해제' : '선택'}
                                                    >
                                                        {isSelected && <Check className="h-4 w-4" />}
                                                    </button>
                                                    <img
                                                        src={festival.imageUrl || "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80"}
                                                        alt={festival.title}
                                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

                                                    {/* Attribution Badges */}
                                                    <div className="absolute top-4 left-4 flex flex-col gap-2">
                                                        <div className="bg-black/40 backdrop-blur-xl border border-white/20 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse"></div>
                                                            <span className="text-[10px] font-black text-white/90 uppercase tracking-wider">
                                                                @{festival.sourceLabel}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="absolute bottom-5 left-5 right-5 text-white">
                                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                                            {festival.genre.split(',').slice(0, 2).map((tag, idx) => (
                                                                <span key={idx} className="px-2.5 py-1 bg-white/20 backdrop-blur-md rounded-lg text-[10px] font-black uppercase tracking-tight border border-white/10">
                                                                    {tag.trim()}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <h3 className="text-lg font-black leading-tight line-clamp-2 drop-shadow-md">
                                                            {festival.title}
                                                        </h3>
                                                    </div>
                                                </div>

                                                <div className="mt-4 px-2 space-y-1">
                                                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                                                        <MapPin className="w-3 h-3 text-pink-400" />
                                                        <span className="truncate">{festival.location}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                                                        <Calendar className="w-3 h-3 text-slate-300" />
                                                        <span>{formatFestivalDateRange(festival)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {totalPages > 1 && (
                                    <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                                            disabled={safeCurrentPage === 1}
                                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-500 transition-all hover:border-pink-300 hover:text-pink-600 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            이전
                                        </button>
                                        {paginationTokens.map((token, index) => (
                                            token === 'ellipsis' ? (
                                                <span
                                                    key={`ellipsis-${index}`}
                                                    className="px-2 text-[11px] font-black text-slate-400"
                                                >
                                                    ...
                                                </span>
                                            ) : (
                                                <button
                                                    key={`page-${token}`}
                                                    type="button"
                                                    onClick={() => setCurrentPage(token)}
                                                    className={`h-8 min-w-8 rounded-lg px-2 text-[11px] font-black transition-all ${
                                                        safeCurrentPage === token
                                                            ? 'bg-pink-600 text-white'
                                                            : 'border border-slate-200 bg-white text-slate-500 hover:border-pink-300 hover:text-pink-600'
                                                    }`}
                                                >
                                                    {token}
                                                </button>
                                            )
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                                            disabled={safeCurrentPage === totalPages}
                                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-500 transition-all hover:border-pink-300 hover:text-pink-600 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            다음
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </main>

            {showScrollTopButton && (
                <button
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="fixed bottom-8 right-8 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-600 text-white shadow-xl shadow-pink-600/35 transition-all hover:bg-pink-500 hover:scale-105 active:scale-95"
                    aria-label="스크롤 맨 위로"
                    title="맨 위로 이동"
                >
                    <ArrowUp className="w-5 h-5" />
                </button>
            )}

            {showNewFestivalsModal && (
                <div
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-6 backdrop-blur-sm"
                    onClick={() => setShowNewFestivalsModal(false)}
                >
                    <div
                        className="relative w-full max-w-3xl rounded-[32px] bg-white p-8 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowNewFestivalsModal(false)}
                            className="absolute right-6 top-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-slate-700 transition-all hover:bg-black/20"
                            aria-label="새로 추가된 내용 닫기"
                        >
                            <Plus className="h-5 w-5 rotate-45" />
                        </button>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">새로고침 결과</p>
                            <h3 className="mt-2 text-2xl font-black text-slate-900">
                                새로 추가된 페스티벌 {newFestivals.length}건
                            </h3>
                            <p className="mt-1 text-sm font-bold text-slate-500">
                                새로 수집된 페스티벌 정보를 바로 확인하세요.
                            </p>
                        </div>

                        <div className="mt-6 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                            {newFestivals.length > 0 ? (
                                newFestivals.map((festival) => (
                                    <div
                                        key={festival.id}
                                        className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center"
                                    >
                                        <div className="h-20 w-full overflow-hidden rounded-2xl bg-slate-100 sm:w-28">
                                            <img
                                                src={festival.imageUrl || "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80"}
                                                alt={festival.title}
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-black text-slate-900">{festival.title}</p>
                                            <p className="mt-1 truncate text-xs font-bold text-slate-500">
                                                {festival.location || "장소 정보 없음"}
                                            </p>
                                            <p className="mt-1 text-xs font-bold text-slate-400">
                                                {formatFestivalDateRange(festival)}
                                            </p>
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-400">
                                            {formatPublishedDate(festival)}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                                    새로 추가된 내용이 없습니다.
                                </div>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setShowNewFestivalsModal(false)}
                                className="rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showNaverUpdateModal && naverUpdateSummary && (
                <div
                    className="fixed inset-0 z-[112] flex items-center justify-center bg-slate-900/55 p-6 backdrop-blur-sm"
                    onClick={() => setShowNaverUpdateModal(false)}
                >
                    <div
                        className="relative w-full max-w-4xl rounded-[32px] bg-white p-8 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowNaverUpdateModal(false)}
                            className="absolute right-6 top-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-slate-700 transition-all hover:bg-black/20"
                            aria-label="AI 조사 업데이트 결과 닫기"
                        >
                            <Plus className="h-5 w-5 rotate-45" />
                        </button>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">요청 결과</p>
                            <h3 className="mt-2 text-2xl font-black text-slate-900">AI 조사 업데이트 결과</h3>
                            <p className="mt-1 text-sm font-bold text-slate-500">
                                선택한 페스티벌 항목별 처리 결과입니다.
                            </p>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">갱신</p>
                                <p className="mt-1 text-xl font-black text-emerald-700">{naverUpdateSummary.updatedCount}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">변경 없음</p>
                                <p className="mt-1 text-xl font-black text-slate-700">{naverUpdateSummary.unchangedCount}</p>
                            </div>
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">검색 실패</p>
                                <p className="mt-1 text-xl font-black text-amber-700">{naverUpdateSummary.noMatchCount}</p>
                            </div>
                            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">대상 없음</p>
                                <p className="mt-1 text-xl font-black text-violet-700">{naverUpdateSummary.notFoundCount}</p>
                            </div>
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">오류</p>
                                <p className="mt-1 text-xl font-black text-rose-700">{naverUpdateSummary.errorCount}</p>
                            </div>
                        </div>

                        <div className="mt-6 max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                            {naverUpdateSummary.results.length > 0 ? (
                                naverUpdateSummary.results.map((result, index) => (
                                    <div
                                        key={`${result.festivalId}-${index}`}
                                        className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-black text-slate-900">
                                                    {result.title || "제목 정보 없음"}
                                                </p>
                                                <p className="mt-1 text-[11px] font-bold text-slate-400">
                                                    ID: {result.festivalId}
                                                </p>
                                                {result.status === 'updated' && formatUpdatedFields(result.updatedFields) && (
                                                    <p className="mt-2 text-xs font-bold text-emerald-700">
                                                        갱신 필드: {formatUpdatedFields(result.updatedFields)}
                                                    </p>
                                                )}
                                                {result.message && (
                                                    <p className="mt-2 text-xs font-bold text-slate-500">
                                                        {result.message}
                                                    </p>
                                                )}
                                            </div>
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${getNaverUpdateStatusClass(result.status)}`}>
                                                {getNaverUpdateStatusLabel(result.status)}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                                    표시할 상세 결과가 없습니다.
                                </div>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setShowNaverUpdateModal(false)}
                                className="rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal - Modernized for Source Attribution */}
            {selectedFestival && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-[48px] overflow-hidden shadow-2xl flex flex-col md:flex-row relative animate-in zoom-in-95 duration-300">
                        <button
                            onClick={() => setSelectedFestival(null)}
                            className="absolute top-6 right-6 z-10 w-10 h-10 bg-black/10 hover:bg-black/20 rounded-full flex items-center justify-center transition-all"
                        >
                            <Plus className="w-6 h-6 rotate-45" />
                        </button>

                        <div className="flex items-center justify-center bg-slate-100/70 p-6 md:w-1/2 md:p-10">
                            <img
                                src={selectedFestival.imageUrl || "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&q=80"}
                                alt={selectedFestival.title}
                                className="h-auto w-auto max-h-[55vh] max-w-full object-contain md:max-h-[80vh]"
                            />
                        </div>

                        <div className="md:w-1/2 p-12 flex flex-col justify-between bg-white overflow-y-auto">
                            <div className="space-y-8">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-wrap gap-2">
                                        <span className="px-4 py-1.5 bg-black text-white rounded-full text-[10px] font-black uppercase tracking-widest">
                                            @{selectedFestival.sourceLabel}
                                        </span>
                                        {selectedFestival.genre.split(',').map((tag, idx) => (
                                            <span key={idx} className="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-tight">
                                                {tag.trim()}
                                            </span>
                                        ))}
                                    </div>
                                    {selectedFestival.sourceUrl && (
                                        <a
                                            href={selectedFestival.sourceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-slate-400 hover:text-pink-600 transition-colors"
                                            title="원본 게시글 보기"
                                        >
                                            <ExternalLink className="w-6 h-6" />
                                        </a>
                                    )}
                                </div>

                                <h2 className="text-4xl font-black text-slate-900 leading-[1.1] tracking-tight">
                                    {selectedFestival.title}
                                </h2>

                                <div className="space-y-6">
                                    <div className="flex items-center gap-5">
                                        <div className="w-12 h-12 bg-pink-50 rounded-2xl flex items-center justify-center text-pink-500">
                                            <MapPin className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">장소</p>
                                            <p className="text-lg font-bold text-slate-800">{selectedFestival.location || "장소 정보 없음"}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-5">
                                        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500">
                                            <Calendar className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">실제 행사일</p>
                                            <p className="text-lg font-bold text-slate-800">{formatFestivalDateRange(selectedFestival)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-5">
                                        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500">
                                            <Info className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">게시글 등록일</p>
                                            <p className="text-lg font-bold text-slate-800">{formatPublishedDate(selectedFestival)}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 rounded-[32px] border border-slate-200 bg-slate-50/70 p-5">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">라인업</p>
                                        <p className="text-sm font-bold leading-relaxed text-slate-700 whitespace-pre-wrap">{selectedFestival.lineup || "라인업 정보 없음"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">티켓 가격</p>
                                        <p className="text-sm font-bold leading-relaxed text-slate-700">{selectedFestival.price || "가격 정보 없음"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">연락처</p>
                                        <p className="text-sm font-bold leading-relaxed text-slate-700">{selectedFestival.contact || "연락처 정보 없음"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">홈페이지</p>
                                        {selectedFestival.homepage ? (
                                            <a
                                                href={selectedFestival.homepage}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-sm font-bold text-pink-600 underline decoration-pink-200 underline-offset-4 break-all"
                                            >
                                                {selectedFestival.homepage}
                                            </a>
                                        ) : (
                                            <p className="text-sm font-bold leading-relaxed text-slate-700">홈페이지 정보 없음</p>
                                        )}
                                    </div>
                                </div>

                                {getExtraDetails(selectedFestival).length > 0 && (
                                    <div className="rounded-[32px] border border-slate-200 bg-slate-50/50 p-6">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-4">추가 정보</p>
                                        <div className="space-y-3">
                                            {getExtraDetails(selectedFestival).map((detail) => (
                                                <div key={`${detail.label}-${detail.value}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{detail.label}</p>
                                                    <p className="mt-1 text-sm font-bold leading-relaxed text-slate-700 whitespace-pre-wrap">{detail.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-[32px] border border-slate-200 bg-white p-6">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-3">본문</p>
                                    <div className="max-h-64 overflow-y-auto pr-2 text-sm font-medium leading-7 text-slate-600 whitespace-pre-wrap">
                                        {selectedFestival.description || "본문 정보 없음"}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => handleCreatePlan(selectedFestival)}
                                className="w-full bg-pink-600 text-white py-5 rounded-[24px] text-lg font-black shadow-xl shadow-pink-100 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 mt-12"
                            >
                                <Sparkles className="w-6 h-6" />
                                AI 기획안 생성하기
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
