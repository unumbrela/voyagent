/**
 * 内存版流水线（--live 用）。
 *
 * 复用线上同一套 WAVES（波内并行、波间顺序）与 finalize.ensureDepartureFirst，
 * 但【不碰 Supabase】——评测不需要持久化/断点续跑，只要产物。
 * 这也顺带证明了编排核心与存储层是解耦的。
 *
 * 需要 DEEPSEEK_API_KEY（各 agent 缺 key 会抛错）；TAVILY_API_KEY 可选（缺则交通/活动不联网核实）。
 */

import { WAVES } from "@/lib/agents/orchestrator";
import { ensureDepartureFirst } from "@/lib/agents/finalize";
import type { AgentContext, AgentName } from "@/lib/agents/types";
import type { EvalCase, PipelineResult } from "./types";

export async function runLocalPipeline(c: EvalCase): Promise<PipelineResult> {
  const upstream: AgentContext["upstream"] = {};

  for (const wave of WAVES) {
    await Promise.all(
      wave.map(async (step) => {
        upstream[step.name] = await step.run({ context: c.input, upstream });
      }),
    );
  }

  const itinerary = ensureDepartureFirst(
    upstream.hub_planner,
    c.input,
    upstream.transport,
  );

  const pick = <T>(name: AgentName) => (upstream[name] ?? {}) as T;
  return {
    itinerary: itinerary as PipelineResult["itinerary"],
    transport: pick("transport"),
    accommodation: pick("accommodation"),
    validator: pick("validator"),
  };
}
