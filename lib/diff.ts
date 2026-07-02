/**
 * 行程改动对比（纯函数，无副作用）。
 *
 * 对话式助手提出改动方案后，前端在「应用」前先给用户看一眼动了哪些天/条目。
 * 条目无稳定 id，这里按 title 在同一天内做启发式匹配：
 *   - proposed 有、current 无 → 新增
 *   - current 有、proposed 无 → 删除
 *   - 两边都有但内容（time/detail/kind/est_cost）不同 → 修改
 * 只为预览高亮服务，不追求精确 diff。
 */

interface ItemLike {
  time?: string;
  title?: string;
  kind?: string;
  detail?: string;
  est_cost?: number;
}
interface DayLike {
  day: number;
  theme?: string;
  items?: ItemLike[];
}

export interface DayDiff {
  day: number;
  theme?: string;
  status: "same" | "changed" | "added" | "removed";
  added: string[];
  removed: string[];
  changed: string[];
}

export interface ItineraryDiff {
  days: DayDiff[];
  /** 有变化的天数 */
  changedCount: number;
}

const fingerprint = (it: ItemLike): string =>
  [it.time ?? "", it.kind ?? "", it.detail ?? "", it.est_cost ?? 0].join("|");

const byTitle = (items: ItemLike[] = []): Map<string, ItemLike> => {
  const m = new Map<string, ItemLike>();
  for (const it of items) {
    const t = (it.title ?? "").trim();
    if (t && !m.has(t)) m.set(t, it);
  }
  return m;
};

export function diffItinerary(
  current: DayLike[],
  proposed: DayLike[],
): ItineraryDiff {
  const curByDay = new Map<number, DayLike>();
  for (const d of current ?? []) curByDay.set(d.day, d);
  const propByDay = new Map<number, DayLike>();
  for (const d of proposed ?? []) propByDay.set(d.day, d);

  const dayNums = Array.from(
    new Set([...curByDay.keys(), ...propByDay.keys()]),
  ).sort((a, b) => a - b);

  const days: DayDiff[] = [];
  for (const day of dayNums) {
    const cur = curByDay.get(day);
    const prop = propByDay.get(day);

    if (cur && !prop) {
      days.push({
        day,
        theme: cur.theme,
        status: "removed",
        added: [],
        removed: (cur.items ?? []).map((i) => i.title ?? "").filter(Boolean),
        changed: [],
      });
      continue;
    }
    if (!cur && prop) {
      days.push({
        day,
        theme: prop.theme,
        status: "added",
        added: (prop.items ?? []).map((i) => i.title ?? "").filter(Boolean),
        removed: [],
        changed: [],
      });
      continue;
    }
    if (!cur || !prop) continue;

    const curMap = byTitle(cur.items);
    const propMap = byTitle(prop.items);
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [title, it] of propMap) {
      if (!curMap.has(title)) added.push(title);
      else if (fingerprint(it) !== fingerprint(curMap.get(title)!))
        changed.push(title);
    }
    for (const title of curMap.keys()) {
      if (!propMap.has(title)) removed.push(title);
    }
    // 主题变化也算改动
    const themeChanged = (cur.theme ?? "") !== (prop.theme ?? "");
    const dirty =
      added.length || removed.length || changed.length || themeChanged;
    days.push({
      day,
      theme: prop.theme,
      status: dirty ? "changed" : "same",
      added,
      removed,
      changed,
    });
  }

  return {
    days,
    changedCount: days.filter((d) => d.status !== "same").length,
  };
}
