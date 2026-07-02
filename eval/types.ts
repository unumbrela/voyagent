/**
 * 评测体系的共享类型。
 *
 * 设计：把「生成」与「打分」解耦——
 *   - 生成：--live 时用内存版流水线跑出 PipelineResult，落盘成 fixture；
 *   - 打分：确定性断言 + LLM-as-Judge 都只吃 PipelineResult，可离线跑（无需 API key）。
 * 这样评测能进 CI（对着 fixture 跑断言做回归），也能随时 --live 重算真实产物。
 */

import type { TripContext } from "@/lib/agents/types";

// ── 被评测的产物（与 lib/agents/schemas.ts 的 json_schema 对齐）──

export interface ItinItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  booking_url?: string;
}
export interface ItinDay {
  day: number;
  date: string;
  theme: string;
  items: ItinItem[];
}
export interface Itinerary {
  title: string;
  overview: string;
  days: ItinDay[];
  references: { label: string; value: string }[];
}

export interface TransportOption {
  mode: string;
  name: string;
  depart: string;
  arrive: string;
  duration: string;
  price_cny: string;
  booking_url: string;
  source_url: string;
}
export interface TransportLeg {
  from: string;
  to: string;
  recommended: string;
  options: TransportOption[];
}
export interface TransportPayload {
  outbound: TransportLeg;
  inbound: TransportLeg;
  airport_transfer: string;
  local: { from_area: string; to_area: string; mode: string; note: string }[];
}

export interface AccommodationOption {
  name: string;
  type: string;
  area: string;
  price_per_night_cny: string;
  rating: string;
  why: string;
  booking_url: string;
  source_url: string;
}
export interface AccommodationPayload {
  recommended: string;
  area_advice: string;
  options: AccommodationOption[];
}

export interface ValidatorPayload {
  passed: boolean;
  issues: { severity: string; area: string; note: string }[];
  suggestions: string[];
}

/** 一次流水线跑完、供评测消费的全部产物 */
export interface PipelineResult {
  itinerary: Itinerary;
  transport: TransportPayload;
  accommodation: AccommodationPayload;
  validator: ValidatorPayload;
}

// ── 评测用例 ──

export interface EvalCase {
  id: string;
  desc: string;
  /** 流水线输入（单一事实来源） */
  input: TripContext;
  /** 用例级期望（覆盖/补充全局不变式） */
  expect?: {
    /** 期望天数；缺省时由 start_date/end_date 推出 */
    days?: number;
  };
}

// ── 断言结果 ──

export type Severity = "high" | "medium" | "low";

/** 一条确定性检查的结果 */
export interface Check {
  name: string;
  pass: boolean;
  /** 失败时的严重级别（high 会 gating CI） */
  severity: Severity;
  detail: string;
}

// ── LLM 评审结果 ──

export interface JudgeScores {
  feasibility: number; // 整体可行性
  route_efficiency: number; // 动线合理
  budget_fit: number; // 预算贴合
  style_match: number; // 风格契合
  pacing: number; // 节奏
}
export interface JudgeResult {
  scores: JudgeScores;
  overall: number;
  rationale: string;
  weaknesses: string[];
}

/** 单个用例的完整评测结果 */
export interface CaseReport {
  id: string;
  desc: string;
  checks: Check[];
  judge?: JudgeResult;
  source: "fixture" | "live";
}
