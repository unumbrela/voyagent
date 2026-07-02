/**
 * Agent Memory 类型体系。
 *
 * 记忆类型学（对齐业界 Agent Memory 范式，如 MemGPT/Letta、Generative Agents、mem0）：
 *   - working  工作记忆：当前对话上下文（已由 Copilot 的 messages 承载，不入本库）
 *   - semantic 语义记忆：关于用户的【持久事实/偏好】——"是什么"（怕早起、爱博物馆、预算敏感）
 *   - episodic 情景记忆：发生过的【事件】——"做过什么"（创建了东京行程、把第2天改成美术馆）
 *
 * 语义记忆带 subject（偏好槽位）：同槽位的新记忆会 supersede 旧的（冲突消解）。
 * 检索走「记忆流」打分：相关性(embedding) + 新近性(recency) + 重要性(importance)。
 */

export type MemoryKind = "semantic" | "episodic";

/** 落库的一条记忆 */
export interface MemoryItem {
  id: string;
  userId: string;
  kind: MemoryKind;
  /** 语义记忆的偏好槽位（如 "pace.wake_time"）；情景记忆为 null。用于同槽位冲突消解 */
  subject: string | null;
  text: string; // 一句话，第三人称陈述（"用户偏好…"）
  importance: number; // 1~5，越大越该被记住/召回
  embedding: number[]; // 语义向量（可插拔 embed 产出）
  embedModel: string; // 产出该向量的模型标识（识别向量空间；切换 provider 时用于自愈重嵌）
  createdAt: string; // ISO
  lastUsedAt: string; // ISO；被召回即刷新（新近性 + 强化）
  useCount: number; // 被召回次数（强化信号）
  source: string; // 来源：trip_create / copilot / edit_feedback …
  active: boolean; // 被 supersede 后置 false（软删除，保留可审计）
}

/** 抽取出、尚未落库的候选记忆（无 id/embedding/时间，由 store 补齐） */
export interface CandidateMemory {
  kind: MemoryKind;
  subject: string | null;
  text: string;
  importance: number;
  source: string;
}

/** 召回结果：记忆 + 其记忆流得分（便于解释"为什么召回它"） */
export interface ScoredMemory {
  item: MemoryItem;
  score: number;
  relevance: number;
  recency: number;
  importance: number;
}

/** consolidate 产出的执行计划（store 据此写库；pure，可测） */
export interface ConsolidationPlan {
  inserts: CandidateMemory[];
  /** 命中近重复：加强既有记忆（可能顺带更新为更具体的文本） */
  updates: { id: string; text?: string; importance: number }[];
  /** 同槽位冲突：旧记忆被新记忆取代 */
  supersedes: { id: string; byText: string }[];
}
