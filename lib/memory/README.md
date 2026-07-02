# Agent Memory + RAG

让规划器**跨行程"越用越懂你"**：从建行程输入 / Copilot 对话里沉淀持久偏好，下次规划按相关性召回并注入 prompt，实现跨会话个性化。

## 记忆类型学（对齐业界 Agent Memory 范式）

| 类型 | 是什么 | 本项目落地 |
| --- | --- | --- |
| working 工作记忆 | 当前对话上下文 | 已由 Copilot `messages` 承载，不入库 |
| **semantic 语义记忆** | 关于用户的持久事实/偏好（"是什么"） | `user_memories` 主力：怕早起、爱博物馆、预算敏感、带娃… 带 `subject` 偏好槽位 |
| **episodic 情景记忆** | 发生过的事件（"做过什么"） | `kind='episodic'`，`subject` 为空 |

## 记忆生命周期

```
原始文本 ──extract──► 候选记忆 ──embed──► ──consolidate──► 落库(user_memories)
(建行程/对话)         (语义偏好)          (去重/冲突消解)         │
                                                              ▼
查询 ──embed──► rankMemories(相关性+新近性+重要性) ──► topK ──► 注入 prompt + 强化被召回项
```

- **抽取** `extract.ts`：`extractDeterministic`（规则、零 key、可测）+ `extractLLM`（生产、语义更广）。蒸馏**持久可泛化**偏好，忽略一次性诉求。
- **向量化** `embed.ts`：**可插拔**。默认确定性本地 embedding（feature hashing，零 key、同文本恒等、离线可测）；配 `EMBED_API_*` 即切真实语义向量，其余逻辑不变。
- **巩固** `consolidate.ts`（纯函数）：① 同 `subject` 冲突 → **supersede** 旧记忆（偏好会变）；② 近重复（cosine≥0.9）→ **强化**既有；③ 其余 → 新增。防止"每次交互都新增"导致记忆库爆炸/自相矛盾。
- **检索** `retrieval.ts`（纯函数）：借鉴 Generative Agents 记忆流，`score = 相关性(embedding) + 新近性(recency 衰减) + 重要性(importance)`，取 topK。
- **强化/遗忘**：被召回的记忆刷新 `last_used_at`、`use_count++`（越常用越易再被召回）；`active` 软删除保留可审计。

## RAG 存储取舍

embedding 存 `jsonb`（float 数组），检索在应用层做 cosine 排序——**可移植、零扩展依赖、可离线测**。规模化路径：换 pgvector 的 `vector(256)` 列 + ivfflat 索引 + `match` RPC，仅动 `store.ts` 一处（见 `migrations/0006_memory.sql` 注释）。

## 接入（读 + 写闭环）

| 时机 | 方向 | 位置 |
| --- | --- | --- |
| 建行程 | **写** | `app/api/trips/route.ts` → `rememberFromText(travel_style)` |
| 规划编排 | **读** | `app/api/trips/[id]/plan/route.ts` → `recallTexts` 注入 `constraints.user_memory` |
| 行程内对话 | **读 + 写** | `app/api/trips/[id]/chat/route.ts`：召回注入 + 从用户消息沉淀 |
| 全局 Copilot「小行」 | **读 + 写** | `app/api/agent/route.ts` + `runtime.ts`：召回注入 system prompt + 沉淀 |
| 注入点 | — | 规划/行程内对话共用 `lib/agents/prompt.ts` 的 `contextBlock`；小行用 `runtime.ts` 的 systemPrompt——**8 个 agent + 两个对话面全覆盖** |

> 两个对话面（行程内 chat 与全局 Copilot）现已一致具备：**记忆读写 · 输入护栏 · 全链路 trace**。

原则：记忆是增强项，全部调用**失败降级不抛**，绝不拖垮建行程/对话主流程。

## 离线自测

```bash
pnpm memory:demo   # 零 key / 零 DB，用内存 store 走完整闭环并断言
```

验证四个关键性质：抽取+巩固（不炸库）· 相关性召回（相关记忆排前）· 冲突消解（同槽位 supersede）· 近重复合并 + 召回强化（use_count↑）· embed 确定性。

## 扩展方向

- 反思/摘要（reflection）：定期把多条低层记忆聚合成更高层的洞察。
- 情景记忆的时间衰减遗忘（低重要性 + 久未用 → 归档）。
- 记忆管理 UI：让用户查看/编辑/删除 AI 记住的偏好（可控性 + 隐私）。
