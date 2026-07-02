# 旅行规划器 — 下一阶段功能路线图

## Context（为什么做这些）

项目的**生成引擎已近乎完整**：8-agent 编排（`lib/pipeline.ts` + `lib/agents/orchestrator.ts`）、真实数据接地（Tavily 搜索 + 12306/携程/Booking 确定性深链）、防幻觉、Supabase Auth + RLS、可拖拽/内联编辑的成品行程、Leaflet 地图、实时车次/航班再搜索。

缺的不是「生成」，而是把**生成出来的计划变成一个真实旅客能信任、负担得起、带得走、能据以行动**的产品。用户确认四个方向全要，按 ROI 分四阶段实现，每阶段独立可上线、互不阻塞。

数据现状（已核实）：
- 每个行程条目带 `est_cost`（number，人民币估算）；`trip_context` 有 `budget`、`party_size`。
- `itineraries.days` 形如 `{day,date,theme,items:[{time,title,kind,detail,est_cost,booking_url?}]}`，`references_data` 为 `{label,value}[]`。
- `GET /api/trips/[id]`（`app/api/trips/[id]/route.ts`）目前**不返回 budget / party_size** —— 预算看板需要补上。
- 地理编码已有 `POST /api/geocode`（Photon+Nominatim，`app/api/geocode/route.ts`），可得目的地中心点。
- 所有表受 RLS 保护（`supabase/migrations/0001_init.sql`）——公开分享必须用 admin 客户端按 token 绕过 RLS。
- `lib/agents/runAgent.ts` + `lib/agents/hub-planner.ts` 是复用「再生成」的现成入口。

---

## 阶段 1：预算成本看板（最低成本、最高感知价值）

**目标**：把已存在却从未汇总的 `est_cost` 变成可视化预算分析。

- `app/api/trips/[id]/route.ts` 的 GET：在返回里**加上 `budget` 和 `party_size`**（从 `trip_context` 读，已在同一查询里 select 一下即可）。
- 新增纯函数 `lib/budget.ts`：输入 `days[]` + `budget` + `party_size`，输出 `{ total, byDay: number[], byKind: Record<kind,number>, perPerson, overBudget: boolean, remaining }`。`kind` 用现有四类 `activity/food/rest/transit`。
- `app/trips/[id]/page.tsx`：在地图下方加 `<BudgetPanel>`：
  - 总花费 vs 预算进度条（超预算变红，复用 validator 已有的「超预算标 medium」语义口径）。
  - 按类别细分（小横条/饼形，纯 CSS，无新依赖）。
  - 按天花费迷你柱状。
  - 编辑条目 `est_cost` 时实时重算（已有 `days` state，纯前端 `useMemo`）。
- 文案沿用项目中文 UI 风格。

**复用**：`est_cost`、`days` state、validator 的超预算口径。**新依赖**：无。

---

## 阶段 2：每日天气（keyless，接地真实）

**目标**：每天行程标题旁显示该日天气；为「室内/室外」决策提供依据。

- 新增 `app/api/weather/route.ts`：`GET /api/weather?dest=&start=&end=`。
  - 先用现有 `/api/geocode` 逻辑（或直接调 Photon）拿目的地中心 `lat/lon`。
  - 调 **Open-Meteo Forecast**（`api.open-meteo.com/v1/forecast`，**无 key**，CORS 友好）取 `daily`（`weathercode`、`temperature_2m_max/min`、`precipitation_probability_max`）。
  - 仅未来约 16 天内有预报；超出范围回退到 **Open-Meteo Climate/历史同期**或直接返回 `null`（前端不显示，**绝不编造**，与项目防幻觉原则一致）。
  - 进程内缓存（仿 `geocode` 的 cache 写法）。
- `app/trips/[id]/page.tsx`：每个 day 卡片标题区加 `<WeatherBadge>`（图标 emoji + 最高/最低温 + 降水概率）。进入「已完成」行程时按 `meta.start_date`/各 day `date` 拉取一次。
- （可选、放阶段 2.5）把天气摘要作为 `scheduling`/`hub_planner` 的上游输入，让 agent 据天气调室内外——改 `lib/agents/prompt.ts` 的 upstream 注入即可，但**先做纯展示**，不阻塞。

**复用**：geocode/Photon、cache 写法。**新依赖**：无（Open-Meteo keyless）。

---

## 阶段 3：导出与分享（让计划带得走）

**目标**：公开只读分享链接 + `.ics` 日历 + 打印/PDF。

- **分享链接**（需绕过 RLS，按 token）：
  - 新增迁移 `supabase/migrations/0002_share.sql`：给 `trips` 加 `share_token uuid`（可空，nullable，默认 null）。
  - `app/api/trips/[id]/share/route.ts`：`POST` 用 cookie 客户端（RLS 校验归属）给自己的 trip 生成/清除 `share_token`（用 `gen_random_uuid()`）。
  - 公开页 `app/share/[token]/page.tsx`（server component）+ 读取逻辑：用 `createAdminClient()`（`lib/supabase/server.ts`，service_role 绕过 RLS）**只按 `share_token` 查**对应 `itineraries`+`trip_context`，**只读渲染**（复用现有行程渲染的只读形态，去掉编辑/保存/搜车票按钮）。`proxy.ts` 的鉴权放行 `/share/*`（加进白名单，类比 `/login`）。
  - 行程页加「🔗 分享」按钮：调 share API、展示可复制的公开链接、可撤销。
- **`.ics` 日历导出**：`app/api/trips/[id]/ics/route.ts` 返回 `text/calendar`。纯字符串拼 VEVENT（每个带 `time` 的条目一条；`date`+`time` 组成 DTSTART，标题=title，描述=detail，地点=title/area）。无依赖。
- **打印 / PDF**：给行程区加 `@media print` 样式（`app/globals.css`），隐藏导航/编辑控件，加「🖨 打印 / 存 PDF」按钮触发 `window.print()`。浏览器原生「另存为 PDF」即可，零依赖。

**复用**：`createAdminClient()`、现有行程渲染、`proxy.ts` 白名单模式。**新依赖**：无。

---

## 阶段 4：对话式优化 / 局部重跑（复用 single-source-of-truth 数据流）

**目标**：用户对成品行程发自然语言指令（「第2天改轻松些」「加个博物馆」「整体多留些美食」），或重跑单天/单 agent，**不丢手动编辑**。

- 新增 `app/api/trips/[id]/refine/route.ts`（SSE，仿 `plan/route.ts`）：
  - 入参 `{ instruction: string, scope: "all" | { day: number } }`。
  - 校验归属（cookie 客户端），随后用 service-role 跑。
  - 复用 `lib/agents/hub-planner.ts` 的 runAgent 调用模式，新建 `lib/agents/refine.ts`：system 说明「在保持其余部分不变的前提下，按指令修订行程」，userPrompt 注入**当前 `itineraries.days`**（含用户编辑）+ 指令 + 相关 upstream（`agent_outputs` 里的 activities/food/accommodation 供取材，避免编造）。输出沿用 `itinerarySchema`。
  - 写回 `itineraries.days`（覆盖，但因为把当前 days 作为输入，等于在用户编辑基础上改）。
- `app/trips/[id]/page.tsx`：加 `<RefineBox>`（底部输入框 + 「优化整段 / 仅本天」按钮）；提交后走 SSE，完成用返回的 days 覆盖 state 并标记 dirty/或直接已存。
- 单 agent 重跑（README 说数据流天然支持）：可作为 refine 的简化特例先不做，或在 RefineBox 旁给「重排本日」快捷指令。

**复用**：`plan/route.ts` 的 SSE 骨架、`runAgent`、`itinerarySchema`、`agent_outputs` 上游产物、归属校验+service-role 模式。**新依赖**：无。

---

## 建议实现顺序

1. **阶段 1（预算看板）** — 半天，纯前端 + 1 处 API 字段补充，立即提升完成度。
2. **阶段 2（天气）** — 半天，1 个 keyless API + 1 个徽章组件。
3. **阶段 3（导出/分享）** — 1~2 天，含 1 个 migration、公开页、`.ics`、打印。
4. **阶段 4（对话式优化）** — 1~2 天，最有产品深度，建立在前述之上。

四个阶段彼此独立，可分别提交、分别上线。

---

## 验证（端到端）

通用：`pnpm dev` 起本地，登录后从首页建一个行程（如「东京 / 5 天 / 中等预算 / 美食+文化」），等编排完成进入 `/trips/[id]`。

- **阶段 1**：改几个条目的 `est_cost`，确认看板总额/分类/按天/超预算实时变化；总额应等于各 `est_cost` 之和；超预算时进度条变红。
- **阶段 2**：选一个近期日期的目的地，确认每天标题旁出现天气徽章；选一个远于 16 天/冷门地点，确认**优雅缺省**（不显示、不编造）。Network 面板核对调用了 Open-Meteo。
- **阶段 3**：点「分享」拿到公开链接；**退出登录或用隐身窗**打开 `/share/[token]`，应只读可见、无编辑控件；撤销后该链接 404/无效。下载 `.ics` 导入日历看到逐条事件。打印预览隐藏了编辑控件。
- **阶段 4**：先手动改一个条目并保存；再发指令「第2天加一个博物馆、整体节奏放慢」，确认第2天更新、**先前手动编辑仍在**、且新增内容取材自真实候选（非编造）。SSE 进度正常。

补充：`pnpm test:deepseek` 仍应通过（阶段 4 若新增 refine agent，可仿照在脚本里加一条断言）。迁移用 `supabase` migration 流程应用 `0002_share.sql`。
