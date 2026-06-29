-- 智能旅行规划 — 初始 schema
-- 复现 orchestrator-worker 架构的数据层：
--   trip_context = 单一事实来源(single source of truth)
--   agent_outputs = 各 agent 产物累积
--   itineraries   = orchestrator 综合后的最终结果

create extension if not exists "pgcrypto";

-- 一次旅行规划任务
create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  status      text not null default 'draft',      -- draft|planning|done|failed
  created_at  timestamptz not null default now()
);

-- 单一事实来源：所有 agent 只读它，不改它
create table if not exists trip_context (
  trip_id      uuid primary key references trips on delete cascade,
  destination  text not null,
  start_date   date,
  end_date     date,
  budget       numeric,
  travel_style text,
  party_size   int default 1,
  constraints  jsonb not null default '{}'::jsonb
);

-- 各 agent 产物累积；下游 agent 读上游这里的产物
create table if not exists agent_outputs (
  trip_id     uuid not null references trips on delete cascade,
  agent_name  text not null,                      -- enrichment|activities|food|scheduling|transport|hub_planner|validator
  payload     jsonb,
  status      text not null default 'pending',    -- pending|running|done|error
  error       text,
  updated_at  timestamptz not null default now(),
  primary key (trip_id, agent_name)
);

-- orchestrator 综合后的最终行程
create table if not exists itineraries (
  trip_id         uuid primary key references trips on delete cascade,
  days            jsonb,
  references_data jsonb,
  validation      jsonb,
  validated_at    timestamptz
);

-- ─── RLS：用户只能访问自己的 trip ───
alter table trips         enable row level security;
alter table trip_context  enable row level security;
alter table agent_outputs enable row level security;
alter table itineraries   enable row level security;

-- trips: 拥有者可读写
create policy "own trips" on trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 子表：通过 trip 的拥有者判定
create policy "own trip_context" on trip_context
  for all using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

create policy "own agent_outputs" on agent_outputs
  for all using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

create policy "own itineraries" on itineraries
  for all using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

-- 注：服务端编排用 service_role key（绕过 RLS），上述策略用于浏览器端直连。
