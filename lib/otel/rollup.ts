/**
 * span 聚合（纯函数，无副作用，可离线单测）。
 * 把扁平的 Span[] 归纳成：整体汇总 + 分 agent 明细 + 瀑布图行。
 */

import type { Span, SpanKind } from "./trace";

export interface Rollup {
  spanCount: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  /** 墙钟总时长（首 span 开始 → 末 span 结束）——并行会小于各 span 之和 */
  wallMs: number;
  /** 各 agent 耗时之和（体现并行节省了多少） */
  sumAgentMs: number;
  byAgent: AgentRollup[];
}

export interface AgentRollup {
  name: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  llmCalls: number;
  toolCalls: number;
  error: string | null;
}

export interface WaterfallRow {
  id: string;
  parentId: string | null;
  depth: number;
  name: string;
  kind: SpanKind;
  /** 相对整条 trace 起点的偏移（ms） */
  offsetMs: number;
  durationMs: number;
  model?: string;
  totalTokens?: number;
  costUsd?: number;
  error?: string | null;
}

function childrenMap(spans: Span[]): Map<string | null, Span[]> {
  const m = new Map<string | null, Span[]>();
  for (const s of spans) {
    const arr = m.get(s.parentId) ?? [];
    arr.push(s);
    m.set(s.parentId, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.startMs - b.startMs);
  return m;
}

/** 收集某 span 的全部后代（不含自身） */
function descendants(root: Span, kids: Map<string | null, Span[]>): Span[] {
  const out: Span[] = [];
  const stack = [...(kids.get(root.id) ?? [])];
  while (stack.length) {
    const s = stack.pop()!;
    out.push(s);
    for (const c of kids.get(s.id) ?? []) stack.push(c);
  }
  return out;
}

export function rollup(spans: Span[]): Rollup {
  const kids = childrenMap(spans);
  const llm = spans.filter((s) => s.kind === "llm");
  const tool = spans.filter((s) => s.kind === "tool");
  const agents = spans.filter((s) => s.kind === "agent");

  const promptTokens = llm.reduce((a, s) => a + (s.promptTokens ?? 0), 0);
  const completionTokens = llm.reduce((a, s) => a + (s.completionTokens ?? 0), 0);
  const totalCostUsd = llm.reduce((a, s) => a + (s.costUsd ?? 0), 0);

  const starts = spans.map((s) => s.startMs);
  const ends = spans.map((s) => s.startMs + s.durationMs);
  const wallMs = spans.length ? Math.max(...ends) - Math.min(...starts) : 0;

  const byAgent: AgentRollup[] = agents
    .map((a) => {
      const desc = descendants(a, kids);
      const dLlm = desc.filter((s) => s.kind === "llm");
      const dTool = desc.filter((s) => s.kind === "tool");
      return {
        name: a.name,
        durationMs: a.durationMs,
        costUsd: dLlm.reduce((x, s) => x + (s.costUsd ?? 0), 0),
        totalTokens: dLlm.reduce((x, s) => x + (s.totalTokens ?? 0), 0),
        llmCalls: dLlm.length,
        toolCalls: dTool.length,
        error: a.error ?? null,
      };
    })
    .sort((x, y) => y.durationMs - x.durationMs);

  return {
    spanCount: spans.length,
    llmCalls: llm.length,
    toolCalls: tool.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
    wallMs,
    sumAgentMs: agents.reduce((a, s) => a + s.durationMs, 0),
    byAgent,
  };
}

/** 扁平 span → 深度优先的瀑布行（按开始时间排） */
export function waterfall(spans: Span[]): WaterfallRow[] {
  if (!spans.length) return [];
  const kids = childrenMap(spans);
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const rows: WaterfallRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const s of kids.get(parentId) ?? []) {
      rows.push({
        id: s.id,
        parentId: s.parentId,
        depth,
        name: s.name,
        kind: s.kind,
        offsetMs: s.startMs - t0,
        durationMs: s.durationMs,
        model: s.model,
        totalTokens: s.totalTokens,
        costUsd: s.costUsd,
        error: s.error,
      });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** 终端 ASCII 瀑布（demo / 日志用） */
export function asciiWaterfall(spans: Span[], width = 40): string {
  const rows = waterfall(spans);
  if (!rows.length) return "(无 span)";
  const span0 = Math.max(...rows.map((r) => r.offsetMs + r.durationMs), 1);
  const glyph: Record<SpanKind, string> = {
    pipeline: "▣",
    agent: "■",
    llm: "▸",
    tool: "◇",
  };
  return rows
    .map((r) => {
      const start = Math.round((r.offsetMs / span0) * width);
      const len = Math.max(1, Math.round((r.durationMs / span0) * width));
      const bar = " ".repeat(start) + "█".repeat(len);
      const label = "  ".repeat(r.depth) + glyph[r.kind] + " " + r.name;
      const cost = r.costUsd ? ` $${r.costUsd.toFixed(4)}` : "";
      const tok = r.totalTokens ? ` ${r.totalTokens}tok` : "";
      const err = r.error ? " ✗" : "";
      return (
        label.padEnd(28).slice(0, 28) +
        " |" +
        bar.padEnd(width) +
        "| " +
        `${r.durationMs}ms${tok}${cost}${err}`
      );
    })
    .join("\n");
}
