/** 单一事实来源：所有 agent 只读它 */
export interface TripContext {
  destination: string;
  /** 出发地（自动定位或手填）；用于规划去程/返程交通 */
  origin: string | null;
  start_date: string | null;
  end_date: string | null;
  /** 当前本地时间 "YYYY-MM-DD HH:MM"；用于过滤已发车的去程班次 */
  now: string | null;
  /** 去程最早出发时间 "HH:MM"（可选） */
  depart_time: string | null;
  /** 返程最晚到达时间 "HH:MM"（可选）；返程到达须早于此 */
  return_by_time: string | null;
  budget: number | null;
  travel_style: string | null;
  party_size: number;
  constraints: Record<string, unknown>;
}

/** 7 个 agent 的名字（与 DB agent_outputs.agent_name 对齐） */
export type AgentName =
  | "enrichment"
  | "activities"
  | "food"
  | "accommodation"
  | "scheduling"
  | "transport"
  | "hub_planner"
  | "validator";

/**
 * 传给每个 agent 的上下文：
 *  - context: 单一事实来源
 *  - upstream: 上游已完成 agent 的产物（agent_name -> payload）
 */
export interface AgentContext {
  context: TripContext;
  upstream: Partial<Record<AgentName, unknown>>;
}

/** 一个 agent 的定义 */
export interface AgentDef<T = unknown> {
  name: AgentName;
  /** 构造发给 Claude 的 system + user prompt，并选模型/工具/schema */
  run: (ctx: AgentContext) => Promise<T>;
}

/** 编排进度事件（推给 SSE） */
export interface ProgressEvent {
  type: "agent_status" | "done" | "error";
  agent?: AgentName;
  status?: "running" | "done" | "error";
  message?: string;
  /** done 时携带最终行程 */
  itinerary?: unknown;
}
