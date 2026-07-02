"use client";

/**
 * 落地页「行程 + 地图」实景演示：无锡 → 苏州 · 三日两晚。
 * 不是效果图——数据为真实地点/车次/票价（手工核对），坐标内置（不走 geocode，
 * 秒开且确定性），右侧是真实 Leaflet 地图（CARTO Voyager 瓦片）。
 * 交互：切天 flyTo 当天动线；列表行 ↔ 地图针脚双向联动；
 * 入视口后每 6s 自动轮播三天，用户一交互即停。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { motion, useInView } from "motion/react";
import { dayColorOf } from "@/lib/palette";
import { TrainFront, KIND_ICONS } from "@/app/ui/icons";

type Kind = "activity" | "food" | "rest" | "transit";

interface Stop {
  time: string;
  title: string;
  kind: Kind;
  detail: string;
  /** 显示用花费（"¥80" / "¥688/晚" / null=免费不显示） */
  cost: string | null;
  lat: number;
  lon: number;
  /** transit 条目以登机牌票根呈现 */
  ticket?: {
    line: string;
    no: string;
    from: string;
    to: string;
    dep: string;
    arr: string;
    dur: string;
    seat: string;
  };
}

interface ShowDay {
  day: number;
  date: string;
  dow: string;
  theme: string;
  tab: string;
  summary: string;
  stops: Stop[];
}

/** 类别 → 小图标着色（与全站类别色对齐） */
const KIND_COLOR: Record<Kind, string> = {
  activity: "var(--c-activity)",
  food: "var(--c-food)",
  rest: "var(--c-rest)",
  transit: "var(--c-transit)",
};

const DAYS: ShowDay[] = [
  {
    day: 1,
    date: "07.10",
    dow: "周五",
    theme: "入城 · 拙政园与平江夜色",
    tab: "园林平江",
    summary: "今日约 ¥888 · 含首晚住宿",
    stops: [
      {
        time: "09:04",
        title: "沪宁城际 G7215 · 无锡 → 苏州",
        kind: "transit",
        detail: "",
        cost: "¥19.5",
        lat: 31.331,
        lon: 120.612,
        ticket: {
          line: "沪宁城际",
          no: "G7215",
          from: "无锡",
          to: "苏州",
          dep: "09:04",
          arr: "09:24",
          dur: "20 分",
          seat: "二等座",
        },
      },
      {
        time: "10:00",
        title: "书香府邸 · 平江府",
        kind: "rest",
        detail: "先寄存行李，出门就是平江路",
        cost: "¥688/晚",
        lat: 31.3182,
        lon: 120.6338,
      },
      {
        time: "10:40",
        title: "拙政园",
        kind: "activity",
        detail: "中国四大名园之首，宜提前一日预约",
        cost: "¥80",
        lat: 31.3236,
        lon: 120.629,
      },
      {
        time: "12:30",
        title: "裕兴记面馆（西北街）",
        kind: "food",
        detail: "两面黄脆底浇头，苏式面点老字号",
        cost: "¥45",
        lat: 31.3249,
        lon: 120.622,
      },
      {
        time: "14:00",
        title: "苏州博物馆",
        kind: "activity",
        detail: "贝聿铭封山之作，片石假山如水墨",
        cost: "免费预约",
        lat: 31.3228,
        lon: 120.6262,
      },
      {
        time: "18:30",
        title: "平江路 · 摇橹船夜游",
        kind: "activity",
        detail: "小桥流水枕河人家，船娘唱一段评弹",
        cost: "¥55",
        lat: 31.3152,
        lon: 120.6336,
      },
    ],
  },
  {
    day: 2,
    date: "07.11",
    dow: "周六",
    theme: "虎丘塔影 · 七里山塘",
    tab: "虎丘山塘",
    summary: "今日约 ¥260",
    stops: [
      {
        time: "09:00",
        title: "虎丘",
        kind: "activity",
        detail: "吴中第一名胜，千年斜塔与剑池",
        cost: "¥70",
        lat: 31.3402,
        lon: 120.5766,
      },
      {
        time: "11:00",
        title: "七里山塘 · 山塘街",
        kind: "activity",
        detail: "古运河畔水上人家，可乘手摇船",
        cost: null,
        lat: 31.3196,
        lon: 120.607,
      },
      {
        time: "12:00",
        title: "荣阳楼（山塘街）",
        kind: "food",
        detail: "百年老店，生煎馒头配卤汁豆腐干",
        cost: "¥35",
        lat: 31.3232,
        lon: 120.6012,
      },
      {
        time: "14:00",
        title: "留园",
        kind: "activity",
        detail: "与拙政园齐名，移步换景的范本",
        cost: "¥55",
        lat: 31.3226,
        lon: 120.5949,
      },
      {
        time: "19:30",
        title: "网师园 · 夜花园",
        kind: "activity",
        detail: "昆曲评弹实景演出，夜苏州的精华",
        cost: "¥100",
        lat: 31.302,
        lon: 120.6321,
      },
    ],
  },
  {
    day: 3,
    date: "07.12",
    dow: "周日",
    theme: "金鸡湖畔 · 满载而归",
    tab: "金鸡湖返程",
    summary: "今日约 ¥128 · 含返程车票",
    stops: [
      {
        time: "08:30",
        title: "同得兴精品面馆（十全街）",
        kind: "food",
        detail: "一碗枫镇大肉面，苏式头汤面的讲究",
        cost: "¥28",
        lat: 31.3035,
        lon: 120.6288,
      },
      {
        time: "10:30",
        title: "诚品书店（金鸡湖）",
        kind: "activity",
        detail: "大陆首家诚品，湖畔消磨一上午",
        cost: null,
        lat: 31.3218,
        lon: 120.6923,
      },
      {
        time: "13:30",
        title: "金鸡湖湖滨步道 · 东方之门",
        kind: "activity",
        detail: "环湖天际线，苏州的现代面孔",
        cost: null,
        lat: 31.3125,
        lon: 120.676,
      },
      {
        time: "15:30",
        title: "采芝斋（观前街总店）",
        kind: "food",
        detail: "一百五十年苏式糖果铺，捎份伴手礼",
        cost: "¥80",
        lat: 31.3128,
        lon: 120.6238,
      },
      {
        time: "17:23",
        title: "沪宁城际 G7042 · 苏州 → 无锡",
        kind: "transit",
        detail: "",
        cost: "¥19.5",
        lat: 31.331,
        lon: 120.612,
        ticket: {
          line: "沪宁城际",
          no: "G7042",
          from: "苏州",
          to: "无锡",
          dep: "17:23",
          arr: "17:42",
          dur: "19 分",
          seat: "二等座",
        },
      },
    ],
  },
];

/** 两点球面距离（km），用于「今日动线」统计 */
function haversineKm(a: Stop, b: Stop): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const riseItem = {
  hidden: { opacity: 0, x: -14 },
  show: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.06 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function ShowcaseTrip() {
  const [dayIdx, setDayIdx] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [interacted, setInteracted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });
  const reducedRef = useRef(false);
  useEffect(() => {
    reducedRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  const d = DAYS[dayIdx];
  const color = dayColorOf(d.day);

  // 入视口自动轮播三天：悬停暂停，点击切天后永久停止
  useEffect(() => {
    if (!inView || interacted || hover !== null || reducedRef.current) return;
    const t = setTimeout(() => {
      setDayIdx((i) => (i + 1) % DAYS.length);
    }, 6000);
    return () => clearTimeout(t);
  }, [inView, interacted, hover, dayIdx]);

  // ── Leaflet：只建一次 ──
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      // 展示图（非工作图）：锁定拖拽缩放，避免滚动误触；针脚仍可交互
      const map = L.map(mapEl.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView([31.318, 120.62], 12);
      map.attributionControl.setPrefix(false);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        },
      ).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
  }, []);

  // ── 切天重绘：白描边动线 + 流动虚线 + 编号针脚，flyTo 当天范围 ──
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    markersRef.current = [];

    const cur = DAYS[dayIdx];
    const c = dayColorOf(cur.day);
    const latlngs = cur.stops.map((s) => [s.lat, s.lon] as [number, number]);

    // 底层白描边让路线在瓦片上更清晰
    L.polyline(latlngs, {
      color: "#fff",
      weight: 7,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(group);
    L.polyline(latlngs, {
      color: c,
      weight: 3,
      opacity: 0.85,
      className: "tp-route",
      lineCap: "round",
      lineJoin: "round",
    }).addTo(group);

    cur.stops.forEach((s, i) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="tp-pin tp-drop" style="--c:${c};animation-delay:${140 + i * 90}ms"><div class="tp-pin-inner"><span>${i + 1}</span></div></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 28],
        tooltipAnchor: [0, -26],
      });
      const m = L.marker([s.lat, s.lon], {
        icon,
        zIndexOffset: i * 10,
        riseOnHover: true,
      });
      // direction auto：靠近地图边缘时自动翻到另一侧，避免提示被裁切
      m.bindTooltip(`${s.time} · ${s.title}`, {
        direction: "auto",
        className: "tp-tip",
      });
      m.on("mouseover", () => setHover(i));
      m.on("mouseout", () => setHover((h) => (h === i ? null : h)));
      m.addTo(group);
      markersRef.current.push(m);
    });

    const bounds = L.latLngBounds(latlngs);
    if (reducedRef.current) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14, animate: false });
    } else {
      map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 14, duration: 1.1 });
    }
  }, [ready, dayIdx]);

  // ── 列表行 ↔ 针脚联动：放大 + 打开悬浮提示 ──
  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      const el = m.getElement()?.querySelector(".tp-pin");
      if (!el) return;
      el.classList.toggle("tp-hot", i === hover);
      if (i === hover) m.openTooltip();
      else m.closeTooltip();
    });
  }, [hover]);

  const dayKm = useMemo(() => {
    let km = 0;
    for (let i = 1; i < d.stops.length; i++)
      km += haversineKm(d.stops[i - 1], d.stops[i]);
    return km;
  }, [d]);

  function pickDay(i: number) {
    setInteracted(true);
    setHover(null);
    setDayIdx(i);
  }

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-card border border-line bg-surface shadow-lift"
    >
      {/* ── 顶栏：行程档案头 + 切天 tabs ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-line bg-surface-2/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white">
            <TrainFront className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-serif text-[15px] font-bold leading-tight text-ink">
              无锡 → 苏州 · 江南三日
            </p>
            <p className="font-data mt-0.5 text-[11px] text-muted">
              07.10 周五 – 07.12 周日 · 2 人 · 三日两晚
            </p>
          </div>
        </div>
        <span className="rounded-pill bg-teal-tint px-2.5 py-1 text-[11px] font-semibold text-teal-dark">
          真实数据 · 可交互
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5" role="tablist" aria-label="切换天数">
          {DAYS.map((dd, i) => {
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
              style={{ left: "calc(3rem + 22.5px)" }}
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
                return (
                  <motion.li
                    key={s.title}
                    variants={riseItem}
                    custom={i}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    className="grid grid-cols-[3rem_26px_minmax(0,1fr)] items-start gap-x-2.5"
                  >
                    <span className="font-data pt-2.5 text-right text-[11px] leading-none text-muted">
                      {s.time}
                    </span>
                    <span
                      className="wl-pin relative mt-1 justify-self-center transition-transform"
                      style={{
                        "--c": color,
                        transform: hot ? "scale(1.18)" : undefined,
                      } as React.CSSProperties}
                    >
                      {i + 1}
                    </span>

                    {s.ticket ? (
                      /* 交通条目：登机牌式票根 */
                      <div className={`ticket px-4 py-2.5 ${hot ? "shadow-lift" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-ink">
                            <TrainFront
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
                          {s.ticket.seat} {s.cost} · 12306 可订
                        </p>
                      </div>
                    ) : (
                      /* 普通条目：地点卡 */
                      <div
                        className={`wl-place-card px-3.5 py-2.5 ${
                          hot ? "border-line-strong shadow-lift" : ""
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[13.5px] font-semibold text-ink">
                            {s.title}
                          </p>
                          {s.cost && (
                            <span className="font-data shrink-0 text-[11px] font-semibold text-teal-dark">
                              {s.cost}
                            </span>
                          )}
                        </div>
                        {s.detail && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs leading-relaxed text-muted">
                            <KindIcon
                              className="h-3 w-3 shrink-0"
                              style={{ color: KIND_COLOR[s.kind] }}
                              aria-hidden
                            />
                            {s.detail}
                          </p>
                        )}
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </motion.ul>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
            <span className="font-data text-xs text-muted">
              {d.stops.length} 站 · 动线 ≈ {dayKm.toFixed(1)} km
            </span>
            <span className="font-data text-xs font-semibold text-ink">
              {d.summary}
            </span>
          </div>
        </div>

        {/* ── 右：真实地图 ── */}
        <div className="relative min-h-[400px] bg-[#e9edef] lg:min-h-0">
          <div ref={mapEl} className="absolute inset-0 z-0" />

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

          {/* 内描边：让瓦片边缘更利落 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[1000] border-t border-line lg:border-l lg:border-t-0"
          />
        </div>
      </div>
    </div>
  );
}
