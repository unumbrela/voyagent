-- 公开分享：给 trips 增加 share_token。
-- 用户点「分享」时生成一个不可猜的 uuid；公开页 /share/[token] 用 service_role
-- 客户端按 token 只读对应行程（绕过 RLS，仅读取，不暴露 user_id）。撤销＝置 null。

alter table trips
  add column if not exists share_token uuid;

-- 按 token 查找的唯一索引（部分索引：仅对已分享的行）
create unique index if not exists trips_share_token_idx
  on trips (share_token)
  where share_token is not null;

-- 说明：不新增 RLS 策略——公开读取走服务端 service_role 客户端（绕过 RLS），
-- 浏览器端仍只能通过既有「own trips」策略访问自己的行程。
