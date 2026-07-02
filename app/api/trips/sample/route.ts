import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createTrip } from "@/lib/trips";
import { buildSampleItinerary } from "@/lib/sample-trip";

export const runtime = "nodejs";

/**
 * POST /api/trips/sample —— 一键载入示例行程「无锡 → 苏州 · 江南三日」。
 * 不跑流水线：直接写入 trip + trip_context + 成品 itinerary（status=done），
 * 让新用户零成本体验拖拽/预算/打包/地图全部功能。日期取下一个周五起三天。
 * 全程用 cookie 客户端（RLS「own itineraries」for all 允许写自己的行程）。
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const sample = await buildSampleItinerary();

    const id = await createTrip(supabase, user.id, {
      destination: "苏州",
      origin: "无锡",
      start_date: sample.start_date,
      end_date: sample.end_date,
      budget: 3000,
      travel_style: "江南水乡 · 园林与美食 · 节奏轻松（示例行程）",
      party_size: 2,
    });

    const { error: itinErr } = await supabase.from("itineraries").insert({
      trip_id: id,
      days: sample.days,
      references_data: sample.references,
    });
    if (itinErr) throw new Error(`写入示例行程失败: ${itinErr.message}`);

    const { error: stErr } = await supabase
      .from("trips")
      .update({ status: "done" })
      .eq("id", id);
    if (stErr) throw new Error(`更新状态失败: ${stErr.message}`);

    return NextResponse.json({ id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
