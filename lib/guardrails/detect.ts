/**
 * 注入检测器（纯函数）。对一段文本跑全部规则，产出去重后的 Finding[]。
 */

import { RULES } from "./patterns";
import type { Finding } from "./types";

const SAMPLE_CAP = 80;
const snippet = (s: string): string =>
  s.length > SAMPLE_CAP ? s.slice(0, SAMPLE_CAP) + "…" : s;

/** 扫描文本，返回命中的 Finding（每条规则至多一条，按 severity 排序） */
export function detectInjection(text: string): Finding[] {
  if (!text) return [];
  const out: Finding[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) {
      out.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        detail: rule.detail,
        sample: snippet(m[0].replace(/\s+/g, " ").trim()),
      });
    }
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const hasHigh = (fs: Finding[]): boolean =>
  fs.some((f) => f.severity === "high");
