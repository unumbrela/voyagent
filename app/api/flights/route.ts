import { NextResponse } from "next/server";
import { callDeepSeekJSON, DEEPSEEK } from "@/lib/deepseek";
import { webSearch } from "@/lib/search";
import { flightBookingUrl } from "@/lib/airports";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/flights?from=上海&to=东京&date=2026-07-01
 * 实时搜索真实航班（Tavily 抓取航班列表页原文 + 模型提取），返回结构化列表供前端下拉选择。
 * 每个航班都带确定性预订深链（携程/Google Flights）；不编造，搜不到就少返回。
 */
const flightsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["flights"],
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "airline",
          "depart",
          "arrive",
          "duration",
          "price_cny",
          "source_url",
        ],
        properties: {
          name: { type: "string" }, // 航班号，如 MU523 / CA929
          airline: { type: "string" }, // 航空公司，如 东方航空
          depart: { type: "string" }, // 出发机场 + 时间，如 上海浦东 09:05
          arrive: { type: "string" }, // 到达机场 + 时间
          duration: { type: "string" },
          price_cny: { type: "string" }, // 票价区间，注明以官方实时为准
          source_url: { type: "string" }, // 搜索来源
        },
      },
    },
  },
};

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
    // 1) 抓取航班列表页【整页原文】（含全天航班），而不是只拿摘要
    const results = await webSearch(
      `${from}到${to} 航班 时刻表 票价 ${date ?? ""}`,
      5,
      true,
    );
    const corpus = results
      .map((r) => `【来源 ${r.url}】\n${r.raw || r.content}`)
      .join("\n\n")
      .slice(0, 18000);

    if (!corpus.trim()) {
      return NextResponse.json({ flights: [] });
    }

    // 2) 从整页里提取【所有】航班（无工具，直接 json_object 收口）
    const result = await callDeepSeekJSON<{
      flights: {
        name: string;
        airline: string;
        depart: string;
        arrive: string;
        duration: string;
        price_cny: string;
        source_url: string;
        booking_url?: string;
      }[];
    }>({
      model: DEEPSEEK.chat,
      maxTokens: 8000,
      schema: flightsSchema,
      system:
        `你是航班时刻表解析助手。下面是若干来源页面的原文，包含 ${from}→${to} 的航班信息。` +
        "请把其中出现的【所有】该航线航班【完整提取】出来（不要只给几趟），" +
        "每趟填：航班号、航空公司、出发机场+时间、到达机场+时间、时长、票价区间、" +
        "source_url（取自对应【来源】行的链接）。" +
        "按出发时间从早到晚排序、去重。只提取原文里真实出现的航班，不要编造；票价以官方实时为准。",
      userPrompt: `航线：${from} → ${to}，日期：${date ?? "未指定"}\n\n原文：\n${corpus}`,
    });

    // 预订链接统一覆盖为确定性真实深链
    const booking = flightBookingUrl(from, to, date);
    const flights = (result.flights ?? []).map((f) => ({
      ...f,
      booking_url: booking,
    }));
    return NextResponse.json({ flights });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
