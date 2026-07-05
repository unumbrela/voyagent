import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { researchXhs } from "@/lib/xhs/research";
import { detectInjection, hasHigh } from "@/lib/guardrails";
import type { XhsGuide } from "@/lib/xhs/types";

export const runtime = "nodejs";
// 聚合检索 + DeepSeek 提炼，留足时长
export const maxDuration = 60;

/** 缓存所用的 agent_outputs 行名（每个行程一份，只算一次） */
const AGENT = "xhs_research";

/** 读 auth + trip_context.destination + 已缓存攻略（均走 RLS 归属校验） */
async function load(tripId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { err: NextResponse.json({ error: "未登录" }, { status: 401 }) };

  const [{ data: ctx }, { data: cached }] = await Promise.all([
    supabase
      .from("trip_context")
      .select("destination")
      .eq("trip_id", tripId)
      .single(),
    supabase
      .from("agent_outputs")
      .select("payload, status")
      .eq("trip_id", tripId)
      .eq("agent_name", AGENT)
      .maybeSingle(),
  ]);
  if (!ctx)
    return {
      err: NextResponse.json({ error: "未找到行程或无权访问" }, { status: 404 }),
    };
  const guide =
    cached?.status === "done" && cached.payload
      ? (cached.payload as XhsGuide)
      : null;
  return { supabase, destination: ctx.destination as string, guide };
}

/**
 * GET /api/trips/[id]/xhs —— 读已缓存的攻略（不触发检索）。
 * 返回 { guide: XhsGuide | null }；null 表示还没生成过。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await load(id);
  if (r.err) return r.err;
  return NextResponse.json({ guide: r.guide });
}

/**
 * POST /api/trips/[id]/xhs —— 生成并缓存攻略。
 * body: { focus?: string, force?: boolean }
 *  - 幂等：已缓存且未 force、且未换 focus 时直接返回缓存（省一次检索+LLM）。
 *  - force=true 或换了 focus 时重算并覆盖缓存。
 * 失败/零召回返回 { guide: null, error } （HTTP 200，属正常"没找到"，非服务器错误）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await load(id);
  if (r.err) return r.err;
  const { supabase, destination, guide: cached } = r;

  let focus = "";
  let force = false;
  try {
    const body = await req.json();
    if (typeof body?.focus === "string") focus = body.focus.trim();
    force = body?.force === true;
  } catch {
    // 无 body 亦可
  }
  // 输入护栏：focus 会进检索词/prompt，高危注入直接丢弃
  if (focus && hasHigh(detectInjection(focus))) {
    console.warn("[guardrail] xhs focus 命中高危注入，已丢弃");
    focus = "";
  }

  // 幂等：已缓存且非强制刷新 → 直接返回（默认自动生成只算一次；换 focus/重翻由 UI 传 force=true）
  if (cached && !force) {
    return NextResponse.json({ guide: cached });
  }

  const result = await researchXhs(destination, focus);
  if ("error" in result) {
    return NextResponse.json({ guide: null, error: result.error });
  }

  // 缓存到 agent_outputs（每个行程一份；换 focus / force 会覆盖）
  const { error } = await supabase.from("agent_outputs").upsert({
    trip_id: id,
    agent_name: AGENT,
    status: "done",
    payload: result,
    error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    // 缓存失败不阻断：仍把结果返回给用户
    console.warn("[xhs] 缓存写入失败：", error.message);
  }
  return NextResponse.json({ guide: result });
}
