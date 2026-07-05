"use client";

/**
 * 落地页演示地图 · Leaflet 2D 降级实现（未配置高德 key 时启用）。
 * 高德 webrd 中文栅格瓦片（全缩放级恒中文）+ GCJ-02 加偏；针脚按「类别」着色、
 * 内嵌类别图标；切天 flyToBounds；列表 ↔ 针脚双向 hover 联动。
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { dayColorOf } from "@/lib/palette";
import { wgs84ToGcj02 } from "@/lib/gcj02";
import { DAYS, KIND_HEX, iconSvg } from "@/app/showcase-data";

interface Props {
  dayIdx: number;
  hover: number | null;
  onHover: (i: number | null) => void;
  reduced: boolean;
}

export default function ShowcaseMapLeaflet({ dayIdx, hover, onHover, reduced }: Props) {
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
      const map = L.map(mapEl.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView(wgs84ToGcj02(31.318, 120.62), 12);
      map.attributionControl.setPrefix(false);
      // scl=1 返回带中文注记的栅格瓦片（区县/街道/POI 名称）；scl=2 是纯路网无注记，
      // 会让人「迷失方向」。style=7 为标准电子地图（注记比路网图 style=8 更全）。
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

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    markersRef.current = [];

    const cur = DAYS[dayIdx];
    const routeColor = dayColorOf(cur.day);
    const latlngs = cur.stops.map((s) => wgs84ToGcj02(s.lat, s.lon));

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
        html: `<div class="tp-pin tp-drop" style="--c:${c};animation-delay:${140 + i * 90}ms"><div class="tp-pin-inner"><span class="tp-ico">${iconSvg(s.kind)}</span></div></div><span class="sc-lflabel">${s.short}</span>`,
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
  }, [ready, dayIdx, reduced, onHover]);

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.getElement()?.classList.toggle("sc-lfmarker-hot", i === hover);
    });
  }, [hover]);

  return <div ref={mapEl} className="sc-map absolute inset-0 z-0" />;
}
