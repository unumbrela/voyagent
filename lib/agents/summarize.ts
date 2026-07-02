/**
 * agent 产物 → 等待页一句话摘要（随 SSE done 事件下发，渐进呈现规划成果）。
 * 只读 schemas.ts 里已定义的字段；任何异常都吞掉返回空串——摘要是增强信息，
 * 绝不能让它拖垮编排主流程。
 */

import type { AgentName } from "./types";

const clip = (s: string, n = 56): string => {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 取数组里前 n 个对象的 name 字段 */
function names(v: unknown, n: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, n)
    .map((x) => String((x as { name?: unknown })?.name ?? "").trim())
    .filter(Boolean);
}

export function summarizeAgentOutput(
  agent: AgentName,
  payload: unknown,
): string {
  try {
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (agent) {
      case "enrichment": {
        const first = String(p.summary ?? "").split(/[。！\n]/)[0];
        return clip(first);
      }
      case "activities": {
        const list = p.activities as unknown[];
        const top = names(list, 3);
        if (!top.length) return "";
        return clip(
          `找到 ${Array.isArray(list) ? list.length : top.length} 个活动：${top.join("、")}`,
        );
      }
      case "food": {
        const list = p.dining as unknown[];
        const top = names(list, 3);
        if (!top.length) return "";
        return clip(
          `${Array.isArray(list) ? list.length : top.length} 家餐厅：${top.join("、")}`,
        );
      }
      case "accommodation": {
        const opts = p.options as unknown[];
        const first = names(opts, 1)[0];
        const n = Array.isArray(opts) ? opts.length : 0;
        if (!n) return clip(String(p.recommended ?? ""));
        return clip(`${n} 家真实住宿${first ? ` · 首选 ${first}` : ""}`);
      }
      case "scheduling": {
        const ds = p.days as { theme?: unknown }[];
        if (!Array.isArray(ds) || !ds.length) return "";
        const themes = ds
          .map((d) => String(d?.theme ?? "").trim())
          .filter(Boolean)
          .slice(0, 3);
        return clip(`排出 ${ds.length} 天框架：${themes.join(" / ")}`);
      }
      case "transport": {
        const leg = (v: unknown) =>
          String(
            ((v as { options?: { name?: unknown }[] })?.options?.[0]?.name ??
              "") as string,
          ).trim();
        const out = leg(p.outbound);
        const back = leg(p.inbound);
        if (!out && !back) return "";
        return clip(
          [out && `去程 ${out}`, back && `返程 ${back}`]
            .filter(Boolean)
            .join(" · "),
        );
      }
      case "hub_planner": {
        const ds = p.days as { items?: unknown[] }[];
        if (!Array.isArray(ds) || !ds.length) return "";
        const items = ds.reduce(
          (n, d) => n + (Array.isArray(d?.items) ? d.items.length : 0),
          0,
        );
        return clip(`成稿：${ds.length} 天 · ${items} 个条目`);
      }
      case "validator": {
        const issues = p.issues as { severity?: unknown }[];
        const n = Array.isArray(issues) ? issues.length : 0;
        const high = Array.isArray(issues)
          ? issues.filter(
              (i) => String(i?.severity ?? "").toLowerCase() === "high",
            ).length
          : 0;
        if (p.passed === true && !n) return "质检通过，可以出发";
        if (high) return clip(`发现 ${high} 个重要问题，正在自动修订`);
        return clip(n ? `质检通过 · ${n} 条出行提醒` : "质检通过");
      }
      default:
        return "";
    }
  } catch {
    return "";
  }
}
