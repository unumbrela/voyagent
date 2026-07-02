import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runPacking } from "@/lib/agents/packing";
import { detectInjection, hasHigh } from "@/lib/guardrails";
import { fetchWeather } from "@/lib/weather-fetch";
import type { AgentContext, TripContext } from "@/lib/agents/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 存进 itineraries.packing 的一项（带 id + 勾选态） */
interface StoredItem {
  id: string;
  label: string;
  group: string;
  checked: boolean;
}

interface Day {
  theme?: string;
  items?: { kind?: string; title?: string }[];
}

/** 读 trip_context + itineraries（RLS 归属校验），返回 { userClient, ctx, itin } 或错误响应 */
async function load(tripId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { err: NextResponse.json({ error: "未登录" }, { status: 401 }) };

  const [{ data: ctx }, { data: itin }] = await Promise.all([
    supabase.from("trip_context").select("*").eq("trip_id", tripId).single(),
    supabase
      .from("itineraries")
      .select("days, packing")
      .eq("trip_id", tripId)
      .maybeSingle(),
  ]);
  if (!ctx)
    return {
      err: NextResponse.json({ error: "未找到行程或无权访问" }, { status: 404 }),
    };
  return { supabase, ctx, itin };
}

/**
 * GET /api/trips/[id]/packing —— 读取已存打包清单（不生成）。
 * 返回 { packing: StoredItem[] | null }；null 表示尚未生成。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await load(id);
  if (r.err) return r.err;
  return NextResponse.json({ packing: r.itin?.packing ?? null });
}

/**
 * POST /api/trips/[id]/packing —— 生成打包清单（幂等：已存在则直接返回，不重复生成）。
 * body: { weatherHint?: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await load(id);
  if (r.err) return r.err;
  const { supabase, ctx, itin } = r;

  // 幂等：已生成过就直接返回
  if (Array.isArray(itin?.packing) && itin.packing.length) {
    return NextResponse.json({ packing: itin.packing });
  }

  let weatherHint: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.weatherHint === "string") weatherHint = body.weatherHint;
  } catch {
    // 无 body 亦可
  }
  // 输入护栏：weatherHint 是进 prompt 的自由文本，高危注入直接丢弃
  if (weatherHint && hasHigh(detectInjection(weatherHint))) {
    console.warn("[guardrail] packing weatherHint 命中高危注入，已丢弃");
    weatherHint = undefined;
  }
  // 天气→打包联动：前端没带天气摘要时，服务端兜底拉一次预报（拿不到就不带）
  if (!weatherHint && ctx.destination && ctx.start_date && ctx.end_date) {
    try {
      const daily = await fetchWeather(ctx.destination, ctx.start_date, ctx.end_date);
      const vals = Object.values(daily);
      if (vals.length) {
        const tmax = Math.max(...vals.map((v) => v.tmax));
        const tmin = Math.min(...vals.map((v) => v.tmin));
        const rainy = vals.filter((v) => v.pop >= 40).length;
        weatherHint = `气温约 ${tmin}~${tmax}°C${rainy ? `，其中 ${rainy} 天可能有雨` : "，以晴到多云为主"}`;
      }
    } catch {
      // 天气是增强信息，拿不到不影响生成
    }
  }

  const constraints = (ctx.constraints ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const context: TripContext = {
    destination: ctx.destination,
    origin: str(constraints.origin),
    start_date: ctx.start_date,
    end_date: ctx.end_date,
    now: str(constraints.now),
    depart_time: str(constraints.depart_time),
    return_by_time: str(constraints.return_by_time),
    budget: ctx.budget,
    travel_style: ctx.travel_style,
    party_size: ctx.party_size ?? 1,
    constraints,
  };
  const agentCtx: AgentContext = { context, upstream: {} };
  const days = (itin?.days as Day[] | null) ?? [];

  let generated: { items: { label: string; group: string }[] };
  try {
    generated = await runPacking(agentCtx, days, weatherHint);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const packing: StoredItem[] = (generated.items ?? [])
    .filter((it) => it.label?.trim())
    .map((it, i) => ({
      id: `g${i}`,
      label: it.label.trim(),
      group: it.group || "其他",
      checked: false,
    }));

  const { error } = await supabase
    .from("itineraries")
    .update({ packing })
    .eq("trip_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ packing });
}

/**
 * PUT /api/trips/[id]/packing —— 保存勾选状态 / 增删自定义项。
 * body: { packing: StoredItem[] }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { packing?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.packing)) {
    return NextResponse.json({ error: "packing 必须是数组" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // .select() 校验命中行数：0 行（他人/不存在）返回 404，避免静默假成功
  const { data, error } = await supabase
    .from("itineraries")
    .update({ packing: body.packing })
    .eq("trip_id", id)
    .select("trip_id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "行程不存在或无权限" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
