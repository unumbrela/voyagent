"use client";

/**
 * 行程地图 · 高德 JSAPI 2.0 引擎（国内行程默认；与首页展示带同款 3D 斜俯视观感）。
 *
 * 与 Leaflet 引擎同一套 EngineProps：针脚（按天着色 + 全局序号）、当天动线、
 * InfoWindow 详情（在行程中查看/加入行程）、按天聚焦、列表 ↔ 针脚 hover 联动、
 * 网友推荐建议层、触屏定位。坐标经 map-core.toGcj() 统一为 GCJ-02。
 *
 * 可靠性（吸取首页高德 3D 空白 canvas 的教训）：
 *  - 无 WebGL 直接回落；加载后轮询容器内是否真出 canvas，~6s 未出即 onFallback；
 *  - 空白 canvas 无法从外部检测（跨域瓦片污染读不了像素），故 shell 常驻
 *    「2D 底图」手动切换按钮兜底——任何情况下用户都能一键回到可用的 Leaflet。
 */

import { useEffect, useRef, useState } from "react";
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
  type ResolvedSpot,
  type SpotFocus,
} from "./map-core";
import {
  loadAmap,
  type AmapInfoWindow,
  type AmapMap,
  type AmapNs,
  type AmapOverlay,
} from "./amap-kit";

const PITCH = 45; // 俯仰角：与首页展示带一致的 3D 斜俯视
const ROTATION = 0; // 行程工作图保持正北，方位直觉优先（展示带才转角度）

/** Pt → [lng, lat] GCJ-02（AMap 经度在前） */
function toLngLat(pt: Resolved["pt"]): [number, number] {
  const [lat, lon] = toGcj(pt);
  return [lon, lat];
}

interface Props extends EngineProps {
  /** 高德加载/渲染失败：shell 据此回落 Leaflet（本会话不再尝试高德） */
  onFallback: () => void;
}

export default function TripMapAMap({
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
  onFallback,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const nsRef = useRef<AmapNs | null>(null);
  const infoRef = useRef<AmapInfoWindow | null>(null);
  const overlaysRef = useRef<AmapOverlay[]>([]);
  // 条目 key → {marker DOM, 坐标, 开弹窗}：hover/定位联动用（重绘时重建）
  const byKey = useRef<
    Map<string, { el: HTMLDivElement; pos: [number, number]; open: () => void }>
  >(new Map());
  const [ready, setReady] = useState(false);
  const [booting, setBooting] = useState(true);
  // 最近一次触屏定位（5s 窗口）：窗口期内重绘不做取景自适应，保证定位不被打断
  const spotRef = useRef<SpotFocus | null>(null);
  useEffect(() => {
    spotRef.current = null; // 天数 chip 被点：清除定位窗口
  }, [spotClearSeq]);

  const onHoverKeyRef = useRef(onHoverKey);
  const onLocateItemRef = useRef(onLocateItem);
  const onAddSpotRef = useRef(onAddSpot);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onHoverKeyRef.current = onHoverKey;
    onLocateItemRef.current = onLocateItem;
    onAddSpotRef.current = onAddSpot;
    onFallbackRef.current = onFallback;
  });

  // ── 建图（一次） ──
  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const keyMap = byKey.current;
    const fail = () => {
      if (!disposed) onFallbackRef.current?.();
    };
    // 高德 2.0 依赖 WebGL；不支持就别空转，直接回落 Leaflet
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
    loadAmap()
      .then((ns) => {
        if (disposed || !boxRef.current || mapRef.current) return;
        nsRef.current = ns;
        const map = new ns.Map(boxRef.current, {
          viewMode: "3D",
          pitch: PITCH,
          rotation: ROTATION,
          zoom: 12,
          center: center ? toLngLat(center) : [120.62, 31.32],
          mapStyle: "amap://styles/whitesmoke",
          // 与首页展示带一致：浅底 + 路网 + 立体楼块 + 行政/大地名注记，
          // features 去掉 "point"（POI 点图层）避免小地标与行程针脚抢视线
          showBuildingBlock: true,
          showLabel: true,
          features: ["bg", "road", "building"],
          dragEnable: true,
          zoomEnable: true,
          scrollWheel: true,
          doubleClickZoom: true,
          keyboardEnable: false,
          rotateEnable: true,
          pitchEnable: true,
          jogEnable: true,
        });
        mapRef.current = map;
        map.on("complete", () => {
          if (!disposed) setReady(true);
        });
        // 真正渲染成功才会在容器里出现 WebGL canvas；~6s 仍无 → 回落
        let tries = 0;
        poll = setInterval(() => {
          if (disposed) return;
          if (boxRef.current?.querySelector("canvas")) {
            clearInterval(poll);
            setBooting(false);
          } else if (++tries > 15) {
            clearInterval(poll);
            fail();
          }
        }, 400);
      })
      .catch(fail);
    return () => {
      disposed = true;
      clearInterval(poll);
      infoRef.current?.close();
      mapRef.current?.destroy();
      mapRef.current = null;
      nsRef.current = null;
      infoRef.current = null;
      overlaysRef.current = [];
      keyMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 打开 InfoWindow：弹窗 HTML 与 Leaflet 引擎共用，按钮回调各自接线 */
  function openInfo(
    html: string,
    pos: [number, number],
    onGo?: () => void,
  ) {
    const ns = nsRef.current;
    const map = mapRef.current;
    if (!ns || !map) return;
    const el = document.createElement("div");
    el.className = "tp-pop-amap";
    el.innerHTML = html;
    el.querySelector(".tp-pop-go")?.addEventListener(
      "click",
      () => {
        onGo?.();
        infoRef.current?.close();
      },
      { once: true },
    );
    if (!infoRef.current) {
      // isCustom：用我们自己的圆角卡片（.tp-pop-amap），与 Leaflet 弹窗同观感
      infoRef.current = new ns.InfoWindow({
        isCustom: true,
        anchor: "bottom-center",
        offset: new ns.Pixel(0, -38),
        autoMove: true,
        closeWhenClickMap: true,
      });
    }
    infoRef.current.setContent(el);
    infoRef.current.open(map, pos);
  }

  // ── 重绘针脚 / 动线（数据或选中天变化时） ──
  useEffect(() => {
    const ns = nsRef.current;
    const map = mapRef.current;
    if (!ready || !ns || !map) return;

    if (overlaysRef.current.length) map.remove(overlaysRef.current);
    overlaysRef.current = [];
    byKey.current.clear();
    infoRef.current?.close();

    const focused = selectedDay; // null = 全部
    const focusOverlays: AmapOverlay[] = [];
    let dropIdx = 0;

    const addMarker = (
      pos: [number, number],
      html: string,
      opts: {
        zIndex: number;
        onClick?: () => void;
        onHover?: [() => void, () => void];
        /** 建议点等圆形标记用 center 锚 + 无 .amp 固定盒 */
        anchor?: "bottom-center" | "center";
        cls?: string;
      },
    ): { el: HTMLDivElement; marker: AmapOverlay } => {
      const el = document.createElement("div");
      el.className = opts.cls ?? "amp";
      el.innerHTML = html;
      if (opts.onClick) el.addEventListener("click", opts.onClick);
      if (opts.onHover) {
        el.addEventListener("mouseenter", opts.onHover[0]);
        el.addEventListener("mouseleave", opts.onHover[1]);
      }
      const marker = new ns.Marker({
        position: pos,
        content: el,
        anchor: opts.anchor ?? "bottom-center",
        zIndex: opts.zIndex,
      });
      map.add(marker);
      overlaysRef.current.push(marker);
      return { el, marker };
    };

    // 出发地
    if (origin) {
      const dim = focused !== null;
      const o = toLngLat(origin);
      const { marker } = addMarker(o, pinHtml("#0f172a", "起", dim, 0), {
        zIndex: 200,
        onClick: () =>
          openInfo(
            `<div class="tp-pop"><div class="tp-pop-h">出发地</div><div class="tp-pop-t">${esc(meta.origin ?? origin.label)}</div></div>`,
            o,
          ),
      });
      if (focused === null) focusOverlays.push(marker);
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
      const path = items.map((r) => toLngLat(r.pt));

      if (path.length > 1) {
        // 白描边打底 + 当天色实线（与首页展示带同手法）
        const under = new ns.Polyline({
          path,
          strokeColor: "#ffffff",
          strokeWeight: 6,
          strokeOpacity: dim ? 0.08 : 0.85,
          lineJoin: "round",
          lineCap: "round",
          zIndex: 40,
        });
        const route = new ns.Polyline({
          path,
          strokeColor: color,
          strokeWeight: 3,
          strokeOpacity: dim ? 0.12 : 0.8,
          lineJoin: "round",
          lineCap: "round",
          zIndex: 41,
        });
        map.add(under);
        map.add(route);
        overlaysRef.current.push(under, route);
        if (focused === day) focusOverlays.push(under);
      }

      items.forEach((r, idx) => {
        const pos = path[idx];
        const delay = Math.min(dropIdx++ * 60, 720);
        // 聚焦某天时给当天针脚常驻名称标签（全程视图针脚多，标签只在聚焦时显示）
        const label =
          focused === day
            ? `<span class="amp-label"><b>${esc(r.title)}</b>${r.time ? `<i>${esc(r.time)}</i>` : ""}</span>`
            : "";
        const { el, marker } = addMarker(
          pos,
          pinHtml(color, String(r.step), dim, delay) + label,
          {
            zIndex: dim ? 60 : 100 + idx,
            onClick: () =>
              openInfo(itemPopupHtml(r, color), pos, () =>
                onLocateItemRef.current?.(r.key),
              ),
            onHover: [
              () => onHoverKeyRef.current?.(r.key),
              () => onHoverKeyRef.current?.(null),
            ],
          },
        );
        el.style.setProperty("--c", color);
        byKey.current.set(r.key, {
          el,
          pos,
          open: () =>
            openInfo(itemPopupHtml(r, color), pos, () =>
              onLocateItemRef.current?.(r.key),
            ),
        });
        if (focused === null || focused === day) focusOverlays.push(marker);
      });
    }

    // ── 网友推荐建议层 ──
    if (showSpots && resolvedSpots.length) {
      resolvedSpots.forEach((s: ResolvedSpot) => {
        const pos = toLngLat(s.pt);
        const { marker } = addMarker(pos, spotIconHtml(s.kind), {
          zIndex: 80,
          anchor: "center",
          cls: "amp-spot",
          onClick: () =>
            openInfo(spotPopupHtml(s), pos, () =>
              onAddSpotRef.current?.({
                title: s.title,
                kind: s.kind,
                reason: s.reason,
                source_url: s.source_url,
              }),
            ),
        });
        // 仅在「全程」视图纳入取景，避免按天聚焦被拉远
        if (focused === null) focusOverlays.push(marker);
      });
    }

    // 触屏定位窗口期内：跳过取景自适应，聚焦目标针脚并开弹窗
    const sp = spotRef.current;
    const spotEntry =
      sp && Date.now() - sp.ts < SPOT_FOCUS_WINDOW_MS
        ? byKey.current.get(sp.key)
        : null;
    if (spotEntry) {
      map.setZoomAndCenter(Math.max(map.getZoom(), 15), spotEntry.pos, false, 500);
      window.setTimeout(() => spotEntry.open(), 550);
      return;
    }

    // 取景：适配目标点集，随后复位俯仰（低缩放级高德会自动收敛俯仰，延迟再压一次）
    if (focusOverlays.length) {
      map.setFitView(focusOverlays, true, [64, 52, 52, 52], 16);
      map.setPitch(PITCH);
      map.setRotation(ROTATION);
      const t = setTimeout(() => {
        if (mapRef.current !== map) return;
        map.setPitch(PITCH);
        map.setRotation(ROTATION);
      }, 400);
      return () => clearTimeout(t);
    } else if (center) {
      map.setZoomAndCenter(11, toLngLat(center), true);
    }
  }, [ready, resolved, resolvedSpots, showSpots, origin, center, selectedDay, meta.origin]);

  // ── 列表行 hover → 针脚高亮（反向由针脚 mouseenter 回传 onHoverKey） ──
  useEffect(() => {
    for (const [key, { el }] of byKey.current) {
      el.classList.toggle("amp-hot", key === hoverKey);
      el.querySelector(".tp-pin")?.classList.toggle("tp-hot", key === hoverKey);
    }
  }, [hoverKey, resolved, selectedDay]);

  // ── 触屏定位：飞到目标针脚并开弹窗（spot 每次是新对象，可重复触发同一条目）──
  useEffect(() => {
    if (!spot) return;
    spotRef.current = { key: spot.key, ts: Date.now() };
    const entry = byKey.current.get(spot.key);
    const map = mapRef.current;
    if (!entry || !map) return;
    map.setZoomAndCenter(Math.max(map.getZoom(), 15), entry.pos, false, 700);
    const t = window.setTimeout(() => entry.open(), 750);
    return () => window.clearTimeout(t);
  }, [spot]);

  return (
    <div className="relative h-full w-full bg-neutral-100">
      <div ref={boxRef} className="absolute inset-0" />
      {/* 缩放控件（高德 2.0 默认无 UI 控件；滚轮/双击/拖拽仍原生可用） */}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-white shadow-soft">
        <button
          type="button"
          aria-label="放大"
          onClick={() => mapRef.current?.zoomIn()}
          className="flex h-8 w-8 items-center justify-center text-lg leading-none text-ink hover:bg-neutral-100"
        >
          +
        </button>
        <button
          type="button"
          aria-label="缩小"
          onClick={() => mapRef.current?.zoomOut()}
          className="flex h-8 w-8 items-center justify-center border-t border-line text-lg leading-none text-ink hover:bg-neutral-100"
        >
          −
        </button>
      </div>
      {booting && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-teal" />
            正在加载高德地图…
          </div>
        </div>
      )}
    </div>
  );
}
