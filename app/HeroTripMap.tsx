"use client";

/**
 * Hero 专属真地图 · Leaflet 2D + 高德中文栅格瓦片（GCJ-02 加偏）。
 *
 * 与中间展示带同源的「真地图 + 真实路径」，但为 Hero 的 3D 悬浮窗口特调：
 *   · 只开 +/- 缩放按钮，关掉拖拽/滚轮——CSS 3D 旋转下屏幕坐标→经纬度换算会错位，
 *     缩放按钮不依赖该换算故照常工作；同时不劫持页面滚动。
 *   · 针脚用「序号」而非类别图标，与左侧逐日卡片编号一一对应；名称标签仅悬停时浮现。
 *   · 列表 ↔ 针脚双向 hover 联动（hero-lfmarker-hot）。
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { dayColorOf } from "@/lib/palette";
import { wgs84ToGcj02 } from "@/lib/gcj02";
import { KIND_HEX, type Stop } from "@/app/showcase-data";

interface Props {
  stops: Stop[];
  hover: number | null;
  onHover: (i: number | null) => void;
  reduced: boolean;
}

export default function HeroTripMap({ stops, hover, onHover, reduced }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    onHoverRef.current = onHover;
  });

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapEl.current || mapRef.current) return;

      const latlngs = stops.map((s) => wgs84ToGcj02(s.lat, s.lon));
      const center = latlngs[0] ?? [31.318, 120.628];

      const map = L.map(mapEl.current, {
        // 3D 悬浮窗内：只保留 +/- 缩放；拖拽/滚轮/双击缩放全关（坐标换算在 CSS 变换下不可靠）
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        // 允许分数级缩放：fitBounds 才能精确把动线填满这块高瘦面板（否则整数级会停在
        // 只填一半的档位 → 动线缩在中间显得「只占 1/3」）
        zoomSnap: 0,
        zoomDelta: 0.5,
      }).setView(center as [number, number], 14);
      L.control.zoom({ position: "topright" }).addTo(map);
      map.attributionControl.setPrefix(false);

      // 高德 webrd 中文栅格（与中间展示带同底图；.sc-tiles 降饱和收敛成素净背景）
      L.tileLayer(
        "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
        {
          subdomains: "1234",
          maxZoom: 18,
          className: "sc-tiles",
          attribution: '&copy; <a href="https://amap.com">高德地图</a>',
        },
      ).addTo(map);

      const group: LayerGroup = L.layerGroup().addTo(map);
      const routeColor = dayColorOf(1);

      // 路径：白描边打底 + 品牌青瓷主线
      L.polyline(latlngs as [number, number][], {
        color: "#fff",
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      L.polyline(latlngs as [number, number][], {
        color: routeColor,
        weight: 2.5,
        opacity: 0.85,
        className: "tp-route",
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);

      // 分类图标针脚（景点/美食/住宿/交通，与三日游地图一致）；名称标签默认隐藏、悬停浮现
      stops.forEach((s, i) => {
        const c = KIND_HEX[s.kind];
        const icon = L.divIcon({
          className: "hero-lfmarker",
          html:
            `<div class="tp-pin tp-drop" style="--c:${c};animation-delay:${reduced ? 0 : 220 + i * 100}ms">` +
            `<div class="tp-pin-inner"><span>${i + 1}</span></div></div>` +
            `<span class="hero-lflabel">${s.short}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 32],
        });
        const m = L.marker(latlngs[i] as [number, number], {
          icon,
          zIndexOffset: i * 10,
          riseOnHover: true,
        });
        m.on("mouseover", () => onHoverRef.current(i));
        m.on("mouseout", () => onHoverRef.current(null));
        m.addTo(group);
        markersRef.current.push(m);
      });

      const bounds = L.latLngBounds(latlngs as [number, number][]);
      const fit = () => {
        const sz = map.getSize();
        // 容器 0 尺寸（移动端面板 hidden / 懒加载首帧）时 fitBounds 会算出非法缩放，退回 setView
        if (sz.x > 60 && sz.y > 60) {
          // 取景要点：① 对称留白 → 动线水平居中；② maxZoom 封顶到 13.5（user 多次要「再缩小」）
          // → 动线明显缩小、周边露更多，不再撑满面板；数字针脚即便挨近也能分清（比图标耐挤）；
          // ③ 底部多留一点给左下角注
          map.fitBounds(bounds, {
            paddingTopLeft: [52, 52],
            paddingBottomRight: [52, 66],
            maxZoom: 13.5,
            animate: false,
          });
        } else {
          map.setView(center as [number, number], 13.5);
        }
      };
      fit();
      // 3D 悬浮窗 / 懒加载下首帧尺寸偶尔未定，稍后重测一次并复位取景
      setTimeout(() => {
        if (disposed || mapRef.current !== map) return;
        map.invalidateSize(false);
        fit();
      }, 400);

      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = [];
      setReady(false);
    };
    // 一次性建图：stops 为 Hero 固定示例，不做响应式重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 列表 ↔ 针脚联动高亮
  useEffect(() => {
    if (!ready) return;
    markersRef.current.forEach((m, i) => {
      m.getElement()?.classList.toggle("hero-lfmarker-hot", i === hover);
    });
  }, [hover, ready]);

  return <div ref={mapEl} className="sc-map absolute inset-0 z-0" />;
}
