"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { META_ACTIVE_ACCOUNT_CHANGED_EVENT } from "@/lib/meta-account-client";
import { SavedContentBoard } from "@/components/saved-content-board";
import { cn } from "@/lib/utils";

type DashboardStatsPayload = {
  publishedCardnewsCount: number;
  draftCardnewsCount: number;
  updatedAt: string | null;
};

type QueueCounts = {
  total: number;
  queued: number;
  scheduled: number;
  publishing: number;
  published: number;
  failed: number;
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

const normalizeQueueCounts = (value: unknown): QueueCounts => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

export default function DashboardHomePage() {
  const { user } = useAuth();

  const [stats, setStats] = useState<DashboardStatsPayload | null>(null);
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null);

  const isReady = Boolean(user);

  const fetchStats = useCallback(async () => {
    if (!user) {
      setStats(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as Partial<DashboardStatsPayload>;
      if (!res.ok) {
        setStats(null);
        return;
      }
      setStats({
        publishedCardnewsCount: typeof data.publishedCardnewsCount === "number" ? data.publishedCardnewsCount : 0,
        draftCardnewsCount: typeof data.draftCardnewsCount === "number" ? data.draftCardnewsCount : 0,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      });
    } catch {
      setStats(null);
    }
  }, [user]);

  const fetchQueueCounts = useCallback(async () => {
    if (!user) {
      setQueueCounts(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/meta/publishing?limit=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { counts?: unknown };
      if (!res.ok) {
        setQueueCounts(null);
        return;
      }
      setQueueCounts(normalizeQueueCounts(data.counts));
    } catch {
      setQueueCounts(null);
    }
  }, [user]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchStats(), fetchQueueCounts()]);
  }, [fetchQueueCounts, fetchStats]);

  useEffect(() => {
    if (!user) {
      setStats(null);
      setQueueCounts(null);
      return;
    }
    void refreshAll();
  }, [refreshAll, user]);

  useEffect(() => {
    const handleActiveAccountChanged = () => {
      if (!user) {
        setQueueCounts(null);
        return;
      }
      void fetchQueueCounts();
    };

    window.addEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(META_ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, [fetchQueueCounts, user]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: "카드뉴스 초안",
        value: stats ? stats.draftCardnewsCount.toLocaleString("ko-KR") : "-",
        tone: "bg-amber-50 text-amber-700",
      },
      {
        label: "카드뉴스 발행",
        value: stats ? stats.publishedCardnewsCount.toLocaleString("ko-KR") : "-",
        tone: "bg-emerald-50 text-emerald-700",
      },
      {
        label: "예약 게시",
        value: queueCounts ? String(queueCounts.scheduled) : "-",
        tone: "bg-sky-50 text-sky-700",
      },
      {
        label: "게시 실패",
        value: queueCounts ? String(queueCounts.failed) : "-",
        tone: "bg-rose-50 text-rose-700",
      },
    ];
  }, [queueCounts, stats]);

  return (
    <div className="mx-auto max-w-[1400px] min-h-screen pb-20">
      <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-600">
            <LayoutDashboard className="h-4 w-4 text-pink-600" />
            Dashboard
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">대시보드</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
            저장된 카드뉴스와 인스타그램 예약/발행 현황을 한 번에 확인합니다.
          </p>
          <p className="mt-2 text-xs font-bold text-slate-400">업데이트: {formatDateTime(stats?.updatedAt ?? null)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/instagram-ai"
            className="inline-flex items-center gap-2 rounded-2xl bg-pink-600 px-5 py-3 text-xs font-black text-white hover:bg-pink-700"
          >
            <CalendarClock className="h-4 w-4" />
            인스타그램 AI
          </Link>
          <Link
            href="/analytics"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-900 px-5 py-3 text-xs font-black text-white hover:bg-slate-800"
          >
            <BarChart3 className="h-4 w-4" />
            분석 보기
          </Link>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <section key={card.label} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className={cn("inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest", card.tone)}>
              {card.label}
            </div>
            <div className="mt-3 text-3xl font-black text-slate-900">{card.value}</div>
          </section>
        ))}
      </div>

      {!isReady && (
        <div className="mb-8 rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-700">
          저장된 내역을 보려면 먼저 로그인해주세요.
        </div>
      )}

      <SavedContentBoard title="저장된 카드뉴스" pageSize={10} />
    </div>
  );
}
