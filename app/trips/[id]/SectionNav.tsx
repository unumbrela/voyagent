"use client";

/**
 * 行程详情页左侧「章节导航」侧栏（招牌三栏之左栏）。
 * - 列出章节锚点：概览 / 行程（下挂逐日）/ 预算 / 探索 / 打包 / 偏好 / 过程 / 助手 / 信息
 * - IntersectionObserver 做 scrollspy：随滚动高亮当前章节
 * - 点击平滑滚动到对应 id
 * 桌面 sticky 于左列；移动端折叠为顶部横向 chips。
 */

import { useEffect, useState } from "react";
import type { LucideIcon } from "@/app/ui/icons";

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 行程章节下挂的逐日子项（可选） */
  children?: { id: string; label: string }[];
}

export function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  // scrollspy：观察所有章节（含逐日子锚点），取最靠近顶部的可见者高亮
  useEffect(() => {
    const ids = sections.flatMap((s) => [s.id, ...(s.children ?? []).map((c) => c.id)]);
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;

    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // 可见章节里取 top 最小（最靠上）的作为当前
        let best: string | null = null;
        let bestTop = Infinity;
        for (const [id, top] of visible) {
          if (top < bestTop) {
            bestTop = top;
            best = id;
          }
        }
        if (best) setActive(best);
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: [0, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }

  // 某父章节高亮：自身或其任一子项处于 active
  const isActive = (s: NavSection) =>
    active === s.id || (s.children ?? []).some((c) => c.id === active);

  return (
    <>
      {/* 桌面：sticky 竖向导航 */}
      <nav className="wl-sidenav hidden lg:block lg:sticky lg:top-[4.5rem] lg:self-start">
        <p className="ed-eyebrow mb-2 px-3">行程目录</p>
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => jump(s.id)}
                className={`wl-sidenav-link w-full text-left cursor-pointer ${
                  isActive(s) ? "wl-sidenav-link--active" : ""
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{s.label}</span>
              </button>
              {isActive(s) && s.children && s.children.length > 0 && (
                <ul className="mt-0.5 space-y-0.5">
                  {s.children.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => jump(c.id)}
                        className={`wl-sidenav-link wl-sidenav-sub w-full text-left cursor-pointer ${
                          active === c.id ? "wl-sidenav-link--active" : ""
                        }`}
                      >
                        <span className="truncate">{c.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* 移动端：顶部横向 chips */}
      <nav className="no-print -mx-6 mb-4 overflow-x-auto px-6 lg:hidden">
        <ul className="flex gap-2">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => jump(s.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                  isActive(s)
                    ? "border-teal bg-teal-tint text-teal-dark"
                    : "border-line bg-surface text-muted"
                }`}
              >
                <s.icon className="h-3.5 w-3.5" aria-hidden />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
