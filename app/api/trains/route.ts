import { NextResponse } from "next/server";
import { searchTrains } from "@/lib/transport";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/trains?from=上海&to=北京&date=2026-10-01
 * 实时搜索真实高铁/动车车次（Tavily + 模型提取），返回结构化列表供前端下拉选择。
 * 核心实现见 lib/transport.ts（与 Copilot 智能体工具共用）。每个车次带 12306 直达购票深链；不编造。
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
    const trains = await searchTrains(from, to, date);
    return NextResponse.json({ trains });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
