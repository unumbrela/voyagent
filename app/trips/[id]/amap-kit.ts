/**
 * 高德 JSAPI 客户端工具（仅浏览器使用）：
 *  - loadAmap()：带安全密钥的单例加载（与首页 ShowcaseMapAMap 同 key/版本，插件自动合并）
 *  - amapGeocodePois()：PlaceSearch 批量把行程地点名转成 GCJ-02 坐标。
 *
 * 为什么用 PlaceSearch 而不是 OSM 系 geocode：Photon/Nominatim 对中文 POI 命中率差，
 * 「同名异地」误配会把针脚甩到合肥/杭州；高德是国内 POI 权威源，
 * 且 city + citylimit 把结果锁死在目的地城市内，返回的又是 GCJ-02 原生坐标，
 * 落高德底图零转换、零偏移。走的是 JSAPI 的 Web 端配额（浏览器 JSONP），无需 Web 服务 key。
 */

import AMapLoader from "@amap/amap-jsapi-loader";
import type { Pt } from "./map-core";

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

const KEY = process.env.NEXT_PUBLIC_AMAP_KEY;
const SECURITY = process.env.NEXT_PUBLIC_AMAP_SECURITY;

export const hasAmapKey = !!KEY;

/** JSAPI 运行时命名空间：只声明用到的构造器（避免 any） */
export interface AmapNs {
  Map: new (container: HTMLElement, opts?: Record<string, unknown>) => AmapMap;
  Marker: new (opts?: Record<string, unknown>) => AmapOverlay;
  Polyline: new (opts?: Record<string, unknown>) => AmapOverlay;
  InfoWindow: new (opts?: Record<string, unknown>) => AmapInfoWindow;
  PlaceSearch: new (opts?: Record<string, unknown>) => AmapPlaceSearch;
  Pixel: new (x: number, y: number) => unknown;
}
export interface AmapMap {
  add(o: AmapOverlay | AmapOverlay[]): void;
  remove(o: AmapOverlay | AmapOverlay[]): void;
  on(ev: string, fn: () => void): void;
  destroy(): void;
  setFitView(
    overlays?: AmapOverlay[] | null,
    immediately?: boolean,
    avoid?: number[],
    maxZoom?: number,
  ): void;
  setZoomAndCenter(
    zoom: number,
    center: [number, number],
    immediately?: boolean,
    duration?: number,
  ): void;
  getZoom(): number;
  setPitch(p: number): void;
  setRotation(r: number): void;
  zoomIn(): void;
  zoomOut(): void;
}
export interface AmapOverlay {
  on?(ev: string, fn: () => void): void;
  getPosition?(): { lng: number; lat: number };
}
export interface AmapInfoWindow {
  open(map: AmapMap, pos: [number, number]): void;
  close(): void;
  setContent(el: HTMLElement | string): void;
}
interface AmapPlaceSearch {
  search(
    keyword: string,
    cb: (status: string, result: unknown) => void,
  ): void;
}

let nsPromise: Promise<AmapNs> | null = null;

/**
 * 单例加载 JSAPI 2.0（含 PlaceSearch 插件）；失败清空缓存以便下次重试。
 * 带 10s 超时：实测脚本加载偶发「挂起」（不成功也不报错），若不设超时，
 * 调用方 await 永不返回——地图 spinner 卡死且回落逻辑无从触发。
 */
export function loadAmap(): Promise<AmapNs> {
  if (!KEY) return Promise.reject(new Error("未配置 NEXT_PUBLIC_AMAP_KEY"));
  if (!nsPromise) {
    if (SECURITY) window._AMapSecurityConfig = { securityJsCode: SECURITY };
    const load = AMapLoader.load({
      key: KEY,
      version: "2.0",
      plugins: ["AMap.PlaceSearch"],
    }) as Promise<AmapNs>;
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("高德 JSAPI 加载超时")), 10000);
    });
    nsPromise = Promise.race([load, timeout]);
    nsPromise.catch(() => {
      nsPromise = null;
    });
  }
  return nsPromise;
}

// ── PlaceSearch 批量地理编码 ──

// 缓存：目的地|地点名 → Pt | null。localStorage 持久化——个人 key 的搜索服务
// 有每日配额，同一行程反复打开/编辑不该重复烧配额；null（查不到）也缓存。
const CACHE_LS_KEY = "amap-poi-cache-v1";
const CACHE_CAP = 600;
const poiCache = new Map<string, Pt | null>();
let cacheLoaded = false;

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(CACHE_LS_KEY);
    if (!raw) return;
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Pt | null>)) {
      poiCache.set(k, v);
    }
  } catch {
    /* 解析失败当无缓存 */
  }
}

function saveCache() {
  try {
    // 超容量时丢最早写入的一半（Map 迭代按插入序）
    while (poiCache.size > CACHE_CAP) {
      const first = poiCache.keys().next().value;
      if (first === undefined) break;
      poiCache.delete(first);
    }
    window.localStorage.setItem(
      CACHE_LS_KEY,
      JSON.stringify(Object.fromEntries(poiCache)),
    );
  } catch {
    /* 隐私模式/超限忽略 */
  }
}

/**
 * 单次 PlaceSearch（带超时）。
 * transient=true 表示临时失败（超时/QPS/配额 error）——这类 miss 不得持久缓存，
 * 否则配额恢复后地点仍被永久标成「查不到」；no_data/空结果才是确定查无。
 */
function searchOnce(
  ps: AmapPlaceSearch,
  keyword: string,
  timeoutMs = 8000,
): Promise<{ pt: Pt | null; transient: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (pt: Pt | null, transient: boolean) => {
      if (!done) {
        done = true;
        resolve({ pt, transient });
      }
    };
    const timer = window.setTimeout(() => finish(null, true), timeoutMs);
    ps.search(keyword, (status, result) => {
      window.clearTimeout(timer);
      if (status === "error") return finish(null, true);
      if (status !== "complete") return finish(null, false); // no_data = 确定查无
      const pois = (
        result as {
          poiList?: {
            pois?: { name?: string; location?: { lng?: number; lat?: number } }[];
          };
        }
      )?.poiList?.pois;
      const p = pois?.[0];
      const lng = p?.location?.lng;
      const lat = p?.location?.lat;
      if (typeof lng !== "number" || typeof lat !== "number")
        return finish(null, false);
      finish({ lat, lon: lng, label: p?.name || keyword, sys: "gcj" }, false);
    });
  });
}

/** 中文条目常见「复合名」拆变体：原名 → 去括号 → 「·/•」分段 → 括号内容 */
function variants(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  push(raw);
  const noParen = raw.replace(/[（(][^）)]*[）)]/g, " ");
  push(noParen);
  for (const seg of noParen.split(/[·•—–]/)) push(seg);
  for (const m of raw.matchAll(/[（(]([^）)]+)[）)]/g)) push(m[1]);
  return out.slice(0, 4);
}

/** 球面距离（km）——全国兜底结果的「离目的地过远即拒绝」过滤 */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 全国兜底命中离目的地中心超过此距离判为同名异地（周边联游城市 ≤150km 内可接受）
const MAX_KM = 150;

/**
 * 批量地点名 → GCJ-02 坐标。
 * 策略（按可信度）：city+citylimit 锁定目的地内逐变体查 → 全国查原名但须落在
 * 目的地 MAX_KM 内 → null（查不到不虚构，交给调用方回落 OSM geocode）。
 * 加载失败/无 key 时返回全 null 映射，调用方自然走 OSM 路径。
 */
export async function amapGeocodePois(
  destination: string,
  queries: string[],
  centerGcj: [number, number] | null,
): Promise<Record<string, Pt | null>> {
  const out: Record<string, Pt | null> = {};
  const uniq = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
  if (!uniq.length) return out;
  loadCache();

  // 全部命中缓存则零请求返回（也不必加载 JSAPI）
  const cacheKey = (raw: string) => `${destination}|${raw.toLowerCase()}`;
  if (uniq.every((q) => poiCache.has(cacheKey(q)))) {
    for (const q of uniq) out[q] = poiCache.get(cacheKey(q)) ?? null;
    return out;
  }

  let ns: AmapNs;
  try {
    ns = await loadAmap();
  } catch {
    // JSAPI 不可用：已有缓存的仍然给，其余 null（调用方回落 OSM）
    for (const q of uniq) out[q] = poiCache.get(cacheKey(q)) ?? null;
    return out;
  }
  const inCity = new ns.PlaceSearch({
    city: destination,
    citylimit: true,
    pageSize: 1,
    pageIndex: 1,
    extensions: "base",
  });
  const nationwide = new ns.PlaceSearch({ pageSize: 1, pageIndex: 1 });

  async function resolveOne(raw: string): Promise<Pt | null> {
    const key = cacheKey(raw);
    if (poiCache.has(key)) return poiCache.get(key) ?? null;
    let p: Pt | null = null;
    let sawTransient = false;
    for (const v of variants(raw)) {
      const r = await searchOnce(inCity, v);
      sawTransient ||= r.transient;
      if (r.pt) {
        p = r.pt;
        break;
      }
    }
    if (!p) {
      const r = await searchOnce(nationwide, raw);
      sawTransient ||= r.transient;
      const cand = r.pt;
      if (
        cand &&
        (!centerGcj ||
          haversineKm(cand.lat, cand.lon, centerGcj[0], centerGcj[1]) <= MAX_KM)
      ) {
        p = cand;
      }
    }
    // 临时失败（配额/QPS/超时）导致的 miss 不缓存，下次访问重试
    if (p || !sawTransient) poiCache.set(key, p);
    return p;
  }

  // 有限并发（个人 key 有 QPS 限制，3 路足够快且稳）
  let i = 0;
  const workers = Array.from({ length: Math.min(3, uniq.length) }, async () => {
    while (i < uniq.length) {
      const q = uniq[i++];
      out[q] = await resolveOne(q);
    }
  });
  await Promise.all(workers);
  saveCache();
  return out;
}
