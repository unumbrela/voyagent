import type { TripContext } from "./types";

/**
 * 成品行程的确定性收尾（硬保证，不依赖模型自觉）。
 *
 * 不变式：当填了出发地时，**全程第一项**必须是「去程出发」(从出发地出发的 transit)，
 * 而不是「入住酒店」。模型（scheduling/hub_planner）常把首日首项写成抵达/入住，
 * 这里在写库前统一纠正：
 *  - 若首日已有一条「去程出发」条目但不在最前 → 提到最前；
 *  - 若没有 → 用 transport.outbound 合成一条插到最前（带车次/时刻/票价/购票深链）。
 */

interface ItItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  booking_url?: string;
}
interface ItDay {
  day: number;
  date: string;
  theme: string;
  items: ItItem[];
}
interface Itinerary {
  title?: string;
  overview?: string;
  days?: ItDay[];
  references?: { label: string; value: string }[];
  [k: string]: unknown;
}

interface TransportOption {
  mode?: string;
  name?: string;
  depart?: string;
  arrive?: string;
  duration?: string;
  price_cny?: string;
  booking_url?: string;
}
interface TransportPayload {
  outbound?: { options?: TransportOption[]; recommended?: string };
}

const PLACEHOLDER = /见购票|实时查询|待定|未知/;
const extractClock = (s?: string): string => s?.match(/\d{1,2}:\d{2}/)?.[0] ?? "";
const parsePrice = (s?: string): number => {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : 0;
};

/** 一条 transit 条目看起来是否就是「从出发地出发的去程」 */
function looksLikeDeparture(
  it: ItItem,
  origin: string,
  destination: string,
  outName?: string,
): boolean {
  if (it.kind !== "transit") return false;
  const text = `${it.title} ${it.detail}`;
  // 命中真实车次/航班号
  if (outName && outName.length >= 2 && !PLACEHOLDER.test(outName) && text.includes(outName))
    return true;
  // 文本体现「从出发地出发 / 去往目的地」
  const mentionsOrigin = origin && text.includes(origin);
  const departish =
    /出发|去程|前往|抵达|乘.*(高铁|动车|火车|飞机|航班)|启程/.test(text) ||
    (destination && text.includes(destination));
  return Boolean(mentionsOrigin && departish);
}

/** 用 outbound 推荐班次合成一条「购票出发」条目 */
function buildDeparture(
  origin: string,
  destination: string,
  opt?: TransportOption,
): ItItem {
  const title = `购票出发：${origin} → ${destination}`;
  if (!opt) {
    return {
      time: "",
      title,
      kind: "transit",
      detail: `${origin} → ${destination} 去程；具体车次/票价请在购票链接实时查询`,
      est_cost: 0,
    };
  }
  const head = [opt.mode, opt.name && !PLACEHOLDER.test(opt.name) ? opt.name : ""]
    .filter(Boolean)
    .join(" ");
  const detail = [
    head,
    opt.depart && opt.arrive ? `${opt.depart} → ${opt.arrive}` : "",
    opt.duration,
    opt.price_cny,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    time: extractClock(opt.depart),
    title,
    kind: "transit",
    detail,
    est_cost: parsePrice(opt.price_cny),
    booking_url: opt.booking_url,
  };
}

/**
 * 保证成品行程首日第一项是「去程出发」。返回新对象（不改入参）。
 * 未填出发地、或无 days 时原样返回。
 */
export function ensureDepartureFirst(
  itinerary: unknown,
  ctx: TripContext,
  transport: unknown,
): unknown {
  const itin = itinerary as Itinerary | null | undefined;
  const origin = ctx.origin?.trim();
  const destination = ctx.destination?.trim();
  if (!itin?.days?.length || !origin || !destination) return itinerary;

  const days = itin.days;
  const day1 = days[0];
  const items = Array.isArray(day1.items) ? [...day1.items] : [];
  const opt = (transport as TransportPayload | undefined)?.outbound?.options?.[0];

  const idx = items.findIndex((it) =>
    looksLikeDeparture(it, origin, destination, opt?.name),
  );

  if (idx === 0) return itinerary; // 已经在最前，无需改动

  if (idx > 0) {
    // 已有去程条目但被排到后面 → 提到最前
    const [dep] = items.splice(idx, 1);
    items.unshift(dep);
  } else {
    // 没有去程条目 → 合成一条插到最前
    items.unshift(buildDeparture(origin, destination, opt));
  }

  const newDays = days.map((d, i) => (i === 0 ? { ...d, items } : d));
  return { ...itin, days: newDays };
}
