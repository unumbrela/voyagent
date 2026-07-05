-- 行程标题与概览落库。
-- hub_planner 产出的 title（如「无锡 → 苏州 · 江南三日」）和 overview 之前只在
-- SSE done 事件里活一程：重开行程会退化成「<目的地> 行程」，概览直接丢失。
-- 写入方（pipeline / 示例种子）对该迁移做了容错：未应用时跳过、不影响主流程。
alter table itineraries
  add column if not exists title text,
  add column if not exists overview text;
