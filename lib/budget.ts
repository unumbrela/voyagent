/**
 * 预算汇总（纯函数，无副作用）。
 *
 * 把行程里每个条目的 `est_cost` 汇总成可视化所需的数据：
 * 总额、按天、按类别、人均、与预算的差额与是否超支。
 * 口径与 validator「明显超预算标 medium」一致——只做汇总，不做判定文案。
 *
 * 约定：`est_cost` 为该条目的【总价】估算（人民币），与 schema/UI 现状一致；
 * 人均 = 总额 / party_size（party_size 缺省按 1）。
 */

export const BUDGET_KINDS = ["activity", "food", "rest", "transit"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

interface ItemLike {
  kind: string;
  est_cost?: number;
}
interface DayLike {
  items?: ItemLike[];
}

export interface BudgetSummary {
  /** 全程总花费（各条目 est_cost 之和） */
  total: number;
  /** 每天花费，下标对应 days 顺序 */
  byDay: number[];
  /** 按条目类别汇总；未知类别归入 "other" */
  byKind: Record<BudgetKind | "other", number>;
  /** 人均花费（总额 / party_size） */
  perPerson: number;
  /** 预算（无则为 null） */
  budget: number | null;
  /** 剩余预算 = budget - total；无预算时为 null */
  remaining: number | null;
  /** 已用预算占比 0~1（无预算时为 null） */
  ratio: number | null;
  /** 是否超预算（无预算时为 false） */
  overBudget: boolean;
}

const isKind = (k: string): k is BudgetKind =>
  (BUDGET_KINDS as readonly string[]).includes(k);

/** 计算预算汇总。`days` 为行程天数组，`budget`/`partySize` 来自 trip_context。 */
export function summarizeBudget(
  days: DayLike[],
  budget: number | null,
  partySize: number | null,
): BudgetSummary {
  const byKind: Record<BudgetKind | "other", number> = {
    activity: 0,
    food: 0,
    rest: 0,
    transit: 0,
    other: 0,
  };
  const byDay: number[] = [];
  let total = 0;

  for (const day of days) {
    let dayTotal = 0;
    for (const it of day.items ?? []) {
      const cost = Number(it.est_cost) || 0;
      if (cost <= 0) continue;
      dayTotal += cost;
      byKind[isKind(it.kind) ? it.kind : "other"] += cost;
    }
    byDay.push(dayTotal);
    total += dayTotal;
  }

  const size = partySize && partySize > 0 ? partySize : 1;
  const hasBudget = typeof budget === "number" && budget > 0;
  return {
    total,
    byDay,
    byKind,
    perPerson: total / size,
    budget: hasBudget ? budget : null,
    remaining: hasBudget ? budget - total : null,
    ratio: hasBudget ? total / budget : null,
    overBudget: hasBudget ? total > budget : false,
  };
}

/** 类别中文标签 + 配色（与 UI 徽章风格一致） */
export const KIND_META: Record<
  BudgetKind | "other",
  { label: string; color: string }
> = {
  activity: { label: "活动", color: "#6366f1" }, // indigo
  food: { label: "餐饮", color: "#f59e0b" }, // amber
  rest: { label: "住宿", color: "#10b981" }, // emerald
  transit: { label: "交通", color: "#3b82f6" }, // blue
  other: { label: "其他", color: "#9ca3af" }, // neutral
};

/** 金额格式化为 "¥1,234"（无小数，四舍五入） */
export function formatCny(n: number): string {
  return "¥" + Math.round(n).toLocaleString("zh-CN");
}
