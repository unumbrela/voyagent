"use client";

/**
 * 演示地图 · Leaflet 2D 实现。首页展示带用它作高德 3D 的降级底层；
 * /demo/[slug] 完整演示页直接用它（不叠高德）。
 *
 * tiles="amap"：高德 webrd 中文栅格瓦片 + GCJ-02 加偏（国内目的地，注记全中文）。
 * tiles="osm"：海外底图（CARTO Voyager，OSM 数据 + 全球 CDN）+ 原始 WGS-84
 *   （出境目的地；高德海外注记稀疏，osm.org 官方瓦片又慢又限流，故走 CARTO）。
 * 针脚按「类别」着色并内嵌类别图标；切天 flyToBounds；列表 ↔ 针脚双向 hover 联动。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { dayColorOf } from "@/lib/palette";
import { wgs84ToGcj02 } from "@/lib/gcj02";
import { DAYS, KIND_HEX, type ShowDay } from "@/app/showcase-data";

interface Props {
  dayIdx: number;
  hover: number | null;
  onHover: (i: number | null) => void;
  reduced: boolean;
  /** 逐日行程（默认首页苏州 DAYS，向后兼容） */
  days?: ShowDay[];
  /** 底图/坐标模式：amap=高德+GCJ 加偏，osm=OSM+原始 WGS-84 */
  tiles?: "amap" | "osm";
  /** 就绪后向父组件登记缩放接口（供统一的 +/- 覆盖控件驱动），卸载时回传 null */
  onZoomApi?: (api: { zoomIn: () => void; zoomOut: () => void } | null) => void;
}

export default function ShowcaseMapLeaflet({
  dayIdx,
  hover,
  onHover,
  reduced,
  days = DAYS,
  tiles = "amap",
  onZoomApi,
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  // onZoomApi 每次渲染可能是新函数：存进 ref，避免进建图 effect 依赖导致重建
  const onZoomApiRef = useRef(onZoomApi);
  useEffect(() => {
    onZoomApiRef.current = onZoomApi;
  });

  // 坐标投影：amap 需 GCJ-02 加偏对齐高德瓦片；osm 用原始 WGS-84
  const project = useMemo(() => {
    return (lat: number, lon: number): [number, number] =>
      tiles === "amap" ? wgs84ToGcj02(lat, lon) : [lat, lon];
  }, [tiles]);

  // 初始中心：第一天首个停靠点（避免从苏州「飞」到冰岛）
  const initialCenter = useMemo<[number, number]>(() => {
    const s = days[0]?.stops[0];
    return s ? project(s.lat, s.lon) : [31.318, 120.62];
  }, [days, project]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current, {
        // 全交互开放：拖拽平移 / 滚轮 / 双击 / 双指 / 框选缩放。滚轮缩放由 Leaflet 原生处理，
        // 不依赖 React 覆盖控件也必然可用；+/- 按钮仍由 ShowcaseTrip 统一覆盖控件驱动。
        zoomControl: false,
        scrollWheelZoom: true,
      }).setView(initialCenter, 11);
      map.attributionControl.setPrefix(false);
      if (tiles === "osm") {
        // 海外底图：CARTO Voyager（OSM 数据 + 全球 CDN，比 osm.org 官方瓦片快得多、
        // 且不受其防滥用限流；暖调注记与本站风格更搭）。{r} 供 detectRetina 时取 @2x。
        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          {
            subdomains: "abcd",
            maxZoom: 20,
            className: "sc-tiles",
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
        ).addTo(map);
      } else {
        // 高德 webrd 带中文注记（scl=1 有区县/街道/POI 名；style=7 标准电子地图）
        L.tileLayer(
          "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
          {
            subdomains: "1234",
            maxZoom: 18,
            className: "sc-tiles",
            attribution: '&copy; <a href="https://amap.com">高德地图</a>',
          },
        ).addTo(map);
      }
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      // 向父组件登记缩放接口，供统一 +/- 覆盖控件调用
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
      setReady(false);
    };
    // tiles/初始中心在挂载时固定；切换 demo 会整页重挂载，无需响应式重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    markersRef.current = [];

    const cur = days[dayIdx];
    if (!cur) return;
    const routeColor = dayColorOf(cur.day);
    const latlngs = cur.stops.map((s) => project(s.lat, s.lon));

    L.polyline(latlngs, {
      color: "#fff",
      weight: 7,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(group);
    L.polyline(latlngs, {
      color: routeColor,
      weight: 3,
      opacity: 0.85,
      className: "tp-route",
      lineCap: "round",
      lineJoin: "round",
    }).addTo(group);

    cur.stops.forEach((s, i) => {
      const c = KIND_HEX[s.kind];
      const icon = L.divIcon({
        className: "sc-lfmarker",
        html: `<div class="tp-pin tp-drop" style="--c:${c};animation-delay:${140 + i * 90}ms"><div class="tp-pin-inner"><span>${i + 1}</span></div></div><span class="sc-lflabel">${s.short}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 32],
        tooltipAnchor: [0, -30],
      });
      const m = L.marker(latlngs[i], { icon, zIndexOffset: i * 10, riseOnHover: true });
      m.on("mouseover", () => onHover(i));
      m.on("mouseout", () => onHover(null));
      m.addTo(group);
      markersRef.current.push(m);
    });

    const bounds = L.latLngBounds(latlngs);
    if (reduced) {
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 14, animate: false });
    } else {
      map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 14, duration: 1.1 });
    }
  }, [ready, dayIdx, reduced, onHover, days, project]);

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.getElement()?.classList.toggle("sc-lfmarker-hot", i === hover);
    });
  }, [hover]);

  return <div ref={mapEl} className="sc-map absolute inset-0 z-0" />;
}
