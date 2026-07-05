"use client";

/**
 * /demo/[slug] —— 首页灵感灯箱点进后的「完整可行方案」演示页。
 *
 * 纯静态渲染（数据来自 app/showcase-data 的 DEMOS），无需登录、不跑流水线，
 * 秒开即见一份从无锡出发、真实车次/景点/票价的逐日行程 + 实景地图。
 * 主 CTA「一键存为我的行程」→ POST /api/trips/demo 把该方案写成可编辑行程；
 * 未登录则先引导登录并带 next 回到本页。
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { logEvent } from "@/lib/log";
import { getDemo, DEMO_LIST } from "@/app/showcase-data";
import {
  Compass,
  MapPin,
  CalendarDays,
  Wallet,
  Sparkles,
  ArrowRight,
  Loader2,
  TrainFront,
  Plane,
} from "@/app/ui/icons";

// 地图依赖浏览器（Leaflet 直接操作 DOM），仅客户端加载，避免 SSR
const ShowcaseTrip = dynamic(() => import("@/app/ShowcaseTrip"), { ssr: false });

export default function DemoPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const demo = getDemo(slug);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!demo) {
    return (
      <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-6 text-center">
        <div>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-muted mx-auto">
            <Compass className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="font-serif mt-5 text-2xl font-bold text-ink">
            没找到这个目的地
          </h1>
          <p className="mt-2 text-muted">换一个灵感目的地看看吧。</p>
          <Link
            href="/#inspiration"
            className="btn-glow mt-6 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold"
          >
            回到灵感灯箱
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </main>
    );
  }

  const TransportIcon = demo.transport === "flight" ? Plane : TrainFront;
  const subtitle = `${demo.dateLabel} · ${demo.partySize} 人 · ${demo.durationLabel}`;
  const others = DEMO_LIST.filter((d) => d.slug !== demo.slug);

  async function save() {
    if (!demo) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/trips/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: demo.slug }),
      });
      // 未登录 → 去登录后回到本页
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/demo/${demo.slug}`)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "存入失败");
      logEvent("demo_save", { slug: demo.slug }, data.id);
      router.push(`/trips/${data.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const SaveButton = ({ block = false }: { block?: boolean }) => (
    <button
      onClick={save}
      disabled={busy}
      className={`btn-glow inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold disabled:opacity-60 cursor-pointer ${
        block ? "w-full sm:w-auto" : ""
      }`}
    >
      {busy ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-4.5 w-4.5" aria-hidden />
      )}
      {busy ? "正在存入…" : "一键存为我的行程"}
      {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
    </button>
  );

  return (
    <main className="flex-1">
      {/* ── HERO：暮色夜空 + 行程档案头 ── */}
      <section className="night">
        <div className="night-stars" aria-hidden />
        <div className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-24 lg:pb-28 lg:pt-28">
          <Link
            href="/#inspiration"
            className="inline-flex items-center gap-1.5 rounded-pill border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold text-white/85 backdrop-blur transition hover:bg-white/[0.14]"
          >
            ← 换个目的地
          </Link>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p
              className="mt-7 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em]"
              style={{ color: "var(--aurora-teal)" }}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {demo.region} · {demo.en}
            </p>
            <h1 className="font-serif mt-3 text-[2.4rem] font-black leading-[1.12] tracking-tight text-white sm:text-5xl">
              {demo.origin} → {demo.name}
            </h1>
            <p className="mt-3 max-w-xl text-lg" style={{ color: "var(--night-muted)" }}>
              {demo.tagline}
            </p>

            {/* 元信息 chips */}
            <div className="mt-6 flex flex-wrap gap-2.5">
              <MetaChip icon={<TransportIcon className="h-3.5 w-3.5" aria-hidden />}>
                {demo.transportNote}
              </MetaChip>
              <MetaChip icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}>
                {subtitle}
              </MetaChip>
              <MetaChip icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}>
                预算 {demo.budgetLabel}
              </MetaChip>
            </div>

            {/* 亮点 chips */}
            <div className="mt-4 flex flex-wrap gap-2">
              {demo.highlights.map((h) => (
                <span
                  key={h}
                  className="rounded-pill border border-white/12 bg-white/[0.05] px-3 py-1 text-xs text-white/80 backdrop-blur"
                >
                  {h}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SaveButton />
              <a
                href="#plan-demo"
                className="rounded-xl border border-white/20 bg-white/[0.06] px-7 py-3.5 text-base font-semibold text-white backdrop-blur transition hover:bg-white/[0.12]"
              >
                先看逐日行程
              </a>
            </div>
            {err && <p className="mt-3 text-sm text-[#ff9b8a]">{err}</p>}
            <p className="mt-4 text-sm" style={{ color: "var(--night-muted)" }}>
              这是一份可直接照着走的示例方案 · 真实车次 / 景点 / 票价 · 存为行程后可拖拽、记账、与 AI 助手对话微调
            </p>
          </motion.div>
        </div>
        <div className="night-curve" aria-hidden />
      </section>

      {/* ── 概览 + 逐日行程 + 地图 ── */}
      <section id="plan-demo" className="isolate relative overflow-hidden scroll-mt-16">
        <div className="glow-spot glow-spot--teal -left-40 top-10 h-[30rem] w-[30rem]" aria-hidden />
        <div className="glow-spot glow-spot--amber -right-32 bottom-0 h-[26rem] w-[26rem]" aria-hidden />
        <div className="mx-auto max-w-6xl px-6 py-14 lg:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <span className="ed-eyebrow justify-center">行程与地图 · 一屏尽览</span>
            <h2 className="font-serif mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {demo.itineraryTitle}
            </h2>
            <p className="mt-3 text-muted">{demo.overview}</p>
          </div>

          <div className="mt-9">
            <ShowcaseTrip
              days={demo.days}
              title={demo.itineraryTitle}
              subtitle={subtitle}
              badge="真实数据 · 可交互"
              tiles={demo.tiles}
              transport={demo.transport}
            />
          </div>

          {/* 关键信息 */}
          {demo.references.length > 0 && (
            <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-soft sm:p-6">
              <h3 className="font-serif text-base font-bold text-ink">关键信息</h3>
              <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {demo.references.map((r) => (
                  <div key={r.label} className="flex gap-2">
                    <dt className="shrink-0 font-medium text-muted">{r.label}</dt>
                    <dd className="text-ink/85">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* 底部 CTA 带 */}
          <div className="mt-8 flex flex-col items-center gap-3 rounded-card border border-teal/20 bg-teal-tint/50 px-6 py-8 text-center">
            <h3 className="font-serif text-xl font-bold text-ink">
              喜欢这个方案？一键收进你的行程
            </h3>
            <p className="max-w-md text-sm text-muted">
              存为我的行程后，即可拖拽排序、按天记账、导出日历，或让 8 位 AI 专家帮你继续微调。
            </p>
            <div className="mt-1">
              <SaveButton block />
            </div>
            {err && <p className="text-sm text-seal">{err}</p>}
          </div>
        </div>
      </section>

      {/* ── 其他灵感目的地 ── */}
      <section className="isolate relative overflow-hidden border-t border-line/60">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <span className="ed-eyebrow">继续探索</span>
          <h2 className="font-serif mt-3 text-2xl font-bold tracking-tight text-ink">
            其他从无锡出发的方案
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            {others.map((d) => {
              const Icon = d.transport === "flight" ? Plane : TrainFront;
              return (
                <Link
                  key={d.slug}
                  href={`/demo/${d.slug}`}
                  className="group rounded-card border border-line bg-surface p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-teal/45 hover:shadow-lift"
                >
                  <p className="font-data text-[10px] font-medium tracking-[0.18em] text-muted">
                    {d.en}
                  </p>
                  <h3 className="font-serif mt-1 text-lg font-bold text-ink">
                    {d.name}
                  </h3>
                  <p className="mt-1 line-clamp-1 text-xs text-muted">{d.tagline}</p>
                  <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-teal-dark">
                    <Icon className="h-3 w-3" aria-hidden />
                    {d.durationLabel}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" aria-hidden />
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function MetaChip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
      <span style={{ color: "var(--aurora-teal)" }}>{icon}</span>
      {children}
    </span>
  );
}
