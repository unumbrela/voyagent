import { runEnrichment } from "./enrichment";
import { runActivities } from "./activities";
import { runFood } from "./food";
import { runAccommodation } from "./accommodation";
import { runScheduling } from "./scheduling";
import { runTransport } from "./transport";
import { runHubPlanner } from "./hub-planner";
import { runValidator } from "./validator";
import type { AgentContext, AgentName } from "./types";

export interface AgentStep {
  name: AgentName;
  run: (ctx: AgentContext) => Promise<unknown>;
}

/**
 * Orchestrator 的派发结构：波内并行、波间顺序。
 * 旅行规划有强依赖链（活动/餐饮 → 日程 → 交通 → 综合 → 质检），
 * 所以第 1 波三个独立 agent 并行，其余按依赖顺序串行。
 */
export const WAVES: AgentStep[][] = [
  // 第 1 波（并行）：互相独立
  [
    { name: "enrichment", run: runEnrichment },
    { name: "activities", run: runActivities },
    { name: "food", run: runFood },
  ],
  // 第 2 波：依据活动分布选住宿区位（贴近景点、动线短）
  [{ name: "accommodation", run: runAccommodation }],
  // 第 3 波：综合上游（含住宿）排逐日框架，每天从酒店出发
  [{ name: "scheduling", run: runScheduling }],
  // 第 4 波：依赖已排好的日程
  [{ name: "transport", run: runTransport }],
  // 收尾：综合成最终行程
  [{ name: "hub_planner", run: runHubPlanner }],
  // 出行前质检
  [{ name: "validator", run: runValidator }],
];
