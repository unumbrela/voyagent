import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id] —— 读取已存的行程（不触发编排）。
 * 前端用它在「已完成」时直接渲染，避免每次进页面都重跑流水线（修复 P1 幂等性）。
 * 用 cookie 客户端：RLS 保证只能读到自己的行程（他人/不存在均为 404）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [{ data: trip }, { data: ctx }, { data: itin }] = await Promise.all([
    supabase.from("trips").select("status, share_token").eq("id", id).single(),
    supabase
      .from("trip_context")
      .select("destination, constraints, start_date, end_date, budget, party_size")
      .eq("trip_id", id)
      .single(),
    supabase
      .from("itineraries")
      // select * 而非点名列：title/overview 属 0008 迁移，未应用时点名会整条报错
      .select("*")
      .eq("trip_id", id)
      .maybeSingle(),
  ]);

  if (!trip) {
    return NextResponse.json({ error: "trip 不存在" }, { status: 404 });
  }
  const constraints = (ctx?.constraints ?? {}) as Record<string, unknown>;
  const itinRow = (itin ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    status: trip.status,
    share_token: trip.share_token ?? null,
    destination: ctx?.destination ?? null,
    origin: typeof constraints.origin === "string" ? constraints.origin : null,
    start_date: ctx?.start_date ?? null,
    end_date: ctx?.end_date ?? null,
    budget: ctx?.budget ?? null,
    party_size: ctx?.party_size ?? null,
    title: typeof itinRow.title === "string" ? itinRow.title : null,
    overview: typeof itinRow.overview === "string" ? itinRow.overview : null,
    days: itinRow.days ?? null,
    references: itinRow.references_data ?? null,
    chat: itinRow.chat ?? null,
  });
}

/**
 * PUT /api/trips/[id] —— 保存用户编辑后的行程（days + references）。
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { days?: unknown; references?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.days)) {
    return NextResponse.json({ error: "days 必须是数组" }, { status: 400 });
  }

  // cookie 客户端：RLS 保证只能改自己的行程；.select() 校验命中行数，
  // 0 行（他人/不存在）返回 404，避免「静默假成功」
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("itineraries")
    .update({
      days: body.days,
      references_data: body.references ?? null,
    })
    .eq("trip_id", id)
    .select("trip_id");

  if (error) {
    return NextResponse.json(
      { error: `保存失败: ${error.message}` },
      { status: 500 },
    );
  }
  if (!data?.length) {
    return NextResponse.json({ error: "行程不存在或无权限" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/trips/[id] —— 删除行程（trip_context / agent_outputs / itineraries 随外键级联删除）。
 * RLS 保证只能删自己的；.select() 校验命中行数，0 行返回 404。
 */
export async function DELETE(
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
  const { data, error } = await supabase
    .from("trips")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "行程不存在或无权限" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
