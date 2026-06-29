import { createAdminClient } from "@/lib/supabase/server";
import { runPipeline } from "@/lib/pipeline";
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
  const supabase = createAdminClient();

  const { data: ctx, error } = await supabase
    .from("trip_context")
    .select("*")
    .eq("trip_id", tripId)
    .single();

  if (error || !ctx) {
    return new Response(`未找到 trip_context: ${error?.message ?? tripId}`, {
      status: 404,
    });
  }

  const constraints = (ctx.constraints ?? {}) as Record<string, unknown>;
  const context: TripContext = {
    destination: ctx.destination,
    origin:
      typeof constraints.origin === "string" ? constraints.origin : null,
    start_date: ctx.start_date,
    end_date: ctx.end_date,
    budget: ctx.budget,
    travel_style: ctx.travel_style,
    party_size: ctx.party_size ?? 1,
    constraints,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ProgressEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      try {
        await runPipeline({ tripId, context, supabase, onEvent: send });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase
          .from("trips")
          .update({ status: "failed" })
          .eq("id", tripId);
        send({ type: "error", message });
      } finally {
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
