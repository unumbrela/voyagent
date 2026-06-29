import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { transportSchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Transport：交通物流（依赖已排好的日程，DeepSeek + 自建 web 搜索） */
export function runTransport(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    useWebSearch: true,
    schema: transportSchema,
    system:
      "你是交通物流专家，对【真实性】负责。核心铁律：所有具体车次/航班号、时刻、票价" +
      "都必须来自 web_search 的真实结果，绝不允许凭记忆编造。\n" +
      "工作流程：\n" +
      "1) 判断出发地↔目的地是否通铁路：国内（含港澳台跨境除外）优先查【高铁/动车】，" +
      "跨国或无直达铁路则查【航班】；两者都合理时各给一组。\n" +
      "2) 必须真的调用 web_search 多次：分别搜去程、返程的真实车次/航班与当日时刻、票价区间" +
      "（查询词带上出发地、目的地、日期、『高铁 时刻表 票价』或『航班』）。\n" +
      "3) outbound/inbound 各给 2~4 个真实存在的班次（options）：填车次/航班号、出发到达站与时间、" +
      "时长、票价区间，并且每条都要带 source_url（搜索来源）和 booking_url（官方购票：" +
      "铁路用 https://www.12306.cn ，机票用航司官网或携程/去哪儿）。\n" +
      "4) 搜不到具体班次时：name 填『见购票链接』、price_cny 填『实时查询』、source_url 留空，" +
      "但必须给 booking_url——绝不编造车次号或票价。recommended 给出选择建议。\n" +
      "5) 再给目的地端机场/车站到市区的接驳，以及每天相邻区域的本地交通。\n" +
      "若出发地未填，outbound/inbound 的 options 可为空并在 recommended 说明。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["scheduling"]),
  });
}
