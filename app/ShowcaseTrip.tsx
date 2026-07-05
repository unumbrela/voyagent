"use client";

/**
 * 「行程 + 地图」实景演示组件。首页展示带默认渲染「无锡 → 苏州」；
 * /demo/[slug] 传入对应 demo 的 days/标题/底图模式复用同一套双向联动 UI。
 *
 * 右侧地图：tiles="amap" 且配置 NEXT_PUBLIC_AMAP_KEY 时叠加高德 3D 斜俯视，
 * 否则（含所有出境 osm demo）用 Leaflet 2D。左侧时间轴与地图针脚双向联动。
 * 数据与类别词汇表集中在 app/showcase-data.ts。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useInView } from "motion/react";
import { dayColorOf } from "@/lib/palette";
import { TrainFront, Plane, KIND_ICONS } from "@/app/ui/icons";
import {
  DAYS,
  KIND_COLOR,
  KIND_LABEL,
  haversineKm,
  type ShowDay,
} from "@/app/showcase-data";

const ShowcaseMapAMap = dynamic(() => import("./ShowcaseMapAMap"), { ssr: false });
const ShowcaseMapLeaflet = dynamic(() => import("./ShowcaseMapLeaflet"), { ssr: false });
// key 在构建期内联；有 key 且底图为高德时走 3D，否则走 Leaflet
const HAS_AMAP_KEY = !!process.env.NEXT_PUBLIC_AMAP_KEY;

/** 地图缩放接口：Leaflet / 高德各自实现并登记，供统一 +/- 控件调用 */
type ZoomApi = { zoomIn: () => void; zoomOut: () => void };

const riseItem = {
  hidden: { opacity: 0, x: -14 },
  show: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.06 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

interface Props {
  /** 逐日行程（默认首页苏州 DAYS，向后兼容） */
  days?: ShowDay[];
  /** 顶栏主标题（如「无锡 → 苏州 · 江南三日」） */
  title?: string;
  /** 顶栏副标题（日期 · 人数 · 时长） */
  subtitle?: string;
  /** 顶栏右侧徽标文案 */
  badge?: string;
  /** 底图/坐标模式：amap（国内）/ osm（出境） */
  tiles?: "amap" | "osm";
  /** 主交通方式，决定顶栏图标（火车/飞机） */
  transport?: "train" | "flight";
}

export default function ShowcaseTrip({
  days = DAYS,
  title = "无锡 → 苏州 · 江南三日",
  subtitle = "07.10 周五 – 07.12 周日 · 2 人 · 三日两晚",
  badge = "真实数据 · 可点可拖",
  tiles = "amap",
  transport = "train",
}: Props = {}) {
  const [dayIdx, setDayIdx] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  // 鼠标是否悬于整个「行程 + 地图」区域：一旦进入即暂停轮播，移出后自动恢复
  const [hovering, setHovering] = useState(false);
  // 地图分层：底层 Leaflet 2D 瞬间出图；高德 3D 后台加载，canvas 就绪(amapReady)后淡入覆盖；
  // 鉴权失败/超时(amapFailed)则永远保持底层 Leaflet —— 地图绝不留白
  const [amapReady, setAmapReady] = useState(false);
  const [amapFailed, setAmapFailed] = useState(false);
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // 仅国内(amap)且有 key 时叠高德 3D；出境 osm demo 永远用 Leaflet（高德海外注记稀疏）
  const useAmap = tiles === "amap" && HAS_AMAP_KEY;
  const TransportIcon = transport === "flight" ? Plane : TrainFront;

  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });

  // 统一缩放：两张地图各自登记 zoomIn/zoomOut，+/- 覆盖控件按当前生效的图路由（高德就绪→控高德，否则→控 Leaflet）
  const amapZoomRef = useRef<ZoomApi | null>(null);
  const leafletZoomRef = useRef<ZoomApi | null>(null);
  const amapActive = useAmap && amapReady && !amapFailed;
  function doZoom(dir: 1 | -1) {
    // 优先驱动当前生效的图；若它尚未登记接口，退回另一张，确保按钮永远有反馈
    const api = amapActive
      ? amapZoomRef.current ?? leafletZoomRef.current
      : leafletZoomRef.current ?? amapZoomRef.current;
    if (!api) return;
    if (dir > 0) api.zoomIn();
    else api.zoomOut();
  }

  const d = days[dayIdx];
  const color = dayColorOf(d.day);

  // 入视口自动轮播；鼠标一旦进入组件区域即暂停，移出后自动恢复
  useEffect(() => {
    if (!inView || hovering || reduced) return;
    const t = setTimeout(() => {
      setDayIdx((i) => (i + 1) % days.length);
    }, 6000);
    return () => clearTimeout(t);
  }, [inView, hovering, dayIdx, reduced, days.length]);

  const dayKm = useMemo(() => {
    let km = 0;
    for (let i = 1; i < d.stops.length; i++)
      km += haversineKm(d.stops[i - 1], d.stops[i]);
    return km;
  }, [d]);

  function pickDay(i: number) {
    setHover(null);
    setDayIdx(i);
  }

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        setHover(null);
      }}
      className="overflow-hidden rounded-card border border-line bg-surface shadow-lift"
    >
      {/* ── 顶栏：行程档案头 + 切天 tabs ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-line bg-surface-2/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white">
            <TransportIcon className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-serif text-[15px] font-bold leading-tight text-ink">
              {title}
            </p>
            <p className="font-data mt-0.5 text-[11px] text-muted">{subtitle}</p>
          </div>
        </div>
        <span className="rounded-pill bg-teal-tint px-2.5 py-1 text-[11px] font-semibold text-teal-dark">
          {badge}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5" role="tablist" aria-label="切换天数">
          {days.map((dd, i) => {
            const active = i === dayIdx;
            const cc = dayColorOf(dd.day);
            return (
              <button
                key={dd.day}
                role="tab"
                aria-selected={active}
                onClick={() => pickDay(i)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "text-white"
                    : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
                }`}
                style={active ? { background: cc, borderColor: cc } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: active ? "#fff" : cc }}
                />
                第 {dd.day} 天
                <span className="hidden sm:inline font-normal opacity-80">
                  · {dd.tab}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* ── 左：当天时间轴 ── */}
        <div className="flex flex-col p-5 sm:p-6 lg:border-r lg:border-line">
          <motion.div
            key={`h-${dayIdx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <p className="ed-eyebrow">
              第 {d.day} 天 · {d.dow} · {d.date}
            </p>
            <h3 className="font-serif mt-1.5 text-xl font-bold tracking-tight text-ink">
              {d.theme}
            </h3>
          </motion.div>

          <div className="relative mt-4 flex-1">
            {/* 时间轴导轨：与针脚同列 */}
            <span
              aria-hidden
              className="absolute bottom-3 top-3 w-px bg-line"
              style={{ left: "calc(3rem + 24px)" }}
            />
            <motion.ul
              key={`l-${dayIdx}`}
              initial="hidden"
              animate="show"
              className="space-y-2.5"
            >
              {d.stops.map((s, i) => {
                const KindIcon = KIND_ICONS[s.kind];
                const hot = hover === i;
                const isFlight = s.ticket?.mode === "flight";
                const TicketIcon = isFlight ? Plane : TrainFront;
                return (
                  <motion.li
                    key={s.title}
                    variants={riseItem}
                    custom={i}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    className="grid grid-cols-[3rem_28px_minmax(0,1fr)] items-start gap-x-2.5"
                  >
                    <span className="font-data pt-2.5 text-right text-[11px] leading-none text-muted">
                      {s.time}
                    </span>
                    {/* 节点按【类别】着色 + 序号，与地图针脚同色同号 */}
                    <span
                      className="sc-node relative mt-1 justify-self-center transition-transform"
                      style={{
                        "--c": KIND_COLOR[s.kind],
                        transform: hot ? "scale(1.16)" : undefined,
                      } as React.CSSProperties}
                    >
                      <span className="text-[13px] font-bold leading-none">{i + 1}</span>
                    </span>

                    {s.ticket ? (
                      /* 交通条目：登机牌 / 车票式票根 */
                      <div className={`ticket px-4 py-2.5 ${hot ? "shadow-lift" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-ink">
                            <TicketIcon
                              className="h-3.5 w-3.5 shrink-0"
                              style={{ color: "var(--c-transit)" }}
                              aria-hidden
                            />
                            {s.ticket.line} {s.ticket.no}
                          </p>
                          <span className="seal-stamp whitespace-nowrap">
                            已核验
                          </span>
                        </div>
                        <hr className="ticket-divider my-2" />
                        <div className="font-data flex items-center justify-between gap-2 text-xs text-ink">
                          <span className="whitespace-nowrap">
                            {s.ticket.from}{" "}
                            <b className="text-[13px]">{s.ticket.dep}</b>
                          </span>
                          <span className="flex-1 whitespace-nowrap text-center text-[10px] text-muted">
                            <span className="hidden sm:inline">
                              —— {s.ticket.dur} →
                            </span>
                            <span className="sm:hidden">→</span>
                          </span>
                          <span className="whitespace-nowrap">
                            <b className="text-[13px]">{s.ticket.arr}</b>{" "}
                            {s.ticket.to}
                          </span>
                        </div>
                        <p className="font-data mt-1.5 text-[11px] text-muted">
                          {s.ticket.seat} {s.cost} ·{" "}
                          {isFlight ? "航司官网可订" : "12306 可订"}
                        </p>
                        {s.ticket.via && (
                          <p className="mt-1 text-[11px] leading-relaxed text-muted/85">
                            {s.ticket.via}
                          </p>
                        )}
                      </div>
                    ) : (
                      /* 普通条目：地点卡 */
                      <div
                        className={`sc-card py-2.5 pl-3.5 pr-3 ${
                          hot ? "border-line-strong shadow-lift" : ""
                        }`}
                        style={{ "--kc": KIND_COLOR[s.kind] } as React.CSSProperties}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[13.5px] font-semibold leading-snug text-ink">
                            {s.title}
                          </p>
                          {s.cost && (
                            <span className="font-data shrink-0 text-[11px] font-semibold text-teal-dark">
                              {s.cost}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-start gap-2">
                          <span
                            className="sc-kind-chip"
                            style={
                              {
                                "--kc": KIND_COLOR[s.kind],
                              } as React.CSSProperties
                            }
                          >
                            <KindIcon className="h-3 w-3" aria-hidden />
                            {KIND_LABEL[s.kind]}
                          </span>
                          {s.detail && (
                            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
                              {s.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </motion.ul>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
            <span className="font-data text-xs text-muted">
              {d.stops.length} 站 · 路线 ≈ {dayKm.toFixed(1)} km
            </span>
            <span className="font-data text-xs font-semibold text-ink">
              {d.summary}
            </span>
          </div>
        </div>

        {/* ── 右：真实地图（高德 3D / Leaflet 降级） ── */}
        <div className="relative min-h-[400px] bg-[#eef1ee] lg:min-h-0">
          {/* 底：Leaflet 2D —— 瞬间出图、绝不空白；高德就绪后被覆盖 */}
          <ShowcaseMapLeaflet
            dayIdx={dayIdx}
            hover={hover}
            onHover={setHover}
            reduced={reduced}
            days={days}
            tiles={tiles}
            onZoomApi={(api) => (leafletZoomRef.current = api)}
          />

          {/* 顶：高德 3D —— 仅国内 amap demo 且有 key 时启用 */}
          {useAmap && !amapFailed && (
            <div
              className="absolute inset-0 z-[1] transition-opacity duration-700"
              style={{ opacity: amapReady ? 1 : 0, pointerEvents: amapReady ? "auto" : "none" }}
              aria-hidden={!amapReady}
            >
              <ShowcaseMapAMap
                dayIdx={dayIdx}
                hover={hover}
                onHover={setHover}
                reduced={reduced}
                onReady={() => setAmapReady(true)}
                onError={() => setAmapFailed(true)}
                onZoomApi={(api) => (amapZoomRef.current = api)}
              />
            </div>
          )}

          {/* 统一 +/- 缩放控件：置于右上（避开左上「当天信息」浮层），驱动当前生效的地图。
              不依赖 Leaflet 原生控件 / 高德 ToolBar 插件，两图行为一致、必然可见可点。 */}
          <div className="absolute right-3 top-3 z-[1001] flex flex-col overflow-hidden rounded-lg border border-line bg-white/92 shadow-soft backdrop-blur">
            <button
              type="button"
              onClick={() => doZoom(1)}
              aria-label="放大"
              className="grid h-8 w-8 cursor-pointer place-items-center text-xl font-semibold leading-none text-ink transition hover:bg-surface-2"
            >
              +
            </button>
            <span className="h-px w-full bg-line" aria-hidden />
            <button
              type="button"
              onClick={() => doZoom(-1)}
              aria-label="缩小"
              className="grid h-8 w-8 cursor-pointer place-items-center text-xl font-semibold leading-none text-ink transition hover:bg-surface-2"
            >
              −
            </button>
          </div>

          {/* 当天信息浮层 */}
          <motion.div
            key={`chip-${dayIdx}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="pointer-events-none absolute left-3 top-3 z-[1000] flex items-center gap-2 rounded-lg border border-line bg-white/92 px-3 py-2 shadow-soft backdrop-blur"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: color }}
            />
            <span className="text-xs font-bold text-ink">
              第 {d.day} 天 · {d.theme}
            </span>
          </motion.div>

          {/* 内描边：让地图边缘更利落 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[1000] border-t border-line lg:border-l lg:border-t-0"
          />
        </div>
      </div>
    </div>
  );
}
