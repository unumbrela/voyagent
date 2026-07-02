-- Agent Memory：跨行程的用户长期记忆（语义偏好 + 情景事件）
-- 让规划器"越用越懂你"——从建行程输入 / Copilot 对话 / 编辑反馈里沉淀持久偏好，
-- 下次规划时按相关性召回并注入 prompt，实现跨会话个性化。
--
-- 设计取舍：
--   * embedding 存 jsonb（float 数组），检索在应用层做 cosine 排序——可移植、零扩展依赖、可离线测。
--     规模化路径：改 pgvector 的 vector(256) 列 + ivfflat 索引 + match RPC，仅动 lib/memory/store.ts。
--   * subject = 偏好槽位（如 pace.wake_time / diet.spicy）：同槽位新记忆 supersede 旧的（冲突消解）。
--   * active：被 supersede 的记忆软删除（active=false），保留可审计而非物理删除。
--   * use_count / last_used_at：召回即强化（记忆流的新近性 + 强化信号）。

create table if not exists user_memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  kind          text not null,                     -- semantic | episodic
  subject       text,                              -- 偏好槽位；情景记忆为空
  text          text not null,                     -- 第三人称一句话
  importance    integer not null default 3,        -- 1~5
  embedding     jsonb not null default '[]'::jsonb,-- 语义向量（float 数组）
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  use_count     integer not null default 0,
  source        text not null default '',          -- trip_create | copilot | edit_feedback …
  active        boolean not null default true
);

create index if not exists user_memories_user_idx
  on user_memories (user_id, active);
create index if not exists user_memories_subject_idx
  on user_memories (user_id, subject) where active;

-- RLS：用户只能读写自己的记忆。服务端沉淀记忆用 service_role 亦可绕过。
alter table user_memories enable row level security;

create policy "own memories" on user_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
