import { NextResponse } from "next/server";
import { callDeepSeekJSON, DEEPSEEK } from "@/lib/deepseek";
import { WEB_SEARCH_TOOL, runWebSearchTool } from "@/lib/search";
import { railBookingUrl } from "@/lib/stations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/trains?from=上海&to=北京&date=2026-10-01
 * 实时搜索真实高铁/动车车次（Tavily + 模型提取），返回结构化列表供前端下拉选择。
 * 每个车次都带 12306 直达购票深链；不编造，搜不到就少返回。
 */
const trainsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["trains"],
  properties: {
    trains: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "depart", "arrive", "duration", "price_cny", "source_url"],
        properties: {
          name: { type: "string" }, // 车次号，如 G2
          depart: { type: "string" }, // 出发站 + 时间，如 上海虹桥 09:00
          arrive: { type: "string" }, // 到达站 + 时间
          duration: { type: "string" },
          price_cny: { type: "string" }, // 票价区间，注明以官方实时为准
          source_url: { type: "string" }, // 搜索来源
        },
      },
    },
  },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  const date = (searchParams.get("date") ?? "").trim() || null;
  if (!from || !to) {
    return NextResponse.json({ error: "缺少 from / to" }, { status: 400 });
  }

  try {
    const result = await callDeepSeekJSON<{
      trains: {
        name: string;
        depart: string;
        arrive: string;
        duration: string;
        price_cny: string;
        source_url: string;
        booking_url?: string;
      }[];
    }>({
      model: DEEPSEEK.chat,
      maxTokens: 4000,
      schema: trainsSchema,
      system:
        "你是车票查询助手，对真实性负责。用 web_search 搜【出发地→目的地】在指定日期的" +
        "真实高铁/动车车次，返回 6~10 个真实存在的车次：车次号、出发站+时间、到达站+时间、" +
        "时长、票价区间、source_url（搜索来源）。绝不编造；搜不到就少返回几个。按出发时间排序。",
      userPrompt: `出发地：${from}\n到达地：${to}\n日期：${date ?? "未指定"}`,
      tools: [WEB_SEARCH_TOOL],
      onToolCall: (_n, args) => runWebSearchTool(args),
    });

    const booking = await railBookingUrl(from, to, date);
    const trains = (result.trains ?? []).map((t) => ({ ...t, booking_url: booking }));
    return NextResponse.json({ trains });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
