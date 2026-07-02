import { createServerSupabase } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/agent/runtime";
import { recallTexts, rememberFromText } from "@/lib/memory";
import { createTrace, persistSpans, span } from "@/lib/otel/trace";
import type { AgentEvent, AgentMsg, AppState } from "@/lib/agent/types";

export const runtime = "nodejs";
// 可能触发 web 搜索 / refine，留足时长
export const maxDuration = 120;

/**
 * POST /api/agent —— Copilot「小行」的 AG-UI 风格事件流。
 * body: { messages: AgentMsg[], appState: AppState }（最后一条须为 user）
 *
 * 登录校验走 cookie 客户端（RLS）；运行时用同一客户端读写（建行程/读候选均按 owner 隔离）。
 * 以 SSE 逐条推送 text/tool_call/tool_result/proposal/action/done 事件。
 * 若在某个行程内，把最新完整对话持久化到 itineraries.chat（记忆）。
 */
export async function POST(req: Request) {
  let body: { messages?: AgentMsg[]; appState?: AppState };
  try {
    body = await req.json();
  } catch {
    return new Response("请求体不是合法 JSON", { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) {
    return new Response("缺少用户消息", { status: 400 });
  }
  const appState: AppState = body.appState ?? {
    pathname: "/",
    tripId: null,
    meta: null,
    itinerary: null,
    now: null,
  };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("未登录", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      // 追踪：整轮对话一条 trace（含内部 LLM/工具 span）；有 trip 上下文才落库
      const trace = createTrace(appState.tripId ?? "copilot");
      try {
        // 记忆召回（读）：按目的地 + 本轮消息召回长期偏好，注入 system prompt
        const memQuery =
          `${appState.meta?.destination ?? ""} ${last.content}`.trim();
        const userMemory = await recallTexts(supabase, user.id, memQuery, 6);
        // 透明性：把本轮参考的记忆推给前端展示（用户可在记忆面板管理）
        if (userMemory.length) emit({ type: "memory", texts: userMemory });

        const reply = await trace.run(() =>
          span("copilot_turn", "agent", () =>
            runAgentTurn({
              messages: messages.slice(-20),
              appState,
              toolCtx: { supabase, userId: user.id, appState, emit },
              emit,
              userMemory,
            }),
          ),
        );

        // 记忆：在某个行程内则把完整对话写回 itineraries.chat
        if (appState.tripId) {
          const full: AgentMsg[] = [...messages, { role: "assistant", content: reply }];
          await supabase
            .from("itineraries")
            .update({ chat: full })
            .eq("trip_id", appState.tripId);
        }
        // 记忆沉淀（写）：从用户本轮消息抽取持久偏好（非阻塞，失败不影响回复）
        await rememberFromText(supabase, user.id, last.content, "copilot");
        emit({ type: "done" });
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // 观测落库（仅当有 trip 上下文；全局对话无 trip_id 则跳过，避免 FK 冲突）
        if (appState.tripId) {
          await persistSpans(supabase, appState.tripId, trace.spans);
        }
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
