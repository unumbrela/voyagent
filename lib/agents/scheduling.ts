import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { schedulingSchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Scheduling：逐日行程编排（核心推理，DeepSeek，读上游活动/餐饮/背景） */
export function runScheduling(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: schedulingSchema,
    system:
      "你是行程编排专家。综合上游的活动、餐饮、目的地背景，按天数排出合理的逐日框架。" +
      "原则：同区域活动尽量同天、动静结合、三餐穿插、预留休整、首尾日考虑到离店。" +
      "每天给主题，时段块标注 activity/food/rest/transit。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["enrichment", "activities", "food"]),
  });
}
