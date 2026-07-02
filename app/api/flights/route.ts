import { NextResponse } from "next/server";
import { searchFlights } from "@/lib/transport";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/flights?from=上海&to=东京&date=2026-07-01
 * 实时搜索真实航班（Tavily 抓取列表页原文 + 模型提取），返回结构化列表供前端下拉选择。
 * 核心实现见 lib/transport.ts（与 Copilot 智能体工具共用）。每个航班带确定性预订深链；不编造。
 */
export async function GET(req: Request) {
  // 需登录：避免实时搜索（DeepSeek + Tavily，均计费）被匿名滥用
  if (!(await getUser())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  const date = (searchParams.get("date") ?? "").trim() || null;
  if (!from || !to) {
    return NextResponse.json({ error: "缺少 from / to" }, { status: 400 });
  }

  try {
    const flights = await searchFlights(from, to, date);
    return NextResponse.json({ flights });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
