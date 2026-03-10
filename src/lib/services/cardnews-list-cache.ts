type ListCacheEntry = {
  items: unknown[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  expiresAt: number;
};

type ListCacheGlobal = typeof globalThis & {
  __cardnewsListCache?: Record<string, ListCacheEntry>;
};

const globalForListCache = globalThis as ListCacheGlobal;

export const getCardnewsListCache = (key: string): ListCacheEntry | null => {
  const cache = globalForListCache.__cardnewsListCache;
  if (!cache) return null;
  return cache[key] ?? null;
};

export const setCardnewsListCache = (key: string, value: ListCacheEntry) => {
  if (!globalForListCache.__cardnewsListCache) {
    globalForListCache.__cardnewsListCache = {};
  }
  globalForListCache.__cardnewsListCache[key] = value;
};

export const invalidateCardnewsListCache = (uid?: string) => {
  const cache = globalForListCache.__cardnewsListCache;
  if (!cache) return;

  if (!uid) {
    globalForListCache.__cardnewsListCache = {};
    return;
  }

  Object.keys(cache).forEach((key) => {
    if (key.startsWith(`${uid}:`)) {
      delete cache[key];
    }
  });
};
