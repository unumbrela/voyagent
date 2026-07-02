import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { summarizeTrace } from "@/lib/trace";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id]/trace —— 规划过程可见化（P2 / RQ2）。
 *
 * 读 agent_outputs（各专家 agent 的真实产物 + 状态），归纳成人可读的「做了什么/选了谁/
 * 取证来源」。纯读库，不跑任何模型/搜索。用 cookie 客户端：RLS 只能读自己 trip 的产物。
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
    .select("agent_name, status, payload, error")
    .eq("trip_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ trace: summarizeTrace(rows ?? []) });
}
