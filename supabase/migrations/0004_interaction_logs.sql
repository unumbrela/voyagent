-- 交互埋点日志（HCI 用户评估基建）
-- 记录用户与人-AI 协作界面的每一次交互，供后续量化分析（效率/掌控感/信任校准等）。
-- 设计取舍：
--   * 独立表，按 user_id 隔离（不挂在某个 trip 上，因为落地页/Copilot 也会打点）。
--   * trip_id 可空（全局事件如 copilot 对话、问卷提交时无 trip 上下文）。
--   * session_id 由前端生成，用于把一次「学习/实验会话」内的事件聚成一组。
--   * event_type + payload(jsonb) 通用结构，新增事件类型无需改表。
--   * 问卷（SUS/NASA-TLX/信任量表）也复用此表：event_type='survey'，答案存 payload。

create table if not exists interaction_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  trip_id     uuid references trips on delete set null,
  session_id  text,
  event_type  text not null,                 -- trip_create|plan_start|plan_done|diff_apply|diff_discard|undo|item_edit|item_add|item_delete|drag_move|save|source_open|chat_send|survey|...
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- 常用查询：按用户 / 会话 / 类型 拉时间线
create index if not exists interaction_logs_user_idx    on interaction_logs (user_id, created_at);
create index if not exists interaction_logs_session_idx on interaction_logs (session_id, created_at);
create index if not exists interaction_logs_type_idx    on interaction_logs (event_type);

-- RLS：用户只能写/读自己的日志（浏览器端直连亦安全）。
-- 研究者导出全量分析时用 service_role key（绕过 RLS）。
alter table interaction_logs enable row level security;

create policy "own interaction_logs" on interaction_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
