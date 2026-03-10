"use client";

import React, { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { auth, isFirebaseClientConfigured } from "@/lib/firebase-client";

type AuthMode = "login" | "signup";
type MessageTone = "error" | "success" | "info";

type MessageState = {
  tone: MessageTone;
  text: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    if (error.message.includes("auth/unauthorized-continue-uri")) {
      return "인증 메일 발송 실패: Firebase Authentication의 Authorized domains에 localhost를 추가해주세요.";
    }
    if (error.message.includes("auth/too-many-requests")) {
      return "요청이 너무 많아 인증 메일 전송이 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.";
    }
    if (error.message.includes("auth/invalid-continue-uri")) {
      return "인증 링크 URL이 유효하지 않습니다. Firebase 인증 도메인 설정을 확인해주세요.";
    }
    return error.message;
  }
  return fallback;
};

const toAuthorizedContinueUrl = () => {
  const current = new URL(window.location.href);
  if (current.hostname === "127.0.0.1") {
    current.hostname = "localhost";
  }
  current.pathname = "/login";
  current.search = "?verified=1";
  current.hash = "";
  return current.toString();
};

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const getActionCodeSettings = () => ({
    url: toAuthorizedContinueUrl(),
    handleCodeInApp: false,
  });

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setInfoMessage("이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.");
    } else if (params.get("verify") === "required") {
      setInfoMessage("이메일 인증 완료 후에만 대시보드에 접근할 수 있습니다.");
    } else if (params.get("verify") === "send_failed") {
      setInfoMessage("인증 메일 전송에 실패했습니다. 도메인 설정과 스팸함을 확인해주세요.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("verified");
    url.searchParams.delete("verify");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const showMessage = (tone: MessageTone, text: string) => {
    setMessage({ tone, text });
  };

  const handleLogin = async () => {
    if (!auth) {
      showMessage("error", "Firebase 인증 설정이 필요합니다.");
      return;
    }
    if (!email || !password) {
      showMessage("error", "이메일과 비밀번호를 입력해주세요.");
      return;
    }

    const credential = await signInWithEmailAndPassword(auth, email, password);
    await credential.user.reload();
    if (!credential.user.emailVerified) {
      try {
        await sendEmailVerification(credential.user, getActionCodeSettings());
      } catch {
        // ignore verification resend failure and still block login
      }
      await firebaseSignOut(auth);
      showMessage("info", "이메일 인증이 필요합니다. 인증 메일을 다시 전송했습니다.");
      return;
    }

    showMessage("success", "로그인되었습니다.");
    router.replace("/");
  };

  const handleSignup = async () => {
    if (!auth) {
      showMessage("error", "Firebase 인증 설정이 필요합니다.");
      return;
    }
    if (!email || !password || !confirmPassword) {
      showMessage("error", "이메일, 비밀번호, 비밀번호 확인을 모두 입력해주세요.");
      return;
    }
    if (password !== confirmPassword) {
      showMessage("error", "비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 8) {
      showMessage("error", "비밀번호는 8자 이상으로 입력해주세요.");
      return;
    }

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await credential.user.reload();
    try {
      await sendEmailVerification(credential.user, getActionCodeSettings());
      showMessage("success", "회원가입 요청이 완료되었고 이메일 인증 메일을 발송했습니다.");
    } catch (error: unknown) {
      showMessage("error", getErrorMessage(error, "회원가입은 완료됐지만 인증 메일 전송에 실패했습니다."));
    }
    await firebaseSignOut(auth);

    setPassword("");
    setConfirmPassword("");
    setMode("login");
  };

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "signup") {
        await handleSignup();
      } else {
        await handleLogin();
      }
    } catch (error: unknown) {
      const fallback = mode === "signup" ? "회원가입에 실패했습니다." : "로그인에 실패했습니다.";
      showMessage("error", getErrorMessage(error, fallback));
    } finally {
      setLoading(false);
    }
  };

  const messageClass = message?.tone === "error"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : message?.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-sky-200 bg-sky-50 text-sky-700";

  return (
    <section className="login-surface relative mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] border shadow-[0_40px_120px_rgba(15,23,42,0.18)]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-rose-200/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-cyan-200/60 blur-3xl" />

      <div className="relative grid min-h-[760px] lg:grid-cols-[1.1fr_1fr]">
        <div className="login-hero flex flex-col justify-between border-b px-8 py-10 text-slate-100 lg:border-b-0 lg:border-r">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.35em] text-rose-300">Insta AI Studio</p>
            <h1 className="mt-4 text-4xl font-black leading-tight text-white">
              {mode === "signup" ? "지금 바로 계정을 만들고" : "검증된 계정으로 안전하게"}
              <br />
              {mode === "signup" ? "캡션 스튜디오를 시작하세요" : "AI 스튜디오에 로그인하세요"}
            </h1>
            <p className="mt-5 text-sm font-semibold leading-relaxed text-slate-300">
              {mode === "signup"
                ? "회원가입 요청 즉시 인증 메일을 보내드리며, 인증 완료 후 대시보드 기능을 바로 사용할 수 있습니다."
                : "인증된 이메일 계정만 로그인 가능하도록 구성되어 있어 계정 보안과 접근 제어를 강화합니다."}
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
              <span>Security Layer</span>
              <span>{mode === "signup" ? "Sign-up" : "Sign-in"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div className={`h-full rounded-full ${mode === "signup" ? "w-2/3 bg-rose-400" : "w-1/2 bg-cyan-400"}`} />
            </div>
            <p className="text-xs font-semibold text-slate-300">
              회원가입 후 이메일 인증을 완료해야 로그인됩니다.
            </p>
          </div>
        </div>

        <div className="flex items-center px-6 py-10 sm:px-10">
          <div className="w-full">
            {!isFirebaseClientConfigured && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                Firebase Auth 환경변수가 비어 있습니다. `.env.local`의 `NEXT_PUBLIC_FIREBASE_*` 값을 먼저 설정해주세요.
              </div>
            )}

            {infoMessage && (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
                {infoMessage}
              </div>
            )}

            <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white/70 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setMessage(null);
                }}
                className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                  mode === "login"
                    ? "bg-black text-white shadow-lg shadow-black/30"
                    : "text-black hover:bg-slate-100"
                }`}
              >
                로그인
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setMessage(null);
                }}
                className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                  mode === "signup"
                    ? "bg-pink-600 text-white shadow-lg shadow-pink-500/30"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                회원가입 요청
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                />
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">Password</label>
                <div className="relative mt-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "8자 이상 비밀번호" : "비밀번호"}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm font-semibold text-slate-900 outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-base hover:bg-slate-100"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    title={showPassword ? "숨기기" : "보이기"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-slate-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-slate-500" />
                    )}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">Confirm Password</label>
                  <div className="relative mt-2">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="비밀번호 확인"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm font-semibold text-slate-900 outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-base hover:bg-slate-100"
                      aria-label={showConfirmPassword ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
                      title={showConfirmPassword ? "숨기기" : "보이기"}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4 text-slate-500" />
                      ) : (
                        <Eye className="h-4 w-4 text-slate-500" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {message && (
                <div className={`rounded-2xl border px-4 py-3 text-xs font-bold ${messageClass}`}>
                  {message.text}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className={`w-full rounded-xl px-4 py-3 text-sm font-black text-white transition disabled:opacity-60 ${
                  mode === "signup"
                    ? "bg-pink-600 hover:bg-pink-700"
                    : "bg-black hover:bg-neutral-900"
                }`}
              >
                {loading
                  ? "처리 중..."
                  : mode === "signup"
                    ? "회원가입 요청하고 인증 메일 받기"
                    : "로그인"}
              </button>

            </div>

            <p className="mt-5 text-xs font-semibold text-slate-500">
              {mode === "signup"
                ? "가입 요청 후 메일함에서 인증 링크를 클릭하면 계정이 활성화됩니다."
                : "미인증 계정은 로그인되지 않으며 인증 메일이 자동 재발송됩니다."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
