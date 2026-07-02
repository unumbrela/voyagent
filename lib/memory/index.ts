/**
 * Agent Memory 对外统一入口。
 *
 * 写：rememberFromText —— 从一段原始文本抽取持久偏好并巩固入库。
 * 读：recall（带分数）/ recallTexts（只要文本，便于塞进 prompt）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractDeterministic, extractLLM } from "./extract";
import { remember, recall } from "./store";
import type { CandidateMemory } from "./types";

export { recall, remember, loadActiveMemories } from "./store";
export { extractDeterministic, extractLLM } from "./extract";
export { rankMemories, scoreMemory, cosine, DEFAULT_WEIGHTS } from "./retrieval";
export { consolidate } from "./consolidate";
export { embed, localEmbed, embedMany, DIM, LOCAL_MODEL, currentEmbedModel } from "./embed";
export type {
  MemoryItem,
  CandidateMemory,
  ScoredMemory,
  MemoryKind,
  ConsolidationPlan,
} from "./types";

/** 抽取：有 DEEPSEEK key 走 LLM（语义更广），否则回退确定性规则 */
async function extract(text: string, source: string): Promise<CandidateMemory[]> {
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const llm = await extractLLM(text, source);
      if (llm.length) return llm;
    } catch (e) {
      console.warn("[memory] LLM 抽取失败，回退规则：", e);
    }
  }
  return extractDeterministic(text, source);
}

/** 从一段文本沉淀记忆（建行程输入 / Copilot 消息 / 编辑反馈）。非阻塞语义，失败不抛。 */
export async function rememberFromText(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  source: string,
): Promise<void> {
  try {
    const cands = await extract(text, source);
    if (cands.length) await remember(supabase, userId, cands);
  } catch (e) {
    console.warn("[memory] rememberFromText 异常：", e);
  }
}

/** 召回与查询最相关的记忆文本（塞进 agent/copilot prompt 用） */
export async function recallTexts(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  k = 6,
): Promise<string[]> {
  const scored = await recall(supabase, userId, query, k, { minRelevance: 0.05 });
  return scored.map((s) => s.item.text);
}
