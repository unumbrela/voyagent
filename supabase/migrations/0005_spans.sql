-- 运营可观测：多智能体流水线的执行 span（token / 成本 / 延迟）
-- 与 lib/trace.ts（内容层「做了什么」摘要，RQ2 可解释）互补：
--   这里记的是【运营指标】——每次 LLM 调用的 token 用量、折算成本、每个 agent 的耗时，
--   用于画 8-agent 的 token+延迟瀑布、算单次规划总成本、定位慢/贵的 agent。
--
-- 设计取舍：
--   * 扁平 span 表（span_id + parent_id 自引用建树），一次 insert 批量写入一条 trace 的所有 span。
--   * start_ms 用 bigint 存 epoch 毫秒（前端按相对偏移画瀑布，不依赖时区）。
--   * kind: pipeline|agent|llm|tool。meta(jsonb) 放 phase/query 等自由字段，扩展不改表。
--   * 服务端编排用 service_role 写；浏览器端按 trip 拥有者做 RLS 只读。

create table if not exists agent_spans (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references trips on delete cascade,
  span_id           uuid not null,
  parent_id         uuid,
  trace_id          text not null,
  name              text not null,
  kind              text not null,              -- pipeline|agent|llm|tool
  start_ms          bigint not null,            -- epoch 毫秒
  duration_ms       integer not null default 0,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost_usd          numeric,
  meta              jsonb not null default '{}'::jsonb,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists agent_spans_trip_idx  on agent_spans (trip_id, start_ms);
create index if not exists agent_spans_trace_idx on agent_spans (trace_id);

-- RLS：用户只能读自己 trip 的 span（浏览器端直连查看瀑布）。服务端写用 service_role 绕过。
alter table agent_spans enable row level security;

create policy "own agent_spans" on agent_spans
  for all using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));
