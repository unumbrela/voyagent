import type { SupabaseClient } from "@supabase/supabase-js";
import { WAVES } from "@/lib/agents/orchestrator";
import type {
  AgentContext,
  AgentName,
  ProgressEvent,
  TripContext,
} from "@/lib/agents/types";

interface RunPipelineArgs {
  tripId: string;
  context: TripContext;
  supabase: SupabaseClient;
  /** 进度回调（推给 SSE） */
  onEvent: (e: ProgressEvent) => void;
}

/**
 * 编排引擎：按 WAVES 执行（波内并行、波间顺序）。
 * - 每个 agent 完成后把产物写入 agent_outputs，并累积进 upstream 供下游读取
 * - 全部完成后把 hub_planner + validator 的结果写入 itineraries
 * - 全程通过 onEvent 推送进度
 */
export async function runPipeline({
  tripId,
  context,
  supabase,
  onEvent,
}: RunPipelineArgs): Promise<void> {
  const upstream: AgentContext["upstream"] = {};

  await supabase.from("trips").update({ status: "planning" }).eq("id", tripId);

  for (const wave of WAVES) {
    // 波内并行
    await Promise.all(
      wave.map(async (step) => {
        await markOutput(supabase, tripId, step.name, "running", null);
        onEvent({ type: "agent_status", agent: step.name, status: "running" });
        try {
          const payload = await step.run({ context, upstream });
          upstream[step.name] = payload;
          await markOutput(supabase, tripId, step.name, "done", payload);
          onEvent({ type: "agent_status", agent: step.name, status: "done" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markOutput(supabase, tripId, step.name, "error", null, message);
          onEvent({
            type: "agent_status",
            agent: step.name,
            status: "error",
            message,
          });
          throw err; // 让整条流水线失败
        }
      }),
    );
  }

  // 综合：hub_planner 是成品行程，validator 是质检报告
  const itinerary = upstream.hub_planner as
    | { days?: unknown; references?: unknown }
    | undefined;
  await supabase.from("itineraries").upsert({
    trip_id: tripId,
    days: itinerary?.days ?? null,
    references_data: itinerary?.references ?? null,
    validation: upstream.validator ?? null,
    validated_at: new Date().toISOString(),
  });
  await supabase.from("trips").update({ status: "done" }).eq("id", tripId);

  onEvent({ type: "done", itinerary: upstream.hub_planner });
}

async function markOutput(
  supabase: SupabaseClient,
  tripId: string,
  agent: AgentName,
  status: "running" | "done" | "error",
  payload: unknown,
  error: string | null = null,
) {
  await supabase.from("agent_outputs").upsert({
    trip_id: tripId,
    agent_name: agent,
    status,
    payload: payload ?? null,
    error,
    updated_at: new Date().toISOString(),
  });
}
