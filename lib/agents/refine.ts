import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { itinerarySchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/**
 * Refine：对**已成形的行程**按用户自然语言指令做局部/整体修订。
 *
 * 与 hub_planner 的差别：输入是「当前行程（含用户手动编辑）」而非从零综合。
 * 铁律：只按指令改动，其余条目**原样保留**；不得编造车次/航班/酒店/票价；
 * 已有的 booking_url 一律保留。可取材自上游 activities/food/accommodation 的真实候选。
 */
export function runRefine(
  ctx: AgentContext,
  currentItinerary: unknown,
  instruction: string,
  scope: "all" | { day: number },
) {
  const scopeText =
    scope === "all"
      ? "本次修订作用于【整段行程】。"
      : `本次修订**只**作用于【第 ${scope.day} 天】，其余各天必须原样返回、一字不改。`;

  return runAgent({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: itinerarySchema,
    system:
      "你是行程优化助手。用户给你一份**已成形的行程**和一条修订指令，请在**尽量保持其余内容稳定**的前提下，" +
      "按指令产出改进后的【完整行程】（仍是同样的 JSON 结构：title/overview/days/references）。\n" +
      "硬性要求：\n" +
      "- 未被指令涉及的条目/天，**原样保留**（包括 time/title/kind/detail/est_cost/why/source_url 与文中链接），不要润色或重排。\n" +
      "- **不得编造**车次/航班/酒店名/票价；如需新增交通或住宿，优先取材自上游 activities/food/accommodation/transport 的真实候选；拿不准的标『实时查询』。\n" +
      "- 保留条目里已有的购票/预订链接（detail 末尾的 http 链接或 booking_url）。\n" +
      "- 保持天数与出发/返回日期一致；每天的 day/date 不要改。\n" +
      "- 首日第一项仍应是【去程出发】、尾日结尾仍是【返程】（若原行程如此）。\n" +
      `${scopeText}\n只输出结构化 JSON。`,
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      `## 当前行程（待修订，请在此基础上改）\n${JSON.stringify(currentItinerary, null, 2)}\n\n` +
      `## 用户修订指令\n${instruction}\n\n` +
      // 供取材的真实候选（避免编造）
      upstreamBlock(ctx, ["activities", "food", "accommodation", "transport"]),
  });
}
