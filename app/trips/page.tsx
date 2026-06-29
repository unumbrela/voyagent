import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

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

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  planning: "规划中",
  done: "已完成",
  failed: "失败",
};

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
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">我的行程</h1>
        <Link
          href="/"
          className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + 新建
        </Link>
      </div>

      {error && (
        <p className="mt-8 text-sm text-red-600">加载失败：{error.message}</p>
      )}

      {!error && trips.length === 0 && (
        <div className="mt-16 text-center text-sm text-neutral-500">
          还没有行程。
          <Link href="/" className="text-neutral-900 underline">
            创建第一个
          </Link>
          。
        </div>
      )}

      <ul className="mt-8 space-y-3">
        {trips.map((t) => {
          const ctx = t.trip_context;
          const dest = ctx?.destination ?? "未命名目的地";
          const dates = [ctx?.start_date, ctx?.end_date]
            .filter(Boolean)
            .join(" → ");
          return (
            <li key={t.id}>
              <Link
                href={`/trips/${t.id}`}
                className="flex items-center justify-between rounded-xl border border-neutral-200 px-5 py-4 transition hover:border-neutral-900"
              >
                <div className="min-w-0">
                  <div className="font-medium">{dest}</div>
                  <div className="mt-0.5 truncate text-xs text-neutral-400">
                    {dates || "未设定日期"} ·{" "}
                    {new Date(t.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "bg-red-50 text-red-700"
        : status === "planning"
          ? "bg-amber-50 text-amber-700"
          : "bg-neutral-100 text-neutral-500";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
