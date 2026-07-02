/**
 * 目的地每日天气抓取 —— 从 /api/weather 抽出，供路由与 Copilot 的 get_weather 工具共用。
 *
 * 目的地名 →（Nominatim 主 / Photon 备，免 key）经纬度 → Open-Meteo（免 key）每日预报。
 * Open-Meteo 仅约未来 16 天；超范围/查不到坐标 → 返回空对象，绝不编造（防幻觉）。进程级缓存。
 */

import type { DayWeather } from "@/lib/weather";

const cache = new Map<string, Record<string, DayWeather>>();
const coordCache = new Map<string, { lat: number; lon: number } | null>();

const UA = "travel-planner/1.0 (itinerary weather)";

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function geocodeCity(
  name: string,
): Promise<{ lat: number; lon: number } | null> {
  const key = name.trim().toLowerCase();
  if (coordCache.has(key)) return coordCache.get(key) ?? null;
  let out: { lat: number; lon: number } | null = null;
  try {
    const nu = new URL("https://nominatim.openstreetmap.org/search");
    nu.searchParams.set("q", name);
    nu.searchParams.set("format", "json");
    nu.searchParams.set("limit", "1");
    nu.searchParams.set("accept-language", "zh");
    const nr = await fetch(nu, { headers: { "User-Agent": UA } });
    if (nr.ok) {
      const arr = (await nr.json()) as { lat: string; lon: string }[];
      if (arr?.[0]) out = { lat: Number(arr[0].lat), lon: Number(arr[0].lon) };
    }
    if (!out) {
      const pu = new URL("https://photon.komoot.io/api/");
      pu.searchParams.set("q", name);
      pu.searchParams.set("limit", "1");
      const pr = await fetch(pu, { headers: { "User-Agent": UA } });
      if (pr.ok) {
        const data = (await pr.json()) as {
          features?: { geometry?: { coordinates?: [number, number] } }[];
        };
        const c = data.features?.[0]?.geometry?.coordinates;
        if (c && c.length >= 2) out = { lat: c[1], lon: c[0] };
      }
    }
  } catch {
    out = null;
  }
  coordCache.set(key, out);
  return out;
}

/** 抓每日天气；参数非法/查不到/超范围 → 返回 {}（不编造）。 */
export async function fetchWeather(
  dest: string,
  start: string,
  end: string,
): Promise<Record<string, DayWeather>> {
  if (!dest || !isDate(start) || !isDate(end)) return {};

  const cacheKey = `${dest.toLowerCase()}|${start}|${end}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const coord = await geocodeCity(dest);
  if (!coord) {
    cache.set(cacheKey, {});
    return {};
  }

  const daily: Record<string, DayWeather> = {};
  try {
    const wu = new URL("https://api.open-meteo.com/v1/forecast");
    wu.searchParams.set("latitude", String(coord.lat));
    wu.searchParams.set("longitude", String(coord.lon));
    wu.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    );
    wu.searchParams.set("timezone", "auto");
    wu.searchParams.set("start_date", start);
    wu.searchParams.set("end_date", end);
    const wr = await fetch(wu);
    if (wr.ok) {
      const d = (await wr.json()) as {
        daily?: {
          time?: string[];
          weather_code?: number[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
          precipitation_probability_max?: (number | null)[];
        };
      };
      const t = d.daily?.time ?? [];
      t.forEach((date, i) => {
        const tmax = d.daily?.temperature_2m_max?.[i];
        const tmin = d.daily?.temperature_2m_min?.[i];
        if (typeof tmax !== "number" || typeof tmin !== "number") return;
        daily[date] = {
          code: d.daily?.weather_code?.[i] ?? 0,
          tmax: Math.round(tmax),
          tmin: Math.round(tmin),
          pop: d.daily?.precipitation_probability_max?.[i] ?? 0,
        };
      });
    }
  } catch {
    // 网络/超范围 → 留空
  }

  cache.set(cacheKey, daily);
  return daily;
}
