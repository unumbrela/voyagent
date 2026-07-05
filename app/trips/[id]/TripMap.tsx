"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { dayColorOf } from "@/lib/palette";
import { Map as MapIcon } from "@/app/ui/icons";

/** 与 page.tsx 对齐的最小类型 */
interface Item {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
}
interface Day {
  day: number;
  date: string;
  theme: string;
  items: Item[];
}
interface Meta {
  destination: string | null;
  origin: string | null;
  start_date: string | null;
  end_date: string | null;
}
interface Pt {
  lat: number;
  lon: number;
  label: string;
}

// 按天配色：全站统一取自 lib/palette（与编号针/分享页/预算图一致）
const colorOf = dayColorOf;

/** 类别 → 弹窗里的中文标签（配类别色圆点，替代 emoji） */
const KIND_LABEL: Record<string, string> = {
  activity: "活动",
  food: "餐饮",
  rest: "住宿",
  transit: "交通",
};
const KIND_COLOR: Record<string, string> = {
  activity: "var(--c-activity)",
  food: "var(--c-food)",
  rest: "var(--c-rest)",
  transit: "var(--c-transit)",
};

/** 哪些条目值得落到地图上（有具体地点的）。本地交通/纯休息标题太泛，靠 geocode 结果自然过滤。 */
function mappable(it: Item): boolean {
  if (!it.title?.trim()) return false;
  if (it.kind === "transit") return false; // 城际交通端点已由活动覆盖，避免连线穿城
  return true;
}

interface Resolved {
  key: string; // di-ii
  day: number;
  date: string;
  theme: string;
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  pt: Pt;
  step: number; // 全局顺序编号
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
  /** 触屏定位：设置后 flyTo 该条目针脚并打开弹窗（每次点按传新对象以重复触发） */
  spot?: { key: string } | null;
  /** 弹窗里「在行程中查看」被点时回传条目 key（页面滚回对应条目） */
  onLocateItem?: (key: string) => void;
}) {
  // 用「标题序列」作为签名：只有地点真正变化才重新 geocode（编辑时间/花费不触发）
  const signature = useMemo(
    () =>
      JSON.stringify({
        d: meta.destination,
        o: meta.origin,
        t: days.map((d) => d.items.map((i) => (mappable(i) ? i.title : ""))),
      }),
    [days, meta.destination, meta.origin],
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [center, setCenter] = useState<Pt | null>(null);
  const [origin, setOrigin] = useState<Pt | null>(null);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // 滚动联动：页面滚到哪天，地图聚焦哪天（手动点天数 chip 仍即时生效，
  // 继续滚动后由 scrollspy 重新接管——行为可预期）。
  // 「prop 变化时调整 state」按官方模式在渲染期间完成，不进 effect。
  const [lastSyncDay, setLastSyncDay] = useState(syncDay);
  if (syncDay !== lastSyncDay) {
    setLastSyncDay(syncDay);
    if (syncDay !== undefined) setSelectedDay(syncDay);
  }

  // 回调用 ref 持有：marker 事件只绑一次，不随回调身份变化重建
  const onHoverKeyRef = useRef(onHoverKey);
  const onLocateItemRef = useRef(onLocateItem);
  useEffect(() => {
    onHoverKeyRef.current = onHoverKey;
    onLocateItemRef.current = onLocateItem;
  });
  // 最近一次触屏定位（5s 窗口）：定位引发的页面滚动会让 syncDay 变化触发重绘，
  // 重绘销毁旧针脚并 fitBounds 复位——重绘结束后据此补聚焦，保证定位不被打断
  const spotRef = useRef<{ key: string; ts: number } | null>(null);

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
        const res = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: meta.destination ?? "",
            origin: meta.origin ?? "",
            queries,
          }),
        });
        const data = (await res.json()) as {
          center: Pt | null;
          originPoint: Pt | null;
          points: Record<string, Pt | null>;
        };
        if (!res.ok) throw new Error((data as unknown as { error?: string }).error || "地点解析失败");
        if (!alive) return;

        const list: Resolved[] = [];
        let step = 0;
        days.forEach((d, di) =>
          d.items.forEach((it, ii) => {
            if (!mappable(it)) return;
            const pt = data.points[it.title.trim()];
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
        setCenter(data.center);
        setOrigin(data.originPoint);
        setResolved(list);
        // 坐标上交给页面（条目间路程耗时估算用）
        if (onResolved) {
          const coords: Record<string, { lat: number; lon: number }> = {};
          for (const r of list) coords[r.key] = { lat: r.pt.lat, lon: r.pt.lon };
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

  // ── Leaflet 实例（只建一次） ──
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  // 条目 key → marker：hover 联动用（重绘时重建）
  const markerByKey = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current, {
        zoomControl: true,
        scrollWheelZoom: false, // 避免页面滚动时误缩放；按 + / 拖拽缩放
        attributionControl: true,
      }).setView([35.68, 139.76], 11);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
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

  // ── 重绘标记 / 路线（数据或选中天变化时） ──
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    markerByKey.current.clear();

    const focused = selectedDay; // null = 全部
    const allLatLng: [number, number][] = [];
    const focusLatLng: [number, number][] = [];

    // 掉落进场（与落地页演示一致）：按落图顺序错峰，reduced-motion 由全局 CSS 钳制
    let dropIdx = 0;
    const pin = (
      color: string,
      label: string,
      dim: boolean,
      size = 30,
    ) => {
      const delay = Math.min(dropIdx++ * 60, 720);
      return L.divIcon({
        className: "",
        html: `<div class="tp-pin tp-drop${dim ? " tp-dim" : ""}" style="--c:${color};animation-delay:${delay}ms"><div class="tp-pin-inner"><span>${label}</span></div></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size - 2],
        popupAnchor: [0, -size + 4],
      });
    };

    const esc = (s: string) =>
      (s ?? "").replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
      );

    // 出发地
    if (origin) {
      const dim = focused !== null;
      L.marker([origin.lat, origin.lon], {
        icon: pin("#0f172a", "起", dim, 34),
        zIndexOffset: 1000,
      })
        .bindPopup(
          `<div class="tp-pop"><div class="tp-pop-h">出发地</div><div class="tp-pop-t">${esc(meta.origin ?? origin.label)}</div></div>`,
        )
        .addTo(group);
      allLatLng.push([origin.lat, origin.lon]);
    }

    // 按天分组连线
    const byDay = new Map<number, Resolved[]>();
    resolved.forEach((r) => {
      if (!byDay.has(r.day)) byDay.set(r.day, []);
      byDay.get(r.day)!.push(r);
    });

    for (const [day, items] of byDay) {
      const color = colorOf(day);
      const dim = focused !== null && focused !== day;
      const latlngs = items.map((r) => [r.pt.lat, r.pt.lon] as [number, number]);

      // 当天动线
      if (latlngs.length > 1) {
        L.polyline(latlngs, {
          color,
          weight: 3,
          opacity: dim ? 0.12 : 0.7,
          className: dim ? "" : "tp-route",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group);
      }

      items.forEach((r) => {
        const m: Marker = L.marker([r.pt.lat, r.pt.lon], {
          icon: pin(color, String(r.step), dim),
          zIndexOffset: dim ? 0 : 500,
          riseOnHover: true,
        });
        const kindDot = `<span style="display:inline-block;width:7px;height:7px;border-radius:99px;background:${KIND_COLOR[r.kind] ?? "var(--c-other)"};margin-right:5px;vertical-align:1px"></span>`;
        m.bindPopup(
          `<div class="tp-pop">
             <div class="tp-pop-h" style="color:${color}">第 ${r.day} 天 · 第 ${r.step} 站 · ${KIND_LABEL[r.kind] ?? "地点"}</div>
             <div class="tp-pop-t">${kindDot}${esc(r.title)}</div>
             ${r.time ? `<div class="tp-pop-time">${esc(r.time)}</div>` : ""}
             ${r.detail ? `<div class="tp-pop-d">${esc(r.detail)}</div>` : ""}
             ${r.est_cost ? `<div class="tp-pop-c">约 ¥${r.est_cost}</div>` : ""}
             <button type="button" class="tp-pop-go">在行程中查看 ↓</button>
           </div>`,
          { className: "tp-pop-wrap" },
        );
        // 弹窗「在行程中查看」→ 页面滚回该条目（触屏的针脚→列表反向联动）
        m.on("popupopen", () => {
          m.getPopup()
            ?.getElement()
            ?.querySelector(".tp-pop-go")
            ?.addEventListener(
              "click",
              () => onLocateItemRef.current?.(r.key),
              { once: true },
            );
        });
        // 悬停轻提示 + 双向联动（点击仍是详情弹窗）；direction auto 避免贴边裁切
        m.bindTooltip(`${r.time ? `${esc(r.time)} · ` : ""}${esc(r.title)}`, {
          direction: "auto",
          className: "tp-tip",
        });
        m.on("mouseover", () => onHoverKeyRef.current?.(r.key));
        m.on("mouseout", () => onHoverKeyRef.current?.(null));
        m.addTo(group);
        markerByKey.current.set(r.key, m);
        allLatLng.push([r.pt.lat, r.pt.lon]);
        if (focused === day) focusLatLng.push([r.pt.lat, r.pt.lon]);
      });
    }

    // 触屏定位窗口期内：跳过视图自适应，改为聚焦目标针脚并开弹窗
    const sp = spotRef.current;
    const spotMarker =
      sp && Date.now() - sp.ts < 5000 ? markerByKey.current.get(sp.key) : null;
    if (spotMarker) {
      map.setView(spotMarker.getLatLng(), Math.max(map.getZoom(), 15), {
        animate: true,
      });
      window.setTimeout(() => spotMarker.openPopup(), 350);
      return;
    }

    // 视图自适应
    const fitTarget = focused !== null && focusLatLng.length ? focusLatLng : allLatLng;
    if (fitTarget.length === 1) {
      map.setView(fitTarget[0], 14, { animate: true });
    } else if (fitTarget.length > 1) {
      map.fitBounds(fitTarget, { padding: [48, 48], maxZoom: 15, animate: true });
    } else if (center) {
      map.setView([center.lat, center.lon], 11);
    }
  }, [ready, resolved, origin, center, selectedDay, meta.origin]);

  // ── 列表行 hover → 对应针脚放大 + 轻提示（反向由 marker mouseover 回传 onHoverKey）──
  useEffect(() => {
    for (const [key, m] of markerByKey.current) {
      const el = m.getElement()?.querySelector(".tp-pin");
      if (!el) continue;
      el.classList.toggle("tp-hot", key === hoverKey);
      if (key === hoverKey) m.openTooltip();
      else m.closeTooltip();
    }
    // resolved/selectedDay 变化会重建 marker，需重放当前 hover 态
  }, [hoverKey, resolved, selectedDay]);

  // ── 触屏定位：flyTo 目标针脚并打开弹窗（spot 每次是新对象，可重复触发同一条目）──
  useEffect(() => {
    if (!spot) return;
    spotRef.current = { key: spot.key, ts: Date.now() };
    const m = markerByKey.current.get(spot.key);
    const map = mapRef.current;
    if (!m || !map) return;
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.8 });
    const t = window.setTimeout(() => m.openPopup(), 850);
    return () => window.clearTimeout(t);
  }, [spot]);

  const dayNumbers = useMemo(
    () => Array.from(new Set(resolved.map((r) => r.day))).sort((a, b) => a - b),
    [resolved],
  );
  const mappedCount = resolved.length;
  const totalPlaces = useMemo(
    () => days.reduce((n, d) => n + d.items.filter(mappable).length, 0),
    [days],
  );

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
              spotRef.current = null;
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
                  spotRef.current = null;
                  setSelectedDay(active ? null : d);
                }}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  active
                    ? "text-white"
                    : "border-line text-muted hover:border-line-strong"
                }`}
                style={
                  active
                    ? { background: c, borderColor: c }
                    : undefined
                }
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

      {/* 地图容器 */}
      <div
        className={`relative mt-3 overflow-hidden rounded-card border border-line shadow-soft ${
          fill ? "min-h-0 flex-1" : ""
        }`}
      >
        <div
          ref={mapEl}
          className={`w-full bg-neutral-100 ${fill ? "h-full min-h-[320px]" : "h-[460px]"}`}
        />

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
