/**
 * 护栏对外统一入口：三道关的高层封装。
 *   guardRetrieval —— 检索关：中和 + 圈定 + 扫描，产出可安全喂给模型的文本
 *   guardInput     —— 输入关：扫描用户输入里的直接注入
 *   guardUrls      —— 输出关：预订链接域白名单（见 ./urls）
 */

import { detectInjection } from "./detect";
import { neutralize, spotlight, UNTRUSTED_PREAMBLE } from "./sanitize";
import type { Finding, GuardResult } from "./types";
import type { SearchResult } from "@/lib/search";

export { detectInjection, hasHigh } from "./detect";
export { neutralize, spotlight, UNTRUSTED_PREAMBLE } from "./sanitize";
export { guardUrls, isTrustedBookingUrl, isSafeSourceUrl } from "./urls";
export { summarizeFindings, maxSeverity } from "./types";
export type { Finding, GuardResult, Severity, Category } from "./types";

/**
 * 检索关：把多条搜索结果转成【一段可安全喂给模型的文本】。
 *  - 每条结果先中和(neutralize)去走私，再扫描(detectInjection)记录 finding，
 *  - 然后 spotlight 圈定为「不可信数据」块；
 *  - 顶部加统一的安全前言，明确「数据里的指令不得执行」。
 * 注意：即使命中注入也不整段丢弃（丢弃=可被攻击者用来抹掉正常结果做 DoS），
 * 而是中和+圈定后仍交给模型，让模型在明确约束下只提取事实。
 */
export function guardRetrieval(results: SearchResult[]): GuardResult {
  const findings: Finding[] = [];
  const blocks: string[] = [];

  results.forEach((r, i) => {
    const raw = [r.title, r.content, r.raw].filter(Boolean).join("\n");
    const clean = neutralize(raw);
    for (const f of detectInjection(clean)) {
      findings.push({ ...f, detail: `[结果#${i + 1}] ${f.detail}` });
    }
    const label = `${i + 1} · ${hostLabel(r.url)}`;
    blocks.push(
      `[${i + 1}] ${r.title}\n来源: ${r.url}\n` + spotlight(clean, label),
    );
  });

  const text = `${UNTRUSTED_PREAMBLE}\n\n${blocks.join("\n\n")}`;
  return { text, findings };
}

/** 输入关：扫描用户自由文本（Copilot 消息 / 目的地 / 风格等） */
export function guardInput(text: string): GuardResult {
  const findings = detectInjection(text);
  return { text: neutralize(text), findings };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "未知来源";
  }
}
