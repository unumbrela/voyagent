"use client";

/**
 * Copilot 的生成式 UI 卡片：把工具结果渲染成真实交互组件（而非纯文字）。
 * 车次/航班可点选「加入行程」，天气/候选做展示/加入。
 */

import { wmoMeta } from "@/lib/weather";
import { formatCny, KIND_META } from "@/lib/budget";
import type { Card } from "@/lib/agent/types";
import type { ItinItem } from "@/lib/agent/types";
import type { XhsSpot } from "@/lib/xhs/types";

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

  if (card.kind === "xhs_guide") {
    const g = card.guide;
    // 诚实标注：Tavily 对小红书索引有限，聚合里常混入其他网友攻略站。
    // 有真·小红书源才叫「小红书攻略」，否则如实叫「网友玩法攻略」。
    const isXhs = (url: string) => /xiaohongshu\.com|xhslink\.com/i.test(url);
    const xhsN = g.sources.filter((s) => isXhs(s.url)).length;
    return (
      <div className="rounded-lg border border-line bg-surface p-2.5 text-xs">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-seal-tint px-2 py-0.5 text-[10px] font-medium text-seal">
            🔥 {xhsN > 0 ? "小红书攻略" : "网友玩法攻略"}
          </span>
          <span className="font-display text-sm font-semibold text-ink">
            {g.destination}
          </span>
          {g.focus && g.focus !== "综合" && (
            <span className="text-[10px] text-muted/70">· {g.focus}</span>
          )}
        </div>

        {(g.best_time || g.suggested_days > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {g.best_time && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                🗓 {g.best_time}
              </span>
            )}
            {g.suggested_days > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                建议 {g.suggested_days} 天
              </span>
            )}
          </div>
        )}

        {g.spots.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] font-medium text-muted">
              玩法 · 景点（点按加入行程）
            </div>
            <XhsSpotList items={g.spots} kind="activity" onAddItem={onAddItem} />
          </div>
        )}

        {g.eats.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] font-medium text-muted">
              美食（点按加入行程）
            </div>
            <XhsSpotList items={g.eats} kind="food" onAddItem={onAddItem} />
          </div>
        )}

        {g.tips.length > 0 && (
          <ul className="mb-2 space-y-0.5">
            {g.tips.map((t, i) => (
              <li key={i} className="flex gap-1 text-[11px] text-muted">
                <span className="shrink-0 text-teal">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}

        {g.warnings.length > 0 && (
          <div className="mb-2 rounded-md bg-seal-tint/60 p-1.5">
            {g.warnings.map((w, i) => (
              <div key={i} className="flex gap-1 text-[11px] text-seal">
                <span className="shrink-0">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {g.sources.length > 0 && (
          <div className="border-t border-line pt-1.5">
            <div className="mb-1 text-[10px] text-muted/70">
              参考 {g.sources.length} 篇网友攻略
              {xhsN > 0 ? `（含 ${xhsN} 篇小红书）` : ""}：
            </div>
            <div className="flex flex-wrap gap-1">
              {g.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.title}
                  className="inline-flex max-w-[9rem] items-center gap-0.5 truncate rounded border border-line px-1.5 py-0.5 text-[10px] text-teal-dark hover:border-teal"
                >
                  {isXhs(s.url) && <span aria-hidden>📕</span>}
                  <span className="truncate">{s.title || s.url}</span>
                </a>
              ))}
            </div>
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

/** 小红书攻略卡里的一列玩法/美食，每条可点按加入行程（携带 why / source_url 证据锚定） */
function XhsSpotList({
  items,
  kind,
  onAddItem,
}: {
  items: XhsSpot[];
  kind: "activity" | "food";
  onAddItem: (item: ItinItem, note: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i}>
          <button
            onClick={() =>
              onAddItem(
                {
                  time: "",
                  title: s.title,
                  kind,
                  detail: [s.area, s.tips].filter(Boolean).join(" · "),
                  est_cost: s.est_cost || 0,
                  ...(s.reason ? { why: s.reason } : {}),
                  ...(s.source_url ? { source_url: s.source_url } : {}),
                },
                `已加入：${s.title}`,
              )
            }
            title={s.reason || "加入行程"}
            className="w-full rounded border border-line px-2 py-1 text-left transition hover:border-teal"
          >
            <div className="flex items-baseline gap-1">
              <span className="font-medium text-ink">{s.title}</span>
              {s.area && <span className="text-[10px] text-muted/70">{s.area}</span>}
              {s.est_cost > 0 && (
                <span className="ml-auto shrink-0 text-[10px] text-muted/70">
                  {formatCny(s.est_cost)}
                </span>
              )}
            </div>
            {s.reason && (
              <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">
                {s.reason}
              </div>
            )}
            {s.tips && (
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted/70">
                💡 {s.tips}
              </div>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
