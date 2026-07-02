-- 记忆向量的模型标识：识别 embedding 所属的向量空间。
-- 切换 embedding provider（本地 ↔ 远端真实向量）会改变向量空间，跨空间的余弦相似度无意义；
-- 据此标记，store.recall 会把旧空间的记忆惰性重嵌到当前空间后再比较（自愈），避免静默漏召回。

alter table user_memories
  add column if not exists embed_model text not null default 'local-fnv-256';
