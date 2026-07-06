import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { activitiesSchema } from "./schemas";
import { contextBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Activities：景点/活动推荐（质量敏感，DeepSeek + 自建 web 搜索） */
export function runActivities(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    useWebSearch: true,
    schema: activitiesSchema,
    system:
      "你是活动策划专家。根据目的地、旅行风格、预算和人数，挑选 8~15 个值得做的活动/景点。" +
      "覆盖不同类别与区域，给出推荐理由、估算花费与时长。用 web 搜索确保景点真实、未关闭；" +
      "需要多个搜索时在【同一轮一次性并行发出】（一次回复带多个工具调用），别一轮只搜一个。" +
      "只输出结构化 JSON。",
    userPrompt: `请为以下行程推荐活动：\n\n${contextBlock(ctx.context)}`,
  });
}
