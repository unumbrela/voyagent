import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { rollup, waterfall } from "@/lib/otel/rollup";
import type { Span } from "@/lib/otel/trace";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id]/spans —— 运营可观测：返回该行程一次规划的
 * 执行汇总（token/成本/延迟）+ 瀑布行。纯读 agent_spans（RLS 只读自己 trip）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("agent_spans")
    .select(
      "span_id, parent_id, trace_id, name, kind, start_ms, duration_ms, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, meta, error",
    )
    .eq("trip_id", id)
    .order("start_ms", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // DB 行 → Span（rollup/waterfall 的输入）
  const spans: Span[] = (rows ?? []).map((r) => ({
    id: r.span_id,
    parentId: r.parent_id,
    traceId: r.trace_id,
    name: r.name,
    kind: r.kind,
    startMs: Number(r.start_ms),
    durationMs: r.duration_ms,
    model: r.model ?? undefined,
    promptTokens: r.prompt_tokens ?? undefined,
    completionTokens: r.completion_tokens ?? undefined,
    totalTokens: r.total_tokens ?? undefined,
    costUsd: r.cost_usd != null ? Number(r.cost_usd) : undefined,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    error: r.error,
  }));

  return NextResponse.json({
    rollup: rollup(spans),
    waterfall: waterfall(spans),
  });
}
