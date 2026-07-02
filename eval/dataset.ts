/**
 * 离线评测集。每条用例 = 一组流水线输入 + 期望。
 *
 * 覆盖维度（刻意挑有区分度的组合）：
 *   - 国内高铁 vs 跨境航班（考交通接地与时刻约束）
 *   - 当天出发（now 与出发日同日 → 去程时刻越界是重点）
 *   - 紧预算 vs 宽预算（考预算贴合）
 *   - 有/无出发地（考「去程置顶」不变式的触发与豁免）
 *
 * fixture 命名：eval/fixtures/<id>.json；--live 会据 id 落盘。
 */

import type { EvalCase } from "./types";

const base = {
  depart_time: null,
  return_by_time: null,
  party_size: 2,
  constraints: {} as Record<string, unknown>,
};

export const CASES: EvalCase[] = [
  {
    id: "tokyo-5d",
    desc: "北京→东京 5天 跨境航班 · 美食+文化 · 宽预算",
    input: {
      ...base,
      destination: "东京",
      origin: "北京",
      start_date: "2026-09-01",
      end_date: "2026-09-05",
      now: "2026-08-20 14:00",
      budget: 12000,
      travel_style: "美食 + 文化，节奏轻松",
    },
  },
  {
    id: "osaka-flawed",
    desc: "上海→大阪 4天 · 当天出发 · 紧预算（示范：有意埋入回归缺陷）",
    input: {
      ...base,
      destination: "大阪",
      origin: "上海",
      start_date: "2026-10-01",
      end_date: "2026-10-04",
      now: "2026-10-01 10:00", // 与出发同日 → 去程须晚于 10:00
      budget: 8000,
      travel_style: "亲子，节奏慢，怕早起",
    },
  },
  {
    id: "chengdu-3d",
    desc: "杭州→成都 3天 · 国内高铁/航班 · 美食",
    input: {
      ...base,
      destination: "成都",
      origin: "杭州",
      start_date: "2026-11-14",
      end_date: "2026-11-16",
      now: "2026-11-01 09:00",
      depart_time: "08:00",
      return_by_time: "22:00",
      budget: 5000,
      travel_style: "美食为主，火锅+小吃，休闲",
    },
  },
];

export function findCase(id: string): EvalCase | undefined {
  return CASES.find((c) => c.id === id);
}
