"use client";

/**
 * 落地页演示地图 · 高德 AMap 2.0「3D 斜俯视」实现（配置了 NEXT_PUBLIC_AMAP_KEY 时启用）。
 *
 * 满足四项诉求：
 *  ①「不同图标不同色」——针脚按【类别】着色（景点靛/美食橙/住宿绿/交通蓝），非按天。
 *  ②「显示区县/关键点名称」——高德底图原生中文行政区 + POI 注记（showLabel）。
 *  ③「3D 斜着俯视」——viewMode:"3D" + pitch 倾斜 + 立体楼块（showBuildingBlock）。
 *  ④「针脚旁显示地点名称」——每个针脚常驻一枚名称标签（DOM 覆盖物）。
 *
 * 坐标：内置真实 WGS-84 → wgs84ToGcj02 加偏成高德 GCJ-02；AMap 用 [lng, lat] 顺序。
 * 交互：切天 setFitView 保持俯仰重新取景；列表 ↔ 针脚双向 hover 联动。
 */

import { useEffect, useRef, useState } from "react";
import AMapLoader from "@amap/amap-jsapi-loader";
import "@amap/amap-jsapi-types";
import { dayColorOf } from "@/lib/palette";
import { wgs84ToGcj02 } from "@/lib/gcj02";
import { DAYS, KIND_HEX, KIND_LABEL, iconSvg } from "@/app/showcase-data";

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

interface Props {
  dayIdx: number;
  hover: number | null;
  onHover: (i: number | null) => void;
  reduced: boolean;
  /** WebGL canvas 真正渲染出来时回调（父组件据此淡入高德、隐去底层 Leaflet） */
  onReady?: () => void;
  /** 高德加载/鉴权失败时回调（父组件据此保持底层 Leaflet） */
  onError?: () => void;
}

/** AMapLoader.load 返回运行时命名空间对象；只声明用到的构造器（避免 any） */
type AMapApi = {
  Map: new (container: HTMLElement, opts?: AMap.MapOptions) => AMap.Map;
  Marker: new (opts?: AMap.MarkerOptions) => AMap.Marker;
  Polyline: new (opts?: AMap.PolylineOptions) => AMap.Polyline;
};

const KEY = process.env.NEXT_PUBLIC_AMAP_KEY;
const SECURITY = process.env.NEXT_PUBLIC_AMAP_SECURITY;

const PITCH = 48; // 俯仰角（0=正俯视，越大越贴地平线）
const ROTATION = -14; // 微转一点，立体感更强

/** [lat,lon] WGS-84 → [lng,lat] GCJ-02（AMap 经度在前） */
function toAMap(lat: number, lon: number): [number, number] {
  const [gLat, gLon] = wgs84ToGcj02(lat, lon);
  return [gLon, gLat];
}

/** 单个针脚 + 常驻名称标签的 DOM（复用全站水滴针脚 .tp-pin） */
function makeMarkerEl(kind: keyof typeof KIND_HEX, name: string, delay: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "amp";
  el.style.setProperty("--c", KIND_HEX[kind]);
  el.innerHTML =
    `<div class="tp-pin tp-drop" style="animation-delay:${delay}ms">` +
    `<div class="tp-pin-inner"><span class="tp-ico">${iconSvg(kind)}</span></div></div>` +
    `<span class="amp-label"><b>${name}</b><i>${KIND_LABEL[kind]}</i></span>`;
  return el;
}

export default function ShowcaseMapAMap({
  dayIdx,
  hover,
  onHover,
  reduced,
  onReady,
  onError,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMap.Map | null>(null);
  const apiRef = useRef<AMapApi | null>(null);
  const overlaysRef = useRef<Array<AMap.Marker | AMap.Polyline>>([]);
  const markerElsRef = useRef<HTMLDivElement[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  });

  // ── 建图（一次） ──
  useEffect(() => {
    let disposed = false;
    if (!KEY) return;
    if (SECURITY) window._AMapSecurityConfig = { securityJsCode: SECURITY };
    // 鉴权失败（USERKEY_PLAT_NOMATCH 等）时 complete 仍会触发、但 WebGL canvas 永不出现、
    // 地图留白——故以「容器内是否出现 canvas」作为真正渲染成功的信号，超时未现即回落。
    let poll: ReturnType<typeof setInterval> | undefined;
    const fail = () => {
      if (disposed) return;
      setFailed(true);
      onErrorRef.current?.();
    };
    // 高德 3D 依赖 WebGL；不支持就别空转，直接用底层 2D
    const webglOK = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(
          c.getContext("webgl2") ||
          c.getContext("webgl") ||
          c.getContext("experimental-webgl")
        );
      } catch {
        return false;
      }
    })();
    if (!webglOK) {
      fail();
      return;
    }
    AMapLoader.load({ key: KEY, version: "2.0", plugins: [] })
      .then((AMap: AMapApi) => {
        if (disposed || !boxRef.current || mapRef.current) return;
        apiRef.current = AMap;
        const center = toAMap(31.318, 120.62);
        const map: AMap.Map = new AMap.Map(boxRef.current, {
          viewMode: "3D",
          pitch: PITCH,
          rotation: ROTATION,
          zoom: 14,
          center,
          mapStyle: "amap://styles/whitesmoke",
          showBuildingBlock: true,
          showLabel: true,
          features: ["bg", "road", "building", "point"],
          // 展示图：锁死平移/缩放手势避免滚动误触；但保留 pitch/rotate 允许，
          // 否则程序化 setPitch/setRotation 会被一并禁用 → 地图永远平的
          dragEnable: false,
          zoomEnable: false,
          scrollWheel: false,
          doubleClickZoom: false,
          keyboardEnable: false,
          rotateEnable: true,
          pitchEnable: true,
          jogEnable: false,
          animateEnable: !reduced,
        } as AMap.MapOptions);
        mapRef.current = map;
        (window as unknown as { __scMap?: AMap.Map }).__scMap = map; // 临时：控制台可查 getPitch/getZoom
        // 可加覆盖物即开始绘制（complete 在鉴权失败时也会触发，故仅用于「可画」门控）
        map.on("complete", () => {
          if (!disposed) setReady(true);
        });
        // 回落判定：真正渲染成功才有 WebGL canvas；~12s 仍无则判失败切 Leaflet
        let tries = 0;
        poll = setInterval(() => {
          if (disposed) return;
          if (boxRef.current?.querySelector("canvas")) {
            clearInterval(poll);
            onReadyRef.current?.(); // 真正出图 → 父组件淡入高德
          } else if (++tries > 30) {
            clearInterval(poll);
            fail();
          }
        }, 400);
      })
      .catch(fail);
    return () => {
      disposed = true;
      clearInterval(poll);
      mapRef.current?.destroy();
      mapRef.current = null;
      apiRef.current = null;
      overlaysRef.current = [];
      markerElsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 切天重绘：类别色针脚 + 名称标签 + 当天动线，setFitView 保持俯仰取景 ──
  useEffect(() => {
    const AMap = apiRef.current;
    const map = mapRef.current;
    if (!ready || !AMap || !map) return;

    if (overlaysRef.current.length) map.remove(overlaysRef.current);
    overlaysRef.current = [];
    markerElsRef.current = [];

    const cur = DAYS[dayIdx];
    const routeColor = dayColorOf(cur.day);
    const path = cur.stops.map((s) => toAMap(s.lat, s.lon));

    // 动线：白描边打底 + 类别中性的当天色虚线
    const under = new AMap.Polyline({
      path,
      strokeColor: "#ffffff",
      strokeWeight: 7,
      strokeOpacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
      zIndex: 40,
    } as AMap.PolylineOptions);
    const route = new AMap.Polyline({
      path,
      strokeColor: routeColor,
      strokeWeight: 4,
      strokeOpacity: 0.95,
      strokeStyle: "dashed",
      strokeDasharray: [10, 8],
      lineJoin: "round",
      lineCap: "round",
      zIndex: 41,
    } as AMap.PolylineOptions);
    map.add(under);
    map.add(route);
    overlaysRef.current.push(under, route);

    cur.stops.forEach((s, i) => {
      const el = makeMarkerEl(s.kind, s.short, reduced ? 0 : 140 + i * 90);
      el.addEventListener("mouseenter", () => onHover(i));
      el.addEventListener("mouseleave", () => onHover(null));
      markerElsRef.current.push(el);
      const marker: AMap.Marker = new AMap.Marker({
        position: path[i],
        content: el,
        anchor: "bottom-center",
        zIndex: 100 + i,
      } as unknown as AMap.MarkerOptions);
      map.add(marker);
      overlaysRef.current.push(marker);
    });

    // 取景：适配当天全部点，顶部多留白（俯视会压缩上缘），保留俯仰/朝向
    // 先即时取景（拿到 center+zoom），再复位俯仰/朝向——setFitView 不改俯仰，
    // 但低缩放级高德会自动收敛俯仰，故越紧凑的当天 3D 越明显（宽跨度当天偏俯视，更易读）
    map.setFitView(overlaysRef.current, true, [64, 52, 52, 52], 16);
    map.setPitch(PITCH);
    map.setRotation(ROTATION);
    // 二次复位：取景后高德内部有时会再调整状态，延迟再压一次俯仰，确保 3D 稳定体现
    const t = setTimeout(() => {
      if (mapRef.current !== map) return;
      map.setPitch(PITCH);
      map.setRotation(ROTATION);
    }, 400);
    return () => clearTimeout(t);
  }, [ready, dayIdx, reduced, onHover]);

  // ── 列表 ↔ 针脚联动高亮 ──
  useEffect(() => {
    markerElsRef.current.forEach((el, i) => {
      el.classList.toggle("amp-hot", i === hover);
    });
  }, [hover]);

  // 失败时渲染空占位——父组件收到 onError 后会切到 Leaflet 2D（此组件随即卸载）
  if (!KEY || failed) return <div className="absolute inset-0 z-0" />;

  return <div ref={boxRef} className="absolute inset-0 z-0" />;
}
