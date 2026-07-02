"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Compass } from "@/app/ui/icons";

type Mode = "signin" | "signup";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // 回调失败时通过 ?error= 带回错误信息
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(null);

  // Google 一键登录（未注册也会自动创建账号）：跳 Google → 回 /auth/callback 换会话
  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // 若项目开了邮箱确认，此处不会立即拿到 session
        if (!data.session) {
          setNotice("注册成功，请到邮箱点确认链接后再登录。");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="night flex min-h-screen items-center justify-center px-6 py-16"
      style={{ "--night-img": "url(/bg/login.jpg)" } as React.CSSProperties}
    >
      <div className="night-stars" aria-hidden />
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="btn-glow grid h-13 w-13 place-items-center rounded-2xl p-3">
            <Compass className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="font-serif mt-5 text-[1.7rem] font-black tracking-tight text-white">
            {mode === "signin" ? "欢迎回来" : "创建你的账号"}
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: "var(--night-muted)" }}>
            {mode === "signin" ? "登录以查看和管理你的行程" : "注册后即可开始规划旅行"}
          </p>
        </div>

        <div className="glass p-6 sm:p-7">
          <button
            type="button"
            onClick={signInWithGoogle}
            className="glass-input flex w-full items-center justify-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium transition hover:bg-white/[0.14] cursor-pointer"
          >
            <GoogleIcon />
            使用 Google 继续
          </button>

          <div
            className="my-5 flex items-center gap-3 text-xs"
            style={{ color: "var(--night-muted)" }}
          >
            <span className="h-px flex-1 bg-white/15" />
            或用邮箱
            <span className="h-px flex-1 bg-white/15" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-white/85">
                邮箱
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-white/85">
                密码
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                className={inputCls}
              />
            </label>

            {error && <p className="text-sm text-[#ff9b8a]">{error}</p>}
            {notice && (
              <p className="text-sm" style={{ color: "var(--aurora-teal)" }}>
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-glow w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {loading ? "处理中…" : mode === "signin" ? "登录" : "注册"}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="mt-5 block w-full text-center text-sm text-white/60 transition hover:text-white cursor-pointer"
        >
          {mode === "signin" ? "没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

const inputCls =
  "glass-input w-full rounded-lg px-3 py-2.5 text-sm outline-none transition";

/** Google 多色「G」图标 */
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
