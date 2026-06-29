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
      "给标题与概览；逐日列出带时间、类型、细节和花费估算的条目，自然嵌入交通衔接与餐饮。" +
      "首日开头嵌入从出发地出发的【去程】交通（kind=transit），尾日结尾嵌入回出发地的【返程】交通；" +
      "概览中点明从出发地到目的地的整体路线。" +
      "references 汇总关键信息（货币、语言、紧急提示、去程/返程要点等）。只输出结构化 JSON。",
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
