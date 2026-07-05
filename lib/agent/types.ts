/**
 * Copilot「小行」的前后端共用类型：消息 / 应用状态 / AG-UI 风格事件 / 生成式 UI 卡片。
 */

import type { TrainOption, FlightOption } from "@/lib/transport";
import type { DayWeather } from "@/lib/weather";
import type { Candidate } from "@/lib/candidates";
import type { ItineraryDiff } from "@/lib/diff";
import type { XhsGuide } from "@/lib/xhs/types";

/** 行程条目/天（与 page.tsx 的 ItineraryItem/Day 对齐；此处作为前后端契约） */
export interface ItinItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  booking_url?: string;
  /** 为什么推荐（RQ2 可解释）；hub_planner/refine 产出并透传 */
  why?: string;
  /** 取证来源链接（RQ3 证据锚定） */
  source_url?: string;
  /** 实际花费（用户记账） */
  actual_cost?: number;
}
export interface ItinDay {
  day: number;
  date: string;
  theme: string;
  items: ItinItem[];
}
export interface Reference {
  label: string;
  value: string;
}

/** 一轮对话消息 */
export interface AgentMsg {
  role: "user" | "assistant";
  content: string;
}

/** 前端每轮随消息一起上报的「共享应用状态」 */
export interface AppState {
  pathname: string;
  tripId: string | null;
  meta: {
    destination: string | null;
    origin: string | null;
    start_date: string | null;
    end_date: string | null;
  } | null;
  /** 当前行程精简快照（供模型推理/答疑；真正编辑仍以 DB 为准） */
  itinerary: { title?: string; days: ItinDay[] } | null;
  /** 当前本地时间 "YYYY-MM-DD HH:MM"（建行程/过滤车次用） */
  now: string | null;
  /** 用户偏好：AI 的每次改动都先给预览、确认后才应用（关闭时小改动会直接生效可撤销）。RQ1 控制权变量。 */
  alwaysPreview?: boolean;
}

/** 生成式 UI 卡片（tool_result 里携带，前端据 kind 渲染真实组件） */
export type Card =
  | {
      kind: "trains";
      from: string;
      to: string;
      date: string | null;
      items: TrainOption[];
    }
  | {
      kind: "flights";
      from: string;
      to: string;
      date: string | null;
      items: FlightOption[];
    }
  | { kind: "weather"; dest: string; daily: Record<string, DayWeather> }
  | { kind: "candidates"; items: Candidate[] }
  | { kind: "xhs_guide"; guide: XhsGuide };

/** AG-UI 风格事件流（服务端 → 前端，SSE 逐条推送） */
export type AgentEvent =
  | { type: "text"; delta: string }
  /** 本轮召回并注入的长期记忆（透明性：让用户看见 AI 参考了什么） */
  | { type: "memory"; texts: string[] }
  | { type: "tool_call"; name: string; label: string }
  | { type: "tool_result"; name: string; card?: Card; note?: string }
  | {
      type: "proposal";
      days: ItinDay[];
      references?: Reference[];
      diff: ItineraryDiff;
      summary: string;
    }
  | { type: "action"; kind: "apply_patch"; days: ItinDay[]; references?: Reference[]; summary: string }
  | { type: "action"; kind: "navigate"; tripId: string }
  | { type: "done" }
  | { type: "error"; message: string };
