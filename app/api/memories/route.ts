import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * /api/memories —— 「小行记得你」记忆管理（HCI 透明性：AI 记了什么，用户可见可控）。
 * GET    列出当前用户的活跃记忆（RLS 按 user_id 隔离）
 * PATCH  body { id, active } 停用/恢复一条记忆
 * DELETE body { id } 物理删除一条记忆
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_memories")
    .select("id, kind, subject, text, importance, use_count, last_used_at, source, active, created_at")
    .eq("active", true)
    .order("last_used_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}

export async function PATCH(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { id?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.id || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "缺少 id / active" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("user_memories")
    .update({ active: body.active })
    .eq("id", body.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "记忆不存在或无权限" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const { data, error } = await supabase
    .from("user_memories")
    .delete()
    .eq("id", body.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "记忆不存在或无权限" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
