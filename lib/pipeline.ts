import type { SupabaseClient } from "@supabase/supabase-js";
import { WAVES } from "@/lib/agents/orchestrator";
import { runHubPlanner } from "@/lib/agents/hub-planner";
import { runValidator } from "@/lib/agents/validator";
import { ensureDepartureFirst } from "@/lib/agents/finalize";
import { summarizeAgentOutput } from "@/lib/agents/summarize";
import { span } from "@/lib/otel/trace";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 单 agent 重试：瞬时失败（模型/搜索 API 抖动、超时）不应拖垮整条流水线。
 * 退避重试 ATTEMPTS 次，仍失败才抛出。
 */
const ATTEMPTS = 3;
async function withRetry<T>(name: AgentName, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < ATTEMPTS) {
        console.warn(`[pipeline] ${name} 第 ${i} 次失败，退避后重试`, err);
        await sleep(800 * i);
      }
    }
  }
  throw lastErr;
}

/** 某 agent 输出是否含 high 级问题（validator 用） */
function hasHighIssues(v: unknown): boolean {
  const issues = (v as { issues?: { severity?: string }[] } | null)?.issues;
  return (
    Array.isArray(issues) &&
    issues.some((i) => String(i?.severity).toLowerCase() === "high")
  );
}

/**
 * 编排引擎：按 WAVES 执行（波内并行、波间顺序）。
 * - 断点续跑：开跑前载入已 done 的 agent_outputs，跳过它们（被中断的规划重开即从断点继续）
 * - 每个 agent 带退避重试；完成后写 agent_outputs 并累积进 upstream 供下游读取
 * - validator 闭环：若质检出 high 问题，让 hub_planner 带反馈修订一次后复检（限 1 轮）
 * - 最终把 hub_planner + validator 结果写入 itineraries；全程通过 onEvent 推进度
 */
export async function runPipeline({
  tripId,
  context,
  supabase,
  onEvent,
}: RunPipelineArgs): Promise<void> {
  const upstream: AgentContext["upstream"] = {};

  await supabase.from("trips").update({ status: "planning" }).eq("id", tripId);

  // 断点续跑：把上次已 done 的产物先载入，本次跳过、不重算
  const { data: existing } = await supabase
    .from("agent_outputs")
    .select("agent_name, status, payload")
    .eq("trip_id", tripId);
  const completed = new Map<string, unknown>();
  for (const row of existing ?? []) {
    if (row.status === "done" && row.payload != null) {
      completed.set(row.agent_name, row.payload);
    }
  }

  for (const wave of WAVES) {
    // 波内并行
    await Promise.all(
      wave.map(async (step) => {
        // 续跑命中：复用已有产物，补发 done 事件点亮 UI
        if (completed.has(step.name)) {
          upstream[step.name] = completed.get(step.name);
          onEvent({
            type: "agent_status",
            agent: step.name,
            status: "done",
            summary: summarizeAgentOutput(step.name, completed.get(step.name)),
          });
          return;
        }
        await markOutput(supabase, tripId, step.name, "running", null);
        onEvent({ type: "agent_status", agent: step.name, status: "running" });
        try {
          const payload = await span(
            step.name,
            "agent",
            () => withRetry(step.name, () => step.run({ context, upstream })),
            { wave: WAVES.indexOf(wave) + 1 },
          );
          upstream[step.name] = payload;
          await markOutput(supabase, tripId, step.name, "done", payload);
          onEvent({
            type: "agent_status",
            agent: step.name,
            status: "done",
            summary: summarizeAgentOutput(step.name, payload),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markOutput(supabase, tripId, step.name, "error", null, message);
          onEvent({
            type: "agent_status",
            agent: step.name,
            status: "error",
            message,
          });
          throw err; // 重试用尽仍失败：让整条流水线失败
        }
      }),
    );
  }

  // ── validator 闭环：质检有 high 问题则修订一次再复检（限 1 轮，避免死循环）──
  // 续跑场景下 validator 可能来自缓存，仍据其结论决定是否修订。
  if (upstream.validator && hasHighIssues(upstream.validator)) {
    try {
      onEvent({ type: "agent_status", agent: "hub_planner", status: "running" });
      // upstream 此时含 validator → hub_planner 据其修复 high 问题
      const revised = await span(
        "hub_planner",
        "agent",
        () => withRetry("hub_planner", () => runHubPlanner({ context, upstream })),
        { phase: "revise" },
      );
      upstream.hub_planner = revised;
      await markOutput(supabase, tripId, "hub_planner", "done", revised);
      onEvent({
        type: "agent_status",
        agent: "hub_planner",
        status: "done",
        summary: summarizeAgentOutput("hub_planner", revised),
      });

      onEvent({ type: "agent_status", agent: "validator", status: "running" });
      const recheck = await span(
        "validator",
        "agent",
        () => withRetry("validator", () => runValidator({ context, upstream })),
        { phase: "recheck" },
      );
      upstream.validator = recheck;
      await markOutput(supabase, tripId, "validator", "done", recheck);
      onEvent({
        type: "agent_status",
        agent: "validator",
        status: "done",
        summary: summarizeAgentOutput("validator", recheck),
      });
    } catch (err) {
      // 修订轮失败不致命：保留首轮结果，记日志后继续收尾
      console.warn("[pipeline] validator 修订轮失败，保留首轮结果", err);
    }
  }

  // 确定性收尾：保证全程第一项是「去程出发」而非「入住酒店」（不依赖模型自觉）
  upstream.hub_planner = ensureDepartureFirst(
    upstream.hub_planner,
    context,
    upstream.transport,
  );

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
