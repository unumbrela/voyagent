import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createTrip } from "@/lib/trips";
import { buildSampleItinerary, nextFriday, type SampleDay } from "@/lib/sample-trip";
import { getDemo, costToNumber, type Stop } from "@/app/showcase-data";

export const runtime = "nodejs";

/** ISO 日期加 n 天 */
function addDays(iso: string, n: number): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 演示停靠点 → 行程条目 detail（交通条目拼出可读票根文字） */
function stopDetail(s: Stop): string {
  if (s.ticket) {
    const t = s.ticket;
    const parts = [
      `${t.from} ${t.dep} → ${t.arr} ${t.to}`,
      t.dur,
      `${t.seat}${s.cost ? " " + s.cost : ""}`,
    ];
    if (t.via) parts.push(t.via);
    return parts.filter(Boolean).join(" · ");
  }
  return s.detail;
}

/**
 * POST /api/trips/demo —— 把首页某个 demo 一键存为「我的行程」。
 * body: { slug }。不跑流水线：直接写 trip + 成品 itinerary（status=done），
 * 用户随即可拖拽/记账/对话微调。日期取下一个周五起连续 N 天。
 * 苏州沿用 buildSampleItinerary（保留 12306 / Booking 真实预订深链）。
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let slug = "";
  try {
    const body = (await req.json()) as { slug?: string };
    slug = String(body.slug ?? "");
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const demo = getDemo(slug);
  if (!demo) {
    return NextResponse.json({ error: "未找到该目的地" }, { status: 404 });
  }

  try {
    // 组装成品行程（days / references / title / overview）+ 起止日期
    let title: string;
    let overview: string;
    let start_date: string;
    let end_date: string;
    let days: SampleDay[];
    let references: { label: string; value: string }[];

    if (slug === "suzhou") {
      // 苏州复用示例行程构造器，保留真实预订深链
      const sample = await buildSampleItinerary();
      ({ title, overview, start_date, end_date, days, references } = sample);
    } else {
      const d0 = nextFriday();
      start_date = d0;
      end_date = addDays(d0, demo.days.length - 1);
      title = demo.itineraryTitle;
      overview = demo.overview;
      references = demo.references;
      days = demo.days.map((day, idx) => ({
        day: day.day,
        date: addDays(d0, idx),
        theme: day.theme,
        items: day.stops.map((s) => ({
          time: s.time,
          title: s.title,
          kind: s.kind,
          detail: stopDetail(s),
          est_cost: costToNumber(s.cost),
          why: s.why ?? "",
        })),
      }));
    }

    const id = await createTrip(supabase, user.id, {
      destination: demo.name,
      origin: demo.origin,
      start_date,
      end_date,
      budget: demo.budgetValue,
      travel_style: `${demo.style}（示例行程）`,
      party_size: demo.partySize,
    });

    const { error: itinErr } = await supabase.from("itineraries").insert({
      trip_id: id,
      days,
      references_data: references,
    });
    if (itinErr) throw new Error(`写入示例行程失败: ${itinErr.message}`);

    // title/overview 分开写：0008 迁移未应用时静默跳过（页面回退到「<目的地> 行程」）
    const { error: metaErr } = await supabase
      .from("itineraries")
      .update({ title, overview })
      .eq("trip_id", id);
    if (metaErr) {
      console.warn("[demo] title/overview 落库失败（未应用 0008 迁移？）", metaErr.message);
    }

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
