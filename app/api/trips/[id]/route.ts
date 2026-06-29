import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id] —— 读取已存的行程（不触发编排）。
 * 前端用它在「已完成」时直接渲染，避免每次进页面都重跑流水线（修复 P1 幂等性）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const [{ data: trip }, { data: ctx }, { data: itin }] = await Promise.all([
    supabase.from("trips").select("status").eq("id", id).single(),
    supabase
      .from("trip_context")
      .select("destination, constraints, start_date, end_date")
      .eq("trip_id", id)
      .single(),
    supabase
      .from("itineraries")
      .select("days, references_data")
      .eq("trip_id", id)
      .maybeSingle(),
  ]);

  if (!trip) {
    return NextResponse.json({ error: "trip 不存在" }, { status: 404 });
  }
  const constraints = (ctx?.constraints ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    status: trip.status,
    destination: ctx?.destination ?? null,
    origin: typeof constraints.origin === "string" ? constraints.origin : null,
    start_date: ctx?.start_date ?? null,
    end_date: ctx?.end_date ?? null,
    days: itin?.days ?? null,
    references: itin?.references_data ?? null,
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

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("itineraries")
    .update({
      days: body.days,
      references_data: body.references ?? null,
    })
    .eq("trip_id", id);

  if (error) {
    return NextResponse.json(
      { error: `保存失败: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
