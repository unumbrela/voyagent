import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { itinerarySchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Hub Planner：把所有产物综合成最终行程（编排器的"综合"环节，DeepSeek） */
export function runHubPlanner(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: itinerarySchema,
    system:
      "你是总规划师。把上游所有产物（背景、活动、餐饮、日程框架、交通）融合成一份成品行程：" +
      "给标题与概览；逐日列出带时间、类型、细节和花费估算的条目，自然嵌入交通衔接与餐饮。\n" +
      "交通【必须忠实搬运 transport 产物，不得改动或杜撰车次/航班/票价】：" +
      "首日开头的 transit 条目 detail 写上去程 outbound 推荐班次的车次/航班号、出发到达站与时间、" +
      "票价，并把 booking_url 附在 detail 末尾（形如『购票: https://...』）；est_cost 用该班次票价；" +
      "尾日结尾的 transit 条目同理写返程 inbound。概览中点明出发地→目的地的整体路线与交通方式。\n" +
      "references 必须包含：『去程购票』『返程购票』两条，value 写明推荐班次摘要 + booking_url；" +
      "再加货币、语言、紧急提示等。所有票务信息以 transport 给的为准，搜不到的标『实时查询』。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, [
        "enrichment",
        "activities",
        "food",
        "scheduling",
        "transport",
      ]),
  });
}
