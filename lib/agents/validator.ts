import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { validatorSchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Validator：出行前质检（编排末环，DeepSeek） */
export function runValidator(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: validatorSchema,
    system:
      "你是出行前质检员。审查最终行程是否：节奏合理（不过载）、预算匹配、区域动线顺、" +
      "交通衔接可行、时段无冲突、覆盖用户风格诉求。逐条列出问题（标 high/medium/low）并给改进建议。" +
      "若整体可行 passed 设为 true。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["hub_planner"]),
  });
}
