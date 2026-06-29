# 智能旅行规划 — 复现 Claude orchestrator-worker 多智能体架构

全栈 Web 旅行规划器：用户输入目的地/日期/预算/风格 → 服务端 **7 个专家 agent** 协作 → 实时进度 → 成品行程。

## 架构

复现 Anthropic 工程博客《How we built our multi-agent research system》的 **orchestrator-worker（编排器-工人）** 范式，落到旅行场景（参考社区项目 `cody-hutson/travel-planner`）：

- **服务端编排**（不用 Managed Agents，自己持有计算）：`lib/pipeline.ts` + `lib/agents/orchestrator.ts`
- **波内并行、波间顺序**（旅行有强依赖链，盲目并行会冲突）：
  1. 并行：`enrichment`（调研）· `activities`（活动）· `food`（美食）
  2. `scheduling`（日程编排，读上游全部产物）
  3. `transport`（交通，依赖已排日程）
  4. `hub_planner`（综合成最终行程）
  5. `validator`（出行前质检）
- **单一事实来源**：Supabase `trip_context` 表，所有 agent 只读它；产物累积写 `agent_outputs`
- **结构化输出**：每个 agent 把 `lib/agents/schemas.ts` 的 json_schema 写进 prompt，DeepSeek 用 `json_object` 模式返回规范 JSON
- **真实数据（自建搜索）**：DeepSeek 没有内置 web 搜索，所以自己实现了一套 **function-calling 工具循环**（`lib/deepseek.ts`）：Activities/Transport 挂 `web_search` 工具，模型决定何时搜，工具后端走 **Tavily**（`lib/search.ts`，可插拔，换 Serper/Bing 只改这一个文件）。未配置 `TAVILY_API_KEY` 时优雅降级——不报错，agent 靠自身知识作答
- **单一 provider（全 DeepSeek）**：7 个 agent 全部走 DeepSeek `deepseek-chat`（OpenAI 兼容接口，`lib/deepseek.ts`）。`lib/agents/runAgent.ts` 仍保留 `provider` 抽象与 anthropic 分支，想切回 Claude 只需改 agent 里的 `provider/model`
- **实时进度**：`GET /api/trips/[id]/plan` 走 SSE，前端 `EventSource` 逐 agent 渲染

## 目录速览

```
app/
  page.tsx                      # 落地页表单
  trips/[id]/page.tsx           # 进度面板 + 行程渲染 (EventSource)
  api/trips/route.ts            # 建 trip + trip_context
  api/trips/[id]/plan/route.ts  # SSE 触发编排
lib/
  deepseek.ts                   # DeepSeek client（json_object + function-calling 工具循环）
  search.ts                     # 自建 web 搜索（Tavily 后端 + 工具定义，可插拔/可降级）
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
4. 打开 http://localhost:3000，填表（如「东京 / 5 天 / 中等预算 / 美食+文化」）→ 提交，在 `/trips/[id]` 看 7 个 agent 依次点亮，完成后渲染逐日行程。
5. 到 Supabase 后台确认 `agent_outputs`（7 行）与 `itineraries`（1 行）已写入。

### 单独测试 DeepSeek 路径（无需 Supabase）

只验证走 DeepSeek 的两个 agent 能产出合法结构化 JSON：

```bash
# .env.local 里填好 DEEPSEEK_API_KEY 后
pnpm test:deepseek
```

脚本 `scripts/test-deepseek.ts` 会用样例行程（东京 5 天）实跑 Enrichment + Food，并断言返回结构正确。

## 说明 / 后续

- 当前未接入用户认证：`trips.user_id` 暂为 null，服务端用 `service_role` 绕过 RLS；多用户 RLS 策略已在 migration 预留。
- 成本优化：DeepSeek 自带上下文硬盘缓存（命中即降价），稳定的 system 前缀天然受益；复杂 agent 可按需切到 `deepseek-reasoner`。
- 因数据流是「单一事实来源 + 产物累积」，天然支持「重跑单个 agent」等局部重算扩展。
