"use client";

/**
 * 「小行」——全站常驻右下角的 AI 智能体 Dock。
 *
 * 消费 CopilotProvider 的共享状态（当前行程控制器），走 /api/agent 的 AG-UI 事件流：
 * 逐条渲染 文字 / 工具进行中 / 生成式卡片 / 改动预览，并执行前端动作（应用改动/撤销/跳转）。
 * Dock 挂在 layout，跨页导航时组件不卸载 → 对话自然延续。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useCopilot } from "./store";
import { CardView } from "./cards";
import { logEvent } from "@/lib/log";
import { ProposalCard } from "@/app/ui/proposal";
import { Markdown, stripMarkdown } from "@/app/ui/markdown";
import {
  Compass,
  X,
  Mic,
  Keyboard,
  Volume2,
  VolumeX,
  Send,
  Check,
  Brain,
  Trash2,
  Sparkles,
} from "@/app/ui/icons";
import type { DigitalHumanHandle, Emotion } from "./DigitalHuman";
import { AVATAR_MODE } from "./avatar-config";

// 数字人仅客户端加载；chunk 加载期间给出夜空占位。
// 形象三选一：video 真人循环视频（默认）/ image 写实立绘 / svg 手绘木偶。
const DigitalHuman = dynamic(
  () =>
    AVATAR_MODE === "video"
      ? import("./DigitalHumanVideo")
      : AVATAR_MODE === "image"
        ? import("./DigitalHumanImage")
        : import("./DigitalHuman"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(160deg,#1b2456,#0b1124)]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-[#2fd4c6]" />
      </div>
    ),
  },
);
import type {
  AgentEvent,
  AgentMsg,
  AppState,
  Card,
  ItinDay,
  ItinItem,
  Reference,
} from "@/lib/agent/types";
import type { DayDiff } from "@/lib/diff";

type StreamItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "card"; card: Card }
  | {
      kind: "proposal";
      days: ItinDay[];
      references?: Reference[];
      diff: { days: DayDiff[]; changedCount: number };
      summary: string;
      done?: "applied" | "discarded";
    }
  | { kind: "notice"; text: string; undo?: boolean }
  | { kind: "memory"; texts: string[] };

const STARTERS = [
  "帮我规划一个周末去成都的行程",
  "小红书上成都有什么好玩好吃的？",
  "查一下目的地这几天的天气",
  "去程有没有更早的高铁",
];

/** 在行程页时的情境化主动建议（比通用 starter 更贴当前任务） */
const TRIP_SUGGESTIONS = [
  "小红书上大家怎么玩这里？",
  "帮我生成打包清单",
  "这趟行程的预算花在哪了？",
  "第2天节奏太赶，帮我放慢",
];

function fmtNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CopilotDock({ signedIn }: { signedIn: boolean }) {
  const { getController } = useCopilot();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // 「改动前先预览」偏好（RQ1 控制权变量）：开启后 AI 的每次改动都先给预览卡再由用户确认
  const [alwaysPreview, setAlwaysPreview] = useState(false);
  // 数字人（头像 + 语音 + 表情）开关与静音。默认开启：让小行以数字人形象出现。
  const [avatarOn, setAvatarOn] = useState(true);
  const [avatarMuted, setAvatarMuted] = useState(false);
  // 输入模式：语音优先（说完自动发送），可切键盘；浏览器不支持 Web Speech 时自动回落键盘
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  // 视图：对话 / 记忆管理（「小行记得你」——AI 记了什么，可见可控）
  const [view, setView] = useState<"chat" | "memory">("chat");
  // 数字人是否正在说话（面板舞台上显示声浪指示）
  const [speaking, setSpeaking] = useState(false);
  const dhRef = useRef<DigitalHumanHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seededTrip = useRef<string | null>(null);

  // 从 localStorage 恢复偏好（订阅外部存储，effect 内一次性 setState，无级联）
  useEffect(() => {
    try {
      setAlwaysPreview(localStorage.getItem("hci_always_preview") === "1");
      // 数字人默认开启：仅当显式选过「智能体图标」才用罗盘。
      // 注意：键名从 hci_digital_human 换成 hci_avatar_style——旧键的历史 "0"
      // 会让气泡常驻指南针（产品已改为数字人优先，旧值一律作废）。
      setAvatarOn(localStorage.getItem("hci_avatar_style") !== "agent");
      setAvatarMuted(localStorage.getItem("hci_avatar_muted") === "1");
      if (localStorage.getItem("hci_input_mode") === "text") setInputMode("text");
    } catch {
      /* 无存储：用默认值 */
    }
  }, []);

  /** 让数字人切换表情（仅在开启时） */
  function setEmotion(e: Emotion) {
    if (avatarOn) dhRef.current?.setEmotion(e);
  }

  // 语音输入（多模态）：语音模式下说完自动发送（对话感）；键盘模式下追加到输入框可再编辑
  const voice = useVoiceDictation((t) => {
    logEvent(
      "voice_input",
      { len: t.length, mode: inputMode },
      getController()?.getTripId() ?? null,
    );
    if (inputMode === "voice") {
      send(t, { voice: true });
    } else {
      setText((prev) => (prev ? prev.trimEnd() + " " : "") + t);
    }
  });

  /** 切换 语音/键盘 输入模式并持久化 */
  function switchInputMode(m: "voice" | "text") {
    setInputMode(m);
    try {
      localStorage.setItem("hci_input_mode", m);
    } catch {
      /* 忽略 */
    }
    logEvent("input_mode", { mode: m }, getController()?.getTripId() ?? null);
  }

  function toggleAlwaysPreview() {
    setAlwaysPreview((v) => {
      const next = !v;
      try {
        localStorage.setItem("hci_always_preview", next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      logEvent(
        "pref_always_preview",
        { on: next },
        getController()?.getTripId() ?? null,
      );
      return next;
    });
  }

  function toggleAvatar() {
    setAvatarOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("hci_avatar_style", next ? "human" : "agent");
      } catch {
        /* 忽略 */
      }
      if (!next) dhRef.current?.stop();
      logEvent("avatar_toggle", { on: next }, getController()?.getTripId() ?? null);
      return next;
    });
  }

  function toggleAvatarMute() {
    setAvatarMuted((v) => {
      const next = !v;
      try {
        localStorage.setItem("hci_avatar_muted", next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      if (next) dhRef.current?.stop();
      logEvent("avatar_mute", { muted: next }, getController()?.getTripId() ?? null);
      return next;
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, open]);

  // 打开时若在某个行程且尚未载入历史 → 从 itineraries.chat 回填（记忆）
  useEffect(() => {
    if (!open) return;
    const c = getController();
    const tripId = c?.getTripId() ?? null;
    if (!tripId || seededTrip.current === tripId || items.length) return;
    seededTrip.current = tripId;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}`);
        const data = await res.json();
        if (Array.isArray(data.chat) && data.chat.length) {
          setItems(
            (data.chat as AgentMsg[]).map((m) => ({ kind: m.role, text: m.content })),
          );
        }
      } catch {
        /* 忽略 */
      }
    })();
  }, [open, getController, items.length]);

  function buildAppState(): AppState {
    const c = getController();
    const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
    const now = fmtNow();
    if (c) {
      return {
        pathname,
        tripId: c.getTripId(),
        meta: c.getMeta(),
        itinerary: { title: c.getTitle(), days: c.getDays() },
        now,
        alwaysPreview,
      };
    }
    return { pathname, tripId: null, meta: null, itinerary: null, now, alwaysPreview };
  }

  function handleEvent(e: AgentEvent) {
    switch (e.type) {
      case "memory":
        setItems((s) => [...s, { kind: "memory", texts: e.texts }]);
        break;
      case "text":
        setItems((s) => [...s, { kind: "assistant", text: e.delta }]);
        if (avatarOn && e.delta.trim()) {
          // 朗读前剥掉 Markdown 记号，数字人不该念出「星号星号」
          dhRef.current?.speak(stripMarkdown(e.delta));
          logEvent(
            "avatar_speak",
            { len: e.delta.length, muted: avatarMuted },
            getController()?.getTripId() ?? null,
          );
        }
        break;
      case "tool_call":
        setItems((s) => [...s, { kind: "tool", label: e.label }]);
        setEmotion("thinking");
        break;
      case "tool_result":
        if (e.card) setItems((s) => [...s, { kind: "card", card: e.card! }]);
        break;
      case "proposal":
        setItems((s) => [
          ...s,
          {
            kind: "proposal",
            days: e.days,
            references: e.references,
            diff: e.diff,
            summary: e.summary,
          },
        ]);
        break;
      case "action":
        if (e.kind === "apply_patch") {
          getController()?.applyDays(e.days, e.references);
          setItems((s) => [...s, { kind: "notice", text: e.summary + " · 已应用", undo: true }]);
          setEmotion("happy");
        } else if (e.kind === "navigate") {
          setItems((s) => [...s, { kind: "notice", text: "正在打开新行程…" }]);
          setEmotion("happy");
          router.push(`/trips/${e.tripId}`);
        }
        break;
      case "error":
        setItems((s) => [...s, { kind: "notice", text: "出错了：" + e.message }]);
        setEmotion("concerned");
        break;
      case "done":
        break;
    }
  }

  async function send(preset?: string, opts?: { voice?: boolean }) {
    const content = (preset ?? text).trim();
    if (!content || busy) return;
    const history: AgentMsg[] = items
      .filter((it): it is { kind: "user" | "assistant"; text: string } =>
        it.kind === "user" || it.kind === "assistant",
      )
      .map((it) => ({ role: it.kind, content: it.text }));
    const outgoing: AgentMsg[] = [...history, { role: "user", content }];

    setItems((s) => [...s, { kind: "user", text: content }]);
    setText("");
    setBusy(true);
    setEmotion("thinking");
    logEvent(
      "chat_send",
      {
        via: "copilot",
        len: content.length,
        preset: preset != null && !opts?.voice,
        voice: !!opts?.voice,
      },
      getController()?.getTripId() ?? null,
    );
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing, appState: buildAppState() }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || "请求失败");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
          } catch {
            /* 跳过坏帧 */
          }
        }
      }
    } catch (e) {
      setItems((s) => [
        ...s,
        { kind: "notice", text: "出错了：" + (e instanceof Error ? e.message : String(e)) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function applyProposal(idx: number) {
    setItems((s) => {
      const it = s[idx];
      if (it?.kind !== "proposal") return s;
      getController()?.applyDays(it.days, it.references);
      logEvent(
        "diff_apply",
        { via: "copilot", changedDays: it.diff.changedCount },
        getController()?.getTripId() ?? null,
      );
      const next = [...s];
      next[idx] = { ...it, done: "applied" };
      return next;
    });
  }
  function discardProposal(idx: number) {
    setItems((s) => {
      const it = s[idx];
      if (it?.kind !== "proposal") return s;
      logEvent(
        "diff_discard",
        { via: "copilot", changedDays: it.diff.changedCount },
        getController()?.getTripId() ?? null,
      );
      const next = [...s];
      next[idx] = { ...it, done: "discarded" };
      return next;
    });
  }
  function addItemToTrip(item: ItinItem, note: string) {
    const c = getController();
    if (!c) {
      setItems((s) => [...s, { kind: "notice", text: "请在某个行程页里再加入哦" }]);
      return;
    }
    const days = c.getDays();
    if (!days.length) return;
    const next = days.map((d, i) =>
      i === 0 ? { ...d, items: [...d.items, item] } : d,
    );
    c.applyDays(next);
    setItems((s) => [...s, { kind: "notice", text: note + "（第1天，可拖拽调整）", undo: true }]);
  }

  return (
    <>
      {/* 收起态：气泡（默认数字人头像，可切换为智能体图标样式） */}
      <AnimatePresence>
        {!open && (
          <motion.div
            key="bubble"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 400, damping: 26 }}
            className="no-print fixed bottom-5 right-5 z-50"
          >
            <button
              onClick={() => setOpen(true)}
              className="block h-16 w-16 cursor-pointer rounded-full p-[2.5px] shadow-[0_10px_28px_-6px_rgba(11,17,36,0.55),0_0_18px_-2px_rgba(47,212,198,0.4)] transition-transform hover:scale-105"
              style={{
                background:
                  "conic-gradient(from 210deg, #2fd4c6, #7c6bff 40%, #2fd4c6 72%, #ffb45e 88%, #2fd4c6)",
              }}
              title="打开旅行智能体 · 小行"
              aria-label="打开旅行智能体 小行"
            >
              {avatarOn ? (
                // 数字人头像（画布不接管点击，交给按钮打开面板）
                <span className="pointer-events-none block h-full w-full overflow-hidden rounded-full ring-1 ring-white/25">
                  <DigitalHuman apiRef={dhRef} muted variant="bubble" />
                </span>
              ) : (
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(160deg,#1b2456,#0b1124)] text-[#7ee8dd] ring-1 ring-white/25">
                  <Compass className="h-7 w-7" aria-hidden />
                </span>
              )}
            </button>
            {/* 形象切换：数字人 ⇄ 智能体图标（不打开面板） */}
            <button
              onClick={toggleAvatar}
              className="absolute -left-1.5 -top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-[#0b1124]/85 text-[#7ee8dd] shadow-md backdrop-blur transition hover:scale-110 hover:text-white"
              title={avatarOn ? "切换为智能体图标" : "切换为数字人形象"}
              aria-label={avatarOn ? "切换为智能体图标" : "切换为数字人形象"}
            >
              {avatarOn ? (
                <Compass className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 展开态：面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="no-print fixed bottom-5 right-5 z-50 flex h-[640px] max-h-[86vh] w-[420px] max-w-[92vw] origin-bottom-right flex-col overflow-hidden rounded-card border border-line bg-surface shadow-lift"
          >
            {/* 头：暮色渐变 */}
            <div
              className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-white"
              style={{
                background:
                  "radial-gradient(24rem 10rem at 0% 0%, color-mix(in srgb, var(--aurora-teal) 26%, transparent), transparent 70%), linear-gradient(135deg, var(--night-2), var(--night-1))",
              }}
            >
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5" aria-hidden />
                <div className="leading-tight">
                  <div className="font-display text-sm font-semibold">
                    小行 · 旅行智能体
                  </div>
                  <div className="text-[10px] text-teal-tint">
                    能规划 · 能改行程 · 能搜真实车次航班
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setView((v) => {
                      const next = v === "memory" ? "chat" : "memory";
                      if (next === "memory")
                        logEvent("memory_view", {}, getController()?.getTripId() ?? null);
                      return next;
                    });
                  }}
                  className={`rounded p-1 transition cursor-pointer ${
                    view === "memory"
                      ? "bg-white/20 text-white"
                      : "text-teal-tint hover:bg-white/10"
                  }`}
                  title="小行记得你（记忆管理）"
                  aria-label="记忆管理"
                  aria-pressed={view === "memory"}
                >
                  <Brain className="h-4 w-4" aria-hidden />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-teal-tint transition hover:bg-white/10 cursor-pointer"
                  title="收起"
                  aria-label="收起小行"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            {/* 控制条：改动前先预览（RQ1 控制权） */}
            <label className="flex cursor-pointer items-center justify-between border-b border-line bg-surface-2/60 px-4 py-1.5 text-[11px] text-muted">
              <span title="开启后，AI 的每次改动都会先给你预览卡，确认后才应用（更有掌控感）；关闭时小改动会直接生效、可撤销（更省事）。">
                改动前先让我确认
              </span>
              <Switch checked={alwaysPreview} onToggle={toggleAlwaysPreview} />
            </label>

            {/* 控制条：数字人形象（3D 头像 + 语音 + 表情） */}
            <div className="flex items-center justify-between border-b border-line bg-surface-2/60 px-4 py-1.5 text-[11px] text-muted">
              <span title="开启后小行以数字人形象出现：会朗读回复、说话时有口型与表情；右下角气泡也会显示数字人头像">
                数字人形象
              </span>
              <div className="flex items-center gap-2">
                {avatarOn && (
                  <button
                    type="button"
                    onClick={toggleAvatarMute}
                    aria-label={avatarMuted ? "取消静音" : "静音"}
                    title={avatarMuted ? "取消静音（发声）" : "静音（只动不发声）"}
                    className="rounded px-1 text-muted transition hover:text-teal cursor-pointer"
                  >
                    {avatarMuted ? (
                      <VolumeX className="h-4 w-4" aria-hidden />
                    ) : (
                      <Volume2 className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                )}
                <Switch checked={avatarOn} onToggle={toggleAvatar} />
              </div>
            </div>

            {/* 数字人舞台（夜空极光场景） */}
            {avatarOn && (
              <div className="relative h-[320px] shrink-0 overflow-hidden border-b border-line bg-[#0b1124]">
                <DigitalHuman
                  apiRef={dhRef}
                  muted={avatarMuted}
                  onSpeakingChange={setSpeaking}
                />
                {speaking && (
                  <div
                    className="absolute bottom-2 right-2 flex h-6 items-end gap-[3px] rounded-full bg-[#0b1124]/60 px-2.5 pb-1.5 backdrop-blur"
                    aria-label="小行正在说话"
                  >
                    <span className="dh-eqbar" style={{ animationDelay: "0ms" }} />
                    <span className="dh-eqbar" style={{ animationDelay: "150ms" }} />
                    <span className="dh-eqbar" style={{ animationDelay: "300ms" }} />
                    <span className="dh-eqbar" style={{ animationDelay: "450ms" }} />
                  </div>
                )}
              </div>
            )}

            {/* 记忆管理视图 */}
            {view === "memory" && <MemoryPanel tripId={getController()?.getTripId() ?? null} />}

            {/* 消息流 */}
            <div
              ref={scrollRef}
              className={`flex-1 space-y-2 overflow-y-auto p-3 ${view === "memory" ? "hidden" : ""}`}
            >
              {items.length === 0 && (
                <div className="mt-2">
                  <p className="text-sm text-muted">
                    你好，我是小行 👋 告诉我你想去哪、想怎么玩，我可以帮你从零规划、调整行程、搜车票航班、查天气。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(getController() ? TRIP_SUGGESTIONS : STARTERS).map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" aria-hidden />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {items.map((it, i) => {
                if (it.kind === "memory")
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted"
                    >
                      <Brain className="h-3 w-3 shrink-0 text-teal-dark" aria-hidden />
                      <span>参考了你的偏好：</span>
                      {it.texts.slice(0, 3).map((t, j) => (
                        <span
                          key={j}
                          className="rounded-full bg-teal-tint px-2 py-0.5 text-teal-dark"
                        >
                          {t.length > 18 ? t.slice(0, 18) + "…" : t}
                        </span>
                      ))}
                      <button
                        onClick={() => {
                          setView("memory");
                          logEvent("memory_view", { via: "chip" }, getController()?.getTripId() ?? null);
                        }}
                        className="text-teal-dark hover:underline cursor-pointer"
                      >
                        管理
                      </button>
                    </div>
                  );
                if (it.kind === "user")
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-teal px-3 py-1.5 text-sm text-white">
                        {it.text}
                      </div>
                    </div>
                  );
                if (it.kind === "assistant")
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink/80">
                        <Markdown text={it.text} />
                      </div>
                    </div>
                  );
                if (it.kind === "tool")
                  return (
                    <div key={i} className="flex items-center gap-2 px-1 text-xs text-muted/80">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      {it.label}
                    </div>
                  );
                if (it.kind === "card")
                  return (
                    <div key={i}>
                      <CardView card={it.card} onAddItem={addItemToTrip} />
                    </div>
                  );
                if (it.kind === "notice")
                  return (
                    <div key={i} className="flex items-center gap-2 px-1 text-[11px] text-muted">
                      <Check className="h-3 w-3 text-teal" aria-hidden />
                      <span>{it.text}</span>
                      {it.undo && (
                        <button
                          onClick={() => getController()?.undo()}
                          className="text-teal-dark hover:underline cursor-pointer"
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  );
                // proposal：未裁决时用统一 ProposalCard；已裁决时折叠为状态行
                if (it.done) {
                  return (
                    <div key={i} className="px-1 text-[11px] text-muted">
                      {it.done === "applied" ? (
                        <span className="text-teal-dark">
                          建议改动（{it.diff.changedCount} 天）已应用 ✓
                        </span>
                      ) : (
                        <span>建议改动（{it.diff.changedCount} 天）已放弃</span>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={i}>
                    <ProposalCard
                      diff={it.diff}
                      summary={it.summary}
                      onApply={() => applyProposal(i)}
                      onDiscard={() => discardProposal(i)}
                    />
                  </div>
                );
              })}

              {busy && (
                <div className="flex items-center gap-2 px-1 text-xs text-muted/80">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
                  小行思考中…
                </div>
              )}
            </div>

            {/* 输入 */}
            <div className="border-t border-line p-2.5">
              {!signedIn ? (
                <p className="px-1 py-2 text-center text-xs text-muted">
                  登录后即可使用小行 ·{" "}
                  <a href="/login" className="text-teal-dark hover:underline">
                    去登录
                  </a>
                </p>
              ) : voice.supported && inputMode === "voice" ? (
                // 语音模式（默认）：点击说话，说完自动发送；可切键盘
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => switchInputMode("text")}
                    title="切换为键盘输入"
                    aria-label="切换为键盘输入"
                    className="rounded-xl border border-line p-2.5 text-muted transition hover:border-teal hover:text-teal-dark cursor-pointer"
                  >
                    <Keyboard className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={voice.toggle}
                    disabled={busy}
                    aria-pressed={voice.listening}
                    aria-label={voice.listening ? "停止聆听" : "开始说话"}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition disabled:opacity-50 cursor-pointer ${
                      voice.listening
                        ? "bg-seal-tint text-seal ring-2 ring-seal/30"
                        : "bg-teal text-white hover:bg-teal-dark"
                    }`}
                  >
                    <Mic
                      className={`h-4 w-4 shrink-0 ${voice.listening ? "animate-pulse" : ""}`}
                      aria-hidden
                    />
                    <span className="truncate">
                      {voice.listening
                        ? "正在聆听…说完自动发送"
                        : busy
                          ? "小行思考中…"
                          : "点击说话"}
                    </span>
                  </button>
                </div>
              ) : (
                // 键盘模式（或浏览器不支持语音识别时的回落）
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                    }}
                    placeholder={busy ? "小行思考中…" : "和小行说说你的想法…（⌘/Ctrl+Enter）"}
                    rows={2}
                    disabled={busy}
                    className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-surface-2"
                  />
                  {voice.supported && (
                    <button
                      type="button"
                      onClick={() => switchInputMode("voice")}
                      title="切换为语音输入"
                      aria-label="切换为语音输入"
                      className="rounded-lg border border-line px-2.5 py-2 text-muted transition hover:border-teal hover:text-teal-dark cursor-pointer"
                    >
                      <Mic className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                  <button
                    onClick={() => send()}
                    disabled={busy || !text.trim()}
                    aria-label="发送消息"
                    className="rounded-lg bg-teal p-2.5 text-white transition hover:bg-teal-dark disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** 「小行记得你」：列出长期记忆，可删除/停用（HCI 透明性与控制权） */
function MemoryPanel({ tripId }: { tripId: string | null }) {
  interface Mem {
    id: string;
    kind: string;
    subject: string | null;
    text: string;
    source: string;
    use_count: number;
  }
  const [mems, setMems] = useState<Mem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/memories");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载失败");
        if (alive) setMems(data.memories as Mem[]);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function remove(id: string) {
    setMems((m) => (m ? m.filter((x) => x.id !== id) : m));
    logEvent("memory_delete", { id }, tripId);
    try {
      await fetch("/api/memories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* 乐观删除；失败下次打开会重新出现 */
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <p className="text-xs leading-relaxed text-muted">
        这些是小行从你的输入里学到的长期偏好（跨行程生效，用于个性化规划）。
        删掉的不再被参考。
      </p>
      {err && <p className="mt-2 text-xs text-seal">{err}</p>}
      {mems === null && !err && (
        <p className="mt-3 text-xs text-muted/70">加载中…</p>
      )}
      {mems && mems.length === 0 && (
        <p className="mt-4 text-center text-xs text-muted">
          还没有记忆——多和小行聊聊你的偏好吧。
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {(mems ?? []).map((m) => (
          <li
            key={m.id}
            className="group flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
          >
            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-dark" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-ink/85">{m.text}</p>
              <p className="mt-0.5 text-[10px] text-muted/70">
                {m.kind === "semantic" ? "偏好" : "情景"}
                {m.subject ? ` · ${m.subject}` : ""} · 被参考 {m.use_count} 次
              </p>
            </div>
            <button
              onClick={() => remove(m.id)}
              title="删除这条记忆"
              aria-label={`删除记忆：${m.text}`}
              className="rounded p-1 text-muted/50 transition hover:text-seal cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 迷你开关（Dock 控制条用） */
function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`relative h-4 w-7 rounded-full transition cursor-pointer ${
        checked ? "bg-teal" : "bg-line-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
          checked ? "left-3.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

// ── 语音输入（Web Speech API）最小类型 + hook ──
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechRecCtor = new () => SpeechRec;

function getSpeechCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 语音听写：中文识别，一次一句；把最终文本回调给调用方。浏览器不支持时 supported=false。 */
function useVoiceDictation(onText: (t: string) => void) {
  const [supported] = useState(() => getSpeechCtor() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  // 识别是异步返回的：经 ref 转发到「最新一次渲染」的回调，避免读到过期的模式/对话状态
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript ?? "";
      if (t) onTextRef.current(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return { supported, listening, toggle };
}
