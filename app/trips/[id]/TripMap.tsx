"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

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

/** 按天分配的高辨识度配色 */
const DAY_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6",
];
const colorOf = (day: number) => DAY_COLORS[(day - 1 + DAY_COLORS.length) % DAY_COLORS.length];

const KIND_ICON: Record<string, string> = {
  activity: "📍",
  food: "🍽️",
  rest: "🏨",
  transit: "🚄",
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

export default function TripMap({ days, meta }: { days: Day[]; meta: Meta }) {
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

    const focused = selectedDay; // null = 全部
    const allLatLng: [number, number][] = [];
    const focusLatLng: [number, number][] = [];

    const pin = (
      color: string,
      label: string,
      dim: boolean,
      size = 30,
    ) =>
      L.divIcon({
        className: "",
        html: `<div class="tp-pin${dim ? " tp-dim" : ""}" style="--c:${color}"><div class="tp-pin-inner"><span>${label}</span></div></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size - 2],
        popupAnchor: [0, -size + 4],
      });

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
        });
        m.bindPopup(
          `<div class="tp-pop">
             <div class="tp-pop-h" style="color:${color}">第 ${r.day} 天 · 第 ${r.step} 站</div>
             <div class="tp-pop-t">${KIND_ICON[r.kind] ?? "📍"} ${esc(r.title)}</div>
             ${r.time ? `<div class="tp-pop-time">🕑 ${esc(r.time)}</div>` : ""}
             ${r.detail ? `<div class="tp-pop-d">${esc(r.detail)}</div>` : ""}
             ${r.est_cost ? `<div class="tp-pop-c">约 ¥${r.est_cost}</div>` : ""}
           </div>`,
          { className: "tp-pop-wrap" },
        );
        m.addTo(group);
        allLatLng.push([r.pt.lat, r.pt.lon]);
        if (focused === day) focusLatLng.push([r.pt.lat, r.pt.lon]);
      });
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
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span>🗺️ 行程地图</span>
          {!loading && (
            <span className="text-xs font-normal text-neutral-400">
              {mappedCount}/{totalPlaces} 个地点已定位
            </span>
          )}
        </h2>
      </div>

      {/* 图例 / 按天聚焦 */}
      {dayNumbers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedDay(null)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              selectedDay === null
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
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
                onClick={() => setSelectedDay(active ? null : d)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "text-white"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
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
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-neutral-200 shadow-sm">
        <div ref={mapEl} className="h-[460px] w-full bg-neutral-100" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
              正在定位行程地点…
            </div>
          </div>
        )}

        {!loading && err && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center text-sm text-red-600">
            {err}
          </div>
        )}

        {!loading && !err && mappedCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center text-sm text-neutral-500">
            暂无可定位的地点（行程里的地点名可能太宽泛，编辑得更具体后会自动出现在地图上）。
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-400">
        点击标记看详情；点上方「第 N 天」聚焦当天动线。地图随行程编辑自动更新。
      </p>
    </section>
  );
}
