"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  summarizeBudget,
  KIND_META,
  BUDGET_KINDS,
  formatCny,
  type BudgetSummary,
} from "@/lib/budget";
import { wmoMeta, type DayWeather } from "@/lib/weather";
import type { Candidate } from "@/lib/candidates";
import { diffItinerary } from "@/lib/diff";
import { logEvent } from "@/lib/log";
import type { AgentTrace } from "@/lib/trace";
import { useCopilot, type ItineraryController } from "@/app/copilot/store";
import { motion, AnimatePresence } from "motion/react";
import { TimelineRail, RAIL_X } from "./Timeline";
import { TripHero, AnimatedNumber } from "./arc";
import { SectionNav } from "./SectionNav";
// 按天配色：全站统一取自 lib/palette（地点卡编号针 ↔ 地图针一致）
import { dayColorOf } from "@/lib/palette";
import { Panel } from "@/app/ui/collapse";
import { Button } from "@/app/ui/button";
import { Chip, SealStamp } from "@/app/ui/chip";
import { ConfirmModal } from "@/app/ui/modal";
import { toast } from "@/app/ui/toast";
import { ListSkeleton } from "@/app/ui/skeleton";
import { ProposalCard } from "@/app/ui/proposal";
import { Markdown } from "@/app/ui/markdown";
import {
  CalendarDays,
  Compass,
  Wallet,
  Luggage,
  SlidersHorizontal,
  Microscope,
  MessageCircle,
  Bookmark,
  Map as MapSectionIcon,
  MapPin,
  Printer,
  Link2,
  Share2,
  RefreshCw,
  Search,
  X,
  GripVertical,
  Info,
  TrainFront,
  Plane,
  ArrowRight,
  ArrowUpRight,
  Footprints,
  CarTaxiFront,
  Send,
  Sparkles,
  BadgeCheck,
  ShieldAlert,
  Ticket,
  KIND_ICONS,
} from "@/app/ui/icons";

/** ISO 日期 → 中文星期（非 ISO 返回空串） */
function weekdayCn(date?: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][wd];
}

/** 条目类别 → 点亮色（复用预算看板/地图同套配色） */
function kindColor(kind: string): string {
  return (
    (KIND_META as Record<string, { color: string }>)[kind]?.color ??
    KIND_META.other.color
  );
}

// 地图依赖浏览器（Leaflet 直接操作 DOM），仅客户端加载，避免 SSR
const TripMap = dynamic(() => import("./TripMap"), { ssr: false });

type Status = "pending" | "running" | "done" | "error";
type Phase = "loading" | "planning" | "ready" | "error";

const AGENTS: { key: string; label: string; wave: number; search?: boolean }[] = [
  { key: "enrichment", label: "目的地调研", wave: 1 },
  { key: "activities", label: "活动推荐", wave: 1, search: true },
  { key: "food", label: "餐饮指南", wave: 1 },
  { key: "accommodation", label: "住宿推荐", wave: 2, search: true },
  { key: "scheduling", label: "日程编排", wave: 3 },
  { key: "transport", label: "交通物流", wave: 4, search: true },
  { key: "hub_planner", label: "综合行程", wave: 5 },
  { key: "validator", label: "出行质检", wave: 6 },
];

const KINDS = ["activity", "food", "rest", "transit"];

interface ItineraryItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  /** 购票/预订链接（从 detail 剥离出来，单独存；不在 detail 文本里展示） */
  booking_url?: string;
  /** 为什么推荐（hub_planner 从上游 agent 搬运的选择依据，RQ2 可解释） */
  why?: string;
  /** 该条目的取证来源链接（RQ3 证据锚定；优先于标题匹配启发式） */
  source_url?: string;
  /** 实际花费（用户旅途中记账；与 est_cost 对照） */
  actual_cost?: number;
}
interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  items: ItineraryItem[];
}
interface Reference {
  label: string;
  value: string;
}

/** 条目取证态（RQ3）：verified=有可核实来源；unverified=应可核实却无来源；linked=仅有预订/购票链接 */
interface Provenance {
  level: "verified" | "unverified" | "linked";
  sourceUrl?: string;
  bookingUrl?: string;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}
interface Meta {
  destination: string | null;
  origin: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** 拖拽负载：既有条目的移动，或从候选池拖入的新条目 */
type DragPayload =
  | { type: "item"; d: number; i: number }
  | { type: "candidate"; item: ItineraryItem };

/** 候选 → 行程条目（带上取证来源，信任徽章直接可用） */
function candidateToItem(c: Candidate): ItineraryItem {
  return {
    time: "",
    title: c.title,
    kind: c.kind,
    detail: c.detail,
    est_cost: c.est_cost || 0,
    ...(c.booking_url ? { booking_url: c.booking_url } : {}),
    ...(c.source_url ? { source_url: c.source_url } : {}),
  };
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  // agent 完成时的一句产物摘要（SSE summary 字段）：等待页渐进呈现
  const [agentSummaries, setAgentSummaries] = useState<Record<string, string>>(
    {},
  );
  const [meta, setMeta] = useState<Meta>({
    destination: null,
    origin: null,
    start_date: null,
    end_date: null,
  });
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  const [partySize, setPartySize] = useState<number | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [weather, setWeather] = useState<Record<string, DayWeather>>({});
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const startedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  // SSE 断流（网络中断/函数超时）：主动断开并让用户手动重试，
  // 避免 EventSource 自动重连不受控地重触发流水线（断点续跑保证重试安全）
  const [streamLost, setStreamLost] = useState(false);
  // 出炉仪式：done 后先「行程已就绪」盖章，再展开成品（reduced-motion 直切）
  const [ceremony, setCeremony] = useState(false);

  const openPlanStream = useCallback(() => {
    setStreamLost(false);
    setPhase("planning");
    const es = new EventSource(`/api/trips/${id}/plan`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "agent_status") {
        setStatuses((s) => ({ ...s, [e.agent]: e.status }));
        if (e.summary) {
          setAgentSummaries((s) => ({ ...s, [e.agent]: e.summary }));
        }
      } else if (e.type === "done") {
        const it = e.itinerary as {
          title?: string;
          overview?: string;
          days?: ItineraryDay[];
          references?: Reference[];
        };
        setTitle(it?.title ?? "");
        setOverview(it?.overview ?? "");
        setDays(normalizeDays(it?.days ?? []));
        setReferences(it?.references ?? []);
        logEvent("plan_done", { days: it?.days?.length ?? 0 }, id);
        es.close();
        // 出炉仪式：小火车到站 → 「行程已就绪」盖章 → 展开成品
        const reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        if (reduce) {
          setPhase("ready");
        } else {
          setCeremony(true);
          window.setTimeout(() => setPhase("ready"), 2200);
        }
      } else if (e.type === "error") {
        setError(e.message);
        setPhase("error");
        es.close();
      }
    };
    es.onerror = () => {
      // done/error 后我们已主动 close，不会走到这里；
      // 走到这里说明规划中连接断开 → 关闭并提示手动重试
      es.close();
      setStreamLost(true);
    };
  }, [id]);

  useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载失败");
        setMeta({
          destination: data.destination,
          origin: data.origin,
          start_date: data.start_date,
          end_date: data.end_date,
        });
        setBudget(typeof data.budget === "number" ? data.budget : null);
        setPartySize(typeof data.party_size === "number" ? data.party_size : null);
        setShareToken(typeof data.share_token === "string" ? data.share_token : null);
        if (Array.isArray(data.chat)) setChatHistory(data.chat as ChatMsg[]);

        // 已完成 → 直接渲染存好的行程，不再重跑流水线（P1 幂等）
        if (data.status === "done" && Array.isArray(data.days)) {
          // 优先用落库的成稿标题/概览（0008），缺失时回退「<目的地> 行程」
          setTitle(
            (typeof data.title === "string" && data.title) ||
              `${data.destination ?? ""} 行程`.trim(),
          );
          if (typeof data.overview === "string") setOverview(data.overview);
          setDays(normalizeDays(data.days as ItineraryDay[]));
          setReferences((data.references as Reference[]) ?? []);
          setPhase("ready");
          return;
        }

        // 未完成 → 触发编排并流式渲染进度
        openPlanStream();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
  }, [id, openPlanStream]);

  // 拉取目的地每日天气（Open-Meteo，仅未来约 16 天有预报；超范围/查不到则缺省不显示）
  const weatherFetched = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || weatherFetched.current) return;
    const dest = meta.destination;
    // 起止日期：优先 trip 的起止，否则取首/末日的 date（须为 ISO）
    const isISO = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const dates = days.map((d) => d.date).filter(isISO) as string[];
    const start = isISO(meta.start_date) ? meta.start_date! : dates[0];
    const end = isISO(meta.end_date) ? meta.end_date! : dates[dates.length - 1];
    if (!dest || !start || !end) return;
    weatherFetched.current = true;
    (async () => {
      try {
        const q = new URLSearchParams({ dest, start, end });
        const res = await fetch(`/api/weather?${q.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { daily?: Record<string, DayWeather> };
        if (data.daily) setWeather(data.daily);
      } catch {
        // 静默失败：天气是增强信息，不影响主流程
      }
    })();
  }, [phase, meta.destination, meta.start_date, meta.end_date, days]);

  // ── 取证索引（RQ3 信任校准）：从候选（含 source_url/booking_url）建标题→来源映射，
  //    用于给每个行程条目标「已核实来源 / 待核实」。就绪后拉一次（纯读库）。──
  const [provIndex, setProvIndex] = useState<
    { titleNorm: string; sourceUrl?: string; bookingUrl?: string }[]
  >([]);
  const provFetched = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || provFetched.current) return;
    provFetched.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/candidates`);
        const data = await res.json();
        if (!res.ok) return;
        const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
        const idx = ((data.candidates as Candidate[]) ?? [])
          .filter((c) => c.source_url || c.booking_url)
          .map((c) => ({
            titleNorm: norm(c.title.replace(/^(去程|返程)\s*/, "")),
            sourceUrl: c.source_url,
            bookingUrl: c.booking_url,
          }))
          .filter((c) => c.titleNorm.length >= 2);
        setProvIndex(idx);
      } catch {
        // 静默：取证徽章是增强项
      }
    })();
  }, [phase, id]);

  const provenanceOf = useMemo(() => {
    const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
    return (item: ItineraryItem): Provenance | null => {
      // 条目自带取证来源（新版 hub_planner 直接写入）优先——证据锚定不再依赖标题匹配
      if (item.source_url) {
        return {
          level: "verified",
          sourceUrl: item.source_url,
          bookingUrl: item.booking_url || undefined,
        };
      }
      // 旧行程 fallback：候选池标题匹配启发式
      const core = norm(item.title || "");
      if (core.length < 2) return null;
      const hit = provIndex.find(
        (p) => p.titleNorm.includes(core) || core.includes(p.titleNorm),
      );
      const sourceUrl = hit?.sourceUrl || undefined;
      const bookingUrl = hit?.bookingUrl || item.booking_url || undefined;
      if (sourceUrl) return { level: "verified", sourceUrl, bookingUrl };
      // 票务/住宿这类应可核实的条目：无来源即「待核实」；活动/餐饮无来源不打扰
      if (item.kind === "transit" || item.kind === "rest")
        return { level: "unverified", bookingUrl };
      return bookingUrl ? { level: "linked", bookingUrl } : null;
    };
  }, [provIndex]);

  // ── 条目坐标（TripMap 地理编码结果上交）：相邻条目间路程耗时估算用 ──
  const [itemCoords, setItemCoords] = useState<
    Record<string, { lat: number; lon: number }>
  >({});

  // ── 列表 ↔ 地图双向联动 ──
  // hoverKey：悬停条目/针脚的 "dayIndex-itemIndex"
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // 触屏定位：条目「地图」钮 → 滚到地图 + flyTo 针脚开弹窗（每次新对象，可重复触发）
  const [spot, setSpot] = useState<{ key: string } | null>(null);
  function locateOnMap(key: string) {
    setSpot({ key });
    setHoverKey(key);
    document
      .querySelector(".wl-maprail")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // 针脚弹窗「在行程中查看」→ 滚回条目并短暂高亮
  function locateInList(key: string) {
    document
      .getElementById(`item-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHoverKey(key);
    window.setTimeout(
      () => setHoverKey((h) => (h === key ? null : h)),
      1800,
    );
  }
  // 滚到第几天，地图聚焦第几天；滚出行程区（概览/预算…）回到全程。
  // 用「阅读线」观察器（视口 28%~42% 细带）直接观察逐日区块——
  // SectionNav 的 scrollspy 以「最靠上的可见章节」为准，超高的父容器会一直霸榜，测不出天。
  const [focusDay, setFocusDay] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "ready" || !days.length) return;
    const els = days
      .map((d) => document.getElementById(`day-${d.day}`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const hit = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) hit.set(e.target.id, e.isIntersecting);
        // 相交阅读线的天里取序号最大者（向前滚动时偏向新进入的一天）
        const current = [...hit.entries()]
          .filter(([, v]) => v)
          .map(([id]) => Number(id.slice(4)))
          .sort((a, b) => a - b)
          .pop();
        setFocusDay(current ?? null);
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // 只依赖天数：day-N 锚点集合仅随天数变化，编辑条目不必重建观察器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, days.length]);

  // ── 把当前行程注册给全站 Copilot Dock（智能体据此读/改当前行程）──
  const { registerItinerary } = useCopilot();
  const ctrl = useRef({ days, references, meta, title });
  useEffect(() => {
    ctrl.current = { days, references, meta, title };
  });
  const undoStack = useRef<ItineraryDay[][]>([]);
  useEffect(() => {
    const putDays = (nd: ItineraryDay[], refs: Reference[]) =>
      fetch(`/api/trips/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: nd, references: refs }),
      }).catch(() => {});
    const controller: ItineraryController = {
      getTripId: () => id,
      getTitle: () => ctrl.current.title,
      getMeta: () => ctrl.current.meta,
      getDays: () => ctrl.current.days,
      applyDays: (nd, refs) => {
        undoStack.current.push(ctrl.current.days);
        const normalized = normalizeDays(nd as ItineraryDay[]);
        const finalRefs = (refs as Reference[] | undefined) ?? ctrl.current.references;
        setDays(normalized);
        if (refs) setReferences(finalRefs);
        setDirty(false);
        toast("小行已更新行程");
        putDays(normalized, finalRefs);
      },
      undo: () => {
        const prev = undoStack.current.pop();
        if (!prev) return;
        setDays(prev);
        logEvent("undo", {}, id);
        toast("已撤销");
        putDays(prev, ctrl.current.references);
      },
      canUndo: () => undoStack.current.length > 0,
    };
    registerItinerary(controller);
    return () => registerItinerary(null);
  }, [id, registerItinerary]);

  // ── 编辑操作 ──
  const touch = () => {
    setDirty(true);
    setSaveMsg(null);
  };
  function updateItem(
    di: number,
    ii: number,
    field: keyof ItineraryItem,
    value: string | number,
  ) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di
          ? d
          : {
              ...d,
              items: d.items.map((it, y) =>
                y !== ii ? it : { ...it, [field]: value },
              ),
            },
      ),
    );
    touch();
  }
  function deleteItem(di: number, ii: number) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di ? d : { ...d, items: d.items.filter((_, y) => y !== ii) },
      ),
    );
    logEvent("item_delete", { day: di }, id);
    touch();
  }
  function addItem(di: number) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di
          ? d
          : {
              ...d,
              items: [
                ...d.items,
                { time: "", title: "新条目", kind: "activity", detail: "", est_cost: 0 },
              ],
            },
      ),
    );
    logEvent("item_add", { day: di }, id);
    touch();
  }

  // 拖拽排序（支持跨天）+ 从候选池拖入新条目
  const dragSrc = useRef<DragPayload | null>(null);
  function dropOnto(dd: number, di: number) {
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!src) return;
    // 来自候选池：在放置位置插入一条新条目
    if (src.type === "candidate") {
      setDays((prev) => {
        const next = prev.map((d) => ({ ...d, items: [...d.items] }));
        next[dd].items.splice(di, 0, src.item);
        return next;
      });
      logEvent("candidate_add", { day: dd, via: "drag" }, id);
      touch();
      return;
    }
    // 已有条目的跨天/同天移动
    if (src.d === dd && src.i === di) return;
    setDays((prev) => {
      const next = prev.map((d) => ({ ...d, items: [...d.items] }));
      const [moved] = next[src.d].items.splice(src.i, 1);
      let target = di;
      if (src.d === dd && src.i < di) target -= 1;
      next[dd].items.splice(target, 0, moved);
      return next;
    });
    logEvent("drag_move", { fromDay: src.d, toDay: dd, crossDay: src.d !== dd }, id);
    touch();
  }

  // 把候选卡追加到指定天末尾（不依赖拖拽的可达性兜底）
  function addCandidate(dd: number, item: ItineraryItem) {
    setDays((prev) =>
      prev.map((d, x) => (x !== dd ? d : { ...d, items: [...d.items, item] })),
    );
    touch();
  }

  async function save() {
    setSaveMsg("保存中…");
    try {
      const res = await fetch(`/api/trips/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, references }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setDirty(false);
      setSaveMsg(null);
      logEvent("save", { days: days.length }, id);
      toast("行程已保存");
    } catch (e) {
      setSaveMsg(null);
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  // 开启/关闭公开分享
  async function toggleShare() {
    setShareBusy(true);
    try {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !shareToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setShareToken(data.token ?? null);
      setCopied(false);
    } catch {
      // 静默
    } finally {
      setShareBusy(false);
    }
  }

  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/share/${shareToken}`
      : "";

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast("分享链接已复制");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：用户可手动复制
    }
  }

  // 预算汇总：随条目 est_cost 实时重算（纯前端）
  const budgetSummary = useMemo(
    () => summarizeBudget(days, budget, partySize),
    [days, budget, partySize],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted shadow-soft transition hover:-translate-y-px hover:text-ink"
      >
        ← 新建行程
      </Link>

      {/* 规划进度（仅编排中显示）：候机楼叙事——航线总进度 + 专家逐个盖章 + 产物摘要 */}
      {(phase === "loading" || phase === "planning") && (
        <PlanningBoard
          origin={meta.origin}
          destination={meta.destination}
          statuses={statuses}
          summaries={agentSummaries}
          loading={phase === "loading"}
          streamLost={streamLost}
          finished={ceremony}
          onRetry={openPlanStream}
        />
      )}

      {error && (
        <p className="mt-6 rounded-lg border border-seal/25 bg-seal-tint px-4 py-3 text-sm text-seal">
          {error}
        </p>
      )}

      {/* 可编辑行程 */}
      {phase === "ready" && (
        <section className="mt-5">
          <TripHero
            title={title || `${meta.destination ?? ""} 行程`.trim() || "我的行程"}
            destination={meta.destination}
            origin={meta.origin}
            dateRange={
              meta.start_date && meta.end_date
                ? `${meta.start_date} – ${meta.end_date}`
                : meta.start_date ?? null
            }
            dayCount={days.length}
            partySize={partySize}
            budgetLabel={budget ? formatCny(budget) : null}
            right={
              <div className="flex items-center gap-2">
                {saveMsg && (
                  <span className="rounded-pill border border-white/20 bg-white/[0.1] px-2.5 py-1 text-xs font-medium text-white/85 backdrop-blur">
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={save}
                  disabled={!dirty}
                  className="btn-glow rounded-pill px-5 py-2 text-sm font-semibold disabled:opacity-40 cursor-pointer"
                >
                  保存
                </button>
              </div>
            }
          />

          {/* 导出 / 分享工具条 */}
          <div className="no-print mt-4 flex flex-wrap items-center gap-2 text-sm">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 py-1.5 font-medium text-ink shadow-soft transition hover:-translate-y-px hover:shadow-lift cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              打印 / 旅行手册 PDF
            </button>
            <a
              href={`/api/trips/${id}/ics`}
              className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 py-1.5 font-medium text-ink shadow-soft transition hover:-translate-y-px hover:shadow-lift"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              导出日历
            </a>
            <button
              onClick={toggleShare}
              disabled={shareBusy}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 font-medium shadow-soft transition hover:-translate-y-px hover:shadow-lift disabled:opacity-50 cursor-pointer ${
                shareToken
                  ? "border-teal/40 bg-teal-tint text-teal-dark"
                  : "border-line bg-surface text-ink"
              }`}
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden />
              {shareBusy ? "处理中…" : shareToken ? "已公开分享" : "生成分享链接"}
            </button>
            {shareToken && (
              <>
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-data min-w-0 flex-1 rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-xs text-muted"
                />
                <button
                  onClick={copyShare}
                  className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-soft transition hover:-translate-y-px cursor-pointer"
                >
                  <Link2 className="h-3 w-3" aria-hidden />
                  {copied ? "已复制 ✓" : "复制"}
                </button>
                <button
                  onClick={toggleShare}
                  disabled={shareBusy}
                  className="text-xs text-muted transition hover:text-seal cursor-pointer"
                >
                  撤销
                </button>
              </>
            )}
          </div>

          {/* ── 三栏：左章节导航 + 中行程内容 + 右 sticky 地图（Wanderlog 布局） ── */}
          <div className="mt-6 lg:grid lg:grid-cols-[184px_minmax(0,1fr)_minmax(0,34%)] lg:gap-6">
            {/* 左：章节导航（sticky）。移动端在 SectionNav 内部折叠为顶部横向 chips */}
            <div className="lg:col-start-1 lg:row-start-1">
              <SectionNav
                sections={[
                  { id: "overview", label: "概览", icon: CalendarDays },
                  {
                    id: "itinerary",
                    label: "行程安排",
                    icon: MapSectionIcon,
                    children: days.map((d) => ({
                      id: `day-${d.day}`,
                      label: `第 ${d.day} 天`,
                    })),
                  },
                  { id: "budget", label: "预算成本", icon: Wallet },
                  { id: "explore", label: "探索备选", icon: Compass },
                  { id: "packing", label: "打包清单", icon: Luggage },
                  { id: "tune", label: "偏好调节", icon: SlidersHorizontal },
                  { id: "process", label: "规划过程", icon: Microscope },
                  { id: "assistant", label: "对话助手", icon: MessageCircle },
                  ...(references.length
                    ? [{ id: "refs", label: "关键信息", icon: Bookmark }]
                    : []),
                ]}
              />
            </div>

            {/* 右：行程地图（DOM 在前 → 移动端显示在内容上方；桌面 order 移到最右并 sticky） */}
            <aside className="wl-maprail order-1 mb-6 lg:col-start-3 lg:row-start-1 lg:mb-0 lg:self-stretch">
              <div className="h-[420px] lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-5.5rem)]">
                {days.length > 0 && (
                  <TripMap
                    days={days}
                    meta={meta}
                    fill
                    onResolved={setItemCoords}
                    hoverKey={hoverKey}
                    onHoverKey={setHoverKey}
                    syncDay={focusDay}
                    spot={spot}
                    onLocateItem={locateInList}
                  />
                )}
              </div>
            </aside>

            {/* 中：行程内容 */}
            <div className="order-2 min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
              {/* 概览 */}
              <section id="overview" className="wl-section space-y-3">
                {overview && (
                  <p className="rounded-card border border-line bg-surface p-4 text-sm leading-relaxed text-ink/80 shadow-soft">
                    {overview}
                  </p>
                )}
                <Countdown start={meta.start_date} end={meta.end_date} />
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span>条目可信度：</span>
                  <SealStamp>已核实</SealStamp>
                  <Chip tone="teal">可查证</Chip>
                  <Chip tone="amber">待核实</Chip>
                  <span>（点「已核实」印章可打开来源核对）</span>
                </div>
              </section>

              {/* 行程安排（逐日） */}
              <section id="itinerary" className="wl-section">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-serif text-xl font-bold text-ink">
                    行程安排
                  </h2>
                  <span className="text-xs text-muted">
                    可拖拽排序、直接编辑；交通条目可搜真实车次/航班
                  </span>
                </div>
                <TimelineRail>
                  {days.map((d, di) => (
                    <div key={di} id={`day-${d.day}`} className="trip-day wl-section">
                      {/* 日头：编号针 + 周几/日期 + 主题 + 天气 */}
                      <div className="relative min-h-[36px] pl-24">
                        <div
                          className="absolute top-0 z-10 -translate-x-1/2"
                          style={{ left: RAIL_X }}
                        >
                          <div
                            className="wl-pin"
                            style={
                              {
                                "--c": dayColorOf(d.day),
                                width: 34,
                                height: 34,
                                fontSize: 14,
                              } as React.CSSProperties
                            }
                          >
                            {d.day}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p
                              className="font-data text-[11px] font-bold uppercase tracking-[0.16em]"
                              style={{ color: dayColorOf(d.day) }}
                            >
                              Day {d.day}
                              {weekdayCn(d.date) ? ` · ${weekdayCn(d.date)}` : ""}
                            </p>
                            <h3 className="font-serif truncate text-xl font-bold text-ink">
                              {d.theme}
                            </h3>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <WeatherBadge w={weather[d.date]} />
                            <RegenDayButton
                              id={id}
                              day={d.day}
                              onApplied={(nd, r) => {
                                setDays(normalizeDays(nd));
                                if (r) setReferences(r);
                                setDirty(false);
                              }}
                            />
                            <span className="font-data rounded-pill border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-muted shadow-soft">
                              {d.date}
                            </span>
                          </div>
                        </div>
                      </div>

                      <ul className="mt-3 space-y-3">
                        {d.items.map((it, ii) => (
                          <li key={ii} id={`item-${di}-${ii}`} className="list-none">
                            <TravelLeg
                              from={ii > 0 ? itemCoords[`${di}-${ii - 1}`] : undefined}
                              to={itemCoords[`${di}-${ii}`]}
                            />
                            <ItemCard
                              item={it}
                              index={ii}
                              number={ii + 1}
                              dayColor={dayColorOf(d.day)}
                              meta={meta}
                              tripId={id}
                              provenance={provenanceOf(it)}
                              hovered={hoverKey === `${di}-${ii}`}
                              onHover={(h) =>
                                setHoverKey(h ? `${di}-${ii}` : null)
                              }
                              onLocate={
                                itemCoords[`${di}-${ii}`]
                                  ? () => locateOnMap(`${di}-${ii}`)
                                  : undefined
                              }
                              onDragStart={() =>
                                (dragSrc.current = { type: "item", d: di, i: ii })
                              }
                              onDrop={() => dropOnto(di, ii)}
                              onChange={(f, v) => updateItem(di, ii, f, v)}
                              onDelete={() => deleteItem(di, ii)}
                            />
                          </li>
                        ))}
                      </ul>

                      {/* 末尾放置区 + 「添加地点」搜索样式条 */}
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropOnto(di, d.items.length)}
                        className="mt-3 pl-24"
                      >
                        <button
                          onClick={() => addItem(di)}
                          className="wl-addbar transition hover:border-teal cursor-pointer"
                        >
                          <Search className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="flex-1 text-left">
                            添加地点 / 活动到第 {d.day} 天…
                          </span>
                          <span className="font-medium text-teal-dark">+ 添加</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </TimelineRail>
              </section>

              {/* 预算成本 */}
              {days.length > 0 && (
                <section id="budget" className="wl-section">
                  <BudgetPanel summary={budgetSummary} partySize={partySize} days={days} />
                </section>
              )}

              {/* 探索备选（候选池） */}
              {days.length > 0 && (
                <section id="explore" className="wl-section">
                  <CandidatePool
                    id={id}
                    days={days}
                    onCandidateDragStart={(c) =>
                      (dragSrc.current = {
                        type: "candidate",
                        item: candidateToItem(c),
                      })
                    }
                    onCandidateAdd={(dayIdx, c) =>
                      addCandidate(dayIdx, candidateToItem(c))
                    }
                  />
                </section>
              )}

              {/* 打包清单 */}
              {days.length > 0 && (
                <section id="packing" className="wl-section">
                  <PackingList
                    id={id}
                    weather={weather}
                    destination={meta.destination}
                  />
                </section>
              )}

              {/* 偏好调节：节奏/预算/兴趣滑块 → 预览式整体重排（不改库，确认后才提交） */}
              {days.length > 0 && (
                <section id="tune" className="wl-section">
                  <PreferencePanel
                    id={id}
                    days={days}
                    onApply={async (d, r) => {
                      const nd = normalizeDays(d);
                      setDays(nd);
                      if (r) setReferences(r);
                      setDirty(false);
                      setSaveMsg("已按偏好重排 ✓");
                      logEvent("diff_apply", { via: "pref", days: nd.length }, id);
                      try {
                        await fetch(`/api/trips/${id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            days: nd,
                            references: r ?? references,
                          }),
                        });
                      } catch {
                        // 静默：用户仍可手动点保存
                      }
                    }}
                  />
                </section>
              )}

              {/* 规划过程可见化：每个 agent 做了什么、选了谁、取证来源（RQ2 可解释） */}
              {days.length > 0 && (
                <section id="process" className="wl-section">
                  <ProcessTrace id={id} />
                </section>
              )}

              {/* 对话式助手：多轮问答 + 改动预览后再应用 */}
              <section id="assistant" className="wl-section">
                <ChatPanel
                  id={id}
                  days={days}
                  initialMessages={chatHistory}
                  onApply={(d, r) => {
                    setDays(normalizeDays(d));
                    if (r) setReferences(r);
                    setDirty(true);
                    logEvent("diff_apply", { via: "chat", days: d.length }, id);
                  }}
                />
              </section>

              {references.length ? (
                <section
                  id="refs"
                  className="wl-section rounded-card border border-line bg-surface p-5 shadow-soft"
                >
                  <h4 className="font-serif text-base font-bold text-ink">关键信息</h4>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    {references.map((r, i) => (
                      <div key={i} className="flex gap-2">
                        <dt className="shrink-0 text-muted">{r.label}</dt>
                        <dd>
                          <Linkify text={r.value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

/** 「重新生成这一天」：复用 refine 端点，scope 限定该天，其余天原样保留。 */
function RegenDayButton({
  id,
  day,
  onApplied,
}: {
  id: string;
  day: number;
  onApplied: (days: ItineraryDay[], references?: Reference[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function regen() {
    setConfirming(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction:
            "把这一天完全重新编排一版：更换/调整活动与餐饮的组合与顺序，保持旅行风格、预算档次与该天日期不变；不得编造车次/航班/酒店/票价。",
          scope: { day },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重新生成失败");
      onApplied(data.days as ItineraryDay[], data.references as Reference[]);
      toast(`第 ${day} 天已重新编排`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        onClick={() => !busy && setConfirming(true)}
        disabled={busy}
        title="重新生成这一天"
        className="no-print inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark disabled:opacity-50 cursor-pointer"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} aria-hidden />
        {busy ? "生成中…" : "重排"}
      </button>
      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={regen}
        title={`重新生成第 ${day} 天？`}
        body="将替换该天全部条目（其余天不动），真实车次/航班/酒店会保留。"
        confirmText="重新生成"
      />
    </>
  );
}

/**
 * 候选探索池：展示各 agent 产出的、未被选进最终行程的真实候选。
 * 每张卡可拖入某天，或用「+加入」追加到所选天。懒加载（首次展开才拉取）。
 */
function CandidatePool({
  id,
  days,
  onCandidateDragStart,
  onCandidateAdd,
}: {
  id: string;
  days: ItineraryDay[];
  onCandidateDragStart: (c: Candidate) => void;
  onCandidateAdd: (dayIndex: number, c: Candidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [targetDay, setTargetDay] = useState(0); // days 下标
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/candidates`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载候选失败");
        setItems((data.candidates as Candidate[]) ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, id]);

  // 按 kind 分组（保持 活动/餐饮/住宿/交通 顺序）
  const groups = useMemo(() => {
    const order: Candidate["kind"][] = ["activity", "food", "rest", "transit"];
    const by: Record<string, Candidate[]> = {};
    for (const c of items ?? []) (by[c.kind] ??= []).push(c);
    return order
      .filter((k) => by[k]?.length)
      .map((k) => ({ kind: k, list: by[k] }));
  }, [items]);

  // 当前行程里所有条目标题（归一化），用于判断某候选是否「已选入行程」——体现选中 vs 放弃
  const pickedTitles = useMemo(() => {
    const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
    const set: string[] = [];
    for (const d of days) for (const it of d.items) if (it.title) set.push(norm(it.title));
    return set;
  }, [days]);

  // 候选标题去掉「去程/返程」等前缀后与行程条目做包含匹配（启发式，够用即可）
  function isPicked(c: Candidate): boolean {
    const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
    const core = norm(c.title.replace(/^(去程|返程)\s*/, ""));
    if (core.length < 2) return false;
    return pickedTitles.some((ft) => ft.includes(core) || core.includes(ft));
  }

  return (
    <Panel
      className="no-print mt-6"
      icon={Compass}
      title="候选探索池"
      meta={
        <span className="text-xs font-normal text-muted">
          各 agent 备选的真实景点/餐厅/酒店/车次 · 拖入或加入某天
        </span>
      }
      open={open}
      onToggle={setOpen}
    >
      {loading && <ListSkeleton rows={4} />}
      {err && <p className="text-sm text-seal">{err}</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-muted">
          暂无候选（该行程的 agent 产物为空或尚未生成）。
        </p>
      )}

      {groups.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <span>「+加入」目标：</span>
            <select
              value={targetDay}
              onChange={(e) => setTargetDay(Number(e.target.value))}
              className="rounded border border-line bg-surface px-2 py-1 text-ink"
            >
              {days.map((d, i) => (
                <option key={i} value={i}>
                  第 {d.day} 天
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            {groups.map(({ kind, list }) => (
              <div key={kind}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: KIND_META[kind].color }}
                  />
                  {KIND_META[kind].label}
                  <span className="text-muted/70">（{list.length}）</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {list.map((c) => {
                    const picked = isPicked(c);
                    return (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={() => onCandidateDragStart(c)}
                        className={`group cursor-grab rounded-lg border bg-surface p-2.5 text-xs transition hover:border-teal hover:shadow-soft ${
                          picked ? "border-teal/40" : "border-line"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 font-medium text-ink">
                            {c.title}
                            <Chip
                              tone={picked ? "teal" : "muted"}
                              className="ml-1.5"
                            >
                              {picked ? "已选入" : "备选"}
                            </Chip>
                          </span>
                          <button
                            onClick={() => onCandidateAdd(targetDay, c)}
                            title={`加入第 ${days[targetDay]?.day} 天`}
                            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark cursor-pointer"
                          >
                            + 加入
                          </button>
                        </div>
                        {c.detail && <p className="mt-1 text-muted">{c.detail}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted/80">
                          {c.tag && (
                            <span className="rounded bg-surface-2 px-1.5 py-0.5">
                              {c.tag}
                            </span>
                          )}
                          {c.est_cost > 0 && (
                            <span className="font-data">约 {formatCny(c.est_cost)}</span>
                          )}
                          {c.source_url && (
                            <a
                              href={c.source_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() =>
                                logEvent("source_open", { via: "candidate", kind: c.kind }, id)
                              }
                              className="inline-flex items-center gap-0.5 text-teal-dark hover:underline"
                            >
                              来源
                              <ArrowUpRight className="h-3 w-3" aria-hidden />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted/80">
            提示：把卡片拖到某天的条目上/末尾放置区即可插入；或用「+加入」追加到上方所选天。
          </p>
        </>
      )}
    </Panel>
  );
}

/**
 * 对话式助手：多轮聊天。可纯问答（不改行程），也可提改动方案——
 * 改动先以 diff 预览卡展示，用户点「应用」才落到行程（再点「保存」入库）。
 */
function ChatPanel({
  id,
  days,
  initialMessages,
  onApply,
}: {
  id: string;
  days: ItineraryDay[];
  initialMessages: ChatMsg[];
  onApply: (days: ItineraryDay[], references?: Reference[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 待用户裁决的改动方案（附在最近一条助手消息之后）
  const [proposal, setProposal] = useState<{
    days: ItineraryDay[];
    references: Reference[];
    change_summary: string;
  } | null>(null);
  // 本轮召回的长期偏好（透明性：AI 参考了什么）
  const [usedMemories, setUsedMemories] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, proposal]);

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setText("");
    setProposal(null);
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "对话失败");
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      setUsedMemories(Array.isArray(data.memories) ? data.memories : []);
      if (data.proposal && Array.isArray(data.proposal.days)) {
        setProposal({
          days: data.proposal.days,
          references: data.proposal.references ?? [],
          change_summary: data.proposal.change_summary ?? "",
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // 出错时回退刚加的用户消息，允许重发
      setMessages((m) => m.slice(0, -1));
      setText(content);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!proposal) return;
    onApply(proposal.days, proposal.references);
    setProposal(null);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "✅ 已把改动应用到行程，记得点右上角「保存」入库。" },
    ]);
  }

  return (
    <div className="no-print mt-6 rounded-card border border-line bg-surface p-4 shadow-soft">
      <h4 className="font-display flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageCircle className="h-4 w-4 text-teal-dark" aria-hidden />
        对话式助手
      </h4>
      <p className="mt-0.5 text-xs text-muted">
        随便问，或让我改行程。例如「第2天节奏放慢、加个博物馆」「本地美食再多点」「机场怎么去市区」。改动会先给你预览、确认后再应用。
      </p>

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-1.5 text-sm ${
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-teal text-white"
                    : "border border-line bg-surface text-ink/80"
                }`}
              >
                {m.role === "user" ? m.content : <Markdown text={m.content} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 本轮参考的长期偏好（透明性） */}
      {usedMemories.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span>参考了你的偏好：</span>
          {usedMemories.slice(0, 3).map((t, i) => (
            <span key={i} className="rounded-full bg-teal-tint px-2 py-0.5 text-teal-dark">
              {t.length > 18 ? t.slice(0, 18) + "…" : t}
            </span>
          ))}
        </div>
      )}

      {/* 改动预览卡 */}
      {proposal && (
        <ProposalCard
          diff={diffItinerary(days, proposal.days)}
          summary={proposal.change_summary}
          onApply={apply}
          onDiscard={() => setProposal(null)}
        />
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
          }}
          placeholder={busy ? "助手思考中…" : "输入消息…（⌘/Ctrl+Enter 发送）"}
          rows={2}
          disabled={busy}
          className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-surface-2"
        />
        <Button onClick={send} disabled={busy || !text.trim()} loading={busy}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          发送
        </Button>
      </div>
      {err && <p className="mt-2 text-xs text-seal">{err}</p>}
    </div>
  );
}

/** 可选的兴趣侧重标签 */
const INTEREST_TAGS = [
  "美食",
  "文化历史",
  "自然风光",
  "购物",
  "夜生活",
  "亲子",
  "小众冷门",
  "拍照打卡",
];

/**
 * 偏好调节面板（P1 混合主动式共创的「直接操作 + 引导」一环）。
 * 用户拖动 节奏/预算侧重 滑块、勾选兴趣侧重 → 组合成自然语言指令，调 refine(preview=true)
 * 只算不改库 → 以 diff 预览卡呈现 → 用户确认后才提交（onApply 持久化）。体现 propose→review→commit。
 */
function PreferencePanel({
  id,
  days,
  onApply,
}: {
  id: string;
  days: ItineraryDay[];
  onApply: (days: ItineraryDay[], references?: Reference[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pace, setPace] = useState(50); // 0 悠闲 ~ 100 紧凑
  const [comfort, setComfort] = useState(50); // 0 省钱 ~ 100 舒适
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    days: ItineraryDay[];
    references?: Reference[];
    summary: string;
  } | null>(null);

  function toggleInterest(t: string) {
    setInterests((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));
  }

  function composeInstruction(): string {
    const paceWord =
      pace < 34
        ? "把整体节奏放慢：每天活动更少、留白与休息更多"
        : pace > 66
          ? "把整体节奏加紧凑：每天多安排一些活动、提高时间利用率"
          : "保持适中的每日节奏";
    const comfortWord =
      comfort < 34
        ? "更偏省钱：优先高性价比或免费的选择，压低单项花费"
        : comfort > 66
          ? "更偏舒适省心：可选品质更好、更省力的选项，允许适当提高花费"
          : "预算档次保持不变";
    const interestWord = interests.length
      ? `；在活动与餐饮上更侧重：${interests.join("、")}`
      : "";
    return (
      `请在保持行程日期、城市，以及既有真实车次/航班/酒店条目不变的前提下，按以下偏好重排整体行程：` +
      `${paceWord}；${comfortWord}${interestWord}。不得编造车次/航班/酒店/票价。`
    );
  }

  async function reorder() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setProposal(null);
    logEvent("pref_reorder_request", { pace, comfort, interests }, id);
    try {
      const res = await fetch(`/api/trips/${id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: composeInstruction(),
          scope: "all",
          preview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重排失败");
      const nd = (data.days as ItineraryDay[]) ?? [];
      if (!nd.length) throw new Error("重排结果为空");
      setProposal({
        days: nd,
        references: data.references as Reference[] | undefined,
        summary: "按偏好重排后的整体行程",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!proposal) return;
    onApply(proposal.days, proposal.references);
    setProposal(null);
  }
  function discard() {
    if (!proposal) return;
    logEvent(
      "diff_discard",
      { via: "pref", changedDays: diffItinerary(days, proposal.days).changedCount },
      id,
    );
    setProposal(null);
  }

  return (
    <Panel
      className="no-print mt-6"
      icon={SlidersHorizontal}
      title="偏好调节"
      meta={
        <span className="text-xs font-normal text-muted">
          拖动节奏/预算、勾选兴趣 → 一键重排整段行程（先预览、确认后生效）
        </span>
      }
      open={open}
      onToggle={setOpen}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <PrefSlider
          label="节奏"
          left="悠闲"
          right="紧凑"
          value={pace}
          onChange={setPace}
          onCommit={(v) => logEvent("pref_change", { key: "pace", value: v }, id)}
        />
        <PrefSlider
          label="预算侧重"
          left="省钱"
          right="舒适"
          value={comfort}
          onChange={setComfort}
          onCommit={(v) =>
            logEvent("pref_change", { key: "comfort", value: v }, id)
          }
        />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-muted">
          兴趣侧重（可多选）
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_TAGS.map((t) => {
            const on = interests.includes(t);
            return (
              <button
                key={t}
                onClick={() => {
                  toggleInterest(t);
                  logEvent("pref_change", { key: "interest", tag: t, on: !on }, id);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs transition cursor-pointer ${
                  on
                    ? "border-teal bg-teal text-white"
                    : "border-line text-muted hover:border-teal hover:text-teal-dark"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={reorder} disabled={busy} loading={busy} size="sm">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {busy ? "重排中…（约 20~40 秒）" : "按偏好重排"}
        </Button>
        <span className="text-[11px] text-muted/80">
          重排会保留日期与真实车票/航班/酒店，只调活动与节奏。
        </span>
      </div>
      {err && <p className="mt-2 text-xs text-seal">{err}</p>}

      {proposal && (
        <ProposalCard
          diff={diffItinerary(days, proposal.days)}
          summary={proposal.summary}
          onApply={apply}
          onDiscard={discard}
        />
      )}
    </Panel>
  );
}

/** 偏好滑块：0~100，带左右端标签；onCommit 在松手时回调（用于埋点，避免拖动刷屏）。 */
function PrefSlider({
  label,
  left,
  right,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink/80">{label}</span>
        <span className="font-data text-xs text-muted">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-teal"
      />
      <div className="flex justify-between text-[11px] text-muted/80">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/**
 * 规划过程可见化（P2 / RQ2）：把多智能体黑箱翻译成「每个 agent 做了什么、选了谁、
 * 找到多少候选、有哪些取证来源」。懒加载（首次展开才拉 /trace），逐 agent 可展开细节。
 */
function ProcessTrace({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<AgentTrace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 本次规划成本卡（tokens / $ / 耗时）：读运营 spans 汇总，拉不到就不显示
  const [cost, setCost] = useState<{
    totalTokens: number;
    totalCostUsd: number;
    wallMs: number;
    llmCalls: number;
  } | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/trace`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载过程失败");
        setTrace((data.trace as AgentTrace[]) ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
      // 成本汇总是增强信息：静默失败
      try {
        const res = await fetch(`/api/trips/${id}/spans`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          rollup?: {
            totalTokens: number;
            totalCostUsd: number;
            wallMs: number;
            llmCalls: number;
          };
        };
        if (data.rollup && data.rollup.llmCalls > 0) setCost(data.rollup);
      } catch {
        // 静默
      }
    })();
  }, [open, id]);

  function toggleAgent(agent: string) {
    setExpanded((m) => {
      const next = !m[agent];
      if (next) logEvent("trace_expand_agent", { agent }, id);
      return { ...m, [agent]: next };
    });
  }

  return (
    <Panel
      className="no-print mt-6"
      icon={Microscope}
      title="规划过程 · AI 是怎么想的"
      meta={
        <span className="text-xs font-normal text-muted">
          8 个专家 agent 各做了什么、选了谁、取证来源
        </span>
      }
      open={open}
      onToggle={(o) => {
        if (o) logEvent("trace_open", {}, id);
        setOpen(o);
      }}
    >
      {loading && <ListSkeleton rows={5} />}
      {err && <p className="text-sm text-seal">{err}</p>}

      {/* 本次规划成本卡（可观测汇总）+ 开发者视图入口 */}
      {cost && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <span className="font-medium text-ink">本次规划</span>
          <span>
            <span className="font-data text-ink">{cost.llmCalls}</span> 次模型调用
          </span>
          <span>
            <span className="font-data text-ink">
              {cost.totalTokens.toLocaleString()}
            </span>{" "}
            tokens
          </span>
          <span>
            成本约{" "}
            <span className="font-data text-ink">
              ${cost.totalCostUsd.toFixed(4)}
            </span>
          </span>
          <span>
            耗时 <span className="font-data text-ink">{Math.round(cost.wallMs / 1000)}s</span>
          </span>
          <a
            href={`/trips/${id}/observability`}
            className="ml-auto inline-flex items-center gap-0.5 font-medium text-teal-dark hover:underline"
            onClick={() => logEvent("observability_open", { via: "trace" }, id)}
          >
            开发者视图
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        </div>
      )}

      {trace && (
        <ol className="space-y-2">
          {trace.map((t) => {
            const isOpen = !!expanded[t.agent];
            return (
              <li key={t.agent} className="rounded-lg border border-line bg-surface">
                <button
                  onClick={() => toggleAgent(t.agent)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
                >
                  <Dot status={t.status} />
                  <span className="text-sm font-medium text-ink">{t.label}</span>
                  <Chip tone="muted">第 {t.wave} 波</Chip>
                  {t.searched && <Chip tone="teal">联网取证 {t.sources.length}</Chip>}
                  {t.candidateCount > 0 && (
                    <Chip tone="amber">{t.candidateCount} 候选</Chip>
                  )}
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.18 }}
                    className="ml-auto text-muted"
                    aria-hidden
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-line px-3 py-2.5 text-xs">
                        <p className="text-muted">{t.what}</p>
                        {t.status !== "done" ? (
                          <p className="mt-1.5 text-muted/80">
                            {t.status === "error"
                              ? `该步出错：${t.error ?? "未知错误"}`
                              : "该步尚无产物。"}
                          </p>
                        ) : (
                          <>
                            {t.recommended && (
                              <p className="mt-1.5 rounded bg-teal-tint px-2 py-1 text-teal-dark">
                                <span className="font-medium">首选：</span>
                                {t.recommended}
                              </p>
                            )}
                            {t.summary.length > 0 && (
                              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-ink/70">
                                {t.summary.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            )}
                            {t.sources.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {t.sources.map((sc, i) => (
                                  <a
                                    key={i}
                                    href={sc.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() =>
                                      logEvent(
                                        "source_open",
                                        { via: "trace", agent: t.agent, label: sc.label },
                                        id,
                                      )
                                    }
                                    className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[11px] text-teal-dark transition hover:border-teal hover:underline"
                                  >
                                    {sc.label}
                                    <ArrowUpRight className="h-3 w-3" aria-hidden />
                                  </a>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-muted/80">
        这些都是各 agent 真实产物的归纳：青色徽章表示带可核实来源，琥珀色表示还有未选入的候选（见候选池）。
      </p>
    </Panel>
  );
}

/** 出发倒计时横幅：距出发 N 天 / 旅行进行中·第 X 天 / 已结束。纯客户端。 */
function Countdown({
  start,
  end,
}: {
  start: string | null;
  end: string | null;
}) {
  const info = useMemo(() => {
    const isISO = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isISO(start)) return null;
    const midnight = (s: string) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const DAY = 86400000;
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const s0 = midnight(start!);
    const e0 = isISO(end) ? midnight(end!) : s0;
    if (today < s0) {
      const n = Math.round((s0 - today) / DAY);
      return {
        text: n === 0 ? "明天出发" : `距出发还有 ${n} 天`,
        cls: "border-teal/30 bg-teal-tint text-teal-dark",
      };
    }
    if (today <= e0) {
      const x = Math.round((today - s0) / DAY) + 1;
      return {
        text: `旅行进行中 · 第 ${x} 天`,
        cls: "border-teal/30 bg-teal-tint text-teal-dark",
      };
    }
    return {
      text: "旅行已结束 · 回顾一下这次行程吧",
      cls: "border-line bg-surface-2 text-muted",
    };
  }, [start, end]);

  if (!info) return null;
  return (
    <div
      className={`no-print mt-3 flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${info.cls}`}
    >
      <CalendarDays className="h-4 w-4" aria-hidden />
      {info.text}
    </div>
  );
}

interface PackItem {
  id: string;
  label: string;
  group: string;
  checked: boolean;
}

/** 打包清单：AI 生成（天气/季节/活动感知）、可勾选、可增删，改动即持久化。 */
function PackingList({
  id,
  weather,
  destination,
}: {
  id: string;
  weather: Record<string, DayWeather>;
  destination: string | null;
}) {
  const [items, setItems] = useState<PackItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const fetched = useRef(false);

  // 首次展开时读已存清单（ref 守卫，避免在 effect 里同步 setState）
  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/packing`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.packing)) setItems(data.packing);
      } catch {
        // 静默：打包清单是增强项
      }
    })();
  }, [open, id]);

  // 用已拉到的天气拼一句摘要，喂给生成
  function weatherHint(): string {
    const vals = Object.values(weather);
    if (!vals.length) return "";
    const tmax = Math.max(...vals.map((v) => v.tmax));
    const tmin = Math.min(...vals.map((v) => v.tmin));
    const rainy = vals.filter((v) => v.pop >= 40).length;
    return `气温约 ${tmin}~${tmax}°C${rainy ? `，其中 ${rainy} 天可能有雨` : "，以晴到多云为主"}`;
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${id}/packing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weatherHint: weatherHint() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setItems(data.packing as PackItem[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 保存（勾选/增删都走这里，乐观更新）
  async function persist(next: PackItem[]) {
    setItems(next);
    try {
      await fetch(`/api/trips/${id}/packing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packing: next }),
      });
    } catch {
      // 静默：下次改动会再尝试
    }
  }

  function toggle(itemId: string) {
    if (!items) return;
    persist(
      items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it)),
    );
  }
  function remove(itemId: string) {
    if (!items) return;
    persist(items.filter((it) => it.id !== itemId));
  }
  function add() {
    const label = newLabel.trim();
    if (!label) return;
    const next = [
      ...(items ?? []),
      { id: `u${Date.now()}`, label, group: "其他", checked: false },
    ];
    setNewLabel("");
    persist(next);
  }

  const groups = useMemo(() => {
    const order = ["证件", "衣物", "电子", "洗漱", "其他"];
    const by: Record<string, PackItem[]> = {};
    for (const it of items ?? []) (by[it.group] ??= []).push(it);
    const keys = [
      ...order.filter((g) => by[g]),
      ...Object.keys(by).filter((g) => !order.includes(g)),
    ];
    return keys.map((g) => ({ group: g, list: by[g] }));
  }, [items]);

  const checkedCount = items?.filter((it) => it.checked).length ?? 0;

  return (
    <Panel
      className="mt-6"
      icon={Luggage}
      title="打包清单"
      meta={
        <span className="text-xs font-normal text-muted">
          {items && items.length ? (
            <span className="font-data">
              已勾选 {checkedCount}/{items.length}
            </span>
          ) : (
            `按${destination ?? "目的地"}天气与活动智能生成`
          )}
        </span>
      }
      open={open}
      onToggle={setOpen}
    >
      {!items && (
        <Button onClick={generate} disabled={busy} loading={busy} size="sm">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {busy ? "生成中…（约 10~20 秒）" : "生成打包清单"}
        </Button>
      )}
      {err && <p className="mt-2 text-xs text-seal">{err}</p>}

      {items && items.length > 0 && (
        <>
          <div className="space-y-3">
            {groups.map(({ group, list }) => (
              <div key={group}>
                <div className="mb-1 text-xs font-medium text-muted">{group}</div>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {list.map((it) => (
                    <li key={it.id} className="group flex items-center gap-2">
                      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={it.checked}
                          onChange={() => toggle(it.id)}
                          className="h-4 w-4 rounded border-line accent-teal"
                        />
                        <span
                          className={
                            it.checked ? "text-muted line-through" : "text-ink/80"
                          }
                        >
                          {it.label}
                        </span>
                      </label>
                      <button
                        onClick={() => remove(it.id)}
                        className="text-muted/50 opacity-0 transition group-hover:opacity-100 hover:text-seal cursor-pointer"
                        title="删除"
                        aria-label={`删除 ${it.label}`}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="添加自定义物品…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={add}
              disabled={!newLabel.trim()}
            >
              添加
            </Button>
          </div>
        </>
      )}
      {items && items.length === 0 && (
        <p className="text-sm text-muted">清单为空，可在下方添加自定义物品。</p>
      )}
    </Panel>
  );
}

/** 每日天气徽章：有数据才显示（无预报/超范围则不渲染，绝不编造）。 */
function WeatherBadge({ w }: { w?: DayWeather }) {
  if (!w) return null;
  const m = wmoMeta(w.code);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill border border-sky-100 bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-700"
      title={`${m.label} · 降水概率 ${w.pop}%`}
    >
      <span>{m.emoji}</span>
      <span className="tabular-nums">
        {w.tmax}° / {w.tmin}°
      </span>
      {w.pop >= 30 && <span className="text-sky-500">💧{w.pop}%</span>}
    </span>
  );
}

/** 预算成本看板：总额 vs 预算进度条 + 按类别细分 + 按天迷你柱状 + 计划 vs 实际记账。随编辑实时重算。 */
function BudgetPanel({
  summary,
  partySize,
  days,
}: {
  summary: BudgetSummary;
  partySize: number | null;
  days: ItineraryDay[];
}) {
  const { total, byDay, byKind, perPerson, budget, remaining, ratio, overBudget } =
    summary;

  // 实际花费（用户记账）：有一条就显示「计划 vs 实际」对照（只和已记账条目的计划值比）
  const actual = useMemo(() => {
    let sum = 0;
    let est = 0;
    let count = 0;
    for (const d of days)
      for (const it of d.items)
        if (typeof it.actual_cost === "number" && it.actual_cost > 0) {
          sum += it.actual_cost;
          est += it.est_cost || 0;
          count += 1;
        }
    return { sum, est, count };
  }, [days]);

  if (total <= 0 && !budget) return null;

  const maxDay = Math.max(1, ...byDay);
  // 类别条：过滤掉为 0 的类别，按金额降序
  const kinds = (
    [...BUDGET_KINDS, "other"] as (keyof typeof byKind)[]
  )
    .filter((k) => byKind[k] > 0)
    .sort((a, b) => byKind[b] - byKind[a]);

  return (
    <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-base font-bold text-ink">预算成本</h3>
        <span className="text-xs text-muted">估算总额 · 随编辑实时更新</span>
      </div>

      {/* 总额 vs 预算 */}
      <div className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <AnimatedNumber
            value={total}
            format={formatCny}
            className="font-serif text-3xl font-bold tracking-tight text-ink tabular-nums"
          />
          {budget != null ? (
            <span className={overBudget ? "text-seal" : "text-muted"}>
              预算 <span className="font-data">{formatCny(budget)}</span> ·{" "}
              {overBudget
                ? `超 ${formatCny(Math.abs(remaining ?? 0))}`
                : `剩 ${formatCny(remaining ?? 0)}`}
            </span>
          ) : (
            <span className="text-muted">未设预算</span>
          )}
        </div>
        {budget != null && (
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <motion.div
              className="h-full rounded-pill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (ratio ?? 0) * 100)}%` }}
              transition={{ type: "spring", stiffness: 90, damping: 20 }}
              style={{
                background: overBudget ? "var(--seal)" : "var(--teal)",
              }}
            />
          </div>
        )}
        <div className="mt-1.5 text-xs text-muted">
          人均 <span className="font-data">{formatCny(perPerson)}</span>
          {partySize && partySize > 1 ? `（${partySize} 人）` : ""}
        </div>
      </div>

      {/* 计划 vs 实际（旅途记账：在条目上填「实际」即出现） */}
      {actual.count > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
          已记账 <span className="font-data text-ink">{actual.count}</span> 项 · 实际共{" "}
          <span className="font-data font-semibold text-ink">
            {formatCny(actual.sum)}
          </span>
          {"　"}
          {actual.sum <= actual.est ? (
            <span className="text-teal-dark">
              比这些项的计划省 {formatCny(actual.est - actual.sum)}
            </span>
          ) : (
            <span className="text-seal">
              比这些项的计划多 {formatCny(actual.sum - actual.est)}
            </span>
          )}
        </div>
      )}

      {/* 按类别 */}
      {kinds.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {kinds.map((k) => {
            const v = byKind[k];
            const pct = total > 0 ? (v / total) * 100 : 0;
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
                <span className="font-data w-16 shrink-0 text-right text-ink/70">
                  {formatCny(v)}
                </span>
                <span className="font-data w-9 shrink-0 text-right text-muted/70">
                  {Math.round(pct)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 按天迷你柱状 */}
      {byDay.length > 1 && (
        <div className="mt-4">
          <div className="flex items-end gap-1" style={{ height: 48 }}>
            {byDay.map((v, i) => (
              <div
                key={i}
                className="group flex flex-1 flex-col items-center justify-end"
                title={`第 ${i + 1} 天 · ${formatCny(v)}`}
              >
                <div
                  className="w-full rounded-t-md transition group-hover:opacity-80"
                  style={{
                    height: `${(v / maxDay) * 100}%`,
                    minHeight: v > 0 ? 2 : 0,
                    background: dayColorOf(i + 1),
                    opacity: 0.85,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="font-data mt-1 flex gap-1 text-[10px] text-muted/70">
            {byDay.map((_, i) => (
              <span key={i} className="flex-1 text-center">
                D{i + 1}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 单个行程条目卡片：可拖拽、可编辑、交通条目可搜车票 */
/**
 * 可信度徽章（RQ3 信任校准）：让 AI 每条结论的证据状态显性化——
 * 「已核实来源」可点开来源核对；「待核实」提示应自行到官方确认；「可查证」有预订/购票链接。
 */
function TrustBadge({
  p,
  tripId,
  kind,
}: {
  p: Provenance;
  tripId: string;
  kind: string;
}) {
  if (p.level === "verified" && p.sourceUrl) {
    return (
      <a
        href={p.sourceUrl}
        target="_blank"
        rel="noreferrer"
        title="有可核实来源，点击核对"
        onClick={() => logEvent("source_open", { via: "item_badge", kind }, tripId)}
        className="seal-stamp transition hover:bg-seal-tint"
      >
        <BadgeCheck className="h-3 w-3" aria-hidden />
        已核实
      </a>
    );
  }
  if (p.level === "unverified") {
    return (
      <Chip tone="amber">
        <ShieldAlert className="h-3 w-3" aria-hidden />
        待核实
      </Chip>
    );
  }
  return (
    <Chip tone="teal">
      <Link2 className="h-3 w-3" aria-hidden />
      可查证
    </Chip>
  );
}

function ItemCard({
  item,
  index = 0,
  number,
  dayColor,
  meta,
  tripId,
  provenance,
  hovered = false,
  onHover,
  onLocate,
  onDragStart,
  onDrop,
  onChange,
  onDelete,
}: {
  item: ItineraryItem;
  index?: number;
  /** 当天内序号（编号针；尽量对应地图针） */
  number?: number;
  /** 当天配色（编号针底色，与地图针一致） */
  dayColor?: string;
  meta: Meta;
  tripId: string;
  provenance: Provenance | null;
  /** 地图针脚悬停联动：true 时卡片高亮 */
  hovered?: boolean;
  /** 鼠标进出卡片时回传（页面据此放大地图对应针脚） */
  onHover?: (hovering: boolean) => void;
  /** 触屏定位（仅小屏显示按钮）：滚到地图并聚焦本条目针脚；无坐标时不传 */
  onLocate?: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onChange: (field: keyof ItineraryItem, value: string | number) => void;
  onDelete: () => void;
}) {
  // null=未展开；"train"=搜车票；"flight"=搜航班
  const [searchMode, setSearchMode] = useState<null | "train" | "flight">(null);
  // 「为什么推荐」展开（RQ2 可解释）
  const [whyOpen, setWhyOpen] = useState(false);
  const bookingUrl = item.booking_url || extractUrl(item.detail);
  const link = bookingMeta(item.kind); // { label, cls }
  // 城际交通才显示搜车票/搜航班；打车/地铁/步行等本地交通不显示
  const longHaul = item.kind === "transit" && !LOCAL_TRANSIT_RE.test(`${item.title} ${item.detail}`);

  const pinColor = dayColor ?? kindColor(item.kind);
  const catColor = kindColor(item.kind);
  const catLabel = (KIND_META as Record<string, { label: string }>)[item.kind]?.label ?? "活动";
  const KindIcon = KIND_ICONS[item.kind] ?? KIND_ICONS.other;

  const editable =
    "rounded border border-transparent px-1 py-0.5 outline-none transition hover:border-line focus:border-teal focus:ring-1 focus:ring-teal/25";

  /** 底部工具行（票根/普通卡共用）：类别、花费、记账、徽章、搜索、删除 */
  const toolRow = (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {/* 类别 chip（含隐形 select 供编辑） */}
      <span
        className="relative inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-medium"
        style={{
          color: catColor,
          background: `color-mix(in srgb, ${catColor} 12%, #fff)`,
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: catColor }}
        />
        {catLabel}
        <select
          value={KINDS.includes(item.kind) ? item.kind : "activity"}
          onChange={(e) => onChange("kind", e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          title="修改类别"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {(KIND_META as Record<string, { label: string }>)[k]?.label ?? k}
            </option>
          ))}
        </select>
      </span>
      <span className="inline-flex items-center gap-0.5 text-muted" title="计划花费">
        <span>¥</span>
        <input
          type="number"
          value={item.est_cost || 0}
          onChange={(e) => onChange("est_cost", Number(e.target.value))}
          className="font-data w-16 rounded border border-line bg-surface px-1 py-0.5 text-ink outline-none transition focus:border-teal"
        />
      </span>
      <span
        className="inline-flex items-center gap-0.5 text-muted/80"
        title="实际花费（旅途记账，预算面板会汇总对照）"
      >
        <span className="text-[10px]">实际</span>
        <input
          type="number"
          value={item.actual_cost ?? ""}
          placeholder="—"
          onChange={(e) =>
            onChange("actual_cost", e.target.value === "" ? 0 : Number(e.target.value))
          }
          className="font-data w-14 rounded border border-dashed border-line bg-surface px-1 py-0.5 text-ink outline-none transition focus:border-teal"
        />
      </span>
      {provenance && <TrustBadge p={provenance} tripId={tripId} kind={item.kind} />}
      {onLocate && (
        <button
          onClick={onLocate}
          className="inline-flex items-center gap-0.5 text-teal-dark cursor-pointer lg:hidden"
          title="在地图上查看"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          地图
        </button>
      )}
      {item.why && (
        <button
          onClick={() => {
            setWhyOpen((o) => {
              if (!o) logEvent("rationale_open", { kind: item.kind }, tripId);
              return !o;
            });
          }}
          className="inline-flex items-center gap-0.5 text-muted transition hover:text-teal-dark cursor-pointer"
          title="为什么推荐它"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
          为什么
        </button>
      )}
      {bookingUrl && (
        <a
          href={bookingUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-white ${link.cls}`}
        >
          <Ticket className="h-3 w-3" aria-hidden />
          {link.label}
        </a>
      )}
      {longHaul && (
        <>
          <button
            onClick={() => setSearchMode((m) => (m === "train" ? null : "train"))}
            className="inline-flex items-center gap-0.5 text-teal-dark transition hover:underline cursor-pointer"
          >
            <TrainFront className="h-3.5 w-3.5" aria-hidden />
            搜车票
          </button>
          <button
            onClick={() => setSearchMode((m) => (m === "flight" ? null : "flight"))}
            className="inline-flex items-center gap-0.5 text-teal-dark transition hover:underline cursor-pointer"
          >
            <Plane className="h-3.5 w-3.5" aria-hidden />
            搜航班
          </button>
        </>
      )}
      <button
        onClick={onDelete}
        className="ml-auto text-muted/60 transition hover:text-seal cursor-pointer"
        title="删除"
        aria-label="删除条目"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );

  /** 「为什么推荐」引语块（编辑风：衬线斜体 + 左侧竖线） */
  const whyBlock = whyOpen && item.why && (
    <p className="font-serif mt-2 border-l-2 border-teal/50 pl-2.5 text-[13px] italic leading-relaxed text-ink/70">
      {item.why}
    </p>
  );

  const searchBlock = searchMode && longHaul && (
    <TransitSearch
      meta={meta}
      mode={searchMode}
      onPick={(t) => {
        onChange("title", t.name);
        // 详情只留干净信息，购票链接单独存到 booking_url（按钮跳转）
        onChange(
          "detail",
          `${t.depart} → ${t.arrive} · ${t.duration} · ${t.price_cny}`,
        );
        onChange("est_cost", parsePrice(t.price_cny));
        onChange("kind", "transit");
        onChange("booking_url", t.booking_url);
        setSearchMode(null);
      }}
    />
  );

  return (
    <motion.div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.04, 0.2),
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative pl-24"
    >
      {/* 时间（左列，mono 数据体） */}
      <input
        value={item.time}
        onChange={(e) => onChange("time", e.target.value)}
        placeholder="时间"
        className={`font-data absolute left-0 top-3 w-14 text-right text-xs text-muted ${editable}`}
      />
      {/* 编号针（对齐时间轴，颜色=当天色，对应地图针；联动悬停时放大） */}
      <div
        className="absolute top-3 z-10 -translate-x-1/2"
        style={{ left: RAIL_X }}
      >
        <div
          className="wl-pin transition-transform"
          style={
            {
              "--c": pinColor,
              transform: hovered ? "scale(1.18)" : undefined,
            } as React.CSSProperties
          }
        >
          {number ?? ""}
        </div>
      </div>

      {longHaul ? (
        /* ── 签名元素：登机牌式票根（城际交通条目） ── */
        /* 联动高亮用内联样式：globals 的 .ticket/.wl-place-card 未分层，utility 压不过 */
        <div
          className="ticket transition-shadow"
          style={
            hovered
              ? { borderColor: "var(--teal)", boxShadow: "var(--shadow-lift)" }
              : undefined
          }
        >
          <div className="flex items-start gap-2 px-4 pb-2.5 pt-3">
            <span
              className="mt-1 cursor-grab select-none text-muted/50"
              title="拖拽排序"
              aria-hidden
            >
              <GripVertical className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {/^.*(航班|飞|机场|[A-Z]{2}\d{2,4}).*$/.test(item.title) ? (
                  <Plane className="h-4 w-4 shrink-0 text-teal-dark" aria-hidden />
                ) : (
                  <TrainFront className="h-4 w-4 shrink-0 text-teal-dark" aria-hidden />
                )}
                <input
                  value={item.title}
                  onChange={(e) => onChange("title", e.target.value)}
                  placeholder="车次 / 航班"
                  className={`font-data w-full text-sm font-semibold tracking-wide text-ink ${editable}`}
                />
              </div>
              <textarea
                value={item.detail}
                onChange={(e) => onChange("detail", e.target.value)}
                placeholder="出发 → 到达 · 时长 · 票价"
                rows={Math.max(1, Math.ceil((item.detail?.length || 0) / 40))}
                className={`font-data mt-0.5 w-full resize-none text-[13px] text-muted ${editable}`}
              />
            </div>
          </div>
          <hr className="ticket-divider" />
          <div className="px-4 pb-3 pt-1.5">
            {toolRow}
            {whyBlock}
            {searchBlock}
          </div>
        </div>
      ) : (
        /* ── 地点卡 ── */
        <div
          className="wl-place-card p-3"
          style={
            hovered
              ? { borderColor: "var(--teal)", boxShadow: "var(--shadow-lift)" }
              : undefined
          }
        >
          <div className="flex items-start gap-3">
            {/* 主体内容 */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <span
                  className="mt-1.5 cursor-grab select-none text-muted/50"
                  title="拖拽排序"
                  aria-hidden
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <input
                  value={item.title}
                  onChange={(e) => onChange("title", e.target.value)}
                  placeholder="标题"
                  className={`w-full text-sm font-semibold text-ink ${editable}`}
                />
              </div>
              <textarea
                value={item.detail}
                onChange={(e) => onChange("detail", e.target.value)}
                placeholder="备注 / 详情…"
                rows={Math.max(1, Math.ceil((item.detail?.length || 0) / 40))}
                className={`mt-0.5 w-full resize-none text-sm text-muted ${editable}`}
              />
              {toolRow}
              {whyBlock}
              {searchBlock}
            </div>

            {/* 缩略图占位块（类别色 + 类别图标；无真实照片源） */}
            <div
              className="wl-thumb hidden h-14 w-14 shrink-0 sm:grid"
              style={{ "--c": catColor } as React.CSSProperties}
              aria-hidden
            >
              <KindIcon className="h-6 w-6" />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** 相邻条目间的路程耗时连接线：haversine 直线距离 + 模式启发（<1km 步行，否则打车/地铁）。 */
function TravelLeg({
  from,
  to,
}: {
  from?: { lat: number; lon: number };
  to?: { lat: number; lon: number };
}) {
  if (!from || !to) return null;
  const km = haversineKm(from, to);
  if (km < 0.05 || km > 80) return null; // 同址或跨城（跨城由交通条目覆盖）不显示
  const walk = km < 1;
  const mins = walk
    ? Math.max(2, Math.round(km * 12)) // 步行 ~12 min/km
    : Math.max(5, Math.round((km / 25) * 60 + 10)); // 市内车行 ~25km/h + 10min 等车
  const Icon = walk ? Footprints : CarTaxiFront;
  return (
    <div className="no-print relative mb-2 h-5 pl-24" aria-hidden>
      <div className="flex h-full items-center gap-1.5 pl-3 text-[11px] text-muted/70">
        <Icon className="h-3 w-3" />
        <span className="font-data">
          约 {mins} 分钟 · {walk ? "步行" : "打车/地铁"} · {km.toFixed(1)}km
        </span>
      </div>
    </div>
  );
}

/** 球面直线距离（km） */
function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Transit {
  name: string;
  depart: string;
  arrive: string;
  duration: string;
  price_cny: string;
  booking_url: string;
  source_url: string;
  airline?: string; // 仅航班
}

/** 交通换乘实时搜索：mode=train 搜真实车次 / mode=flight 搜真实航班，下拉点选替换条目 */
function TransitSearch({
  meta,
  mode,
  onPick,
}: {
  meta: Meta;
  mode: "train" | "flight";
  onPick: (t: Transit) => void;
}) {
  const [from, setFrom] = useState(meta.origin ?? "");
  const [to, setTo] = useState(meta.destination ?? "");
  const [date, setDate] = useState(meta.start_date ?? "");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Transit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isFlight = mode === "flight";
  const endpoint = isFlight ? "/api/flights" : "/api/trains";
  const accent = isFlight
    ? { noun: "航班", empty: "未搜到航班" }
    : { noun: "趟", empty: "未搜到车次" };

  async function run() {
    if (!from || !to) {
      setErr("请填出发地和到达地");
      return;
    }
    setLoading(true);
    setErr(null);
    setItems(null);
    try {
      const q = new URLSearchParams({ from, to, date });
      const res = await fetch(`${endpoint}?${q.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "搜索失败");
      setItems((isFlight ? data.flights : data.trains) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-teal/30 bg-teal-tint/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="出发地"
          className="w-24 rounded border border-line bg-surface px-1.5 py-1 text-ink outline-none transition focus:border-teal"
        />
        <ArrowRight className="h-3 w-3 text-muted" aria-hidden />
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="到达地"
          className="w-24 rounded border border-line bg-surface px-1.5 py-1 text-ink outline-none transition focus:border-teal"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="font-data rounded border border-line bg-surface px-1.5 py-1 text-ink outline-none transition focus:border-teal"
        />
        <Button size="sm" onClick={run} disabled={loading} loading={loading}>
          {isFlight ? (
            <Plane className="h-3 w-3" aria-hidden />
          ) : (
            <TrainFront className="h-3 w-3" aria-hidden />
          )}
          {loading ? "搜索中…" : isFlight ? "搜航班" : "搜车票"}
        </Button>
      </div>
      {err && <p className="mt-1.5 text-xs text-seal">{err}</p>}
      {items && (
        <>
          {items.length > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              共 {items.length} {accent.noun} · 滚动浏览，点选替换该条目
            </p>
          )}
          <ul className="mt-1 max-h-80 space-y-1 overflow-y-auto pr-1">
            {items.length === 0 && (
              <li className="text-xs text-muted">{accent.empty}</li>
            )}
            {items.map((t, i) => (
              <li key={i}>
                <button
                  onClick={() => onPick(t)}
                  className="w-full rounded border border-line bg-surface px-2 py-1.5 text-left text-xs transition hover:border-teal hover:shadow-soft cursor-pointer"
                >
                  <span className="font-data font-semibold text-ink">{t.name}</span>
                  {t.airline ? (
                    <span className="text-muted"> {t.airline}</span>
                  ) : null}{" "}
                  <span className="font-data text-ink/70">
                    {t.depart} → {t.arrive}
                  </span>{" "}
                  <span className="font-data text-muted/80">
                    {t.duration} · {t.price_cny}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 从文本里抽第一个 URL（购票链接用） */
function extractUrl(text: string): string | null {
  const m = text?.match(/https?:\/\/[^\s，。）)]+/);
  return m ? m[0] : null;
}
function parsePrice(s: string): number {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** 本地短途交通（不显示搜车票/搜航班） */
const LOCAL_TRANSIT_RE =
  /打车|出租|网约车|滴滴|地铁|公交|步行|巴士|班车|接驳|缆车|轮渡|摆渡|taxi|metro|subway|walk|bus/i;

/** 按条目类别决定跳转按钮的文案与配色 */
function bookingMeta(kind: string): { label: string; cls: string } {
  if (kind === "transit")
    return { label: "购票", cls: "bg-teal hover:bg-teal-dark" };
  if (kind === "rest")
    return { label: "预订", cls: "bg-teal hover:bg-teal-dark" };
  return { label: "查看", cls: "bg-ink/70 hover:bg-ink" };
}

/** 把 detail 里的购票/预订 URL 剥离到 item.booking_url，detail 只留干净文字 */
function normalizeDays(days: ItineraryDay[]): ItineraryDay[] {
  return (days ?? []).map((d) => ({
    ...d,
    items: (d.items ?? []).map((it) => {
      const url = it.booking_url || extractUrl(it.detail || "") || undefined;
      let detail = it.detail ?? "";
      if (url) {
        const idx = detail.indexOf(url);
        if (idx >= 0) {
          const head = detail
            .slice(0, idx)
            .replace(/[·,，;；\s]*(购票|预订|订票|详情|链接|预定)?\s*[:：]?\s*$/, "")
            .trim();
          const tail = detail.slice(idx + url.length).trim();
          detail = (head + (tail ? ` ${tail}` : "")).trim();
        }
      }
      return { ...it, detail, booking_url: url };
    }),
  }));
}

/** 把文本里的 URL 渲染成可点击链接 */
function Linkify({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/[^\s，。）)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="text-teal-dark underline underline-offset-2 hover:text-teal"
          >
            购票/详情
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * 等待页「候机楼」面板：航线总进度（小火车随完成数前进）+
 * 专家卡片完成盖章 + 一句产物摘要渐进呈现。等待变成观赏。
 */
function PlanningBoard({
  origin,
  destination,
  statuses,
  summaries,
  loading,
  streamLost,
  finished = false,
  onRetry,
}: {
  origin: string | null;
  destination: string | null;
  statuses: Record<string, Status>;
  summaries: Record<string, string>;
  loading: boolean;
  streamLost: boolean;
  /** 出炉仪式：全员到站，盖「行程已就绪」章（随后由页面切换到成品） */
  finished?: boolean;
  onRetry: () => void;
}) {
  const doneCount = finished
    ? AGENTS.length
    : AGENTS.filter((a) => statuses[a.key] === "done").length;
  const pct = (doneCount / AGENTS.length) * 100;

  // 已用时计时器：等待有了刻度，焦虑就小了
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <span className="ed-eyebrow">多智能体协作中</span>
          <h1 className="font-serif mt-2 text-2xl font-bold tracking-tight text-ink">
            正在编排
            {destination
              ? `「${origin ? `${origin} → ` : ""}${destination}」`
              : "你的行程"}
          </h1>
        </div>
        <span className="font-data pb-1 text-xs tabular-nums text-muted">
          已用时 {mm}:{ss}
        </span>
      </div>

      {/* 航线总进度：出发地 →（小火车随完成数前进）→ 目的地 */}
      <div className="mt-6 rounded-card border border-line bg-surface px-5 py-4 shadow-soft">
        <div className="font-data flex items-center justify-between gap-2 text-xs text-muted">
          <span className="font-semibold text-ink">{origin || "出发地"}</span>
          <span>
            {doneCount}/{AGENTS.length} 位专家完成
          </span>
          <span className="font-semibold text-ink">{destination || "目的地"}</span>
        </div>
        <div className="relative mt-3 h-7" aria-hidden>
          {/* 虚线航线 */}
          <div className="absolute inset-x-1 top-1/2 border-t-2 border-dashed border-line-strong" />
          {/* 已走过的实线 */}
          <div
            className="absolute left-1 top-1/2 h-[2px] -translate-y-px bg-teal transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
          {/* 端点：出发实心 / 目的地空心 */}
          <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-ink" />
          <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-teal bg-surface" />
          {/* 小火车 */}
          <span
            className="absolute top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface shadow-soft transition-all duration-700 ease-out"
            style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}
          >
            <TrainFront className="h-4 w-4 text-teal-dark" />
          </span>
        </div>
      </div>

      {/* 专家卡片：运行中亮边、完成盖章 + 一句产物摘要 */}
      <ol className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {AGENTS.map((a) => {
          const st = statuses[a.key] ?? "pending";
          const summary = summaries[a.key];
          return (
            <li
              key={a.key}
              className={`rounded-lg border bg-surface px-4 py-3 shadow-soft transition-all duration-300 ${
                st === "running"
                  ? "border-teal/60"
                  : st === "pending"
                    ? "border-line opacity-55"
                    : "border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <Dot status={st} />
                <span className="text-sm font-semibold text-ink">{a.label}</span>
                <span className="font-data ml-auto text-[10px] text-muted">
                  第 {a.wave} 波
                </span>
                {st === "done" && (
                  <motion.span
                    initial={{ scale: 2.2, opacity: 0, rotate: -14 }}
                    animate={{ scale: 1, opacity: 1, rotate: -2 }}
                    transition={{ type: "spring", stiffness: 320, damping: 16 }}
                    className="seal-stamp"
                  >
                    完成
                  </motion.span>
                )}
              </div>
              <p className="mt-1.5 min-h-4 text-xs leading-relaxed text-muted">
                {st === "running"
                  ? a.search
                    ? "正在联网检索真实数据…"
                    : "正在推理…"
                  : st === "done"
                    ? summary || "完成"
                    : st === "error"
                      ? "出错了，正在重试…"
                      : "等待上游产物…"}
              </p>
            </li>
          );
        })}
      </ol>

      {streamLost ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-card border border-seal/30 bg-seal-tint px-4 py-3">
          <p className="text-sm text-seal">
            与规划服务的连接中断了。已完成的步骤都已保存，重试会从断点继续。
          </p>
          <button
            onClick={onRetry}
            className="shrink-0 rounded-lg bg-teal px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-dark cursor-pointer"
          >
            继续规划
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">
          {loading
            ? "加载中…"
            : finished
              ? "行程出炉！正在为你展开…"
              : "8 位专家实时联网协作中，约需 1~3 分钟——每位专家完成即亮出成果。"}
        </p>
      )}

      {/* ── 出炉仪式：印章「啪」地盖下 ── */}
      {finished && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[1200] grid place-items-center bg-canvas/55 backdrop-blur-[2px]"
          aria-live="polite"
        >
          <motion.div
            initial={{ scale: 2.6, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: -4 }}
            transition={{ type: "spring", stiffness: 240, damping: 15, delay: 0.15 }}
            className="rounded-xl border-4 border-seal bg-surface/95 px-10 py-6 text-center shadow-lift"
          >
            <p className="font-serif text-3xl font-black tracking-[0.18em] text-seal">
              行程已就绪
            </p>
            <p className="font-data mt-2 text-xs text-muted">
              {AGENTS.length} 位专家 · 全部到站
            </p>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

function Dot({ status }: { status: Status }) {
  const cls =
    {
      pending: "bg-line-strong",
      running: "bg-amber-400 animate-pulse",
      done: "bg-teal",
      error: "bg-seal",
    }[status] ?? "bg-line-strong";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}
