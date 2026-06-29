import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { itinerarySchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** Hub Planner：把所有产物综合成最终行程（编排器的"综合"环节，DeepSeek） */
export function runHubPlanner(ctx: AgentContext) {
  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: itinerarySchema,
    system:
      "你是总规划师。把上游所有产物（背景、活动、餐饮、住宿、日程框架、交通）融合成一份成品行程：" +
      "给标题与概览；逐日列出带时间、类型、细节和花费估算的条目，自然嵌入交通衔接与餐饮。\n" +
      "【全程第一项铁律】：首日的**第一个**条目必须是【去程出发】(transit)——" +
      "title 体现『出发/去程』（如『购票出发：出发地 → 目的地』），detail 忠实写 transport 的 outbound " +
      "推荐班次：车次/航班号、出发到达站与时间、票价，booking_url 附在末尾（形如『购票: https://...』），" +
      "est_cost 用该班次票价。【不得】把入住酒店、抵达或任何活动排在去程出发之前。" +
      "尾日结尾的 transit 条目同理写返程 inbound。概览中点明出发地→目的地的整体路线与交通方式。\n" +
      "住宿【必须忠实搬运 accommodation 首选酒店，不得编造】：在**抵达目的地之后**单独一个 transit 条目" +
      "（绝非全程第一项）写入住的酒店名、区域与每晚价，并把 booking_url 附在末尾（形如『预订: https://...』）；" +
      "概览中点明住在哪个区域。references 必须含一条『住宿』：value 写首选酒店摘要 + booking_url。\n" +
      "交通【必须忠实搬运 transport 产物，不得改动或杜撰车次/航班/票价】：" +
      "references 必须包含：『去程购票』『返程购票』两条，value 写明推荐班次摘要 + booking_url；" +
      "再加货币、语言、紧急提示等。所有票务信息以 transport 给的为准，搜不到的标『实时查询』。\n" +
      "【若上游含 validator 质检产物（修订轮）】：这是一次修订，请逐条修复其中 severity=high 的问题" +
      "（如时间冲突、票务缺链接、节奏过载、预算不符），在保持其余内容稳定的前提下产出改进后的完整行程。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      // validator 仅在修订轮存在；存在时一并喂入，指导 hub_planner 修复 high 问题
      upstreamBlock(ctx, [
        "enrichment",
        "activities",
        "food",
        "accommodation",
        "scheduling",
        "transport",
        "validator",
      ]),
  });
}
