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
      "你是出行前质检员，重点把关【真实性与可行性】。审查最终行程是否：\n" +
      "- 交通可核实：去程/返程是否给了具体班次与【购票链接】；任何看起来像编造的车次/航班/票价" +
      "（无来源、链接缺失）一律标 high；\n" +
      "- 时间自洽：去程抵达时间不晚于首日首个活动、返程出发时间不早于尾日最后活动，衔接留足缓冲；\n" +
      "- 日期一致：行程天数与出发/返回日期吻合；\n" +
      "- 节奏合理（不过载）、预算匹配、区域动线顺、时段无冲突、覆盖用户风格诉求。\n" +
      "逐条列出问题（标 high/medium/low）并给改进建议。仅当无 high 级问题时 passed 设为 true。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["hub_planner"]),
  });
}
