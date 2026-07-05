"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Compass, LogOut } from "@/app/ui/icons";

/** 顶部导航：白色栏 + 罗盘标 + Fraunces 字标。email 由服务端布局传入（null = 未登录）。 */
export function Nav({ email }: { email: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  // 登录页不显示导航，避免干扰
  if (pathname.startsWith("/login")) return null;

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  // 落地页与 demo 演示页：透明悬浮在暮色 hero 之上（白字）；其余页：白色 sticky 栏
  const onNight = pathname === "/" || pathname.startsWith("/demo");

  return (
    <header
      className={
        onNight
          ? "no-print absolute inset-x-0 top-0 z-50"
          : "no-print sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur"
      }
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="flex items-center gap-2">
            <span
              className={`grid h-8 w-8 place-items-center rounded-lg text-white shadow-soft ${
                onNight ? "bg-white/15 backdrop-blur" : "bg-teal"
              }`}
            >
              <Compass className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
            </span>
            <span
              className={`font-serif text-lg font-bold tracking-tight ${
                onNight ? "text-white" : "text-ink"
              }`}
            >
              漫游
            </span>
          </Link>
          <Link
            href="/"
            className={`hidden font-medium transition sm:inline ${
              onNight
                ? "text-white/90 hover:text-white"
                : pathname === "/"
                  ? "text-ink"
                  : "text-muted hover:text-ink"
            }`}
          >
            首页
          </Link>
          <Link
            href="/trips"
            className={`hidden font-medium transition sm:inline ${
              onNight
                ? "text-white/60 hover:text-white"
                : pathname.startsWith("/trips")
                  ? "text-ink"
                  : "text-muted hover:text-ink"
            }`}
          >
            我的行程
          </Link>
        </nav>
        {email ? (
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`hidden sm:inline ${onNight ? "text-white/60" : "text-muted"}`}
            >
              {email}
            </span>
            <button
              onClick={logout}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition cursor-pointer ${
                onNight
                  ? "border border-white/20 bg-white/[0.08] text-white backdrop-blur hover:bg-white/[0.15]"
                  : "border border-line bg-surface text-ink hover:bg-surface-2"
              }`}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              退出
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className={
              onNight
                ? "btn-glow rounded-lg px-4 py-1.5 text-sm font-semibold"
                : "rounded-lg bg-teal px-4 py-1.5 text-sm font-semibold text-white shadow-soft transition hover:bg-teal-dark"
            }
          >
            登录
          </Link>
        )}
      </div>
    </header>
  );
}
