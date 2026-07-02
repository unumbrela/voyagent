/**
 * 模型定价表 —— 用于把 token 用量折算成美元成本。
 *
 * 单位：USD / 1M tokens。数值为各家公开价的近似值，只作「量级」参考，
 * 会随官方调价变动；改价只改这一处。未知模型走 DEFAULT 兜底（不为 0，避免成本被静默低估）。
 */

export interface ModelPrice {
  /** 输入（prompt）单价，USD / 1M tokens */
  input: number;
  /** 输出（completion）单价，USD / 1M tokens */
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  // DeepSeek（本项目默认 provider）
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  // Claude（保留分支）
  "claude-opus-4-8": { input: 15, output: 75 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
};

const DEFAULT: ModelPrice = { input: 1, output: 3 };

/** 前缀匹配（容忍带日期后缀的模型 id，如 claude-haiku-4-5-20251001） */
export function priceOf(model: string): ModelPrice {
  if (PRICES[model]) return PRICES[model];
  const hit = Object.keys(PRICES).find((k) => model.startsWith(k));
  return hit ? PRICES[hit] : DEFAULT;
}

/** token 用量 → 美元成本（保留 6 位小数，单次调用常在 $0.00x 量级） */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = priceOf(model);
  const usd =
    (promptTokens / 1e6) * p.input + (completionTokens / 1e6) * p.output;
  return Math.round(usd * 1e6) / 1e6;
}
