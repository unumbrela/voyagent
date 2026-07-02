import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createTrip } from "@/lib/trips";
import { rememberFromText } from "@/lib/memory";

export const runtime = "nodejs";

/** POST /api/trips —— 创建一次行程 + 写入单一事实来源 trip_context（核心见 lib/trips.ts） */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 以登录用户身份写入：RLS 要求 user_id = auth.uid()
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const id = await createTrip(supabase, user.id, {
      destination: String(body.destination ?? ""),
      origin: body.origin ? String(body.origin) : null,
      start_date: (body.start_date as string) ?? null,
      end_date: (body.end_date as string) ?? null,
      budget: (body.budget as number) ?? null,
      travel_style: (body.travel_style as string) ?? null,
      party_size: Number(body.party_size ?? 1),
      now: body.now ? String(body.now) : null,
      depart_time: body.depart_time ? String(body.depart_time) : null,
      return_by_time: body.return_by_time ? String(body.return_by_time) : null,
    });

    // 沉淀记忆：从旅行风格/诉求里抽取持久偏好，供后续行程个性化（非阻塞，失败不影响建行程）
    const style = String(body.travel_style ?? "").trim();
    if (style) await rememberFromText(supabase, user.id, style, "trip_create");

    return NextResponse.json({ id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.includes("destination") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
