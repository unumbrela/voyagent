import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { enrichmentSchema } from "./schemas";
import { contextBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Enrichment：目的地背景调研（轻量任务，用 DeepSeek deepseek-chat） */
export function runEnrichment(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    schema: enrichmentSchema,
    system:
      "你是目的地调研专家。基于目的地补全背景信息：概览、最佳季节、货币、语言、" +
      "安全提示、实用本地贴士。只输出结构化 JSON。",
    userPrompt: `请调研以下行程的目的地背景：\n\n${contextBlock(ctx.context)}`,
  });
}
