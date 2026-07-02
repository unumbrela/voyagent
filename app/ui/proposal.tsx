"use client";

import type { DayDiff } from "@/lib/diff";
import { Check, X } from "./icons";
import { Button } from "./button";

/**
 * 改动预览卡（propose → review → commit/undo 协议的统一 UI）：
 * 按天列出 新增/删除/修改，供用户「应用 / 放弃」。
 * 行程页 ChatPanel/PreferencePanel 与全站 CopilotDock 共用这一份。
 */
export function ProposalCard({
  diff,
  summary,
  onApply,
  onDiscard,
  applyLabel = "应用",
}: {
  diff: { days: DayDiff[]; changedCount: number };
  summary: string;
  onApply: () => void;
  onDiscard: () => void;
  applyLabel?: string;
}) {
  const changed = diff.days.filter((d) => d.status !== "same");
  return (
    <div className="mt-3 rounded-card border border-teal/40 bg-teal-tint/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold text-teal-dark">
          建议改动（{diff.changedCount} 天）
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onApply}>
            <Check className="h-3 w-3" aria-hidden />
            {applyLabel}
          </Button>
          <Button size="sm" variant="secondary" onClick={onDiscard}>
            <X className="h-3 w-3" aria-hidden />
            放弃
          </Button>
        </div>
      </div>
      {summary && <p className="mt-1.5 text-xs text-muted">{summary}</p>}
      {changed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {changed.map((d) => (
            <li key={d.day} className="text-muted">
              <span className="font-data font-semibold text-ink">
                第 {d.day} 天
              </span>
              {d.status === "added" && (
                <span className="text-teal-dark">（新增当天）</span>
              )}
              {d.status === "removed" && (
                <span className="text-seal">（删除当天）</span>
              )}
              {d.added.map((t) => (
                <span key={`a-${t}`} className="ml-1 text-teal-dark">
                  +{t}
                </span>
              ))}
              {d.removed.map((t) => (
                <span key={`r-${t}`} className="ml-1 text-seal line-through">
                  {t}
                </span>
              ))}
              {d.changed.map((t) => (
                <span key={`c-${t}`} className="ml-1 text-amber-600">
                  ~{t}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
