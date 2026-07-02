/**
 * 候选池归一化（纯函数，无副作用）。
 *
 * 各 agent（activities/food/accommodation/transport）每类都产出 2~4 个真实候选，
 * 但 hub_planner 只挑一个写进最终行程，其余候选一直躺在 agent_outputs 里没被用起来。
 * 这里把它们归一化成统一的 Candidate 形状，供「候选探索与替换」抽屉展示、拖入行程。
 *
 * 约定与 lib/budget.ts 一致：只做汇总/转换，不做判定；缺失字段用空串/0 兜底，绝不编造。
 */

import type { AgentName } from "./agents/types";

/** 与 page.tsx 的 ItineraryItem.kind 对齐 */
export type CandidateKind = "activity" | "food" | "rest" | "transit";

export interface Candidate {
  /** React key / 拖拽标识（同批内稳定） */
  id: string;
  kind: CandidateKind;
  title: string;
  detail: string;
  /** 人民币估算；无法确定填 0（食/宿/交通多为区间或"实时查询"） */
  est_cost: number;
  /** 预订/购票深链（accommodation/transport 带；其余无） */
  booking_url?: string;
  /** 信息来源链接（搜索结果；未搜到为空） */
  source_url?: string;
  /** 分类小标签：活动类别 / 菜系 / 住宿类型 / 交通方式 */
  tag?: string;
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);
/** 从"¥520 起 / 520-680 / 实时查询"这类文本里取首个数字，取不到为 0 */
const priceNum = (v: unknown): number => {
  const m = s(v).match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : 0;
};
const join = (...parts: string[]): string =>
  parts.map((p) => p.trim()).filter(Boolean).join(" · ");

interface ActivityRow {
  name?: unknown; category?: unknown; area?: unknown; why?: unknown; est_cost?: unknown;
}
interface DiningRow {
  name?: unknown; cuisine?: unknown; area?: unknown; price_level?: unknown; note?: unknown;
}
interface StayRow {
  name?: unknown; type?: unknown; area?: unknown; price_per_night_cny?: unknown;
  rating?: unknown; why?: unknown; booking_url?: unknown; source_url?: unknown;
}
interface TransportRow {
  mode?: unknown; name?: unknown; depart?: unknown; arrive?: unknown;
  duration?: unknown; price_cny?: unknown; booking_url?: unknown; source_url?: unknown;
}

/**
 * 把已完成 agent 的产物归一化成 Candidate[]。
 * outputs: agent_name -> payload（只取 activities/food/accommodation/transport）。
 */
export function normalizeCandidates(
  outputs: Partial<Record<AgentName, unknown>>,
): Candidate[] {
  const out: Candidate[] = [];

  // ── 活动 ──
  const acts = (outputs.activities as { activities?: unknown })?.activities;
  if (Array.isArray(acts)) {
    acts.forEach((raw, i) => {
      const a = raw as ActivityRow;
      const title = s(a.name);
      if (!title) return;
      out.push({
        id: `activity-${i}`,
        kind: "activity",
        title,
        detail: join(s(a.area), s(a.why)),
        est_cost: n(a.est_cost),
        tag: s(a.category) || undefined,
      });
    });
  }

  // ── 餐饮 ──
  const dining = (outputs.food as { dining?: unknown })?.dining;
  if (Array.isArray(dining)) {
    dining.forEach((raw, i) => {
      const d = raw as DiningRow;
      const title = s(d.name);
      if (!title) return;
      out.push({
        id: `food-${i}`,
        kind: "food",
        title,
        detail: join(s(d.area), s(d.price_level), s(d.note)),
        est_cost: 0, // food 只有价位档（$/$$/$$$），无金额
        tag: s(d.cuisine) || undefined,
      });
    });
  }

  // ── 住宿 ──
  const stays = (outputs.accommodation as { options?: unknown })?.options;
  if (Array.isArray(stays)) {
    stays.forEach((raw, i) => {
      const h = raw as StayRow;
      const title = s(h.name);
      if (!title) return;
      const price = s(h.price_per_night_cny);
      out.push({
        id: `rest-${i}`,
        kind: "rest",
        title,
        detail: join(s(h.area), price ? `每晚${price}` : "", s(h.rating), s(h.why)),
        est_cost: priceNum(price),
        booking_url: s(h.booking_url) || undefined,
        source_url: s(h.source_url) || undefined,
        tag: s(h.type) || undefined,
      });
    });
  }

  // ── 交通（去程 + 返程各自的候选班次）──
  const transport = outputs.transport as
    | { outbound?: { options?: unknown }; inbound?: { options?: unknown } }
    | undefined;
  const legs: [string, unknown][] = [
    ["去程", transport?.outbound?.options],
    ["返程", transport?.inbound?.options],
  ];
  for (const [legLabel, opts] of legs) {
    if (!Array.isArray(opts)) continue;
    opts.forEach((raw, i) => {
      const t = raw as TransportRow;
      const name = s(t.name);
      const mode = s(t.mode);
      const title = [mode, name].filter(Boolean).join(" ") || legLabel;
      out.push({
        id: `transit-${legLabel}-${i}`,
        kind: "transit",
        title: `${legLabel} ${title}`.trim(),
        detail: join(
          [s(t.depart), s(t.arrive)].filter(Boolean).join(" → "),
          s(t.duration),
          s(t.price_cny),
        ),
        est_cost: priceNum(t.price_cny),
        booking_url: s(t.booking_url) || undefined,
        source_url: s(t.source_url) || undefined,
        tag: mode || undefined,
      });
    });
  }

  return out;
}
