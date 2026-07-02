-- 交互增强：给行程附属数据加两列（沿用「1:1 行程附属数据存 itineraries」的现状）。
--   chat    = 多轮对话历史 [{ role, content, ts }]
--   packing = 打包清单     [{ id, label, group, checked }]
-- 用户偏好（👍/👎）不新增列，写入 trip_context.constraints.preferences（沿用 constraints jsonb 约定）。
-- RLS 无需改动——两列都在已受 own itineraries 策略保护的表上。

alter table itineraries
  add column if not exists chat jsonb;

alter table itineraries
  add column if not exists packing jsonb;
