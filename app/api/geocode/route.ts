import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/geocode
 * body: { destination: string; origin?: string | null; queries: string[] }
 *
 * 把行程里的地点名批量转成经纬度，供前端在地图上落点。
 * - 主用 Photon（komoot，免 key、容并发、对中文地名容忍度好），失败回退 Nominatim。
 * - 以「目的地城市中心」为偏置(bias)，并在查询里附加目的地消歧（如「天守阁 大阪」）。
 * - 模块级缓存：同一地点二次请求直接命中，编辑后重画近乎零成本。
 * 不编造坐标：查不到就返回 null，前端自动跳过该点（不在图上虚构位置）。
 */

interface Point {
  lat: number;
  lon: number;
  label: string;
}

// 进程级缓存：query(归一化) -> Point | null
const cache = new Map<string, Point | null>();

const UA = "travel-planner/1.0 (itinerary map geocoder)";

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function photon(
  q: string,
  bias?: Point | null,
): Promise<Point | null> {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "1");
  if (bias) {
    u.searchParams.set("lat", String(bias.lat));
    u.searchParams.set("lon", String(bias.lon));
  }
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> }[];
  };
  const f = data.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!c || c.length < 2) return null;
  const p = f?.properties ?? {};
  const label = [p.name, p.city || p.state, p.country].filter(Boolean).join(", ");
  return { lon: c[0], lat: c[1], label: label || q };
}

async function nominatim(q: string): Promise<Point | null> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  u.searchParams.set("accept-language", "zh");
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const arr = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const r = arr?.[0];
  if (!r) return null;
  return { lat: Number(r.lat), lon: Number(r.lon), label: r.display_name?.split(",")[0] || q };
}

/** 球面距离（km），用于剔除「落到别的国家」的离谱结果 */
function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 单城行程的 POI 应在目的地附近；超过此距离判为消歧错误（如「东京」误中中国某村）
const MAX_KM = 600;

/**
 * 城市级地理编码：用 Nominatim 优先（按重要度排序，能把「东京」定到日本东京而非中国某村），
 * 失败再退 Photon。用于目的地中心与出发地。
 */
async function geocodeCity(name: string): Promise<Point | null> {
  const key = "city:" + norm(name);
  if (cache.has(key)) return cache.get(key) ?? null;
  let p: Point | null = null;
  try {
    p = (await nominatim(name)) || (await photon(name, null));
  } catch {
    p = null;
  }
  cache.set(key, p);
  return p;
}

/**
 * 中文行程条目常见的「复合名」拆成查询变体，按可信度排序：
 * 原名 → 去括号 → 「·/•」各分段 → 括号内容（多为街区/商圈，位置近似可接受）。
 * 如「荣阳楼（山塘街）」→ [原名, 荣阳楼, 山塘街]；「平江路 · 摇橹船夜游」→ [原名, 平江路, 摇橹船夜游]。
 */
function queryVariants(raw: string): string[] {
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
  return out;
}

/**
 * POI 级地理编码：Photon 带「目的地中心」偏置最准（附加城市名反而拉低中文命中），
 * 逐策略尝试，返回首个落在目的地 MAX_KM 内的结果；都不在范围内则判为查不到（不在异国虚构落点）。
 * 原名查不到时退到 queryVariants 的拆分变体（招牌名/街区名），请求数有上限。
 */
async function geocodeOne(
  raw: string,
  destination: string,
  bias: Point | null,
): Promise<Point | null> {
  const key = norm(raw);
  if (cache.has(key)) return cache.get(key) ?? null;

  const withCity =
    destination && !raw.includes(destination) ? `${raw} ${destination}` : raw;
  const alts = queryVariants(raw).slice(1, 4); // 除原名外最多 3 个变体
  const tries: (() => Promise<Point | null>)[] = [
    () => photon(raw, bias),
    ...(withCity !== raw ? [() => photon(withCity, bias)] : []),
    () => nominatim(withCity),
    // 兜底：裸名走 Nominatim（部分地标附加城市名反而搜不到，如「凡尔赛宫」在巴黎郊外）
    ...(withCity !== raw ? [() => nominatim(raw)] : []),
    // 拆分变体：带偏置的 Photon 逐个试（覆盖「店名（街区）」「地点 · 活动」式条目）
    ...alts.map((v) => () => photon(v, bias)),
    // 最后一搏：首个变体加城市名走 Nominatim
    ...(alts.length
      ? [
          () =>
            nominatim(
              destination && !alts[0].includes(destination)
                ? `${alts[0]} ${destination}`
                : alts[0],
            ),
        ]
      : []),
  ];

  let p: Point | null = null;
  for (const t of tries) {
    let cand: Point | null = null;
    try {
      cand = await t();
    } catch {
      cand = null;
    }
    if (!cand) continue;
    if (!bias || haversineKm(cand, bias) <= MAX_KM) {
      p = cand;
      break;
    }
    // 命中但离目的地过远 → 多半是同名异地，继续试下一策略
  }
  cache.set(key, p);
  return p;
}

/** 有限并发跑一批 promise 工厂，保序返回。 */
async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (i < jobs.length) {
      const idx = i++;
      out[idx] = await jobs[idx]();
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: Request) {
  let body: { destination?: string; origin?: string | null; queries?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const destination = (body.destination ?? "").trim();
  const origin = (body.origin ?? "").trim();
  const queries = (body.queries ?? []).filter((q) => q && q.trim()).slice(0, 80);

  // 1) 先定目的地中心（城市级、按重要度排序），作为后续 POI 偏置
  const center = destination ? await geocodeCity(destination) : null;

  // 2) 出发地（城市级）
  const originPoint = origin ? await geocodeCity(origin) : null;

  // 3) 批量地点（去重后并发）
  const uniq = Array.from(new Set(queries));
  const resolved = await pool(
    uniq.map((q) => () => geocodeOne(q, destination, center)),
    6,
  );
  const map: Record<string, Point | null> = {};
  uniq.forEach((q, i) => (map[q] = resolved[i]));

  return NextResponse.json({ center, originPoint, points: map });
}
