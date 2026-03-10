"use client";

import React from "react";
import { ShieldCheck, UserRound, Mail, Fingerprint, CalendarClock } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function SettingsPage() {
  const { user } = useAuth();

  const accountFields = [
    { label: "이름", value: user?.displayName || "미설정", icon: UserRound },
    { label: "이메일", value: user?.email || "-", icon: Mail },
    { label: "인증 상태", value: user?.emailVerified ? "이메일 인증 완료" : "미인증", icon: ShieldCheck },
    { label: "UID", value: user?.uid || "-", icon: Fingerprint },
    { label: "가입 일시", value: formatDate(user?.metadata?.creationTime), icon: CalendarClock },
    { label: "최근 로그인", value: formatDate(user?.metadata?.lastSignInTime), icon: CalendarClock },
  ];

  return (
    <div className="mx-auto max-w-5xl min-h-screen pb-20">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-7">
          <div className="inline-flex items-center rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-pink-600">
            Account
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">내 계정 정보</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">
            현재 로그인된 계정의 기본 정보만 표시합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {accountFields.map((field) => (
            <div
              key={field.label}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
                  <field.icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                  {field.label}
                </div>
              </div>
              <div className="mt-3 break-all text-sm font-bold text-slate-900">
                {field.value}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
