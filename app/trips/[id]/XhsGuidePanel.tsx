"use client";

/**
 * 「灵感 · 网友攻略」面板（Phase 2）：目的地驱动，自动聚合小红书等社区攻略并提炼，
 * 展示玩法/美食/贴士/避坑，可把任一条一键加入指定某天。
 *
 * 与 Copilot Dock 里的紧凑攻略卡不同：这里是行程页的全宽面板，带「加入第 N 天」的日选择器。
 * 结果缓存在 agent_outputs（每个行程只算一次）；首次展开自动生成，之后秒开。
 * 诚实标注：Tavily 对小红书索引有限，聚合里常含其他网友攻略站——真·小红书源加 📕 徽标并如实计数。
 */

import { useEffect, useRef, useState } from "react";
import { Panel } from "@/app/ui/collapse";
import { Lightbulb, RefreshCw, ArrowUpRight } from "@/app/ui/icons";
import { formatCny } from "@/lib/budget";
import { logEvent } from "@/lib/log";
import { toast } from "@/app/ui/toast";
import type { XhsGuide, XhsSpot } from "@/lib/xhs/types";
import type { ItinItem } from "@/lib/agent/types";

const FOCUS_CHIPS = ["综合", "美食", "citywalk", "亲子", "小众", "夜生活"];
const isXhs = (url: string) => /xiaohongshu\.com|xhslink\.com/i.test(url);

export function XhsGuidePanel({
  id,
  destination,
  days,
  onAdd,
  onGuide,
}: {
  id: string;
  destination: string | null;
  days: { day: number }[];
  onAdd: (dayIndex: number, item: ItinItem) => void;
  /** 攻略加载/更新时上抛给页面（供地图落点建议层） */
  onGuide?: (g: XhsGuide | null) => void;
}) {
  const [guide, setGuide] = useState<XhsGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [targetDay, setTargetDay] = useState(0);
  const fetched = useRef(false);

  // 攻略变化时上抛给页面（地图建议层用）；ref 转发避免因回调身份变化重复触发
  const onGuideRef = useRef(onGuide);
  useEffect(() => {
    onGuideRef.current = onGuide;
  });
  useEffect(() => {
    onGuideRef.current?.(guide);
  }, [guide]);

  // 首次展开：先读缓存，没有就自动生成一次（"输入目的地后自动搜索"）
  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/xhs`);
        const data = await res.json();
        if (res.ok && data.guide) {
          setGuide(data.guide as XhsGuide);
        } else {
          await run(""); // 无缓存 → 自动生成
        }
      } catch {
        setErr("加载失败，可以点「重翻」再试一次。");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  async function run(focus: string, force = false) {
    if (loading) return;
    setLoading(true);
    setErr(null);
    logEvent("xhs_research", { via: "panel", focus, force }, id);
    try {
      const res = await fetch(`/api/trips/${id}/xhs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      if (data.error) {
        setErr(data.error);
        setGuide(null);
      } else {
        setGuide(data.guide as XhsGuide);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function addSpot(s: XhsSpot, kind: "activity" | "food") {
    const dayNo = days[targetDay]?.day ?? 1;
    onAdd(targetDay, {
      time: "",
      title: s.title,
      kind,
      detail: [s.area, s.tips].filter(Boolean).join(" · "),
      est_cost: s.est_cost || 0,
      ...(s.reason ? { why: s.reason } : {}),
      ...(s.source_url ? { source_url: s.source_url } : {}),
    });
    toast(`已加入第 ${dayNo} 天：${s.title}`);
    logEvent("xhs_add", { via: "panel", kind }, id);
  }

  const xhsN = guide?.sources.filter((s) => isXhs(s.url)).length ?? 0;

  return (
    <Panel
      className="no-print mt-6"
      icon={Lightbulb}
      title="网友攻略"
      meta={
        <span className="text-xs font-normal text-muted">
          {guide
            ? `${guide.spots.length} 个玩法 · ${guide.eats.length} 个美食`
            : `汇总小红书等网友的攻略，帮你了解${destination ?? "目的地"}怎么玩`}
        </span>
      }
      open={open}
      onToggle={setOpen}
    >
      {/* 顶部：聚焦 chips（点一下换角度重翻） */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted">换个角度：</span>
        {FOCUS_CHIPS.map((f) => (
          <button
            key={f}
            disabled={loading}
            onClick={() => run(f === "综合" ? "" : f, true)}
            className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark disabled:opacity-50 cursor-pointer"
          >
            {f}
          </button>
        ))}
        {guide && (
          <button
            disabled={loading}
            onClick={() => run(guide.focus === "综合" ? "" : guide.focus, true)}
            title="重新翻一遍"
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
            重翻
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal" />
          正在看{destination ?? "目的地"}的网友攻略，综合多篇整理中…
        </div>
      )}

      {err && !loading && (
        <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-sm text-muted">
          {err}
        </div>
      )}

      {guide && !loading && (
        <div className="space-y-4">
          {/* 概况 chips */}
          {(guide.best_time || guide.suggested_days > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {guide.best_time && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
                  🗓 {guide.best_time}
                </span>
              )}
              {guide.suggested_days > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
                  建议 {guide.suggested_days} 天
                </span>
              )}
            </div>
          )}

          {/* 加入到哪天 */}
          {days.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>点「加入」放到：</span>
              <select
                value={targetDay}
                onChange={(e) => setTargetDay(Number(e.target.value))}
                className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-teal"
              >
                {days.map((d, i) => (
                  <option key={i} value={i}>
                    第 {d.day} 天
                  </option>
                ))}
              </select>
            </div>
          )}

          {guide.spots.length > 0 && (
            <SpotGrid title="景点玩法" items={guide.spots} kind="activity" onAdd={addSpot} />
          )}
          {guide.eats.length > 0 && (
            <SpotGrid title="美食" items={guide.eats} kind="food" onAdd={addSpot} />
          )}

          {guide.tips.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">实用贴士</div>
              <ul className="space-y-1">
                {guide.tips.map((t, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-ink/80">
                    <span className="shrink-0 text-teal">·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {guide.warnings.length > 0 && (
            <div className="rounded-lg bg-seal-tint/50 p-3">
              <div className="mb-1 text-xs font-medium text-seal">避坑提醒</div>
              {guide.warnings.map((w, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-seal/90">
                  <span className="shrink-0">⚠</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {guide.sources.length > 0 && (
            <div className="border-t border-line pt-2.5">
              <div className="mb-1.5 text-[11px] text-muted/80">
                参考 {guide.sources.length} 篇网友攻略
                {xhsN > 0 ? `（含 ${xhsN} 篇小红书 📕）` : "（这次小红书原帖较少，用其他网友攻略补充了）"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {guide.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={s.title}
                    onClick={() => logEvent("source_open", { via: "xhs", xhs: isXhs(s.url) }, id)}
                    className="inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded border border-line px-2 py-1 text-[11px] text-teal-dark transition hover:border-teal"
                  >
                    {isXhs(s.url) && <span aria-hidden>📕</span>}
                    <span className="truncate">{s.title || s.url}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** 一组玩法/美食卡片（可加入指定天） */
function SpotGrid({
  title,
  items,
  kind,
  onAdd,
}: {
  title: string;
  items: XhsSpot[];
  kind: "activity" | "food";
  onAdd: (s: XhsSpot, kind: "activity" | "food") => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{title}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((s, i) => (
          <div
            key={i}
            className="group rounded-lg border border-line bg-surface p-2.5 text-xs transition hover:border-teal hover:shadow-soft"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-medium text-ink">
                {s.title}
                {s.area && (
                  <span className="ml-1 text-[10px] font-normal text-muted/70">{s.area}</span>
                )}
              </span>
              <button
                onClick={() => onAdd(s, kind)}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted transition hover:border-teal hover:text-teal-dark cursor-pointer"
              >
                + 加入
              </button>
            </div>
            {s.reason && <p className="mt-1 text-muted">{s.reason}</p>}
            {s.tips && <p className="mt-1 text-[11px] text-muted/70">💡 {s.tips}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted/80">
              {s.est_cost > 0 && (
                <span className="font-data">约 {formatCny(s.est_cost)}</span>
              )}
              {s.source_url && (
                <a
                  href={s.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-teal-dark hover:underline"
                >
                  {isXhs(s.source_url) ? "📕 小红书" : "来源"}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
