import {
  createAdminClient,
  createServerSupabase,
} from "@/lib/supabase/server";
import { runPipeline } from "@/lib/pipeline";
import { createTrace, persistSpans, span } from "@/lib/otel/trace";
import { recallTexts } from "@/lib/memory";
import type { ProgressEvent, TripContext } from "@/lib/agents/types";

export const runtime = "nodejs";
// 编排耗时较长（多 agent + web 搜索），放宽时长上限
export const maxDuration = 300;

/**
 * GET /api/trips/[id]/plan —— SSE 流式触发编排，逐 agent 推送进度。
 * 前端用 EventSource 订阅。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tripId } = await params;

  // 先以登录用户身份读取（RLS）：读得到 = 拥有该行程；否则 401/404。
  const userClient = await createServerSupabase();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return new Response("未登录", { status: 401 });
  }
  const { data: ctx, error } = await userClient
    .from("trip_context")
    .select("*")
    .eq("trip_id", tripId)
    .single();

  if (error || !ctx) {
    return new Response(`未找到行程或无权访问: ${tripId}`, { status: 404 });
  }

  // 记忆召回（读）：按目的地+风格召回用户跨行程的长期偏好，注入所有 agent 的 prompt
  const memQuery = `${ctx.destination ?? ""} ${ctx.travel_style ?? ""}`.trim();
  const userMemory = memQuery
    ? await recallTexts(userClient, user.id, memQuery, 6)
    : [];

  // 归属已确认；编排用 admin 客户端写 agent_outputs/itineraries（受信任的服务端流程）
  const supabase = createAdminClient();

  const constraints = (ctx.constraints ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const context: TripContext = {
    destination: ctx.destination,
    origin: str(constraints.origin),
    start_date: ctx.start_date,
    end_date: ctx.end_date,
    now: str(constraints.now),
    depart_time: str(constraints.depart_time),
    return_by_time: str(constraints.return_by_time),
    budget: ctx.budget,
    travel_style: ctx.travel_style,
    party_size: ctx.party_size ?? 1,
    constraints: { ...constraints, user_memory: userMemory },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ProgressEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      // 一条 trace 贯穿整条流水线：agent/llm/tool span 自动嵌套收集
      const trace = createTrace(tripId);
      try {
        await trace.run(() =>
          span("pipeline", "pipeline", () =>
            runPipeline({ tripId, context, supabase, onEvent: send }),
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase
          .from("trips")
          .update({ status: "failed" })
          .eq("id", tripId);
        send({ type: "error", message });
      } finally {
        // 观测落库（失败只告警，不影响主流程）；即使中途抛错也已收集到 span
        await persistSpans(supabase, tripId, trace.spans);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
