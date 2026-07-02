/**
 * 记忆流检索打分（纯函数，可离线测）。
 *
 * 借鉴 Generative Agents 的 memory stream：一条记忆的召回得分 =
 *   相关性(relevance, 与查询的语义相似) + 新近性(recency, 越近用过越高) + 重要性(importance)。
 * 三者加权求和，取 topK。被召回的记忆随后应被【强化】（刷新 lastUsedAt、useCount++）。
 */

import type { MemoryItem, ScoredMemory } from "./types";

export interface RetrievalWeights {
  relevance: number;
  recency: number;
  importance: number;
}
export const DEFAULT_WEIGHTS: RetrievalWeights = {
  relevance: 1,
  recency: 0.5,
  importance: 0.5,
};

/** 新近性半衰期（天）：越久没被用，recency 越低 */
const HALF_LIFE_DAYS = 30;
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

export function cosine(a: number[], b: number[]): number {
  // 维度不同 = 不同向量空间，不可比：返回 0（而非按 min 长度算出垃圾相似度）
  if (a.length !== b.length) return 0;
  const n = a.length;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const d = Math.sqrt(ma) * Math.sqrt(mb);
  return d ? dot / d : 0;
}

function recencyOf(item: MemoryItem, nowMs: number): number {
  const last = Date.parse(item.lastUsedAt);
  if (Number.isNaN(last)) return 0;
  const ageDays = Math.max(0, (nowMs - last) / 86400000);
  return Math.exp(-LAMBDA * ageDays); // (0,1]
}

/** 给一条记忆按记忆流公式打分（各分量已归一到 [0,1]） */
export function scoreMemory(
  item: MemoryItem,
  queryEmb: number[],
  nowMs: number,
  w: RetrievalWeights = DEFAULT_WEIGHTS,
): ScoredMemory {
  const relevance = Math.max(0, cosine(queryEmb, item.embedding)); // 负相关归 0
  const recency = recencyOf(item, nowMs);
  const importance = Math.min(1, Math.max(0, item.importance / 5));
  const score =
    w.relevance * relevance + w.recency * recency + w.importance * importance;
  return { item, score, relevance, recency, importance };
}

/**
 * 排序召回 topK。默认只看 active 记忆；relevance 过低（近乎无关）可选阈值过滤，
 * 避免"无关但很新/很重要"的记忆霸榜。
 */
export function rankMemories(
  items: MemoryItem[],
  queryEmb: number[],
  nowMs: number,
  k = 5,
  opts: { weights?: RetrievalWeights; minRelevance?: number } = {},
): ScoredMemory[] {
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const minRel = opts.minRelevance ?? 0;
  return items
    .filter((it) => it.active)
    .map((it) => scoreMemory(it, queryEmb, nowMs, w))
    .filter((s) => s.relevance >= minRel)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
