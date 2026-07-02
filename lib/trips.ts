/**
 * 建行程的共用核心 —— 从 /api/trips 抽出，供路由与 Copilot 的 create_trip 工具共用。
 *
 * 写 trips（status=draft, user_id）+ trip_context（单一事实来源）。
 * origin 与时间约束存进 constraints jsonb（免新增列）。返回新 trip id。
 * 用传入的 cookie 客户端写入 → RLS 保证 user_id = auth.uid()。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreateTripParams {
  destination: string;
  origin?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
  travel_style?: string | null;
  party_size?: number | null;
  now?: string | null;
  depart_time?: string | null;
  return_by_time?: string | null;
}

export async function createTrip(
  supabase: SupabaseClient,
  userId: string,
  params: CreateTripParams,
): Promise<string> {
  const destination = String(params.destination ?? "").trim();
  if (!destination) throw new Error("缺少 destination");

  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .insert({ status: "draft", user_id: userId })
    .select("id")
    .single();
  if (tripErr || !trip) {
    throw new Error(`创建 trip 失败: ${tripErr?.message}`);
  }

  const origin = params.origin ? String(params.origin).trim() : null;
  const constraints: Record<string, unknown> = {
    ...(origin ? { origin } : {}),
    ...(params.now ? { now: String(params.now) } : {}),
    ...(params.depart_time ? { depart_time: String(params.depart_time) } : {}),
    ...(params.return_by_time
      ? { return_by_time: String(params.return_by_time) }
      : {}),
  };

  const { error: ctxErr } = await supabase.from("trip_context").insert({
    trip_id: trip.id,
    destination,
    start_date: params.start_date ?? null,
    end_date: params.end_date ?? null,
    budget: params.budget ?? null,
    travel_style: params.travel_style ?? null,
    party_size: Number(params.party_size ?? 1),
    constraints,
  });
  if (ctxErr) {
    throw new Error(`写入 trip_context 失败: ${ctxErr.message}`);
  }

  return trip.id as string;
}
