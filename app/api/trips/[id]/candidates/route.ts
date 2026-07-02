import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeCandidates } from "@/lib/candidates";
import type { AgentName } from "@/lib/agents/types";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id]/candidates —— 读取各 agent 产出的「未被选中」真实候选池。
 *
 * 复用 agent_outputs 里 activities/food/accommodation/transport 的 2~4 个候选，
 * 归一化成统一 Candidate[] 供前端「候选探索与替换」抽屉展示、拖入行程。
 * 用 cookie 客户端：RLS 保证只能读自己 trip 的产物（他人/不存在均为空）。
 * 不触发任何模型/搜索——纯读库，未配置 TAVILY 也能用（候选早已落库）。
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
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("agent_outputs")
    .select("agent_name, payload, status")
    .eq("trip_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outputs: Partial<Record<AgentName, unknown>> = {};
  for (const r of rows ?? []) {
    if (r.status === "done" && r.payload) {
      outputs[r.agent_name as AgentName] = r.payload;
    }
  }

  return NextResponse.json({ candidates: normalizeCandidates(outputs) });
}
