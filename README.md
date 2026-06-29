# 智能旅行规划 — 复现 Claude orchestrator-worker 多智能体架构

全栈 Web 旅行规划器：用户输入出发地（浏览器自动定位，失败可手填）/目的地/日期/预算/风格 → 服务端 **8 个专家 agent** 协作 → 实时进度 → 含去程/返程的成品行程。

## 架构

复现 Anthropic 工程博客《How we built our multi-agent research system》的 **orchestrator-worker（编排器-工人）** 范式，落到旅行场景（参考社区项目 `cody-hutson/travel-planner`）：

- **服务端编排**（不用 Managed Agents，自己持有计算）：`lib/pipeline.ts` + `lib/agents/orchestrator.ts`
- **波内并行、波间顺序**（旅行有强依赖链，盲目并行会冲突）：
  1. 并行：`enrichment`（调研）· `activities`（活动）· `food`（美食）
  2. `accommodation`（住宿，依据活动分布选区位）
  3. `scheduling`（日程编排，以住宿为锚点读上游全部产物）
  4. `transport`（交通，依赖已排日程）
  5. `hub_planner`（综合成最终行程）
  6. `validator`（出行前质检）
- **单一事实来源**：Supabase `trip_context` 表，所有 agent 只读它；产物累积写 `agent_outputs`
- **结构化输出**：每个 agent 把 `lib/agents/schemas.ts` 的 json_schema 写进 prompt，DeepSeek 用 `json_object` 模式返回规范 JSON
- **真实数据（自建搜索）**：DeepSeek 没有内置 web 搜索，所以自己实现了一套 **function-calling 工具循环**（`lib/deepseek.ts`）：Activities/Accommodation/Transport 挂 `web_search` 工具，模型决定何时搜，工具后端走 **Tavily**（`lib/search.ts`，可插拔，换 Serper/Bing 只改这一个文件）
- **住宿取证、不编造**：Accommodation agent 同样对真实性负责——酒店必须搜真实结果，每家带 `source_url`（来源）+ `booking_url`（**确定性生成**的 Booking.com 真实房态深链：能定到酒店名就落该酒店、否则落该城市该日期列表，见 `lib/hotels.ts`）；搜不到则标「实时查询」，**绝不编造酒店名或价格**。区位依据 Activities 的景点分布选取（动线短），Scheduling 以酒店为锚点排每日动线，Hub-planner 写入首日入住条目与「住宿」reference，Validator 把「无来源的住宿/超预算」判为问题
- **交通取证、不编造**：Transport agent 对真实性负责——去程/返程必须搜真实车次/航班，每个班次带 `source_url`（来源）+ `booking_url`；搜不到则标「实时查询」并给官方链接，**绝不编造车次号或票价**。`booking_url` 一律**确定性覆盖**为真实深链：铁路用 12306 线路+日期余票页（`lib/stations.ts`，权威车站码），航班用携程单程列表 / Google Flights（`lib/airports.ts`，IATA 城市码已知走携程、未知走 Google Flights 自然语言深链兜底）。Hub-planner 忠实搬运不改动，Validator 把「无来源的票务」判为 high 级问题。未配置 `TAVILY_API_KEY` 时降级为只给官方购票链接（`source_url` 留空＝未核实）
- **时间感知**：表单自动获取当前时间（可手填出发/返程时间）。去程班次必须晚于当前时间（出发日为今天时，不推已发车的票）且不早于指定出发时间；返程到达须早于「最晚到达时间」。除 prompt 约束外，`lib/agents/transport.ts` 还有一道**确定性代码过滤**剔除越界班次（硬保证，不依赖模型自觉），Validator 复核
- **单一 provider（全 DeepSeek）**：8 个 agent 全部走 DeepSeek `deepseek-chat`（OpenAI 兼容接口，`lib/deepseek.ts`）。`lib/agents/runAgent.ts` 仍保留 `provider` 抽象与 anthropic 分支，想切回 Claude 只需改 agent 里的 `provider/model`
- **实时进度**：`GET /api/trips/[id]/plan` 走 SSE，前端 `EventSource` 逐 agent 渲染
- **可视化编辑 + 持久化**：成品行程每个条目是可**拖拽排序**、可**直接改内容**（时间/标题/详情/花费/类型）、可增删的模块；交通条目带「🔍 搜车票」「✈️ 搜航班」——`GET /api/trains` / `GET /api/flights` 实时搜真实车次/航班（Tavily 抓整页时刻表原文 + 模型提取，带来源 + 确定性预订深链）下拉替换。「保存」`PUT /api/trips/[id]` 写回库。进入已完成行程走 `GET /api/trips/[id]` 直接读库渲染、**不再重跑流水线**（幂等，编辑不被覆盖）

## 目录速览

```
app/
  page.tsx                      # 落地页表单
  trips/[id]/page.tsx           # 进度面板 + 行程渲染 (EventSource)
  api/trips/route.ts            # 建 trip + trip_context
  api/trips/[id]/route.ts       # GET 读已存行程(不重跑) / PUT 保存编辑
  api/trips/[id]/plan/route.ts  # SSE 触发编排
  api/trains/route.ts           # 实时搜真实高铁车次(Tavily+模型, 带 12306 深链)
  api/flights/route.ts          # 实时搜真实航班(Tavily+模型, 带携程/Google Flights 深链)
lib/
  deepseek.ts                   # DeepSeek client（json_object + function-calling 工具循环）
  search.ts                     # 自建 web 搜索（Tavily 后端 + 工具定义，可插拔/可降级）
  stations.ts                   # 12306 官方车站码（权威）→ 构造直达购票深链
  airports.ts                   # IATA 城市码 → 携程/Google Flights 航班预订深链
  hotels.ts                     # 城市/酒店名 + 日期 → Booking.com 真实房态深链
  anthropic.ts                  # Claude client（保留，默认不用）
  supabase/{server,client}.ts   # service_role / anon client
  agents/
    runAgent.ts                 # 通用单 agent 封装（provider 分派 + 结构化 + web 搜索）
    schemas.ts  prompt.ts  types.ts
    enrichment/activities/food/scheduling/transport/hub-planner/validator.ts
    orchestrator.ts             # WAVES 派发结构
  pipeline.ts                   # 编排引擎（执行+写库+进度回调）
supabase/migrations/0001_init.sql
```

## 运行

1. **填环境变量**：复制 `.env.local.example` 为 `.env.local`，填 `DEEPSEEK_API_KEY` 与 Supabase 三个值；`TAVILY_API_KEY` 可选（填了 Activities/Transport 才联网核实真实数据），`ANTHROPIC_API_KEY` 现在不需要。
2. **建表**：在 Supabase SQL Editor 执行 `supabase/migrations/0001_init.sql`（或 `supabase db push`）。
3. **启动**：
   ```bash
   pnpm dev
   ```
4. 打开 http://localhost:3000，填表（如「东京 / 5 天 / 中等预算 / 美食+文化」）→ 提交，在 `/trips/[id]` 看 8 个 agent 依次点亮，完成后渲染逐日行程。
5. 到 Supabase 后台确认 `agent_outputs`（8 行）与 `itineraries`（1 行）已写入。

### 单独测试 DeepSeek 路径（无需 Supabase）

只验证走 DeepSeek 的两个 agent 能产出合法结构化 JSON：

```bash
# .env.local 里填好 DEEPSEEK_API_KEY 后
pnpm test:deepseek
```

脚本 `scripts/test-deepseek.ts` 会用样例行程（东京 5 天）实跑 Enrichment + Food，并断言返回结构正确。

## 说明 / 后续

- **多用户认证（已接入）**：Supabase Auth（邮箱+密码），`proxy.ts`（Next 16 取代 middleware）每请求刷新会话、未登录跳 `/login`。用户态读写走 cookie 绑定的 anon 客户端（`createServerSupabase`），由 migration 预留的 **RLS 按 `user_id` 自动隔离**——只能看/改自己的行程；建 trip 时写入 `user_id`。编排 SSE 先校验归属、再用 `service_role` 跑（受信任的服务端流程）。`/trips` 是「我的行程」列表。注：0001 之前以 null user 建的行程登录后不可见，开发期清表即可。
- 成本优化：DeepSeek 自带上下文硬盘缓存（命中即降价），稳定的 system 前缀天然受益；复杂 agent 可按需切到 `deepseek-reasoner`。
- **可靠性（已接入，`lib/pipeline.ts`）**：① **单 agent 退避重试**（3 次）——模型/搜索 API 抖动不再拖垮全局；② **断点续跑**——开跑前载入已 `done` 的 `agent_outputs` 并跳过，被中断的规划重开即从断点继续（前端「未完成→重连 SSE」逻辑天然触发，无需队列）；③ **validator 闭环**——质检出 high 级问题时，让 hub_planner 带质检反馈修订一次再复检（限 1 轮，修订轮失败不致命）。
- 因数据流是「单一事实来源 + 产物累积」，天然支持「重跑单个 agent」等局部重算扩展。
