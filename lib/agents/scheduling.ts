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
      "你是行程编排专家。综合上游的活动、餐饮、住宿、目的地背景，按天数排出合理的逐日框架。" +
      "原则：同区域活动尽量同天、动静结合、三餐穿插、预留休整；" +
      "【以住宿为锚点】：参考 accommodation 选定的酒店区域，每天动线尽量围绕酒店就近展开、" +
      "早出晚归回到同一住处，减少无谓往返；\n" +
      "【首日顺序铁律】：首日的**第一个** transit 块必须是【从出发地出发的去程】" +
      "（写明 出发地→目的地、交通方式，这是全程第一项；若出发地未填可省略）；" +
      "**抵达目的地之后**再单独一个 transit/rest 块为【抵达＋入住酒店】（写明酒店）——" +
      "切勿把入住排在出发之前。尾日最后一个 transit 块为离店/返程。" +
      "每天给主题，时段块标注 activity/food/rest/transit。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["enrichment", "activities", "food", "accommodation"]),
  });
}
