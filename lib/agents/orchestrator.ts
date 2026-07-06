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
 * 旅行规划有强依赖链（活动/餐饮 → 住宿 → 日程 → 综合 → 质检），
 * 依赖链之外的 agent 全部塞进第 1 波并行。
 *
 * transport 只依赖出发地/目的地/日期（都在 context 里），不依赖日程——
 * 它是最慢的搜索型 agent 之一，放第 1 波并行可把总时长砍掉一整段；
 * 反过来 scheduling 还能吃到真实班次，用到达/返程时刻锚定首尾日。
 */
export const WAVES: AgentStep[][] = [
  // 第 1 波（并行）：互相独立（transport 只需 context 的出发地/目的地/日期）
  [
    { name: "enrichment", run: runEnrichment },
    { name: "activities", run: runActivities },
    { name: "food", run: runFood },
    { name: "transport", run: runTransport },
  ],
  // 第 2 波：依据活动分布选住宿区位（贴近景点、动线短）
  [{ name: "accommodation", run: runAccommodation }],
  // 第 3 波：综合上游（含住宿、真实班次）排逐日框架，首尾日以班次时刻为锚
  [{ name: "scheduling", run: runScheduling }],
  // 收尾：综合成最终行程
  [{ name: "hub_planner", run: runHubPlanner }],
  // 出行前质检
  [{ name: "validator", run: runValidator }],
];
