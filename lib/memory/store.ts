/**
 * 记忆存储（Supabase 落地）。把纯逻辑（embed/rank/consolidate）接到 user_memories 表。
 *
 * 关键动态：
 *   - recall 会【强化】被召回的记忆（刷新 last_used_at、use_count++）——越常用越容易再被召回；
 *   - remember 走 consolidate 去重/冲突消解后再写；
 *   - 一切失败都降级（告警不抛），记忆是增强项，绝不能拖垮建行程/对话主流程。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, embedMany, currentEmbedModel } from "./embed";
import { rankMemories, type RetrievalWeights } from "./retrieval";
import { consolidate } from "./consolidate";
import type { CandidateMemory, MemoryItem, ScoredMemory } from "./types";

const TABLE = "user_memories";

interface Row {
  id: string;
  user_id: string;
  kind: string;
  subject: string | null;
  text: string;
  importance: number;
  embedding: number[] | null;
  embed_model: string | null;
  created_at: string;
  last_used_at: string;
  use_count: number;
  source: string;
  active: boolean;
}

function rowToItem(r: Row): MemoryItem {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind as MemoryItem["kind"],
    subject: r.subject,
    text: r.text,
    importance: r.importance,
    embedding: r.embedding ?? [],
    embedModel: r.embed_model ?? "",
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
    source: r.source,
    active: r.active,
  };
}

/** 载入某用户全部 active 记忆 */
export async function loadActiveMemories(
  supabase: SupabaseClient,
  userId: string,
): Promise<MemoryItem[]> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) {
      console.warn("[memory] load 失败：", error.message);
      return [];
    }
    return (data ?? []).map((r) => rowToItem(r as Row));
  } catch (e) {
    console.warn("[memory] load 异常：", e);
    return [];
  }
}

/**
 * 召回与查询最相关的记忆（记忆流打分），并强化被召回项。
 * 返回带分数的结果（便于解释"为何召回"）。
 */
export async function recall(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  k = 5,
  opts: { weights?: RetrievalWeights; minRelevance?: number } = {},
): Promise<ScoredMemory[]> {
  const items = await loadActiveMemories(supabase, userId);
  if (!items.length) return [];
  const q = await embed(query);
  const model = currentEmbedModel();

  // 自愈：切换过 embedding provider 后，旧记忆在不同向量空间——重嵌到当前空间再比较，
  // 并把新向量持久化（一次性迁移，失败忽略）。避免跨空间 cosine 返回 0 而漏召回。
  const stale = items.filter(
    (it) => it.embedModel !== model || it.embedding.length !== q.length,
  );
  if (stale.length) {
    await Promise.all(
      stale.map(async (it) => {
        it.embedding = await embed(it.text);
        it.embedModel = model;
        supabase
          .from(TABLE)
          .update({ embedding: it.embedding, embed_model: model })
          .eq("id", it.id)
          .then(
            () => {},
            () => {},
          );
      }),
    );
  }

  const now = Date.now();
  const top = rankMemories(items, q, now, k, opts);

  // 强化：被召回的记忆刷新 last_used_at + use_count（失败忽略）
  if (top.length) {
    const nowIso = new Date(now).toISOString();
    await Promise.all(
      top.map((s) =>
        supabase
          .from(TABLE)
          .update({ last_used_at: nowIso, use_count: s.item.useCount + 1 })
          .eq("id", s.item.id)
          .then(
            () => {},
            () => {},
          ),
      ),
    );
  }
  return top;
}

/**
 * 写入候选记忆：embed → consolidate（去重/冲突消解）→ 落库。
 * 返回本次写入统计。
 */
export async function remember(
  supabase: SupabaseClient,
  userId: string,
  candidates: CandidateMemory[],
): Promise<{ inserted: number; updated: number; superseded: number }> {
  const stats = { inserted: 0, updated: 0, superseded: 0 };
  if (!candidates.length) return stats;
  try {
    const embs = await embedMany(candidates.map((c) => c.text));
    const embMap = new Map<CandidateMemory, number[]>();
    const pairs = candidates.map((cand, i) => {
      embMap.set(cand, embs[i]);
      return { cand, embedding: embs[i] };
    });

    const existing = await loadActiveMemories(supabase, userId);
    const plan = consolidate(existing, pairs);
    const nowIso = new Date().toISOString();
    const model = currentEmbedModel();

    // supersede：旧记忆置 active=false
    for (const s of plan.supersedes) {
      const { error } = await supabase
        .from(TABLE)
        .update({ active: false })
        .eq("id", s.id);
      if (!error) stats.superseded++;
    }
    // update：强化既有记忆（+可选更新文本，文本变了同步向量）
    for (const u of plan.updates) {
      const patch: Record<string, unknown> = {
        importance: u.importance,
        last_used_at: nowIso,
      };
      if (u.text) {
        patch.text = u.text;
        patch.embedding = await embed(u.text);
        patch.embed_model = model;
      }
      const { error } = await supabase.from(TABLE).update(patch).eq("id", u.id);
      if (!error) stats.updated++;
    }
    // insert：全新记忆
    if (plan.inserts.length) {
      const rows = plan.inserts.map((c) => ({
        user_id: userId,
        kind: c.kind,
        subject: c.subject,
        text: c.text,
        importance: c.importance,
        embedding: embMap.get(c) ?? [],
        embed_model: model,
        created_at: nowIso,
        last_used_at: nowIso,
        use_count: 0,
        source: c.source,
        active: true,
      }));
      const { error } = await supabase.from(TABLE).insert(rows);
      if (!error) stats.inserted += rows.length;
    }
  } catch (e) {
    console.warn("[memory] remember 异常：", e);
  }
  return stats;
}
