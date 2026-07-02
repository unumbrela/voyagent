import { NextResponse } from "next/server";
import { fetchWeather } from "@/lib/weather-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather?dest=<目的地>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>
 * 目的地按日期返回每日天气；核心见 lib/weather-fetch.ts（与 Copilot 的 get_weather 工具共用）。
 * 超范围/查不到坐标返回空 daily —— 绝不编造天气（防幻觉）。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dest = (url.searchParams.get("dest") ?? "").trim();
  const start = (url.searchParams.get("start") ?? "").trim();
  const end = (url.searchParams.get("end") ?? "").trim();

  const daily = await fetchWeather(dest, start, end);
  return NextResponse.json({ daily });
}
