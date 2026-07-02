import { NextResponse } from "next/server";
import {
  createAdminClient,
  createServerSupabase,
} from "@/lib/supabase/server";
import { runRefine } from "@/lib/agents/refine";
import { detectInjection, hasHigh } from "@/lib/guardrails";
import type { AgentContext, AgentName, TripContext } from "@/lib/agents/types";

export const runtime = "nodejs";
// 单次 agent 调用，留足时长
export const maxDuration = 120;

interface Day {
  day: number;
  date: string;
  theme: string;
  items: unknown[];
}
interface ItinResult {
  title?: string;
  overview?: string;
  days?: Day[];
  references?: { label: string; value: string }[];
}

/**
 * POST /api/trips/[id]/refine —— 对已成形行程按自然语言指令做局部/整体修订。
 * body: { instruction: string, scope: "all" | { day: number } }
 *
 * 归属校验走 cookie 客户端（RLS）；随后用 admin 客户端读上游产物、写回 itineraries。
 * 把【当前已存行程（含用户编辑）】作为输入再生成 —— 等于在用户编辑基础上改，不会丢编辑。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tripId } = await params;

  let body: {
    instruction?: string;
    scope?: "all" | { day: number };
    preview?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  // preview=true：只计算并返回，不写库——用于「先预览、用户确认后再由前端提交」的流程
  const preview = body.preview === true;
  const instruction = (body.instruction ?? "").trim();
  if (!instruction) {
    return NextResponse.json({ error: "缺少修订指令" }, { status: 400 });
  }
  // 输入护栏：修订指令是自由文本入口，扫提示注入；高危直接拒绝
  const findings = detectInjection(instruction);
  if (hasHigh(findings)) {
    console.warn(
      "[guardrail] refine 指令命中高危注入：",
      findings.map((f) => f.id).join(", "),
    );
    return NextResponse.json(
      { error: "指令中含疑似越权内容，已拒绝。请只描述行程修改诉求。" },
      { status: 400 },
    );
  }
  const scope: "all" | { day: number } =
    body.scope && typeof body.scope === "object" && "day" in body.scope
      ? { day: Number(body.scope.day) }
      : "all";

  // 1) 归属校验 + 读单一事实来源（RLS）
  const userClient = await createServerSupabase();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data: ctx, error: ctxErr } = await userClient
    .from("trip_context")
    .select("*")
    .eq("trip_id", tripId)
    .single();
  if (ctxErr || !ctx) {
    return NextResponse.json({ error: "未找到行程或无权访问" }, { status: 404 });
  }

  // 2) admin 客户端读当前行程 + 上游产物
  const admin = createAdminClient();
  const [{ data: itin }, { data: outputs }] = await Promise.all([
    admin
      .from("itineraries")
      .select("days, references_data")
      .eq("trip_id", tripId)
      .maybeSingle(),
    admin
      .from("agent_outputs")
      .select("agent_name, payload, status")
      .eq("trip_id", tripId),
  ]);

  const currentDays = (itin?.days as Day[] | null) ?? [];
  if (!currentDays.length) {
    return NextResponse.json(
      { error: "行程尚未生成，无法修订——请回到行程页等规划完成或从断点重试" },
      { status: 400 },
    );
  }
  const currentRefs = (itin?.references_data as
    | { label: string; value: string }[]
    | null) ?? [];

  const upstream: Partial<Record<AgentName, unknown>> = {};
  for (const o of outputs ?? []) {
    if (o.status === "done" && o.payload) {
      upstream[o.agent_name as AgentName] = o.payload;
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
  const agentCtx: AgentContext = { context, upstream };

  const currentItinerary = {
    title: `${ctx.destination ?? ""} 行程`.trim(),
    days: currentDays,
    references: currentRefs,
  };

  // 3) 调 refine agent
  let result: ItinResult;
  try {
    result = (await runRefine(
      agentCtx,
      currentItinerary,
      instruction,
      scope,
    )) as ItinResult;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const revisedDays = Array.isArray(result.days) ? result.days : [];
  if (!revisedDays.length) {
    return NextResponse.json({ error: "修订结果为空" }, { status: 500 });
  }

  // 4) 合并：day-scope 只替换目标天（按 day 号匹配），其余各天保留当前版本（不丢编辑）
  let finalDays: Day[];
  let finalRefs = currentRefs;
  if (scope === "all") {
    finalDays = revisedDays;
    if (Array.isArray(result.references)) finalRefs = result.references;
  } else {
    const revisedOne = revisedDays.find((d) => d.day === scope.day);
    finalDays = revisedOne
      ? currentDays.map((d) => (d.day === scope.day ? revisedOne : d))
      : currentDays;
  }

  // 5) 写回（preview 模式跳过：交由前端确认后再走 PUT 提交，保证「预览不改库」）
  if (!preview) {
    const { error: upErr } = await admin
      .from("itineraries")
      .update({ days: finalDays, references_data: finalRefs })
      .eq("trip_id", tripId);
    if (upErr) {
      return NextResponse.json(
        { error: `保存失败: ${upErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ days: finalDays, references: finalRefs, preview });
}
