"use client";

/**
 * 行程地图 · Leaflet 2D 引擎——与首页展示带（ShowcaseMapLeaflet）同一套视觉：
 *  - 国内 tiles="amap"：高德中文栅格瓦片 + GCJ-02 加偏落点（观感即高德 2D 图）；
 *  - 出境 tiles="osm"：CARTO Voyager（OSM 数据 + 全球 CDN）+ 原始 WGS-84；
 *  - 针脚：类别色水滴 + 当天序号 + 常驻名称标签（.sc-lfmarker / .sc-lflabel）；
 *  - 路线：白描边打底 + 按天配色流动虚线；
 *  - 缩放：原生滚轮/双击 + shell 的首页同款 +/- 覆盖控件（onZoomApi 登记）。
 * 坐标解析由 shell（TripMap.tsx）完成，这里只管画：针脚/动线/弹窗/联动。
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker, TileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  colorOf,
  esc,
  itemPopupHtml,
  kindHex,
  labeledPinHtml,
  shortName,
  spotIconHtml,
  spotPopupHtml,
  toGcj,
  toWgs,
  SPOT_FOCUS_WINDOW_MS,
  type EngineProps,
  type Pt,
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
  tiles = "amap",
  onZoomApi,
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
  const onZoomApiRef = useRef(onZoomApi);
  useEffect(() => {
    onHoverKeyRef.current = onHoverKey;
    onLocateItemRef.current = onLocateItem;
    onAddSpotRef.current = onAddSpot;
    onZoomApiRef.current = onZoomApi;
  });

  // 落点投影随底图走：高德瓦片要 GCJ-02 加偏，CARTO（OSM 系）用原始 WGS-84
  const project = (pt: Pt): [number, number] => {
    if (tiles === "osm") {
      const w = toWgs(pt);
      return [w.lat, w.lon];
    }
    return toGcj(pt);
  };

  // ── Leaflet 实例（只建一次；瓦片层随 tiles 判定切换） ──
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
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
        // 与首页展示地图一致：无原生缩放控件（shell 出 +/- 覆盖控件）、
        // 滚轮/双击/拖拽全开放
        zoomControl: false,
        scrollWheelZoom: true,
        attributionControl: true,
      }).setView([35.68, 139.76], 11);
      map.attributionControl.setPrefix(false);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      onZoomApiRef.current?.({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
      });
      setReady(true);
    })();
    return () => {
      disposed = true;
      onZoomApiRef.current?.(null);
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
      setReady(false);
    };
  }, []);

  // ── 瓦片层（tiles 由 shell 在国内判定后传入，可能从默认 amap 切到 osm）──
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    tileRef.current?.remove();
    tileRef.current = (
      tiles === "osm"
        ? // 出境底图：CARTO Voyager（与首页出境 demo 同款；osm.org 官方瓦片慢且限流）
          L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
            {
              subdomains: "abcd",
              maxZoom: 20,
              className: "sc-tiles",
              attribution: "&copy; OpenStreetMap &copy; CARTO",
            },
          )
        : // 国内底图：高德中文瓦片（scl=1=含区县/街道/POI 中文注记，style=7 标准电子图），
          // GCJ-02 加偏坐标 → 所有落点须经 project() 换算，否则针脚偏移
          L.tileLayer(
            "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
            {
              subdomains: "1234",
              maxZoom: 18,
              className: "sc-tiles",
              attribution: '&copy; <a href="https://amap.com">高德地图</a>',
            },
          )
    ).addTo(map);
  }, [ready, tiles]);

  // ── 重绘标记 / 路线（数据、选中天或底图变化时） ──
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

    // 掉落进场（与首页演示一致）：按落图顺序错峰，reduced-motion 由全局 CSS 钳制
    let dropIdx = 0;
    const nextDelay = () => Math.min(dropIdx++ * 60, 720);

    // 首页同款针脚：类别色 + 当天序号 + 常驻名称标签；dim 由 .sc-lfdim 整体淡出
    const labeledIcon = (color: string, num: string, name: string, dim: boolean) =>
      L.divIcon({
        className: `sc-lfmarker${dim ? " sc-lfdim" : ""}`,
        html: labeledPinHtml(color, num, name, nextDelay()),
        iconSize: [34, 34],
        iconAnchor: [17, 32],
        popupAnchor: [0, -30],
      });

    // 出发地
    if (origin) {
      const o = project(origin);
      L.marker(o, {
        icon: labeledIcon("#0f172a", "起", shortName(meta.origin ?? origin.label), focused !== null),
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
      const dayColor = colorOf(day);
      const dim = focused !== null && focused !== day;
      const latlngs = items.map((r) => project(r.pt));

      // 当天动线：白描边打底 + 按天配色流动虚线（首页同款）
      if (latlngs.length > 1) {
        if (!dim) {
          L.polyline(latlngs, {
            color: "#fff",
            weight: 7,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(group);
        }
        L.polyline(latlngs, {
          color: dayColor,
          weight: 3,
          opacity: dim ? 0.12 : 0.85,
          className: dim ? "" : "tp-route",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group);
      }

      items.forEach((r, idx) => {
        const pos = latlngs[idx];
        const m: Marker = L.marker(pos, {
          icon: labeledIcon(kindHex(r.kind), String(r.step), shortName(r.title), dim),
          zIndexOffset: dim ? 0 : 500,
          riseOnHover: true,
        });
        m.bindPopup(itemPopupHtml(r, dayColor), { className: "tp-pop-wrap" });
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
        // 名称标签常驻，无需 tooltip；hover 双向联动（点击仍是详情弹窗）
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
        const pos = project(s.pt);
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
      map.setView(project(center), 11);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    tiles,
    resolved,
    resolvedSpots,
    showSpots,
    origin,
    center,
    selectedDay,
    meta.origin,
  ]);

  // ── 列表行 hover → 对应针脚放大 + 标签点亮（反向由 marker mouseover 回传 onHoverKey）──
  useEffect(() => {
    for (const [key, m] of markerByKey.current) {
      m.getElement()?.classList.toggle("sc-lfmarker-hot", key === hoverKey);
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
