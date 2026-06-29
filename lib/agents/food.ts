import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { foodSchema } from "./schemas";
import { contextBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Food：餐饮指南（轻量任务，用 DeepSeek deepseek-chat） */
export function runFood(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    schema: foodSchema,
    system:
      "你是美食向导。根据目的地、预算和旅行风格，推荐 8~12 家餐厅/小吃，覆盖当地特色与不同价位。" +
      "标注菜系、所在区域、价位和一句话亮点。只输出结构化 JSON。",
    userPrompt: `请为以下行程推荐餐饮：\n\n${contextBlock(ctx.context)}`,
  });
}
