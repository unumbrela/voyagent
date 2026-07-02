"use client";

/**
 * 「旅程时间轴」表现层组件（纯 UI，无业务逻辑）。
 * page.tsx 用它把逐日行程包裹成一条随滚动生长的时间轴：
 *  - <TimelineRail>  单条连续导轨 + 随 scrollYProgress 生长的进度线
 * 尊重 prefers-reduced-motion；打印时靠 globals.css 的 .tp-rail/.tp-beam 隐藏。
 */

import { useRef, type ReactNode } from "react";
import { motion, useScroll, useSpring, useReducedMotion } from "motion/react";

/** 导轨 X 坐标（相对 TimelineRail 左缘，px）。节点用 absolute left-[RAIL_X] -translate-x-1/2 对齐到此。 */
export const RAIL_X = 72;

/** 时间轴容器：左侧静态导轨 + 随滚动自顶向下生长的进度线 */
export function TimelineRail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.35", "end 0.65"],
  });
  const scaleY = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <div ref={ref} className="relative mt-6">
      {/* 静态导轨（细线连接逐日编号针） */}
      <div
        aria-hidden
        className="tp-rail pointer-events-none absolute top-2 bottom-2 rounded-full"
        style={{ left: RAIL_X - 1, width: 2, background: "var(--line)" }}
      />
      {/* 随滚动生长的进度线 */}
      <motion.div
        aria-hidden
        className="tp-beam pointer-events-none absolute top-2 bottom-2 w-[2px] rounded-full"
        style={{
          left: RAIL_X - 1,
          scaleY: reduce ? 1 : scaleY,
          transformOrigin: "top",
          background:
            "linear-gradient(to bottom, var(--teal), var(--teal-dark))",
        }}
      />
      <div className="space-y-6">{children}</div>
    </div>
  );
}
