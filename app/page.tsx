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
  TrainFront,
  Plane,
  type LucideIcon,
} from "@/app/ui/icons";

// 地图依赖浏览器（Leaflet 直接操作 DOM），仅客户端加载，避免 SSR
const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });
// 「行程+地图」实景演示：真实 Leaflet 地图 + 无锡→苏州三日真实行程
const ShowcaseTrip = dynamic(() => import("./ShowcaseTrip"), { ssr: false });
// Hero 右侧真地图：真实 Leaflet + 高德瓦片 + 定制苏州古城步行路径（浏览器专属，禁 SSR）
const HeroTripMap = dynamic(() => import("./HeroTripMap"), { ssr: false });
// Hero 示例数据：专为 Hero 定制的「苏州古城 · 一日漫步」步行环线
import { HERO_DAY, KIND_COLOR, DEMO_LIST, haversineKm, type DemoTrip } from "./showcase-data";

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
        <div className="relative z-10 mx-auto grid max-w-[88rem] items-center gap-12 px-6 pb-28 pt-28 lg:grid-cols-[0.85fr_1.3fr] lg:pb-36 lg:pt-32">
          <motion.div initial="hidden" animate="show">
            <motion.p
              variants={rise}
              custom={0}
              className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold tracking-[0.14em] backdrop-blur"
              style={{ color: "var(--aurora-teal)" }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              8 个 AI 助手，一起帮你规划
            </motion.p>
            <motion.h1
              variants={rise}
              custom={1}
              className="font-serif mt-7 text-[2.7rem] font-black leading-[1.14] tracking-tight text-white sm:text-6xl"
            >
              一个应用，
              <br />
              安排好你的
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
              告诉我们你想去哪，AI 会帮你排好每天的行程，
              查好真实的车票、酒店和门票，标在地图上。哪里不合适，随时能改。
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

      {/* ── 灵感灯箱：精选目的地图墙（点卡片即见完整可行方案） ── */}
      <section
        id="inspiration"
        className="isolate relative scroll-mt-16 overflow-hidden border-b border-line/60"
      >
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
            <span className="ed-eyebrow justify-center">热门目的地</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              选一个目的地，看现成的行程
            </h2>
            <p className="mt-3 text-lg text-muted">
              这里有六条从<b className="text-ink">无锡</b>出发的行程，车次、航班和门票都是真实的，可以照着走。点开就能看到每天的安排，喜欢的话，一键存到自己的行程里。
            </p>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
            {DEMO_LIST.map((d, i) => (
              <DestinationCard
                key={d.slug}
                d={d}
                index={i}
                onOpen={() =>
                  logEvent("destination_open_demo", { slug: d.slug, via: "gallery" })
                }
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
            <span className="ed-eyebrow justify-center">行程和地图</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              行程和地图，一起看
            </h2>
            <p className="mt-3 text-lg text-muted">
              下面是一份真实的「无锡 → 苏州」三日行程，车次、门票都能直接用。
              切换天数，或把鼠标放到某一站上，地图就会跟着显示对应的位置。
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
            <span className="ed-eyebrow">漫游能帮你做什么</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              规划旅行需要的，这里都有
            </h2>
            <p className="mt-3 text-lg text-muted">
              查路线、找酒店、排时间这些事，交给不同的 AI 分头去做，它们之间还会互相检查。
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
              "找目的地",
              "推荐活动",
              "美食推荐",
              "挑住宿",
              "排日程",
              "查交通",
              "汇总行程",
              "检查行程",
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
            <span className="ed-eyebrow justify-center">用户怎么说</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              旅行者和研究者都在用
            </h2>
            <p className="mt-3 text-lg text-muted">
              把麻烦的规划交给 AI，每一步你都看得懂、也能自己核对。
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
              使用的技术
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
            <span className="ed-eyebrow justify-center">开始</span>
            <h2 className="font-serif mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              开始规划你的旅行
            </h2>
            <p className="mt-2 text-muted">
              填几项，剩下的交给 AI。
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
              用来排除已经发车的班次。你也可以在下面自己填出发和返程时间。
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
                placeholder="比如：想多吃美食，节奏慢一点"
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
  { value: "8", label: "个 AI 助手" },
  { value: "6", label: "个环节同时进行" },
  { value: "100%", label: "信息都带来源" },
  { value: "1 屏", label: "看完整趟行程" },
];

const TESTIMONIALS: { name: string; role: string; quote: string; color: string }[] = [
  {
    name: "林 Wei",
    role: "自由行爱好者",
    quote:
      "以前订一趟五天的行程，要开十几个网页来回比。现在几分钟就排好了，车次和酒店都带链接，点开就能订。",
    color: "#0f8b8b",
  },
  {
    name: "Zoe",
    role: "人机交互研究者",
    quote:
      "我最喜欢的是它把过程都摆出来：每个选择用了哪些资料都写得很清楚，想改的地方还能先看效果再决定。",
    color: "#5b6abf",
  },
  {
    name: "老陈",
    role: "带娃出行的爸爸",
    quote:
      "拉一下就能把每天的安排排松一点，还会自动列好要带的东西。全家出门，我不用再一个人熬夜查攻略了。",
    color: "#d97742",
  },
];

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: MapIcon,
    title: "行程都在地图上",
    desc: "每个景点、餐厅和酒店都会标在地图上，每天走的路线看得很清楚。",
  },
  {
    icon: Bot,
    title: "8 个 AI 一起规划",
    desc: "找地方、选活动、订餐、订住宿、排时间、查交通，各管一摊，最后一起核对。",
  },
  {
    icon: Link2,
    title: "信息都是真的",
    desc: "车次、航班和酒店都是实时查来的，附上来源和官方订购链接，不会瞎编。",
  },
  {
    icon: GripVertical,
    title: "随时能改",
    desc: "每一项都能拖动排序、直接修改，也可以让 AI 助手帮你一起调整。",
  },
  {
    icon: Wallet,
    title: "花了多少一直看得到",
    desc: "按类别和每天自动算好花费，跟预算一比，超了会提醒你。",
  },
  {
    icon: Luggage,
    title: "天气和行李清单",
    desc: "根据当地天气和你的安排，帮你列好要带的东西，出发前不漏项。",
  },
];

/** 目的地卡：竖幅实景照 + 底部渐深遮罩 + 衬线地名；hover 抬升并浮出「查看方案」。
 *  点开即跳 /demo/<slug> 完整行程页；照片缺失（尚未生成）时降级为柔和渐变占位，绝不裂图。
 *  数据来自 app/showcase-data 的 DEMOS（单一事实来源），slug 对应 public/destinations/<slug>.jpg。 */
function DestinationCard({
  d,
  index,
  onOpen,
}: {
  d: DemoTrip;
  index: number;
  onOpen: () => void;
}) {
  const TransportIcon = d.transport === "flight" ? Plane : TrainFront;
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
      href={`/demo/${d.slug}`}
      onClick={onOpen}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: 0.05 * (index % 3), duration: 0.45 }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 800 }}
      className="group relative block overflow-hidden rounded-card border border-line bg-surface-2 shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-teal/45 hover:shadow-lift"
      aria-label={`查看${d.origin}→${d.name}的完整行程方案`}
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
            <span className="mt-2 inline-flex items-center gap-1 rounded-pill bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
              <TransportIcon className="h-2.5 w-2.5" aria-hidden />
              {d.durationLabel} · {d.budgetLabel}
            </span>
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

/**
 * 产品预览窗口：左「苏州古城一日漫步 · 逐站卡片」+ 右「真·Leaflet 地图上的步行路径」。
 * 数据取自 showcase-data 的 HERO_DAY（Hero 专属定制示例）：左侧卡片序号与右侧地图编号
 * 针脚一一对应、hover 双向联动；右侧是真实高德底图 + 真实步行动线（HeroTripMap）。
 * 地图只开 +/- 缩放、关拖拽/滚轮——见 HeroTripMap，避让 hero 的 3D 悬浮/视差。
 */
function HeroMock() {
  const day = HERO_DAY;
  const stops = day.stops;
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();

  // 步行动线总里程（真实球面距离）
  let walkKm = 0;
  for (let i = 1; i < stops.length; i++) walkKm += haversineKm(stops[i - 1], stops[i]);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-lift">
      {/* 窗口顶栏 */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="font-data ml-3 rounded-pill border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
          苏州古城 · 一日游
        </span>
      </div>
      <div className="grid sm:grid-cols-[0.92fr_1.08fr]">
        {/* 左：定制行程逐站卡片（序号 ↔ 右侧针脚，hover 联动） */}
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="ed-eyebrow">{day.dow} · 步行路线</p>
            <p className="font-data text-[10px] text-muted">{day.summary}</p>
          </div>
          <h3 className="font-serif mt-1 text-base font-bold text-ink">
            一天六个景点
          </h3>
          <ul className="mt-3 space-y-1.5">
            {stops.map((s, i) => {
              const hot = hover === i;
              return (
                <li
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition ${
                    hot
                      ? "border-line-strong bg-surface-2 shadow-soft"
                      : "border-line bg-surface"
                  }`}
                >
                  <span
                    className="sc-node shrink-0 transition-transform"
                    style={
                      {
                        "--c": KIND_COLOR[s.kind],
                        transform: hot ? "scale(1.12)" : undefined,
                      } as React.CSSProperties
                    }
                  >
                    <span className="text-[13px] font-bold leading-none">
                      {i + 1}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold leading-tight text-ink">
                      {s.title}
                    </p>
                    {s.detail && (
                      <p className="truncate text-[11px] leading-tight text-muted">
                        {s.detail}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right leading-tight">
                    <p className="font-data text-[11px] font-semibold text-ink">
                      {s.time}
                    </p>
                    <p className="font-data text-[10px] text-muted">
                      {s.cost ?? "免费"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
            <span className="font-data text-[10px] text-muted">
              {stops.length} 站 · 步行 ≈ {walkKm.toFixed(1)} km
            </span>
            <span className="font-data text-[10px] font-semibold text-teal-dark">
              真实地图 · 可放大
            </span>
          </div>
        </div>

        {/* 右：真·Leaflet 地图上的步行路径（真实高德底图 + 编号针脚 + hover 联动） */}
        <div className="relative hidden min-h-[440px] border-l border-line bg-[#eef1ee] sm:block">
          <HeroTripMap
            stops={stops}
            hover={hover}
            onHover={setHover}
            reduced={!!reduce}
          />
          {/* 地图角注 */}
          <div className="pointer-events-none absolute bottom-2 left-2.5 z-[1000] flex items-center gap-1 rounded-pill bg-white/85 px-2 py-0.5 shadow-soft backdrop-blur">
            <MapPin className="h-3 w-3 text-teal" aria-hidden />
            <span className="font-data text-[10px] font-medium text-muted">
              苏州古城 · 步行路线
            </span>
          </div>
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
