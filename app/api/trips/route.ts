import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST /api/trips —— 创建一次行程 + 写入单一事实来源 trip_context */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const destination = String(body.destination ?? "").trim();
  if (!destination) {
    return NextResponse.json({ error: "缺少 destination" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 当前脚手架未接入认证：user_id 暂为 null（服务端用 service_role 绕过 RLS）
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .insert({ status: "draft" })
    .select("id")
    .single();
  if (tripErr || !trip) {
    return NextResponse.json(
      { error: `创建 trip 失败: ${tripErr?.message}` },
      { status: 500 },
    );
  }

  const { error: ctxErr } = await supabase.from("trip_context").insert({
    trip_id: trip.id,
    destination,
    start_date: body.start_date ?? null,
    end_date: body.end_date ?? null,
    budget: body.budget ?? null,
    travel_style: body.travel_style ?? null,
    party_size: Number(body.party_size ?? 1),
    constraints: body.constraints ?? {},
  });
  if (ctxErr) {
    return NextResponse.json(
      { error: `写入 trip_context 失败: ${ctxErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: trip.id });
}
