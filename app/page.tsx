"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useScroll,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
} from "motion/react";
import { logEvent } from "@/lib/log";
import {
  Map as MapIcon,
  Bot,
  Link2,
  GripVertical,
  Wallet,
  Luggage,
  MapPin,
  ArrowRight,
  Star,
  Sparkles,
  type LucideIcon,
} from "@/app/ui/icons";

// 地图依赖浏览器（Leaflet 直接操作 DOM），仅客户端加载，避免 SSR
const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });
// 「行程+地图」实景演示：真实 Leaflet 地图 + 无锡→苏州三日真实行程
const ShowcaseTrip = dynamic(() => import("./ShowcaseTrip"), { ssr: false });

type GeoStatus = "idle" | "locating" | "ok" | "failed";

/** 开场编排：eyebrow → 标题 → 文案 → CTA 依次浮现 */
const rise = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 出发地：自动定位填入，失败可手填。进页面即定位，故初始态就是 locating。
  const [origin, setOrigin] = useState("");
  const [geo, setGeo] = useState<GeoStatus>("locating");

  // 目的地：受控，便于「地图点选」多模态回填；默认表单也照常读它
  const [destination, setDestination] = useState("");
  const [showMap, setShowMap] = useState(false);

  // ── Hero 指针视差：光标在夜空里移动，产品预览随之 3D 微倾，一束青瓷光跟随光标 ──
  const reduceMotion = useReducedMotion();
  const hpx = useMotionValue(0); // 横向 -0.5 → 0.5
  const hpy = useMotionValue(0); // 纵向 -0.5 → 0.5
  const hsx = useSpring(hpx, { stiffness: 120, damping: 20 });
  const hsy = useSpring(hpy, { stiffness: 120, damping: 20 });
  const mockRotateY = useTransform(hsx, [-0.5, 0.5], [7, -7]);
  const mockRotateX = useTransform(hsy, [-0.5, 0.5], [-6, 6]);
  const mockShiftX = useTransform(hsx, [-0.5, 0.5], [-12, 12]);
  const glowX = useTransform(hsx, [-0.5, 0.5], ["32%", "68%"]);
  const glowY = useTransform(hsy, [-0.5, 0.5], ["28%", "72%"]);
  const heroGlow = useMotionTemplate`radial-gradient(360px circle at ${glowX} ${glowY}, rgba(47,212,198,0.18), transparent 68%)`;
  function onHeroMove(e: React.MouseEvent<HTMLElement>) {
    if (reduceMotion) return;
    const r = e.currentTarget.getBoundingClientRect();
    hpx.set((e.clientX - r.left) / r.width - 0.5);
    hpy.set((e.clientY - r.top) / r.height - 0.5);
  }
  function onHeroLeave() {
    hpx.set(0);
    hpy.set(0);
  }

  // 顶部滚动进度极光细条
  const { scrollYProgress } = useScroll();
  const progressX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  // 仅发起浏览器定位请求；setState 只在异步回调里发生（不在 effect 里同步 setState）。
  function requestGeo() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo("failed");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const place = await reverseGeocode(
            pos.coords.latitude,
            pos.coords.longitude,
          );
          if (place) {
            setOrigin(place);
            setGeo("ok");
          } else {
            setGeo("failed");
          }
        } catch {
          setGeo("failed");
        }
      },
      () => setGeo("failed"), // 用户拒绝授权 / 定位失败 → 手填
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  // 进页面即尝试自动定位（订阅浏览器 geolocation 外部系统，是 effect 的正当用途；
  // 仅「设备不支持定位」这一同步分支会立即 setState，无级联风险，豁免该启发式规则）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    requestGeo();
  }, []);

  // 按钮「重新定位」：事件处理器里同步置位 locating 没问题
  function onRelocate() {
    setGeo("locating");
    requestGeo();
  }

  // 当前时间（本地）：用于过滤「已过站」的车次。每分钟刷新一次显示。
  const [now, setNow] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(formatLocal(new Date()));
    const t = setInterval(() => setNow(formatLocal(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      destination: fd.get("destination"),
      origin: (fd.get("origin") as string)?.trim() || null,
      start_date: fd.get("start_date") || null,
      end_date: fd.get("end_date") || null,
      // 提交时取最新本地时间；浏览器拿不到时为空，由下方手填时间兜底
      now: typeof Date !== "undefined" ? formatLocal(new Date()) : null,
      depart_time: fd.get("depart_time") || null, // 去程最早出发时间（可选）
      return_by_time: fd.get("return_by_time") || null, // 返程最晚到达时间（可选）
      budget: fd.get("budget") ? Number(fd.get("budget")) : null,
      travel_style: fd.get("travel_style") || null,
      party_size: Number(fd.get("party_size") || 1),
    };
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      logEvent(
        "trip_create",
        {
          destination: body.destination,
          has_budget: body.budget != null,
          has_dates: !!body.start_date,
          party_size: body.party_size,
          via: "form",
        },
        data.id,
      );
      router.push(`/trips/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main className="flex-1">
      {/* 顶部滚动进度：极光渐变细条，随页面推进拉伸 */}
      <motion.div
        className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left"
        style={{
          scaleX: progressX,
          background:
            "linear-gradient(90deg, var(--aurora-teal), var(--aurora-violet) 55%, var(--aurora-amber))",
        }}
        aria-hidden
      />
      {/* ── HERO：暮色夜空 + 极光（可选影像层 /bg/hero.jpg 自动垫底） ── */}
      <section
        className="night"
        style={{ "--night-img": "url(/bg/hero.jpg)" } as React.CSSProperties}
        onMouseMove={onHeroMove}
        onMouseLeave={onHeroLeave}
      >
        <div className="night-stars" aria-hidden />
        {/* 跟随光标的青瓷柔光（极光在近处的回响） */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: heroGlow }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-28 pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:pb-36 lg:pt-32">
          <motion.div initial="hidden" animate="show">
            <motion.p
              variants={rise}
              custom={0}
              className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold tracking-[0.14em] backdrop-blur"
              style={{ color: "var(--aurora-teal)" }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              TRAVEL ATLAS · 8 位 AI 专家共创行程
            </motion.p>
            <motion.h1
              variants={rise}
              custom={1}
              className="font-serif mt-7 text-[2.7rem] font-black leading-[1.14] tracking-tight text-white sm:text-6xl"
            >
              一个应用，
              <br />
              搞定你的
              <span className="relative whitespace-nowrap">
                整趟旅行
                {/* 手绘下划：极光琥珀，暗底上的一笔暖色 */}
                <svg
                  className="absolute -bottom-2 left-0 w-full"
                  height="10"
                  viewBox="0 0 200 10"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <motion.path
                    d="M3 7c40-4 118-5 194-2"
                    fill="none"
                    stroke="var(--aurora-amber)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    opacity="0.9"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.6, duration: 0.7, ease: "easeInOut" }}
                  />
                </svg>
              </span>
              。
            </motion.h1>
            <motion.p
              variants={rise}
              custom={2}
              className="mt-7 max-w-md text-lg leading-relaxed"
              style={{ color: "var(--night-muted)" }}
            >
              制定逐日行程、探索真实地点、把交通住宿预算都放进一屏——
              8 位 AI 专家实时联网协作，全部在地图上可见、可拖拽微调。
            </motion.p>
            <motion.div
              variants={rise}
              custom={3}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <a
                href="#plan"
                className="btn-glow group inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold"
              >
                开始规划
                <ArrowRight
                  className="h-4 w-4 transition group-hover:translate-x-0.5"
                  aria-hidden
                />
              </a>
              <Link
                href="/trips"
                className="rounded-xl border border-white/20 bg-white/[0.06] px-7 py-3.5 text-base font-semibold text-white backdrop-blur transition hover:bg-white/[0.12]"
              >
                我的行程
              </Link>
            </motion.div>
            <motion.p
              variants={rise}
              custom={4}
              className="mt-5 text-sm"
              style={{ color: "var(--night-muted)" }}
            >
              免费开始 · 无需信用卡 · 数据真实可核验
            </motion.p>
          </motion.div>

          {/* 产品预览：白色应用窗口浮在夜空上（进场 → 缓慢浮动 → 指针 3D 微倾，三层解耦互不打架） */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ perspective: 1200 }}
          >
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -9, 0] }}
              transition={
                reduceMotion
                  ? undefined
                  : { duration: 6.5, repeat: Infinity, ease: "easeInOut" }
              }
            >
              <motion.div
                style={{
                  rotateX: mockRotateX,
                  rotateY: mockRotateY,
                  x: mockShiftX,
                  transformStyle: "preserve-3d",
                  filter: "drop-shadow(0 24px 60px rgba(4,10,30,0.6))",
                }}
              >
                <HeroMock />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
        <div className="night-curve" aria-hidden />
      </section>

      {/* ── 灵感灯箱：精选目的地图墙（点卡片即带入下方表单） ── */}
      <section className="isolate relative overflow-hidden border-b border-line/60">
        <div
          className="glow-spot glow-spot--amber -right-40 top-6 h-[26rem] w-[26rem]"
          aria-hidden
        />
        <div
          className="glow-spot glow-spot--teal -left-36 bottom-0 h-[24rem] w-[24rem]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="ed-eyebrow justify-center">灵感灯箱 · 想去哪</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              挑一个目的地，即刻启程
            </h2>
            <p className="mt-3 text-lg text-muted">
              点开任意一站，目的地自动填入下方表单，8 位 AI 专家立刻为你排出逐日行程。
            </p>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
            {DESTINATIONS.map((d, i) => (
              <DestinationCard
                key={d.slug}
                d={d}
                index={i}
                onPick={(q) => {
                  setDestination(q);
                  logEvent("destination_pick_gallery", { name: q, via: "gallery" });
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── "行程与地图，一屏尽览" 展示带 ── */}
      <section className="isolate relative overflow-hidden border-b border-line/60">
        {/* 白昼光斑：极光的日间回响 */}
        <div
          className="glow-spot glow-spot--teal -left-40 top-10 h-[30rem] w-[30rem]"
          aria-hidden
        />
        <div
          className="glow-spot glow-spot--amber -right-32 bottom-0 h-[26rem] w-[26rem]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="ed-eyebrow justify-center">行程与地图 · 一屏尽览</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              左手逐日安排，右手同步地图
            </h2>
            <p className="mt-3 text-lg text-muted">
              这不是效果图——下面是一份可以直接出发的「无锡 → 苏州」三日行程：
              真实车次、真实门票、真实动线。切换天数或指向任意一站，地图随之聚焦。
            </p>
          </div>
          {/* 航线绘入：虚线路线随滚动画出，落点一枚定位针 */}
          <RouteFlourish />
          <motion.div
            className="mt-2"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <ShowcaseTrip />
          </motion.div>
        </div>
      </section>

      {/* ── 特性区 ── */}
      <section className="isolate relative overflow-hidden">
        <div
          className="glow-spot glow-spot--violet -right-48 top-24 h-[32rem] w-[32rem]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="max-w-2xl">
            <span className="ed-eyebrow">为什么是漫游</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              规划一趟旅行需要的一切，都在这里
            </h2>
            <p className="mt-3 text-lg text-muted">
              orchestrator–worker 多智能体架构，专家分工、实时联网、彼此校验。
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: 0.05 * (i % 3), duration: 0.45 }}
                className="group tilt-card rounded-card border border-line bg-surface p-6 shadow-soft"
              >
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-teal to-teal-dark text-white shadow-soft transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <f.icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="font-display mt-4 text-lg font-bold text-ink">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {f.desc}
                </p>
              </motion.div>
            ))}
          </div>

          {/* 8 位专家 chips：随滚动逐枚弹入，hover 点亮为主色 */}
          <div className="mt-8 flex flex-wrap gap-2">
            {[
              "目的地调研",
              "活动推荐",
              "美食指南",
              "住宿甄选",
              "日程编排",
              "交通接驳",
              "综合行程",
              "出行质检",
            ].map((f, i) => (
              <motion.span
                key={f}
                initial={{ opacity: 0, y: 8, scale: 0.94 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{
                  delay: 0.04 * i,
                  duration: 0.32,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="cursor-default rounded-pill border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-teal/50 hover:bg-teal-tint hover:text-teal-dark"
              >
                {f}
              </motion.span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 数据统计带：夜空回响 ── */}
      <section className="night">
        <div className="night-stars" aria-hidden />
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 py-16 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p
                className="font-serif text-4xl font-black tracking-tight sm:text-5xl"
                style={{ color: "var(--aurora-teal)" }}
              >
                <StatNumber value={s.value} />
              </p>
              <p className="mt-1.5 text-sm" style={{ color: "var(--night-muted)" }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 用户评价 ── */}
      <section className="isolate relative overflow-hidden">
        <div
          className="glow-spot glow-spot--teal -left-40 bottom-10 h-[28rem] w-[28rem]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="ed-eyebrow justify-center">来自旅途</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              旅行者与研究者都在用
            </h2>
            <p className="mt-3 text-lg text-muted">
              把规划这件复杂的事，交给可解释、可核验、可协作的 AI。
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure
                key={t.name}
                className="tilt-card flex flex-col rounded-card border border-line bg-surface p-6 shadow-soft"
              >
                <div className="flex gap-0.5 text-amber-400" aria-label="五星评价">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-current" aria-hidden />
                  ))}
                </div>
                <blockquote className="font-serif mt-3 flex-1 text-[15px] italic leading-relaxed text-ink/85">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: t.color }}
                  >
                    {t.name.slice(0, 1)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {t.name}
                    </span>
                    <span className="block text-xs text-muted">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>

          {/* 技术栈徽章带 */}
          <div className="mt-12 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
              由这些技术驱动
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {["DeepSeek", "Supabase", "Leaflet", "Tavily", "Next.js", "OpenTelemetry"].map(
                (t) => (
                  <span
                    key={t}
                    className="rounded-pill border border-line bg-surface-2 px-3.5 py-1.5 text-sm font-semibold text-muted"
                  >
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 规划表单区 ── */}
      <section
        id="plan"
        className="isolate relative scroll-mt-16 overflow-hidden border-t border-line/60"
      >
        <div
          className="glow-spot glow-spot--teal -left-32 top-24 h-[26rem] w-[26rem]"
          aria-hidden
        />
        <div
          className="glow-spot glow-spot--violet -right-36 bottom-16 h-[28rem] w-[28rem]"
          aria-hidden
        />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="text-center">
            <span className="ed-eyebrow justify-center">启程</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              开始规划你的旅程
            </h2>
            <p className="mt-2 text-muted">
              填几个字段，剩下的交给 8 位 AI 专家。
            </p>
          </div>

          <motion.form
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 space-y-5 rounded-card border border-line bg-surface/90 p-6 shadow-lift ring-1 ring-teal/10 backdrop-blur sm:p-8"
          >
            <Field label="出发地">
              <div className="flex gap-2">
                <input
                  name="origin"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder={geo === "locating" ? "正在定位…" : "如：北京"}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={onRelocate}
                  disabled={geo === "locating"}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50 cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {geo === "locating" ? "定位中…" : "定位"}
                </button>
              </div>
              <GeoHint geo={geo} />
            </Field>

            <Field label="目的地" required>
              <div className="flex gap-2">
                <input
                  name="destination"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="如：东京"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShowMap((v) => !v)}
                  aria-expanded={showMap}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink cursor-pointer"
                >
                  <MapIcon className="h-3.5 w-3.5" aria-hidden />
                  {showMap ? "收起地图" : "地图选点"}
                </button>
              </div>
              {showMap && (
                <MapPicker
                  initial={destination}
                  onPick={(name) => {
                    setDestination(name);
                    logEvent("destination_pick_map", { name, via: "map" });
                  }}
                />
              )}
            </Field>

            <p className="text-xs text-muted">
              {now ? `当前时间：${now}（自动获取）` : "未能获取当前时间"}，
              用于过滤已发车的班次；也可在下方手动指定出发/返程时间。
            </p>

            <div className="grid grid-cols-2 gap-4">
              <Field label="出发日期">
                <input type="date" name="start_date" className={inputCls} />
              </Field>
              <Field label="出发时间（可选，最早）">
                <input type="time" name="depart_time" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="返回日期">
                <input type="date" name="end_date" className={inputCls} />
              </Field>
              <Field label="返程最晚到达（可选）">
                <input type="time" name="return_by_time" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="预算">
                <input
                  type="number"
                  name="budget"
                  placeholder="如：10000"
                  className={inputCls}
                />
              </Field>
              <Field label="人数">
                <input
                  type="number"
                  name="party_size"
                  defaultValue={2}
                  min={1}
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label="旅行风格">
              <input
                name="travel_style"
                placeholder="如：美食 + 文化，节奏轻松"
                className={inputCls}
              />
            </Field>

            {error && <p className="text-sm text-seal">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-glow w-full rounded-xl px-4 py-3.5 text-base font-semibold disabled:opacity-50 cursor-pointer"
            >
              {loading ? "创建中…" : "开始规划 →"}
            </button>
          </motion.form>
        </div>
      </section>
    </main>
  );
}

/** 统计数字滚动计数：进入视口后从 0 弹到目标值（非数字前缀/后缀原样保留） */
function StatNumber({ value }: { value: string }) {
  const m = value.match(/^(\d+)(.*)$/);
  const target = m ? Number(m[1]) : null;
  const suffix = m ? m[2] : "";
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (inView && target != null) mv.set(target);
  }, [inView, target, mv]);
  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplay(Math.round(v)));
    return () => unsub();
  }, [spring]);

  if (target == null) return <span ref={ref}>{value}</span>;
  return (
    <span ref={ref} className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

/** 航线绘入装饰：虚线路线随进入视口画出，终点亮起定位针（呼应「行程落在地图上」） */
function RouteFlourish() {
  return (
    <div className="pointer-events-none mx-auto -mb-2 mt-4 max-w-3xl px-6" aria-hidden>
      <svg viewBox="0 0 640 90" className="h-16 w-full sm:h-20" fill="none">
        <motion.path
          d="M8 74 C120 20, 240 84, 340 46 S 560 12, 616 34"
          stroke="var(--teal)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 9"
          opacity="0.55"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
        />
        {/* 起点小圆 */}
        <motion.circle
          cx="8"
          cy="74"
          r="4"
          fill="var(--teal)"
          opacity="0.7"
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        />
        {/* 终点定位针：路线画完后弹出 */}
        <motion.g
          initial={{ opacity: 0, scale: 0.4, y: 6 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ delay: 1.45, type: "spring", stiffness: 380, damping: 18 }}
        >
          <path
            d="M616 14c-7.2 0-13 5.7-13 12.8 0 9.6 13 21.2 13 21.2s13-11.6 13-21.2C629 19.7 623.2 14 616 14z"
            fill="var(--seal)"
            opacity="0.9"
          />
          <circle cx="616" cy="27" r="4.6" fill="#fff" />
        </motion.g>
      </svg>
    </div>
  );
}

const STATS: { value: string; label: string }[] = [
  { value: "8", label: "位专家 AI 协作" },
  { value: "6", label: "波并行编排" },
  { value: "100%", label: "数据附来源核验" },
  { value: "1 屏", label: "行程 + 地图同步" },
];

const TESTIMONIALS: { name: string; role: string; quote: string; color: string }[] = [
  {
    name: "林 Wei",
    role: "自由行玩家",
    quote:
      "以前排一趟五日游要开十几个标签页，现在几分钟就出一版逐日行程，车次和酒店还都带真实链接，直接就能订。",
    color: "#0f8b8b",
  },
  {
    name: "Zoe",
    role: "HCI 研究者",
    quote:
      "最难得的是过程可见——每个 agent 选了谁、依据什么来源都摊开给你看，改动还能先预览再决定，信任是建立在证据上的。",
    color: "#5b6abf",
  },
  {
    name: "老陈",
    role: "带娃出行的爸爸",
    quote:
      "节奏滑块一拉就把每天排松，天气打包清单也自动生成。全家出门再也不用我一个人熬夜做攻略了。",
    color: "#d97742",
  },
];

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: MapIcon,
    title: "地图上的行程",
    desc: "每个景点、餐厅、酒店都落在交互地图上，逐日路线一目了然。",
  },
  {
    icon: Bot,
    title: "8 位 AI 专家协作",
    desc: "调研、活动、美食、住宿、日程、交通、综合、质检，分工又互相校验。",
  },
  {
    icon: Link2,
    title: "真实数据，可核验",
    desc: "车次、航班、酒店实时联网检索，附来源与官方预订深链，绝不编造。",
  },
  {
    icon: GripVertical,
    title: "拖拽即改",
    desc: "条目可拖拽排序、直接改内容，也能和对话助手共同微调行程。",
  },
  {
    icon: Wallet,
    title: "预算随时可见",
    desc: "按类别、按天实时汇总花费，和预算对照，超支立刻提醒。",
  },
  {
    icon: Luggage,
    title: "天气与打包",
    desc: "按目的地天气与活动智能生成打包清单，出发前一项不落。",
  },
];

/** 精选目的地：图墙数据。slug 对应 public/destinations/<slug>.jpg（见该目录 README 的生成提示词）。
 *  query 为点卡片后带入「目的地」表单的字段；featured 卡片右上角盖「AI 精选」印章。 */
type Destination = {
  slug: string;
  name: string;
  en: string;
  tagline: string;
  query: string;
  featured?: boolean;
};

const DESTINATIONS: Destination[] = [
  {
    slug: "suzhou",
    name: "苏州",
    en: "SUZHOU",
    tagline: "园林深处，枕河人家",
    query: "苏州",
    featured: true,
  },
  {
    slug: "kyoto",
    name: "京都",
    en: "KYOTO",
    tagline: "千年古都，红叶千鸟居",
    query: "京都",
  },
  {
    slug: "yading",
    name: "稻城亚丁",
    en: "YADING",
    tagline: "雪山圣湖，蓝色星球的净土",
    query: "稻城亚丁",
  },
  {
    slug: "iceland",
    name: "冰岛",
    en: "ICELAND",
    tagline: "极光旷野，冰与火之地",
    query: "冰岛",
    featured: true,
  },
  {
    slug: "santorini",
    name: "圣托里尼",
    en: "SANTORINI",
    tagline: "爱琴海落日，蓝白之城",
    query: "圣托里尼",
  },
  {
    slug: "morocco",
    name: "摩洛哥",
    en: "MOROCCO",
    tagline: "撒哈拉沙丘，暖色秘境",
    query: "摩洛哥",
  },
];

/** 目的地卡：竖幅实景照 + 底部渐深遮罩 + 衬线地名；hover 抬升并浮出「规划这里」。
 *  照片缺失（尚未生成）时降级为青瓷→琥珀柔和渐变占位，绝不裂图。 */
function DestinationCard({
  d,
  index,
  onPick,
}: {
  d: Destination;
  index: number;
  onPick: (query: string) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  // 指针 3D 微倾：光标位置 → 卡片朝光标翘起（弹簧回中），比纯 CSS 更有实体感
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [6.5, -6.5]), {
    stiffness: 150,
    damping: 15,
  });
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-6.5, 6.5]), {
    stiffness: 150,
    damping: 15,
  });
  function onMove(e: React.MouseEvent<HTMLElement>) {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  function onLeave() {
    px.set(0);
    py.set(0);
  }
  return (
    <motion.a
      href="#plan"
      onClick={() => onPick(d.query)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: 0.05 * (index % 3), duration: 0.45 }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 800 }}
      className="group relative block overflow-hidden rounded-card border border-line bg-surface-2 shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-teal/45 hover:shadow-lift"
      aria-label={`规划前往${d.name}的行程`}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        {imgOk ? (
          <img
            src={`/destinations/${d.slug}.jpg`}
            alt={d.name}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
          />
        ) : (
          // 照片未就绪的占位：柔和色晕 + 定位针，观感仍是「有意为之」
          <div
            className="grid h-full w-full place-items-center"
            style={{
              background:
                "linear-gradient(150deg, color-mix(in srgb, var(--teal) 22%, #fff), color-mix(in srgb, var(--aurora-amber) 26%, #fff))",
            }}
          >
            <MapPin className="h-7 w-7 text-white/80" aria-hidden />
          </div>
        )}
        {/* 顶部微遮罩：在亮顶照片上也托住右上角印章 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{
            background: "linear-gradient(to bottom, rgba(11,17,36,0.42), transparent)",
          }}
        />
        {/* 底部主遮罩：保证白字在任意照片上都可读 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(11,17,36,0.9), rgba(11,17,36,0.22) 44%, rgba(11,17,36,0) 70%)",
          }}
        />
        {d.featured && (
          <span className="seal-stamp absolute right-3 top-3 bg-white/85 backdrop-blur">
            AI 精选
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2.5 p-3.5 sm:p-4">
          <div className="min-w-0">
            <p className="font-data text-[10px] font-medium tracking-[0.22em] text-white/75">
              {d.en}
            </p>
            <h3 className="font-serif text-lg font-bold leading-tight text-white sm:text-xl">
              {d.name}
            </h3>
            <p className="mt-1 text-xs leading-snug text-white/85">{d.tagline}</p>
          </div>
          {/* 常驻圆形箭头：明确「点即规划」，hover 时填青瓷并右移 */}
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 text-white backdrop-blur transition-all duration-300 group-hover:translate-x-0.5 group-hover:border-transparent group-hover:bg-teal sm:h-9 sm:w-9"
            aria-hidden
          >
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </motion.a>
  );
}

/** 产品预览窗口：左行程列表 + 右迷你地图（呼应「行程+地图」双栏视图）。 */
function HeroMock() {
  const rows = [
    { n: 1, c: "var(--c-transit)", title: "G7215 · 无锡 → 苏州", meta: "09:04 · 20 分钟直达" },
    { n: 2, c: "var(--c-activity)", title: "拙政园", meta: "10:40 · ¥80" },
    { n: 3, c: "var(--c-activity)", title: "苏州博物馆", meta: "14:00 · 免费预约" },
    { n: 4, c: "var(--c-activity)", title: "平江路 · 摇橹船夜游", meta: "18:30 · ¥55" },
  ];
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-lift">
      {/* 窗口顶栏 */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="font-data ml-3 rounded-pill border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
          无锡 → 苏州 · 江南三日
        </span>
      </div>
      <div className="grid sm:grid-cols-[1fr_0.85fr]">
        {/* 左：行程列表 */}
        <div className="p-5">
          <p className="ed-eyebrow">周五 · Day 1</p>
          <h3 className="font-serif mt-1 text-base font-bold text-ink">
            入城 · 拙政园与平江夜色
          </h3>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li
                key={r.n}
                className="flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5"
              >
                <span
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: r.c }}
                >
                  {r.n}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {r.title}
                  </p>
                  <p className="font-data text-[11px] text-muted">{r.meta}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {/* 右：迷你地图 */}
        <div
          className="relative hidden min-h-[260px] border-l border-line sm:block"
          style={{
            background:
              "linear-gradient(135deg,#eef4f2,#e7eef3), radial-gradient(circle at 30% 40%, rgba(15,139,139,.08), transparent 60%)",
          }}
        >
          {/* 路线绘入动效 */}
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <motion.polyline
              points="60,60 120,110 90,180 150,220"
              fill="none"
              stroke="var(--teal)"
              strokeWidth="2"
              strokeDasharray="1 8"
              strokeLinecap="round"
              opacity="0.7"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.7, duration: 1.2, ease: "easeInOut" }}
            />
          </svg>
          {[
            { n: 1, x: 60, y: 60, c: "var(--c-transit)" },
            { n: 2, x: 120, y: 110, c: "var(--c-activity)" },
            { n: 3, x: 90, y: 180, c: "var(--c-activity)" },
            { n: 4, x: 150, y: 220, c: "var(--c-activity)" },
          ].map((p, i) => (
            <motion.span
              key={p.n}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8 + i * 0.22, type: "spring", stiffness: 400, damping: 22 }}
              className="absolute grid h-6 w-6 -translate-x-1/2 -translate-y-full place-items-center rounded-full text-[11px] font-bold text-white shadow-md"
              style={{
                left: p.x,
                top: p.y,
                background: p.c,
                borderRadius: "50% 50% 50% 0",
              }}
            >
              <span style={{ transform: "rotate(0)" }}>{p.n}</span>
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 本地时间格式化为 "YYYY-MM-DD HH:MM"（不带时区，按旅客本地时间理解） */
function formatLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

/**
 * 反向地理编码：经纬度 → 地名。用 BigDataCloud 的免费客户端接口（无需 key、支持 CORS）。
 * 返回中文地名，失败返回 null。
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  const city = d.city || d.locality || d.principalSubdivision || "";
  const parts = [city, d.countryName].filter(Boolean);
  return parts.length ? parts.join("，") : null;
}

function GeoHint({ geo }: { geo: GeoStatus }) {
  const text =
    geo === "locating"
      ? "正在获取当前位置…"
      : geo === "ok"
        ? "已自动定位，可手动修改"
        : geo === "failed"
          ? "未能自动定位，请手动填写出发地"
          : "";
  if (!text) return null;
  return (
    <span
      className={`mt-1 block text-xs ${
        geo === "failed" ? "text-amber-600" : "text-muted"
      }`}
    >
      {text}
    </span>
  );
}

const inputCls =
  "w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink/80">
        {label}
        {required && <span className="text-seal"> *</span>}
      </span>
      {children}
    </label>
  );
}
