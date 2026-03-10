import type { UnifiedFestival } from "@/types/festival";

type FestivalsClientPayload = {
  festivals: UnifiedFestival[];
  lastUpdated: string | null;
  appendedCount?: number;
};

type FestivalsClientCache = {
  data: FestivalsClientPayload | null;
  promise: Promise<FestivalsClientPayload> | null;
  lastDeltaCursorAt: string | null;
};

type FestivalsClientCacheGlobal = typeof globalThis & {
  __festivalsClientCache?: FestivalsClientCache;
};

const globalForFestivalCache = globalThis as FestivalsClientCacheGlobal;
const FESTIVAL_DELTA_CURSOR_STORAGE_KEY = "festival_delta_refresh_cursor_at";

const readDeltaCursorFromStorage = () => {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(FESTIVAL_DELTA_CURSOR_STORAGE_KEY);
  return value && value.trim().length > 0 ? value : null;
};

const writeDeltaCursorToStorage = (value: string | null) => {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(FESTIVAL_DELTA_CURSOR_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(FESTIVAL_DELTA_CURSOR_STORAGE_KEY, value);
};

const getFestivalCache = () => {
  if (!globalForFestivalCache.__festivalsClientCache) {
    globalForFestivalCache.__festivalsClientCache = {
      data: null,
      promise: null,
      lastDeltaCursorAt: readDeltaCursorFromStorage(),
    };
  }
  return globalForFestivalCache.__festivalsClientCache;
};

const getFestivalIdentityKey = (festival: UnifiedFestival) =>
  typeof festival.sourceUrl === "string" && festival.sourceUrl.trim().length > 0
    ? `url:${festival.sourceUrl.trim()}`
    : `id:${festival.id}`;

const mergeFestivalLists = (current: UnifiedFestival[], incoming: UnifiedFestival[]) => {
  const merged: UnifiedFestival[] = [];
  const seen = new Set<string>();

  for (const festival of [...incoming, ...current]) {
    const key = getFestivalIdentityKey(festival);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(festival);
  }

  return merged;
};

const requestFestivals = async (
  refresh: boolean,
  delta: boolean,
  since?: string,
): Promise<FestivalsClientPayload> => {
  const searchParams = new URLSearchParams();
  if (refresh) {
    searchParams.set("refresh", "true");
  }
  if (delta) {
    searchParams.set("delta", "true");
  }
  if (since) {
    searchParams.set("since", since);
  }

  const query = searchParams.toString();
  const res = await fetch(`/api/festivals${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    const errorMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "행사 정보를 불러오지 못했습니다.";
    throw new Error(errorMessage);
  }
  return {
    festivals: Array.isArray(data) ? (data as UnifiedFestival[]) : [],
    lastUpdated: res.headers.get("x-festivals-last-updated"),
  };
};

export const fetchFestivalsFromApi = async (options?: { refresh?: boolean; refreshMode?: "replace" | "append" }) => {
  const refresh = Boolean(options?.refresh);
  const refreshMode = options?.refreshMode ?? "replace";
  const delta = refresh && refreshMode === "append";
  const cache = getFestivalCache();
  const requestStartedAt = new Date().toISOString();

  if (!refresh) {
    if (cache.data) {
      return cache.data;
    }
    if (cache.promise) {
      return cache.promise;
    }
  }

  const request = requestFestivals(refresh, delta, delta ? cache.lastDeltaCursorAt ?? undefined : undefined)
    .then((payload) => {
      if (delta) {
        const mergedFestivals = mergeFestivalLists(cache.data?.festivals ?? [], payload.festivals);
        const mergedPayload = {
          festivals: mergedFestivals,
          lastUpdated: payload.lastUpdated ?? cache.data?.lastUpdated ?? null,
          appendedCount: mergedFestivals.length - (cache.data?.festivals.length ?? 0),
        };
        cache.data = mergedPayload;
        cache.lastDeltaCursorAt = requestStartedAt;
        writeDeltaCursorToStorage(requestStartedAt);
        return mergedPayload;
      }

      cache.data = payload;
      return payload;
    })
    .finally(() => {
      cache.promise = null;
    });

  cache.promise = request;
  return request;
};
