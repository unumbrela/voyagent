import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { DAY_COLORS } from "@/lib/palette";
import { Plus } from "@/app/ui/icons";
import { Empty } from "@/app/ui/empty";
import { TripCard } from "./TripCard";
import { SampleTripButton } from "./SampleTripButton";

export const runtime = "nodejs";
// 总是动态渲染：依赖登录态 cookie
export const dynamic = "force-dynamic";

interface TripRow {
  id: string;
  status: string;
  created_at: string;
  trip_context: {
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
  } | null;
}

// 目的地 → 制图集色调（稳定映射同色）
function hueFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % DAY_COLORS.length;
  return DAY_COLORS[h];
}

/** 我的行程：列出当前登录用户的全部行程（RLS 自动隔离，仅见本人的）。 */
export default async function TripsPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, status, created_at, trip_context(destination, start_date, end_date)",
    )
    .order("created_at", { ascending: false });

  const trips = (data ?? []) as unknown as TripRow[];

  return (
    <main className="isolate relative mx-auto w-full max-w-5xl overflow-x-clip px-6 py-12">
      <div
        className="glow-spot glow-spot--teal -left-40 -top-10 h-[24rem] w-[24rem]"
        aria-hidden
      />
      <div
        className="glow-spot glow-spot--amber -right-32 top-60 h-[22rem] w-[22rem]"
        aria-hidden
      />
      <div className="flex items-center justify-between">
        <div>
          <span className="ed-eyebrow">全部行程</span>
          <h1 className="font-serif mt-2 text-3xl font-bold tracking-tight text-ink">
            我的行程
          </h1>
          <p className="mt-1 text-sm text-muted">共 {trips.length} 趟</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-teal-dark"
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建行程
        </Link>
      </div>

      {error && (
        <p className="mt-8 rounded-md bg-seal-tint px-4 py-3 text-sm text-seal">
          加载失败：{error.message}
        </p>
      )}

      {!error && trips.length === 0 && (
        <div className="mt-12 rounded-card border border-dashed border-line-strong bg-surface">
          <Empty
            art="luggage"
            title="还没有行程"
            hint="填几项，AI 就能帮你排好每一天。也可以先载入一份真实的示例行程，试试拖动、预算、打包和地图怎么用。"
            action={
              <span className="flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/"
                  className="inline-block rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-teal-dark"
                >
                  创建第一个行程
                </Link>
                <SampleTripButton />
              </span>
            }
          />
        </div>
      )}

      {/* 空状态时上方已有两个入口，网格（含新建卡）只在有行程时出现，避免 CTA 重复 */}
      {trips.length > 0 && (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* 置顶：新建行程卡 */}
          <Link
            href="/"
            className="group flex min-h-[172px] flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface text-center shadow-soft transition hover:-translate-y-0.5 hover:border-teal hover:shadow-lift"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-teal text-white shadow-soft transition group-hover:scale-105">
              <Plus className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">规划新行程</p>
            <p className="mt-0.5 text-xs text-muted">几分钟排好每天的安排</p>
          </Link>

          {trips.map((t) => {
            const ctx = t.trip_context;
            const dest = ctx?.destination ?? "未命名目的地";
            const dates = [ctx?.start_date, ctx?.end_date]
              .filter(Boolean)
              .join(" → ");
            return (
              <TripCard
                key={t.id}
                id={t.id}
                status={t.status}
                createdAt={t.created_at}
                destination={dest}
                dates={dates}
                hue={hueFor(dest)}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
