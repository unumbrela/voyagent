/**
 * 12306 车站电报码（telecode）查询。
 * 直接抓取 12306 官方车站表（权威来源，避免硬编码错码），解析后缓存在内存。
 * 用于把购票链接做成「直达某线路+日期的余票查询页」，而不是首页。
 *
 * 车站表格式：var station_names = '@bjb|北京北|VAP|beijingbei|bjb|0@...'
 *   每条以 @ 分隔，字段以 | 分隔：[简拼, 中文名, 电报码, 全拼, 首字母, 序号]
 */

const STATION_URL =
  "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js";

interface Station {
  name: string;
  code: string;
  pinyin: string;
}

let cache: Map<string, Station> | null = null;

async function load(): Promise<Map<string, Station>> {
  if (cache) return cache;
  const map = new Map<string, Station>();
  try {
    const res = await fetch(STATION_URL);
    if (res.ok) {
      const text = await res.text();
      for (const part of text.split("@")) {
        const f = part.split("|");
        if (f.length >= 4 && f[1] && f[2]) {
          map.set(f[1], { name: f[1], code: f[2], pinyin: f[3] });
        }
      }
    }
  } catch {
    // 网络不可达时返回空表，调用方回退到首页链接
  }
  cache = map;
  return map;
}

/** 把「上海，中国」「北京市」「上海虹桥」等归一化到城市站名候选 */
function normalize(raw: string): string[] {
  const head = raw.split(/[，,、\s]/)[0].replace(/[市省]$/, "").trim();
  return [raw.trim(), head]; // 先试原名，再试去后缀的城市名
}

/** 查城市/车站对应的电报码；查不到返回 null */
export async function lookupStation(raw: string): Promise<Station | null> {
  if (!raw) return null;
  const map = await load();
  for (const cand of normalize(raw)) {
    const hit = map.get(cand);
    if (hit) return hit;
  }
  // 兜底：找以该城市名开头的车站（如「上海」→「上海虹桥」时反向也可）
  const head = normalize(raw)[1];
  for (const st of map.values()) {
    if (st.name.startsWith(head) && head.length >= 2) return st;
  }
  return null;
}

/**
 * 构造 12306 直达余票查询深链：落地即该出发地→目的地、该日期的车次列表。
 * 需要登录后即可购票。查不到电报码时返回 12306 首页。
 */
export async function railBookingUrl(
  fromCity: string,
  toCity: string,
  date: string | null,
): Promise<string> {
  const from = await lookupStation(fromCity);
  const to = await lookupStation(toCity);
  if (!from || !to) return "https://www.12306.cn";
  // 12306 预填要求「中文名,电报码」——只编码中文名，逗号保持字面，否则 %2C 会让其无法切分
  const fs = `${encodeURIComponent(from.name)},${from.code}`;
  const ts = `${encodeURIComponent(to.name)},${to.code}`;
  const dateParam = date ? `&date=${date}` : "";
  return (
    `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc` +
    `&fs=${fs}&ts=${ts}${dateParam}&flag=N,N,Y`
  );
}

/** 携程火车票线路深链（pinyin），作为备选/展示 */
export async function ctripTrainUrl(
  fromCity: string,
  toCity: string,
): Promise<string | null> {
  const from = await lookupStation(fromCity);
  const to = await lookupStation(toCity);
  if (!from?.pinyin || !to?.pinyin) return null;
  return `https://trains.ctrip.com/trainbooking/${from.pinyin}-${to.pinyin}/`;
}
