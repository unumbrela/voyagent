/**
 * 规划过程摘要（纯函数，无副作用）——P2 多智能体过程可见化 / 可解释（RQ2）。
 *
 * 把 agent_outputs（各专家 agent 的真实产物）翻译成人能读懂的「它做了什么、
 * 选了谁、找到多少候选、有哪些取证来源」，让多智能体黑箱变得 legible。
 * 与 candidates.ts / budget.ts 一致：只做归纳/转换，不做判定，缺失字段兜底，绝不编造。
 */

import type { AgentName } from "./agents/types";

export type AgentStatus = "pending" | "running" | "done" | "error";

export interface TraceSource {
  label: string; // 来源 / 预订
  url: string;
}

export interface AgentTrace {
  agent: AgentName;
  label: string; // 中文名
  wave: number; // 第几波
  status: AgentStatus;
  what: string; // 一句话：这个 agent 负责什么
  summary: string[]; // 它实际产出/决策的要点
  recommended: string | null; // 它的一句话首选（若有）
  candidateCount: number; // 它给出的真实候选/备选数量
  sources: TraceSource[]; // 取证来源（去重）
  searched: boolean; // 是否带来了可核实的真实数据（web 搜索取证的代理指标）
  error?: string | null;
}

/** 按执行顺序（波）排列的元信息，与 orchestrator WAVES 一致 */
const META: { agent: AgentName; label: string; wave: number; what: string }[] = [
  { agent: "enrichment", label: "了解目的地", wave: 1, what: "了解目的地的基本情况：季节、货币、语言、安全和本地小贴士" },
  { agent: "activities", label: "推荐活动", wave: 1, what: "上网找真实的景点和活动，并说明为什么推荐" },
  { agent: "food", label: "推荐美食", wave: 1, what: "整理当地的餐厅（菜系、区域、价位）" },
  { agent: "transport", label: "安排交通", wave: 1, what: "上网找真实的去程和返程班次（带来源和购票链接）" },
  { agent: "accommodation", label: "推荐住宿", wave: 2, what: "根据活动分布挑住的区域，上网找真实住宿（带来源和预订链接）" },
  { agent: "scheduling", label: "安排日程", wave: 3, what: "以住宿为中心、以真实班次为锚，把这些地方排成每天的大致路线" },
  { agent: "hub_planner", label: "汇总行程", wave: 4, what: "把前面的结果汇总成每天的完整行程" },
  { agent: "validator", label: "检查行程", wave: 5, what: "在出发前检查整份行程，挑出问题" },
];

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 递归收集 payload 里的取证链接（source_url=来源 / booking_url=预订），去重、限量 */
function collectSources(payload: unknown, cap = 8): TraceSource[] {
  const seen = new Set<string>();
  const out: TraceSource[] = [];
  const walk = (node: unknown) => {
    if (out.length >= cap || node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (out.length >= cap) return;
        if ((k === "source_url" || k === "booking_url") && typeof v === "string") {
          const url = v.trim();
          if (/^https?:\/\//.test(url) && !seen.has(url)) {
            seen.add(url);
            out.push({ label: k === "source_url" ? "来源" : "预订", url });
          }
        } else if (v && typeof v === "object") {
          walk(v);
        }
      }
    }
  };
  walk(payload);
  return out;
}

/** 生成单个 agent 的摘要要点 + 推荐 + 候选数 */
function summarizeOne(
  agent: AgentName,
  payload: unknown,
): { summary: string[]; recommended: string | null; candidateCount: number } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const summary: string[] = [];
  let recommended: string | null = null;
  let candidateCount = 0;

  switch (agent) {
    case "enrichment": {
      if (s(p.summary)) summary.push(s(p.summary));
      const seasons = arr(p.best_seasons).map(s).filter(Boolean);
      if (seasons.length) summary.push(`适合季节：${seasons.join("、")}`);
      const tips = arr(p.local_tips).length;
      const safety = arr(p.safety_notes).length;
      if (tips || safety) summary.push(`整理 ${tips} 条本地贴士、${safety} 条安全提示`);
      break;
    }
    case "activities": {
      const acts = arr(p.activities);
      candidateCount = acts.length;
      const cats = Array.from(
        new Set(acts.map((a) => s((a as Record<string, unknown>).category)).filter(Boolean)),
      );
      summary.push(`找到 ${acts.length} 个活动候选` + (cats.length ? `，覆盖：${cats.join("、")}` : ""));
      const names = acts.slice(0, 4).map((a) => s((a as Record<string, unknown>).name)).filter(Boolean);
      if (names.length) summary.push("如：" + names.join("、"));
      break;
    }
    case "food": {
      const dining = arr(p.dining);
      candidateCount = dining.length;
      const cuisines = Array.from(
        new Set(dining.map((d) => s((d as Record<string, unknown>).cuisine)).filter(Boolean)),
      );
      summary.push(`找到 ${dining.length} 家餐饮候选` + (cuisines.length ? `，菜系：${cuisines.slice(0, 6).join("、")}` : ""));
      break;
    }
    case "accommodation": {
      const opts = arr(p.options);
      candidateCount = opts.length;
      recommended = s(p.recommended) || null;
      if (s(p.area_advice)) summary.push(`选区建议：${s(p.area_advice)}`);
      summary.push(`找到 ${opts.length} 家真实住宿候选（尽量带来源与预订链接）`);
      break;
    }
    case "scheduling": {
      const days = arr(p.days);
      const themes = days.map((d) => s((d as Record<string, unknown>).theme)).filter(Boolean);
      summary.push(`编排 ${days.length} 天日程框架` + (themes.length ? `：${themes.join(" / ")}` : ""));
      break;
    }
    case "transport": {
      const ob = (p.outbound ?? {}) as Record<string, unknown>;
      const ib = (p.inbound ?? {}) as Record<string, unknown>;
      const obN = arr(ob.options).length;
      const ibN = arr(ib.options).length;
      candidateCount = obN + ibN;
      const rec = [s(ob.recommended), s(ib.recommended)].filter(Boolean).join("；");
      recommended = rec || null;
      summary.push(`去程 ${s(ob.from) || "?"}→${s(ob.to) || "?"}：${obN} 个班次候选`);
      summary.push(`返程 ${s(ib.from) || "?"}→${s(ib.to) || "?"}：${ibN} 个班次候选`);
      if (s(p.airport_transfer)) summary.push(`接驳：${s(p.airport_transfer)}`);
      break;
    }
    case "hub_planner": {
      const days = arr(p.days);
      const itemCount = days.reduce<number>(
        (acc, d) => acc + arr((d as Record<string, unknown>).items).length,
        0,
      );
      summary.push(`综合成 ${days.length} 天成品行程，共 ${itemCount} 个条目`);
      const refs = arr(p.references).length;
      if (refs) summary.push(`附 ${refs} 条关键信息（住宿/票务等）`);
      break;
    }
    case "validator": {
      const issues = arr(p.issues);
      const bySev = { high: 0, medium: 0, low: 0 } as Record<string, number>;
      for (const i of issues) {
        const sev = s((i as Record<string, unknown>).severity).toLowerCase();
        if (sev in bySev) bySev[sev]++;
      }
      summary.push(p.passed === true ? "质检结论：通过 ✓" : "质检结论：发现需注意的问题");
      summary.push(`共 ${issues.length} 个问题（high ${bySev.high} / medium ${bySev.medium} / low ${bySev.low}）`);
      const sug = arr(p.suggestions).length;
      if (sug) summary.push(`给出 ${sug} 条改进建议`);
      break;
    }
  }
  return { summary, recommended, candidateCount };
}

/**
 * 把 agent_outputs 行归纳成有序的 AgentTrace[]（按波次排列）。
 * rows: [{ agent_name, status, payload, error }]
 */
export function summarizeTrace(
  rows: {
    agent_name: string;
    status?: string | null;
    payload?: unknown;
    error?: string | null;
  }[],
): AgentTrace[] {
  const byAgent = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byAgent.set(r.agent_name, r);

  return META.map((m) => {
    const row = byAgent.get(m.agent);
    const status = (row?.status as AgentStatus) ?? "pending";
    const payload = status === "done" ? row?.payload : null;
    const { summary, recommended, candidateCount } = summarizeOne(m.agent, payload);
    const sources = collectSources(payload);
    return {
      agent: m.agent,
      label: m.label,
      wave: m.wave,
      status,
      what: m.what,
      summary,
      recommended,
      candidateCount,
      sources,
      searched: sources.length > 0,
      error: row?.error ?? null,
    };
  });
}
