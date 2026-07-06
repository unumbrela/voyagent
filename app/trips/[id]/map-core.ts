/**
 * 行程地图共享核心（Leaflet / 高德双引擎通用）：类型、坐标系换算、弹窗 HTML。
 *
 * 坐标系约定：Pt.sys 标记来源坐标系——
 *  - "wgs"（默认）：/api/geocode（Photon/Nominatim）返回的真实 WGS-84；
 *  - "gcj"：高德 PlaceSearch 返回的 GCJ-02（加偏），落高德底图零转换、零偏移。
 * 落图用 toGcj()（国内中文底图都是 GCJ-02）；距离/耗时计算用 toWgs()。
 */

import { dayColorOf } from "@/lib/palette";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/lib/gcj02";

export interface Item {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
}
export interface Day {
  day: number;
  date: string;
  theme: string;
  items: Item[];
}
export interface Meta {
  destination: string | null;
  origin: string | null;
  start_date: string | null;
  end_date: string | null;
}
export interface Pt {
  lat: number;
  lon: number;
  label: string;
  /** 坐标系：wgs（OSM 系，默认）/ gcj（高德系）。 */
  sys?: "wgs" | "gcj";
}
/** 网友攻略推荐点（来自小红书攻略面板，未必已加入行程）——地图上作独立「建议」图层 */
export interface MapSpot {
  title: string;
  kind: string; // activity | food
  reason?: string;
  area?: string;
  source_url?: string;
}
export interface ResolvedSpot {
  title: string;
  kind: string;
  reason?: string;
  source_url?: string;
  pt: Pt;
}
export interface Resolved {
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
  /** 当天内序号（= 列表 ItemCard 的 number，含交通/未定位项；图上缺号=该项没定位上） */
  step: number;
}

// 按天配色：全站统一取自 lib/palette（与编号针/分享页/预算图一致）
export const colorOf = dayColorOf;

/** 类别 → 弹窗里的中文标签（配类别色圆点，替代 emoji） */
export const KIND_LABEL: Record<string, string> = {
  activity: "活动",
  food: "餐饮",
  rest: "住宿",
  transit: "交通",
};
export const KIND_COLOR: Record<string, string> = {
  activity: "var(--c-activity)",
  food: "var(--c-food)",
  rest: "var(--c-rest)",
  transit: "var(--c-transit)",
};

/** 类别 → 落地色值（针脚/标签描边要塞进 divIcon 的行内样式，与 globals.css --c-* 一致） */
const KIND_HEX: Record<string, string> = {
  activity: "#6366f1",
  food: "#f97316",
  rest: "#10b981",
  transit: "#3b82f6",
};
export const kindHex = (k: string) => KIND_HEX[k] ?? "#9ca3af";

/** 哪些条目值得落到地图上（有具体地点的）。本地交通/纯休息标题太泛，靠 geocode 结果自然过滤。 */
export function mappable(it: Item): boolean {
  if (!it.title?.trim()) return false;
  if (it.kind === "transit") return false; // 城际交通端点已由活动覆盖，避免连线穿城
  return true;
}

/** Pt → [lat, lon] GCJ-02（国内中文底图落点用；gcj 来源零转换） */
export function toGcj(pt: Pt): [number, number] {
  return pt.sys === "gcj" ? [pt.lat, pt.lon] : wgs84ToGcj02(pt.lat, pt.lon);
}

/** Pt → {lat, lon} WGS-84（距离/耗时计算用；gcj 来源反解） */
export function toWgs(pt: Pt): { lat: number; lon: number } {
  if (pt.sys !== "gcj") return { lat: pt.lat, lon: pt.lon };
  const [lat, lon] = gcj02ToWgs84(pt.lat, pt.lon);
  return { lat, lon };
}

export function esc(s: string): string {
  return (s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** 行程条目弹窗（含「在行程中查看」按钮，两引擎共用同一份 HTML/样式类） */
export function itemPopupHtml(r: Resolved, color: string): string {
  const kindDot = `<span style="display:inline-block;width:7px;height:7px;border-radius:99px;background:${KIND_COLOR[r.kind] ?? "var(--c-other)"};margin-right:5px;vertical-align:1px"></span>`;
  return `<div class="tp-pop">
    <div class="tp-pop-h" style="color:${color}">第 ${r.day} 天 · 第 ${r.step} 项 · ${KIND_LABEL[r.kind] ?? "地点"}</div>
    <div class="tp-pop-t">${kindDot}${esc(r.title)}</div>
    ${r.time ? `<div class="tp-pop-time">${esc(r.time)}</div>` : ""}
    ${r.detail ? `<div class="tp-pop-d">${esc(r.detail)}</div>` : ""}
    ${r.est_cost ? `<div class="tp-pop-c">约 ¥${r.est_cost}</div>` : ""}
    <button type="button" class="tp-pop-go">在行程中查看 ↓</button>
  </div>`;
}

/** 网友推荐建议点弹窗（含「加入行程」按钮） */
export function spotPopupHtml(s: ResolvedSpot): string {
  const c = s.kind === "food" ? "var(--c-food)" : "var(--c-activity)";
  return `<div class="tp-pop">
    <div class="tp-pop-h" style="color:${c}">网友推荐 · 未加入</div>
    <div class="tp-pop-t">${esc(s.title)}</div>
    ${s.reason ? `<div class="tp-pop-d">${esc(s.reason)}</div>` : ""}
    ${s.source_url ? `<div class="tp-pop-time">${/xiaohongshu\.com|xhslink\.com/i.test(s.source_url) ? "📕 小红书" : "网友攻略"}</div>` : ""}
    <button type="button" class="tp-pop-go">加入行程 +</button>
  </div>`;
}

/** 建议点针脚（虚线圈 + emoji，标识「未加入」；两引擎共用） */
export function spotIconHtml(kind: string): string {
  const isFood = kind === "food";
  const c = isFood ? "var(--c-food)" : "var(--c-activity)";
  const emoji = isFood ? "🍜" : "📍";
  return `<div style="width:24px;height:24px;border-radius:99px;background:#fff;border:2px dashed ${c};display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;box-shadow:0 2px 6px rgba(11,17,36,.22)">${emoji}</div>`;
}

/** 行程条目针脚（水滴 .tp-pin，按天着色 + 全局序号；两引擎共用） */
export function pinHtml(
  color: string,
  label: string,
  dim: boolean,
  delay: number,
): string {
  return `<div class="tp-pin tp-drop${dim ? " tp-dim" : ""}" style="--c:${color};animation-delay:${delay}ms"><div class="tp-pin-inner"><span>${label}</span></div></div>`;
}

/** 针脚旁常驻名称标签的短名：去括号 → 取「·/：」首段 → 剥活动动词前缀 → 超长截断 */
export function shortName(title: string): string {
  let t = title.replace(/[（(][^）)]*[）)]/g, " ").trim();
  const seg = t.split(/[·•—–:：]/)[0].trim();
  if (seg.length >= 2) t = seg;
  const stripped = t
    .replace(
      /^(?:游览|参观|打卡|夜游|夜逛|漫步|漫游|闲逛|逛逛|逛|探访|探秘|走进|前往|抵达|入住|品尝|品味|体验|观赏|欣赏|拜访|寻味|觅食)\s*/,
      "",
    )
    .trim();
  if (stripped.length >= 2) t = stripped;
  if (!t) t = title;
  return t.length > 12 ? `${t.slice(0, 11)}…` : t;
}

/** 首页展示带同款「编号针脚 + 常驻名称标签」（.sc-lfmarker divIcon 内容） */
export function labeledPinHtml(
  color: string,
  num: string,
  name: string,
  delay: number,
): string {
  // --c 同时写在针脚与标签上：标签 hover 描边色 var(--c) 取自身，不受兄弟节点限制
  return (
    `<div class="tp-pin tp-drop" style="--c:${color};animation-delay:${delay}ms"><div class="tp-pin-inner"><span>${esc(num)}</span></div></div>` +
    `<span class="sc-lflabel" style="--c:${color}">${esc(name)}</span>`
  );
}

/** 触屏定位焦点（5s 窗口内引擎跳过取景自适应，改聚焦该针脚并开弹窗） */
export interface SpotFocus {
  key: string;
  ts: number;
}
export const SPOT_FOCUS_WINDOW_MS = 5000;

/** 引擎组件的统一 props：shell 解析好坐标后交给任一引擎渲染 */
export interface EngineProps {
  resolved: Resolved[];
  resolvedSpots: ResolvedSpot[];
  showSpots: boolean;
  origin: Pt | null;
  center: Pt | null;
  meta: Meta;
  selectedDay: number | null;
  hoverKey: string | null;
  /** 底图：amap=高德中文瓦片+GCJ 落点（国内）；osm=CARTO Voyager+WGS 落点（出境，与首页 demo 一致） */
  tiles?: "amap" | "osm";
  /** 就绪后登记缩放接口（供 shell 的首页同款 +/- 覆盖控件驱动），卸载回传 null */
  onZoomApi?: (api: { zoomIn: () => void; zoomOut: () => void } | null) => void;
  onHoverKey?: (key: string | null) => void;
  /** 触屏定位目标（每次点按传新对象以重复触发）；引擎内部记 5s 窗口 */
  spot: { key: string } | null;
  /** 递增信号：天数 chip 被点时 +1，引擎据此清除定位窗口（避免取景被劫持） */
  spotClearSeq: number;
  onLocateItem?: (key: string) => void;
  onAddSpot?: (s: MapSpot) => void;
}
