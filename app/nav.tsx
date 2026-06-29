"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** 顶部导航：展示登录态。email 由服务端布局传入（null = 未登录）。 */
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

  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-6">
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="font-medium hover:text-neutral-900">
            新建行程
          </Link>
          <Link
            href="/trips"
            className="text-neutral-500 hover:text-neutral-900"
          >
            我的行程
          </Link>
        </nav>
        {email ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-400 sm:inline">{email}</span>
            <button
              onClick={logout}
              className="text-neutral-500 hover:text-neutral-900"
            >
              退出
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            登录
          </Link>
        )}
      </div>
    </header>
  );
}
