import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/log —— 批量写入交互埋点（HCI 用户评估基建）。
 *
 * body: { events: LogEvent[] }，单次可带多条（前端缓冲后批量 flush，降请求数）。
 * 每条：{ event_type, payload?, trip_id?, session_id?, client_ts? }
 *
 * 走用户态 client：RLS 自动把 user_id 限定为当前登录用户；未登录静默丢弃（返回 ok）
 * ——埋点不该阻塞主流程，也不该在未登录时报错刷屏。
 * 兼容 navigator.sendBeacon（pagehide 时可能以 text/plain 发来），故手动解析文本。
 */
export async function POST(req: Request) {
  let body: { events?: unknown };
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ ok: true, inserted: 0 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 未登录：静默成功（埋点最佳努力，不打断体验）
  if (!user) return NextResponse.json({ ok: true, inserted: 0 });

  type Row = {
    user_id: string;
    trip_id: string | null;
    session_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
  };
  const isUuid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const rows: Row[] = [];
  for (const e of events) {
    if (typeof e !== "object" || e === null) continue;
    const ev = e as Record<string, unknown>;
    if (typeof ev.event_type !== "string" || !ev.event_type) continue;
    const payload =
      typeof ev.payload === "object" && ev.payload !== null
        ? (ev.payload as Record<string, unknown>)
        : {};
    // client_ts 一起并入 payload，保留前端精确时序（服务端 created_at 为落库时间）
    if (typeof ev.client_ts === "number") payload.client_ts = ev.client_ts;
    rows.push({
      user_id: user.id,
      trip_id: isUuid(ev.trip_id) ? ev.trip_id : null,
      session_id: typeof ev.session_id === "string" ? ev.session_id : null,
      event_type: ev.event_type,
      payload,
    });
  }
  if (!rows.length) return NextResponse.json({ ok: true, inserted: 0 });

  const { error } = await supabase.from("interaction_logs").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: rows.length });
}
