import { NextResponse } from "next/server";
import { callDeepSeekJSON, DEEPSEEK } from "@/lib/deepseek";
import { webSearch } from "@/lib/search";
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
    // 1) 抓取时刻表页【整页原文】（含全天车次），而不是只拿摘要
    const results = await webSearch(
      `${from}到${to} 高铁 动车 时刻表 全部车次 票价`,
      5,
      true,
    );
    const corpus = results
      .map((r) => `【来源 ${r.url}】\n${r.raw || r.content}`)
      .join("\n\n")
      .slice(0, 18000); // 控制上下文长度

    if (!corpus.trim()) {
      return NextResponse.json({ trains: [] });
    }

    // 2) 从整页时刻表里提取【所有】车次（无工具，直接 json_object 收口）
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
      maxTokens: 8000,
      schema: trainsSchema,
      system:
        `你是车票时刻表解析助手。下面是若干来源页面的原文，包含 ${from}→${to} 的高铁/动车时刻表。` +
        "请把其中出现的【所有】该线路车次【完整提取】出来（一条繁忙线路通常 20~40 趟，不要只给几趟），" +
        "每趟填：车次号、出发站+时间、到达站+时间、时长、票价区间、source_url（取自对应【来源】行的链接）。" +
        "按出发时间从早到晚排序、去重。只提取原文里真实出现的车次，不要编造；票价/余票以 12306 实时为准。",
      userPrompt: `线路：${from} → ${to}，日期：${date ?? "未指定"}\n\n时刻表原文：\n${corpus}`,
    });

    const booking = await railBookingUrl(from, to, date);
    const trains = (result.trains ?? []).map((t) => ({ ...t, booking_url: booking }));
    return NextResponse.json({ trains });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
