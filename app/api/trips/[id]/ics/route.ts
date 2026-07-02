import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/trips/[id]/ics —— 导出行程为 .ics 日历文件。
 * 用 cookie 客户端：RLS 保证只能导出自己的行程。
 * 每个带时间的条目生成一条 VEVENT（浮动本地时间，旅客本地理解）；
 * 无具体时间的条目作为当日全天事件。
 */

interface Item {
  time?: string;
  title?: string;
  kind?: string;
  detail?: string;
}
interface Day {
  date?: string;
  items?: Item[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → {h,m}；无效返回 null */
function parseClock(s?: string): { h: number; m: number } | null {
  const mt = s?.match(/(\d{1,2}):(\d{2})/);
  if (!mt) return null;
  const h = Number(mt[1]);
  const m = Number(mt[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** ICS 文本转义（逗号/分号/反斜杠/换行） */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("需要登录后导出", { status: 401 });
  }

  const [{ data: ctx }, { data: itin }] = await Promise.all([
    supabase.from("trip_context").select("destination").eq("trip_id", id).single(),
    supabase.from("itineraries").select("days").eq("trip_id", id).maybeSingle(),
  ]);

  const days = (itin?.days as Day[] | null) ?? [];
  if (!days.length) {
    return new Response("itinerary not found", { status: 404 });
  }
  const dest = ctx?.destination ?? "行程";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//travel-planner//itinerary//CN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(`${dest} 行程`)}`,
  ];

  let seq = 0;
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  for (const d of days) {
    const date = d.date; // 期望 YYYY-MM-DD
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const ymd = date.replace(/-/g, "");
    for (const it of d.items ?? []) {
      const title = (it.title ?? "").trim();
      if (!title) continue;
      const uid = `${id}-${seq++}@travel-planner`;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${stamp}`);
      const clk = parseClock(it.time);
      if (clk) {
        // 浮动本地时间，默认时长 1.5h
        const startMin = clk.h * 60 + clk.m;
        const endMin = Math.min(startMin + 90, 23 * 60 + 59);
        lines.push(`DTSTART:${ymd}T${pad(clk.h)}${pad(clk.m)}00`);
        lines.push(
          `DTEND:${ymd}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`,
        );
      } else {
        // 全天事件：DTEND 为次日（ICS 全天为半开区间）
        const next = new Date(`${date}T00:00:00`);
        next.setDate(next.getDate() + 1);
        const ny = `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
        lines.push(`DTEND;VALUE=DATE:${ny}`);
      }
      lines.push(`SUMMARY:${esc(title)}`);
      if (it.detail) lines.push(`DESCRIPTION:${esc(it.detail)}`);
      lines.push(`LOCATION:${esc(dest)}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");

  const body = lines.join("\r\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="trip-${id}.ics"`,
    },
  });
}
