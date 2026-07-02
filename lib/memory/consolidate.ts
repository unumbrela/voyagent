/**
 * 记忆巩固（纯函数，可离线测）——写入记忆前的去重与冲突消解。
 *
 * 朴素地"每次交互都新增一条"会让记忆库爆炸且自相矛盾，是 Agent Memory 的经典坑。
 * 这里对每条候选记忆决策：
 *   1) 同槽位冲突（subject 相同）→ supersede 旧记忆，写入新记忆（用户偏好会变）；
 *   2) 近重复（cosine ≥ DEDUP）→ update：强化既有记忆，若候选更具体则更新文本；
 *   3) 其余 → insert。
 * 产出一个执行计划（inserts/updates/supersedes），由 store 落库。
 */

import { cosine } from "./retrieval";
import type {
  CandidateMemory,
  ConsolidationPlan,
  MemoryItem,
} from "./types";

/** 判为"同一条"的相似度阈值 */
const DEDUP = 0.9;

export function consolidate(
  existing: MemoryItem[],
  candidates: { cand: CandidateMemory; embedding: number[] }[],
): ConsolidationPlan {
  const plan: ConsolidationPlan = { inserts: [], updates: [], supersedes: [] };
  // 本轮已被 supersede/更新的既有 id，避免一轮内重复处理
  const touched = new Set<string>();
  const active = () => existing.filter((e) => e.active && !touched.has(e.id));

  for (const { cand, embedding } of candidates) {
    // 1) 同槽位冲突消解（仅语义记忆有 subject）
    if (cand.subject) {
      const clash = active().find(
        (e) => e.kind === "semantic" && e.subject === cand.subject,
      );
      if (clash) {
        // 文本几乎一致 → 只强化，不新增；否则取代
        if (cosine(embedding, clash.embedding) >= DEDUP) {
          plan.updates.push({
            id: clash.id,
            importance: Math.max(clash.importance, cand.importance),
          });
        } else {
          plan.supersedes.push({ id: clash.id, byText: cand.text });
          plan.inserts.push(cand);
        }
        touched.add(clash.id);
        continue;
      }
    }

    // 2) 近重复合并（无槽位或槽位无冲突时，按向量找最近的既有记忆）
    let best: MemoryItem | null = null;
    let bestSim = -1;
    for (const e of active()) {
      const sim = cosine(embedding, e.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        best = e;
      }
    }
    if (best && bestSim >= DEDUP) {
      plan.updates.push({
        id: best.id,
        importance: Math.max(best.importance, cand.importance),
        // 候选更长（更具体）时更新文本
        text: cand.text.length > best.text.length ? cand.text : undefined,
      });
      touched.add(best.id);
      continue;
    }

    // 3) 全新记忆
    plan.inserts.push(cand);
  }

  return plan;
}
