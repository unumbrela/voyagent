"use client";

/**
 * 行程地图 shell：地点解析（地理编码）+ 引擎选择 + 图例/聚焦控件。
 * 渲染交给双引擎之一：
 *  - TripMapAMap：高德 JSAPI 2.0（国内行程默认，与首页展示带同款 3D 斜俯视）
 *  - TripMapLeaflet：Leaflet + 高德栅格瓦片（出境行程 / 高德不可用时的保底）
 *
 * 地理编码策略：
 *  - 国内（目的地中心落在国内 bbox）且配了高德 key → 高德 PlaceSearch
 *    （city 锁定目的地，GCJ-02 原生，杜绝「同名异地」把针脚甩到合肥/杭州），
 *    查不到的少数条目回落 /api/geocode（OSM 系，已收紧距离阈值）；
 *  - 其余 → /api/geocode 原路径。
 */

import { useEffect, useMemo, useState } from "react";
import { isInChina, wgs84ToGcj02 } from "@/lib/gcj02";
import { Map as MapIcon } from "@/app/ui/icons";
import {
  colorOf,
  mappable,
  toWgs,
  type Day,
  type MapSpot,
  type Meta,
  type Pt,
  type Resolved,
  type ResolvedSpot,
} from "./map-core";
import { amapGeocodePois, hasAmapKey } from "./amap-kit";
import TripMapLeaflet from "./TripMapLeaflet";
import TripMapAMap from "./TripMapAMap";

// 本会话内高德引擎是否已确认不可用（加载/渲染失败后不再反复尝试）
let amapBrokenSession = false;

/** 用户手动引擎偏好（localStorage 持久化；null = 自动） */
function readEnginePref(): "amap" | "leaflet" | null {
  try {
    const v = window.localStorage.getItem("trip-map-engine");
    return v === "amap" || v === "leaflet" ? v : null;
  } catch {
    return null;
  }
}

async function postGeocode(body: {
  destination: string;
  origin: string;
  queries: string[];
}): Promise<{
  center: Pt | null;
  originPoint: Pt | null;
  points: Record<string, Pt | null>;
}> {
  const res = await fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "地点定位失败");
  }
  return data;
}

export default function TripMap({
  days,
  meta,
  fill = false,
  onResolved,
  hoverKey = null,
  onHoverKey,
  syncDay,
  spot = null,
  onLocateItem,
  spots = [],
  onAddSpot,
}: {
  days: Day[];
  meta: Meta;
  /** true 时铺满父容器高度（用于右侧 sticky 地图栏）；否则固定 460px。 */
  fill?: boolean;
  /** 地点坐标解析完成后回传（key = "dayIndex-itemIndex"），供页面计算条目间路程耗时 */
  onResolved?: (coords: Record<string, { lat: number; lon: number }>) => void;
  /** 列表 ↔ 地图双向联动：当前悬停条目 key（"dayIndex-itemIndex"） */
  hoverKey?: string | null;
  /** 鼠标悬停到针脚时回传条目 key（离开回传 null） */
  onHoverKey?: (key: string | null) => void;
  /** 滚动联动：页面滚到第几天就聚焦第几天（null=全程）。undefined 表示不启用 */
  syncDay?: number | null;
  /** 触屏定位：设置后飞到该条目针脚并打开弹窗（每次点按传新对象以重复触发） */
  spot?: { key: string } | null;
  /** 弹窗里「在行程中查看」被点时回传条目 key（页面滚回对应条目） */
  onLocateItem?: (key: string) => void;
  /** 网友攻略推荐点（小红书攻略面板产出）：地图上作独立「建议」图层，可开关、可加入行程 */
  spots?: MapSpot[];
  /** 建议点弹窗里「加入行程」被点时回传该点 */
  onAddSpot?: (s: MapSpot) => void;
}) {
  // 用「标题序列」作为签名：只有地点真正变化才重新 geocode（编辑时间/花费不触发）
  const signature = useMemo(
    () =>
      JSON.stringify({
        d: meta.destination,
        o: meta.origin,
        t: days.map((d) => d.items.map((i) => (mappable(i) ? i.title : ""))),
        s: spots.map((x) => x.title),
      }),
    [days, meta.destination, meta.origin, spots],
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [center, setCenter] = useState<Pt | null>(null);
  const [origin, setOrigin] = useState<Pt | null>(null);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolvedSpots, setResolvedSpots] = useState<ResolvedSpot[]>([]);
  const [showSpots, setShowSpots] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // null = 尚未判定（首次 geocode 前不挂引擎，避免闪一下再切换）
  const [domestic, setDomestic] = useState<boolean | null>(null);
  const [enginePref, setEnginePref] = useState<"amap" | "leaflet" | null>(() =>
    typeof window === "undefined" ? null : readEnginePref(),
  );
  // 高德失败回落的重渲染触发器
  const [, setBrokenTick] = useState(0);

  // 滚动联动：页面滚到哪天，地图聚焦哪天（手动点天数 chip 仍即时生效，
  // 继续滚动后由 scrollspy 重新接管——行为可预期）。
  // 「prop 变化时调整 state」按官方模式在渲染期间完成，不进 effect。
  const [lastSyncDay, setLastSyncDay] = useState(syncDay);
  if (syncDay !== lastSyncDay) {
    setLastSyncDay(syncDay);
    if (syncDay !== undefined) setSelectedDay(syncDay);
  }

  // 天数 chip 点击信号：引擎据此清除触屏定位的 5s 窗口（避免按天取景被劫持）
  const [spotClearSeq, setSpotClearSeq] = useState(0);

  // ── 地点 → 坐标 ──
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const queries: string[] = [];
        days.forEach((d) =>
          d.items.forEach((it) => {
            if (mappable(it)) queries.push(it.title.trim());
          }),
        );
        // 建议点也一并地理编码（同批请求，命中缓存）
        spots.forEach((sp) => {
          if (sp.title?.trim()) queries.push(sp.title.trim());
        });
        const uniq = Array.from(new Set(queries));
        const destination = meta.destination ?? "";

        let centerPt: Pt | null = null;
        let originPt: Pt | null = null;
        let points: Record<string, Pt | null> = {};
        let isDomestic = false;

        if (hasAmapKey && destination) {
          // 先定城市中心（轻请求）→ 判国内与否，再决定 POI 编码走哪条路
          const base = await postGeocode({ destination, origin: meta.origin ?? "", queries: [] });
          centerPt = base.center;
          originPt = base.originPoint;
          isDomestic = !!centerPt && isInChina(centerPt.lat, centerPt.lon);
          if (isDomestic) {
            const cGcj = centerPt
              ? wgs84ToGcj02(centerPt.lat, centerPt.lon)
              : null;
            points = await amapGeocodePois(destination, uniq, cGcj);
            // 高德查不到的少数条目回落 OSM 系（已收紧的距离过滤兜底）
            const misses = uniq.filter((q) => !points[q]);
            if (misses.length) {
              const fb = await postGeocode({ destination, origin: "", queries: misses });
              for (const q of misses) points[q] = fb.points[q] ?? null;
            }
          } else {
            const fb = await postGeocode({ destination, origin: meta.origin ?? "", queries: uniq });
            points = fb.points;
          }
        } else {
          const fb = await postGeocode({ destination, origin: meta.origin ?? "", queries: uniq });
          centerPt = fb.center;
          originPt = fb.originPoint;
          points = fb.points;
          isDomestic = !!centerPt && isInChina(centerPt.lat, centerPt.lon);
        }
        if (!alive) return;

        const list: Resolved[] = [];
        let step = 0;
        days.forEach((d, di) =>
          d.items.forEach((it, ii) => {
            if (!mappable(it)) return;
            const pt = points[it.title.trim()];
            if (!pt) return; // 查不到坐标 → 不在图上虚构
            step += 1;
            list.push({
              key: `${di}-${ii}`,
              day: d.day,
              date: d.date,
              theme: d.theme,
              time: it.time,
              title: it.title,
              kind: it.kind,
              detail: it.detail,
              est_cost: it.est_cost,
              pt,
              step,
            });
          }),
        );
        // 建议点：过滤掉已在行程里的（避免重复针脚）与查不到坐标的
        const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
        const itinTitles = new Set(list.map((r) => norm(r.title)));
        const seenSpot = new Set<string>();
        const spotList: ResolvedSpot[] = [];
        spots.forEach((sp) => {
          const title = sp.title?.trim();
          if (!title) return;
          const n = norm(title);
          if (itinTitles.has(n) || seenSpot.has(n)) return;
          const pt = points[title];
          if (!pt) return; // 查不到坐标 → 不虚构落点
          seenSpot.add(n);
          spotList.push({
            title,
            kind: sp.kind,
            reason: sp.reason,
            source_url: sp.source_url,
            pt,
          });
        });

        setCenter(centerPt);
        setOrigin(originPt);
        setResolved(list);
        setResolvedSpots(spotList);
        setDomestic(isDomestic);
        // 坐标上交给页面（条目间路程耗时估算用）——统一还原成 WGS-84
        if (onResolved) {
          const coords: Record<string, { lat: number; lon: number }> = {};
          for (const r of list) coords[r.key] = toWgs(r.pt);
          onResolved(coords);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // ── 引擎选择：国内 + 有 key + 未确认失败 → 高德；用户手动偏好优先 ──
  const amapEligible = domestic === true && hasAmapKey && !amapBrokenSession;
  const engine: "amap" | "leaflet" | null =
    domestic === null ? null : amapEligible && enginePref !== "leaflet" ? "amap" : "leaflet";

  function setPref(v: "amap" | "leaflet") {
    try {
      window.localStorage.setItem("trip-map-engine", v);
    } catch {
      /* 隐私模式等场景忽略 */
    }
    setEnginePref(v);
  }

  const dayNumbers = useMemo(
    () => Array.from(new Set(resolved.map((r) => r.day))).sort((a, b) => a - b),
    [resolved],
  );
  const mappedCount = resolved.length;
  const totalPlaces = useMemo(
    () => days.reduce((n, d) => n + d.items.filter(mappable).length, 0),
    [days],
  );

  const engineProps = {
    resolved,
    resolvedSpots,
    showSpots,
    origin,
    center,
    meta,
    selectedDay,
    hoverKey,
    onHoverKey,
    spot,
    spotClearSeq,
    onLocateItem,
    onAddSpot,
  };

  return (
    <section className={fill ? "flex h-full flex-col" : "mt-6"}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-lg font-semibold text-ink">
          <MapIcon className="h-4.5 w-4.5 text-teal-dark" aria-hidden />
          <span>行程地图</span>
          {!loading && (
            <span className="font-data text-xs font-normal text-muted">
              {mappedCount}/{totalPlaces} 个地点已定位
            </span>
          )}
        </h2>
      </div>

      {/* 图例 / 按天聚焦 */}
      {dayNumbers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setSpotClearSeq((n) => n + 1);
              setSelectedDay(null);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition cursor-pointer ${
              selectedDay === null
                ? "border-ink bg-ink text-white"
                : "border-line text-muted hover:border-line-strong"
            }`}
          >
            全程
          </button>
          {dayNumbers.map((d) => {
            const active = selectedDay === d;
            const c = colorOf(d);
            return (
              <button
                key={d}
                onClick={() => {
                  setSpotClearSeq((n) => n + 1);
                  setSelectedDay(active ? null : d);
                }}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  active
                    ? "text-white"
                    : "border-line text-muted hover:border-line-strong"
                }`}
                style={active ? { background: c, borderColor: c } : undefined}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: active ? "#fff" : c }}
                />
                第 {d} 天
              </button>
            );
          })}
        </div>
      )}

      {/* 网友推荐建议层开关 */}
      {resolvedSpots.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowSpots((v) => !v)}
            aria-pressed={showSpots}
            title="来自「网友攻略」的推荐点（虚线圈表示还没加入）"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition cursor-pointer ${
              showSpots
                ? "border-teal bg-teal-tint text-teal-dark"
                : "border-line text-muted hover:border-line-strong"
            }`}
          >
            <span aria-hidden>💡</span>
            网友推荐 {resolvedSpots.length} 处
            <span className="text-[10px] text-muted/70">
              {showSpots ? "显示中" : "已隐藏"}
            </span>
          </button>
        </div>
      )}

      {/* 地图容器 */}
      <div
        className={`relative mt-3 overflow-hidden rounded-card border border-line shadow-soft ${
          fill ? "min-h-0 flex-1" : ""
        }`}
      >
        <div className={`w-full bg-neutral-100 ${fill ? "h-full min-h-[320px]" : "h-[460px]"}`}>
          {engine === "amap" && (
            <TripMapAMap
              {...engineProps}
              onFallback={() => {
                amapBrokenSession = true;
                setBrokenTick((n) => n + 1);
              }}
            />
          )}
          {engine === "leaflet" && <TripMapLeaflet {...engineProps} />}
        </div>

        {/* 引擎手动切换（也是高德空白 canvas 等「检测不出的失败」的逃生门） */}
        {engine === "amap" && (
          <button
            type="button"
            onClick={() => setPref("leaflet")}
            className="absolute bottom-3 right-3 z-10 rounded-full border border-line bg-white/90 px-2.5 py-1 text-[11px] text-muted shadow-soft backdrop-blur-sm hover:border-line-strong hover:text-ink"
            title="地图显示不正常？切换到备用底图"
          >
            备用地图
          </button>
        )}
        {engine === "leaflet" && amapEligible && (
          <button
            type="button"
            onClick={() => setPref("amap")}
            className="absolute bottom-3 right-3 z-10 rounded-full border border-line bg-white/90 px-2.5 py-1 text-[11px] text-muted shadow-soft backdrop-blur-sm hover:border-line-strong hover:text-ink"
            title="切换为高德地图引擎"
          >
            高德地图
          </button>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-teal" />
              正在定位行程地点…
            </div>
          </div>
        )}

        {!loading && err && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center text-sm text-seal">
            {err}
          </div>
        )}

        {!loading && !err && mappedCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center text-sm text-muted">
            暂无可定位的地点（行程里的地点名可能太宽泛，编辑得更具体后会自动出现在地图上）。
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted/80">
        点击标记看详情；点上方「第 N 天」聚焦当天动线。地图随行程编辑自动更新。
      </p>
    </section>
  );
}
