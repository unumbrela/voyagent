"use client";

/**
 * Copilot 的生成式 UI 卡片：把工具结果渲染成真实交互组件（而非纯文字）。
 * 车次/航班可点选「加入行程」，天气/候选做展示/加入。
 */

import { wmoMeta } from "@/lib/weather";
import { formatCny, KIND_META } from "@/lib/budget";
import type { Card } from "@/lib/agent/types";
import type { ItinItem } from "@/lib/agent/types";

/** 从 "¥520 起 / 520-680" 取首个数字 */
function priceNum(s: string): number {
  const m = (s || "").match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : 0;
}

export function CardView({
  card,
  onAddItem,
}: {
  card: Card;
  onAddItem: (item: ItinItem, note: string) => void;
}) {
  if (card.kind === "trains" || card.kind === "flights") {
    const items = card.items;
    const noun = card.kind === "trains" ? "车次" : "航班";
    return (
      <div className="rounded-lg border border-line bg-surface p-2">
        <div className="mb-1 text-[11px] text-muted">
          {card.from} → {card.to}
          {card.date ? ` · ${card.date}` : ""} · {items.length} {noun}
        </div>
        {items.length === 0 && (
          <div className="text-xs text-muted/70">
            未搜到（可能未配置搜索或无直达）
          </div>
        )}
        <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {items.map((t, i) => (
            <li key={i}>
              <button
                onClick={() =>
                  onAddItem(
                    {
                      time: "",
                      title: t.name + ("airline" in t && t.airline ? ` ${t.airline}` : ""),
                      kind: "transit",
                      detail: `${t.depart} → ${t.arrive} · ${t.duration} · ${t.price_cny}`,
                      est_cost: priceNum(t.price_cny),
                      ...(t.booking_url ? { booking_url: t.booking_url } : {}),
                    },
                    `已加入交通：${t.name}`,
                  )
                }
                className="w-full rounded border border-line px-2 py-1 text-left text-[11px] hover:border-teal"
              >
                <span className="font-data font-semibold text-ink">{t.name}</span>{" "}
                <span className="text-ink/70">
                  {t.depart} → {t.arrive}
                </span>{" "}
                <span className="text-muted/70">
                  {t.duration} · {t.price_cny}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (card.kind === "weather") {
    const days = Object.entries(card.daily);
    return (
      <div className="rounded-lg border border-line bg-surface p-2">
        <div className="mb-1 text-[11px] text-muted">{card.dest} 天气</div>
        {days.length === 0 ? (
          <div className="text-xs text-muted/70">该日期无预报（超 16 天）</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {days.map(([d, w]) => {
              const m = wmoMeta(w.code);
              return (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700"
                  title={`${m.label} · 降水 ${w.pop}%`}
                >
                  {m.emoji} {d.slice(5)} {w.tmin}°/{w.tmax}°
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // candidates
  return (
    <div className="rounded-lg border border-line bg-surface p-2">
      <div className="mb-1 text-[11px] text-muted">
        候选 {card.items.length} 个
      </div>
      <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto pr-1">
        {card.items.map((c) => (
          <button
            key={c.id}
            onClick={() =>
              onAddItem(
                {
                  time: "",
                  title: c.title,
                  kind: c.kind,
                  detail: c.detail,
                  est_cost: c.est_cost || 0,
                  ...(c.booking_url ? { booking_url: c.booking_url } : {}),
                },
                `已加入：${c.title}`,
              )
            }
            className="rounded border border-line px-2 py-1 text-left text-[11px] hover:border-teal"
          >
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{
                backgroundColor:
                  (KIND_META as Record<string, { color: string }>)[c.kind]
                    ?.color ?? KIND_META.other.color,
              }}
            />
            <span className="font-medium">{c.title}</span>
            {c.est_cost > 0 && (
              <span className="text-muted/70"> · {formatCny(c.est_cost)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
