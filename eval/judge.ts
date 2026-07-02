/**
 * LLM-as-Judge：确定性断言管硬约束，评审模型管「好不好」这类主观质量。
 * 用一份显式 rubric（1~5 分）压住评分漂移，复用项目现成的 runAgent(deepseek)。
 */

import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "@/lib/agents/runAgent";
import { contextBlock } from "@/lib/agents/prompt";
import type { EvalCase, JudgeResult, PipelineResult } from "./types";

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "overall", "rationale", "weaknesses"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "feasibility",
        "route_efficiency",
        "budget_fit",
        "style_match",
        "pacing",
      ],
      properties: {
        feasibility: { type: "number" },
        route_efficiency: { type: "number" },
        budget_fit: { type: "number" },
        style_match: { type: "number" },
        pacing: { type: "number" },
      },
    },
    overall: { type: "number" },
    rationale: { type: "string" },
    weaknesses: { type: "array", items: { type: "string" } },
  },
};

/** 把行程压成精简文本给评审（不塞整段 JSON，省 token 也更聚焦） */
function itineraryText(r: PipelineResult): string {
  return (r.itinerary?.days ?? [])
    .map(
      (d) =>
        `第${d.day}天(${d.date}·${d.theme}):\n` +
        (d.items ?? [])
          .map(
            (it) =>
              `  - ${it.time || "—"} [${it.kind}] ${it.title}（¥${it.est_cost}）${it.detail ? "：" + it.detail : ""}`,
          )
          .join("\n"),
    )
    .join("\n");
}

const RUBRIC =
  "评分口径（1~5，整数）：\n" +
  "- feasibility 可行性：时间/交通/开门时间是否自洽，能不能真的照着走。\n" +
  "- route_efficiency 动线：同日活动是否就近、有无来回折返、跨区是否合理。\n" +
  "- budget_fit 预算贴合：总花费与预算的匹配度（既不爆也不过度抠）。\n" +
  "- style_match 风格契合：是否命中用户的旅行风格/诉求。\n" +
  "- pacing 节奏：每天松紧是否得当，有无过载或过空。\n" +
  "5=优秀 4=良好 3=及格 2=偏弱 1=差。overall 为综合印象（可非均值）。";

export async function judge(
  c: EvalCase,
  r: PipelineResult,
): Promise<JudgeResult> {
  return runAgent<JudgeResult>({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 2000,
    schema: judgeSchema,
    system:
      "你是严格但公允的行程评审专家。依据给定 rubric 为一份旅行行程打分，" +
      "只依据材料本身、不臆测缺失信息，指出真实弱点。只输出结构化 JSON。\n\n" +
      RUBRIC,
    userPrompt:
      `# 用户诉求\n${contextBlock(c.input)}\n\n` +
      `# 行程标题\n${r.itinerary?.title ?? ""}\n\n` +
      `# 逐日行程\n${itineraryText(r)}\n\n` +
      `# 住宿建议\n${r.accommodation?.recommended ?? "（无）"}\n` +
      `# 交通建议\n去程：${r.transport?.outbound?.recommended ?? "（无）"}\n返程：${r.transport?.inbound?.recommended ?? "（无）"}`,
  });
}
