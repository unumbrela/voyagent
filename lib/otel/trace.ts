/**
 * 轻量分布式追踪：用 AsyncLocalStorage 让 span 在异步调用链里自动嵌套，
 * 无需把 tracer 一路透传到每个函数签名里。
 *
 * 三类 span：
 *   - agent：一个专家 agent 的一次执行（含重试）
 *   - llm  ：一次模型 HTTP 调用（带真实 token 用量 → 折算成本）
 *   - tool ：一次工具调用（web 搜索等）
 *
 * 设计要点：
 *   - 【零副作用】没有活动 trace 时 span() 直接执行函数体、不记录——
 *     所以 eval / Copilot / 任何未包裹路径都不受影响，也不会报错。
 *   - 并行安全：每个 span 在自己的 als.run 分支里跑，兄弟并行也能拿到正确 parent。
 *   - 观测绝不拖垮主流程：落库失败只告警，不抛。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd } from "./pricing";

export type SpanKind = "agent" | "llm" | "tool" | "pipeline";

export interface Span {
  id: string;
  parentId: string | null;
  traceId: string;
  name: string;
  kind: SpanKind;
  startMs: number; // epoch ms
  durationMs: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  meta?: Record<string, unknown>;
  error?: string | null;
}

/** span 体内可用的记录器：附加用量/元信息到当前 span */
export interface SpanRecorder {
  setUsage(model: string, promptTokens: number, completionTokens: number): void;
  setMeta(key: string, value: unknown): void;
}

interface TraceStore {
  traceId: string;
  spans: Span[]; // 整条 trace 共享同一数组引用
  stack: string[]; // 当前 parent span id 栈（栈顶 = 直接父）
}

const als = new AsyncLocalStorage<TraceStore>();

const NOOP_RECORDER: SpanRecorder = {
  setUsage() {},
  setMeta() {},
};

/**
 * 记录一个 span。无活动 trace 时退化为直接执行 fn（零开销、零副作用）。
 */
export async function span<T>(
  name: string,
  kind: SpanKind,
  fn: (rec: SpanRecorder) => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const store = als.getStore();
  if (!store) return fn(NOOP_RECORDER);

  const sp: Span = {
    id: randomUUID(),
    parentId: store.stack[store.stack.length - 1] ?? null,
    traceId: store.traceId,
    name,
    kind,
    startMs: Date.now(),
    durationMs: 0,
    meta: meta ? { ...meta } : undefined,
    error: null,
  };
  store.spans.push(sp);

  const rec: SpanRecorder = {
    setUsage(model, promptTokens, completionTokens) {
      sp.model = model;
      sp.promptTokens = (sp.promptTokens ?? 0) + promptTokens;
      sp.completionTokens = (sp.completionTokens ?? 0) + completionTokens;
      sp.totalTokens = (sp.totalTokens ?? 0) + promptTokens + completionTokens;
      sp.costUsd =
        (sp.costUsd ?? 0) +
        estimateCostUsd(model, promptTokens, completionTokens);
    },
    setMeta(key, value) {
      sp.meta = { ...(sp.meta ?? {}), [key]: value };
    },
  };

  const childStore: TraceStore = { ...store, stack: [...store.stack, sp.id] };
  const t0 = performance.now();
  try {
    return await als.run(childStore, () => fn(rec));
  } catch (e) {
    sp.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    sp.durationMs = Math.round(performance.now() - t0);
  }
}

/** 一条 trace 的句柄：spans 是共享引用，run 完即可读取（即使 fn 抛错也已收集） */
export interface TraceHandle {
  traceId: string;
  spans: Span[];
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createTrace(traceId: string): TraceHandle {
  const spans: Span[] = [];
  return {
    traceId,
    spans,
    run(fn) {
      return als.run({ traceId, spans, stack: [] }, fn);
    },
  };
}

/**
 * 落库到 agent_spans。观测失败绝不影响主流程：仅告警、不抛。
 * 传 service_role 客户端（后端受信任流程）。
 */
export async function persistSpans(
  supabase: SupabaseClient,
  tripId: string,
  spans: Span[],
): Promise<void> {
  if (!spans.length) return;
  try {
    const rows = spans.map((s) => ({
      trip_id: tripId,
      span_id: s.id,
      parent_id: s.parentId,
      trace_id: s.traceId,
      name: s.name,
      kind: s.kind,
      start_ms: s.startMs,
      duration_ms: s.durationMs,
      model: s.model ?? null,
      prompt_tokens: s.promptTokens ?? null,
      completion_tokens: s.completionTokens ?? null,
      total_tokens: s.totalTokens ?? null,
      cost_usd: s.costUsd ?? null,
      meta: s.meta ?? {},
      error: s.error ?? null,
    }));
    const { error } = await supabase.from("agent_spans").insert(rows);
    if (error) console.warn("[trace] persistSpans 失败（忽略）：", error.message);
  } catch (e) {
    console.warn("[trace] persistSpans 异常（忽略）：", e);
  }
}
