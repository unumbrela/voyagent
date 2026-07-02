import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { summarizeBudget, KIND_META, BUDGET_KINDS, formatCny } from "@/lib/budget";
import { dayColorOf as shareDayColor } from "@/lib/palette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 公开只读分享页 /share/[token]
 * 用 service_role 客户端按 share_token 查行程（绕过 RLS，仅读取，不暴露 user_id）。
 * 无编辑/保存/搜票控件，仅渲染逐日行程 + 预算汇总 + 关键信息。
 */

interface Item {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost?: number;
  booking_url?: string;
}
interface Day {
  day: number;
  date: string;
  theme: string;
  items: Item[];
}
interface Ref {
  label: string;
  value: string;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: trip } = await admin
    .from("trips")
    .select("id")
    .eq("share_token", token)
    .maybeSingle();
  if (!trip) notFound();

  const [{ data: ctx }, { data: itin }] = await Promise.all([
    admin
      .from("trip_context")
      .select("destination, start_date, end_date, budget, party_size")
      .eq("trip_id", trip.id)
      .single(),
    admin
      .from("itineraries")
      .select("days, references_data")
      .eq("trip_id", trip.id)
      .maybeSingle(),
  ]);

  const days = (itin?.days as Day[] | null) ?? [];
  const references = (itin?.references_data as Ref[] | null) ?? [];
  if (!days.length) notFound();

  const budget = summarizeBudget(
    days,
    typeof ctx?.budget === "number" ? ctx.budget : null,
    typeof ctx?.party_size === "number" ? ctx.party_size : null,
  );
  const dest = ctx?.destination ?? "";
  const dateRange = [ctx?.start_date, ctx?.end_date].filter(Boolean).join(" → ");

  const kinds = ([...BUDGET_KINDS, "other"] as (keyof typeof budget.byKind)[])
    .filter((k) => budget.byKind[k] > 0)
    .sort((a, b) => budget.byKind[b] - budget.byKind[a]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      {/* 头图：暮色刊头 */}
      <div className="night rounded-card shadow-lift">
        <div className="night-stars" aria-hidden />
        <div className="px-6 pb-6 pt-10 sm:pt-12">
          <p className="font-data text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--aurora-teal)" }}>
            {dest || "行程"} · 只读分享
          </p>
          <h1 className="font-serif mt-2 text-3xl font-black leading-tight text-white">
            {dest} 行程
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {dateRange && (
              <span className="font-data inline-flex items-center gap-1.5 rounded-pill border border-white/18 bg-white/[0.09] px-3 py-1 text-sm font-medium text-white/85 backdrop-blur">
                {dateRange}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/18 bg-white/[0.09] px-3 py-1 text-sm font-medium text-white/85 backdrop-blur">
              {days.length} 天
            </span>
          </div>
        </div>
      </div>

      {/* 预算汇总 */}
      {(budget.total > 0 || budget.budget) && (
        <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-soft">
          <div className="flex items-baseline justify-between">
            <span className="font-serif text-2xl font-bold tracking-tight text-ink">
              {formatCny(budget.total)}
            </span>
            {budget.budget != null && (
              <span className={budget.overBudget ? "text-seal" : "text-muted"}>
                预算 {formatCny(budget.budget)}
              </span>
            )}
          </div>
          {kinds.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {kinds.map((k) => {
                const v = budget.byKind[k];
                const pct = budget.total > 0 ? (v / budget.total) * 100 : 0;
                const m = KIND_META[k];
                return (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-8 shrink-0 text-muted">{m.label}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-pill bg-surface-2">
                      <div
                        className="h-full rounded-pill"
                        style={{ width: `${pct}%`, backgroundColor: m.color }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-ink/70">
                      {formatCny(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 逐日行程（只读） */}
      <div className="mt-6 space-y-6">
        {days.map((d, di) => (
          <div key={di} className="rounded-card border border-line bg-surface p-5 shadow-soft">
            <div className="flex items-baseline justify-between">
              <div>
                <p
                  className="font-data text-[11px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: shareDayColor(d.day) }}
                >
                  Day {d.day}
                </p>
                <h3 className="font-serif text-lg font-bold text-ink">
                  {d.theme}
                </h3>
              </div>
              <span className="font-data rounded-pill border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
                {d.date}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {d.items.map((it, ii) => (
                <li key={ii} className="wl-place-card p-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="wl-pin mt-0.5"
                      style={{ "--c": shareDayColor(d.day) } as React.CSSProperties}
                    >
                      {ii + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {it.time && (
                          <span className="font-data shrink-0 text-xs text-muted">{it.time}</span>
                        )}
                        <div className="text-sm font-semibold text-ink">{it.title}</div>
                      </div>
                      {it.detail && (
                        <div className="mt-0.5 text-sm text-muted">{it.detail}</div>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        {it.est_cost ? <span>¥{it.est_cost}</span> : null}
                        {it.booking_url && (
                          <a
                            href={it.booking_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-teal-dark hover:underline"
                          >
                            预订/购票 ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {references.length > 0 && (
        <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-soft">
          <h4 className="font-serif text-base font-bold text-ink">关键信息</h4>
          <dl className="mt-3 space-y-1.5 text-sm">
            {references.map((r, i) => (
              <div key={i} className="flex gap-2">
                <dt className="shrink-0 text-muted">{r.label}</dt>
                <dd className="break-all text-ink/80">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="mt-10 text-center text-xs text-muted">
        由{" "}
        <Link href="/" className="font-medium text-teal-dark underline">
          漫游 · 智能旅行规划
        </Link>{" "}
        生成
      </p>
    </main>
  );
}

