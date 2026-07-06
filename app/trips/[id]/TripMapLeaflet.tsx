"use client";

/**
 * 行程地图 · Leaflet 2D 引擎（高德中文栅格瓦片）。
 * 出境行程的默认引擎；也是国内行程在高德 JSAPI 不可用时的保底。
 * 坐标解析由 shell（TripMap.tsx）完成，这里只管画：针脚/动线/弹窗/联动。
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  colorOf,
  esc,
  itemPopupHtml,
  pinHtml,
  spotIconHtml,
  spotPopupHtml,
  toGcj,
  SPOT_FOCUS_WINDOW_MS,
  type EngineProps,
  type Resolved,
  type SpotFocus,
} from "./map-core";

export default function TripMapLeaflet({
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
}: EngineProps) {
  // 回调用 ref 持有：marker 事件只绑一次，不随回调身份变化重建
  const onHoverKeyRef = useRef(onHoverKey);
  const onLocateItemRef = useRef(onLocateItem);
  const onAddSpotRef = useRef(onAddSpot);
  useEffect(() => {
    onHoverKeyRef.current = onHoverKey;
    onLocateItemRef.current = onLocateItem;
    onAddSpotRef.current = onAddSpot;
  });

  // ── Leaflet 实例（只建一次） ──
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  // 条目 key → marker：hover/定位联动用（重绘时重建）
  const markerByKey = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);
  // 最近一次触屏定位（5s 窗口）：定位引发的页面滚动会让 selectedDay 变化触发重绘，
  // 重绘销毁旧针脚并 fitBounds 复位——重绘结束后据此补聚焦，保证定位不被打断
  const spotRef = useRef<SpotFocus | null>(null);
  useEffect(() => {
    spotRef.current = null; // 天数 chip 被点：清除定位窗口，让按天取景立即生效
  }, [spotClearSeq]);

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
      // 与首页展示地图一致：高德中文瓦片（scl=1=含区县/街道/POI 中文注记，style=7 标准电子图）。
      // 高德是 GCJ-02 加偏坐标 → 所有落点须经 toGcj() 换算，否则针脚偏移。.sc-tiles 降饱和到暖纸调。
      L.tileLayer(
        "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
        {
          subdomains: "1234",
          maxZoom: 18,
          className: "sc-tiles",
          attribution: '&copy; <a href="https://amap.com">高德地图</a>',
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
    const pin = (color: string, label: string, dim: boolean, size = 30) => {
      const delay = Math.min(dropIdx++ * 60, 720);
      return L.divIcon({
        className: "",
        html: pinHtml(color, label, dim, delay),
        iconSize: [size, size],
        iconAnchor: [size / 2, size - 2],
        popupAnchor: [0, -size + 4],
      });
    };

    // 出发地
    if (origin) {
      const dim = focused !== null;
      const o = toGcj(origin);
      L.marker(o, {
        icon: pin("#0f172a", "起", dim, 34),
        zIndexOffset: 1000,
      })
        .bindPopup(
          `<div class="tp-pop"><div class="tp-pop-h">出发地</div><div class="tp-pop-t">${esc(meta.origin ?? origin.label)}</div></div>`,
        )
        .addTo(group);
      allLatLng.push(o);
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
      const latlngs = items.map((r) => toGcj(r.pt));

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

      items.forEach((r, idx) => {
        const pos = latlngs[idx];
        const m: Marker = L.marker(pos, {
          icon: pin(color, String(r.step), dim),
          zIndexOffset: dim ? 0 : 500,
          riseOnHover: true,
        });
        m.bindPopup(itemPopupHtml(r, color), { className: "tp-pop-wrap" });
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
        allLatLng.push(pos);
        if (focused === day) focusLatLng.push(pos);
      });
    }

    // ── 网友推荐建议层（独立样式：虚线圈 + emoji，标识"未加入"）──
    if (showSpots && resolvedSpots.length) {
      resolvedSpots.forEach((s) => {
        const icon = L.divIcon({
          className: "",
          html: spotIconHtml(s.kind),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -12],
        });
        const pos = toGcj(s.pt);
        const m: Marker = L.marker(pos, {
          icon,
          zIndexOffset: 200,
          riseOnHover: true,
        });
        m.bindPopup(spotPopupHtml(s), { className: "tp-pop-wrap" });
        m.on("popupopen", () => {
          m.getPopup()
            ?.getElement()
            ?.querySelector(".tp-pop-go")
            ?.addEventListener(
              "click",
              () => {
                onAddSpotRef.current?.({
                  title: s.title,
                  kind: s.kind,
                  reason: s.reason,
                  source_url: s.source_url,
                });
                m.closePopup();
              },
              { once: true },
            );
        });
        m.bindTooltip(`💡 ${esc(s.title)}`, {
          direction: "auto",
          className: "tp-tip",
        });
        m.addTo(group);
        // 仅在「全程」视图把建议点纳入自适应，避免按天聚焦时被拉远
        if (focused === null) allLatLng.push(pos);
      });
    }

    // 触屏定位窗口期内：跳过视图自适应，改为聚焦目标针脚并开弹窗
    const sp = spotRef.current;
    const spotMarker =
      sp && Date.now() - sp.ts < SPOT_FOCUS_WINDOW_MS
        ? markerByKey.current.get(sp.key)
        : null;
    if (spotMarker) {
      map.setView(spotMarker.getLatLng(), Math.max(map.getZoom(), 15), {
        animate: true,
      });
      window.setTimeout(() => spotMarker.openPopup(), 350);
      return;
    }

    // 视图自适应
    const fitTarget =
      focused !== null && focusLatLng.length ? focusLatLng : allLatLng;
    if (fitTarget.length === 1) {
      map.setView(fitTarget[0], 14, { animate: true });
    } else if (fitTarget.length > 1) {
      map.fitBounds(fitTarget, { padding: [48, 48], maxZoom: 15, animate: true });
    } else if (center) {
      map.setView(toGcj(center), 11);
    }
  }, [
    ready,
    resolved,
    resolvedSpots,
    showSpots,
    origin,
    center,
    selectedDay,
    meta.origin,
  ]);

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

  return <div ref={mapEl} className="h-full w-full bg-neutral-100" />;
}
