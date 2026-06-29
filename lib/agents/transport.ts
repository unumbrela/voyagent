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
      "你是交通物流专家。首先规划【去程 outbound】：从出发地到目的地的主要交通" +
      "（航班/高铁/长途等，给出方式、大致班次时段与衔接建议）；以及【返程 inbound】：从目的地回出发地。" +
      "若出发地未填，则 outbound/inbound 给通用建议或留空。" +
      "然后给目的地机场/车站往返市区方案、（如涉及）城际中转，以及每天相邻区域之间的本地交通方式与提示。" +
      "用 web 搜索核实线路/票务。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["scheduling"]),
  });
}
