"use client";

/**
 * 行程页专用 UI：旅行志刊头（TripHero）+ 弹簧数字（AnimatedNumber）+ 元信息 chip。
 * 编辑风：Fraunces 衬线大标题 · mono 数据行 · 制图集封面条（等高线 + 路线）。
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "motion/react";

/* ── 弹簧数字：数值变化时平滑滚动（预算/统计用） ── */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 90, damping: 22, restDelta: 0.5 });
  const fmt = format ?? ((n: number) => String(Math.round(n)));
  const [display, setDisplay] = useState(() => fmt(value));

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  useEffect(() => {
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(fmt(value));
      return;
    }
    const unsub = spring.on("change", (v) => setDisplay(fmt(v)));
    return () => unsub();
  }, [spring, reduce, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span className={className}>{reduce ? fmt(value) : display}</span>;
}

/* ── 元信息小标签（暮色刊头上的玻璃徽章） ── */
export function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/18 bg-white/[0.09] px-3 py-1 text-sm font-medium text-white/85 backdrop-blur">
      {children}
    </span>
  );
}

/* ── 行程刊头：暮色夜空 masthead。极光 + 白色衬线标题 + 玻璃 meta 徽章 ── */
export function TripHero({
  title,
  destination,
  origin,
  dateRange,
  dayCount,
  partySize,
  budgetLabel,
  right,
}: {
  title: string;
  destination?: string | null;
  origin?: string | null;
  dateRange?: string | null;
  dayCount: number;
  partySize?: number | null;
  budgetLabel?: string | null;
  right?: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="night rounded-card shadow-lift"
      style={{ "--night-img": "url(/bg/masthead.jpg)" } as React.CSSProperties}
    >
      <div className="night-stars" aria-hidden />
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-6 pt-10 sm:px-7 sm:pt-12">
        <div className="min-w-0">
          <p
            className="font-data text-xs font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--aurora-teal)" }}
          >
            {origin ? `${origin} → ` : ""}
            {destination ?? "行程"}
            {dateRange ? ` · ${dateRange}` : ""}
          </p>
          <h1 className="font-serif mt-2 text-3xl font-black leading-tight text-white sm:text-[2.2rem]">
            {title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <MetaPill>
              <span className="font-data">{dayCount}</span> 天
            </MetaPill>
            {partySize ? (
              <MetaPill>
                <span className="font-data">{partySize}</span> 人
              </MetaPill>
            ) : null}
            {budgetLabel && (
              <MetaPill>
                预算 <span className="font-data">{budgetLabel}</span>
              </MetaPill>
            )}
          </div>
        </div>
        {right && <div className="shrink-0 pb-1">{right}</div>}
      </div>
    </motion.header>
  );
}
