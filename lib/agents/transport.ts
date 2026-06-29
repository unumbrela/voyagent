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
      "你是交通物流专家。基于已排好的逐日行程，给出机场往返方案、（如涉及）城际交通，" +
      "以及每天相邻区域之间的本地交通方式与提示。用 web 搜索核实线路/票务。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["scheduling"]),
  });
}
