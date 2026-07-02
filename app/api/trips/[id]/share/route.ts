import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/trips/[id]/share —— 开启/关闭公开分享。
 * body: { enabled: boolean }
 * 用 cookie 客户端：RLS 保证只能改自己的 trip（他人/不存在命中 0 行）。
 * 开启时若尚无 token 则生成一个不可猜的 uuid；关闭时置 null。
 * 返回 { token: string | null }。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!body.enabled) {
    const { error } = await supabase
      .from("trips")
      .update({ share_token: null })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ token: null });
  }

  // 开启：已存在则复用，否则生成新 token
  const { data: existing } = await supabase
    .from("trips")
    .select("share_token")
    .eq("id", id)
    .single();
  let token = (existing?.share_token as string | null) ?? null;
  if (!token) {
    token = crypto.randomUUID();
    const { error } = await supabase
      .from("trips")
      .update({ share_token: token })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ token });
}
