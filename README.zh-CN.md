<div align="center">

[English](README.md) | **简体中文**

</div>

<h1 align="center">漫游 voyagent</h1>

<p align="center">一个只把<b>查得到、核得实</b>的信息写进行程的多智能体旅行规划应用。</p>

<p align="center">
  <a href="https://voyagent-five.vercel.app"><b>在线体验 → voyagent-five.vercel.app</b></a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e?logo=supabase&logoColor=white" />
  <img alt="DeepSeek" src="https://img.shields.io/badge/LLM-DeepSeek-4d6bfe" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green" />
</p>

![voyagent 首页](docs/screenshots/landing-hero.jpg)

## 这是什么

输入出发地、目的地、日期、预算和偏好，服务端 8 个智能体分工协作，联网查询真实的景点、餐厅、酒店、车次和航班，大约两分钟生成一份从去程排到返程的完整行程。

做这个项目的起因：直接让大模型生成行程，它会编出不存在的酒店和早已停运的车次。voyagent 把**真实性当作硬约束**，靠代码保证而不是靠提示词：

- 每条信息带「已核实 / 可查证 / 待核实」标签，已核实的可以点开来源网页核对。
- 预订链接（12306 / 携程 / Booking.com）由代码按已知 URL 规则拼接，模型从不生成链接。
- 联网查不到的信息标注「实时查询」，不编造；出发日为当天时，已发车的班次会被代码过滤。

> 在线体验支持邮箱注册，开箱即用。

## 四张截图看完主要功能

### 生成之后还能继续改的行程

条目支持拖拽排序、直接改内容、增删；交通条目内嵌真实车票 / 航班搜索，查到班次一键原地替换。保存幂等：再次打开不重跑流水线、不覆盖修改。每个条目分别记预算与实际花费。

![行程详情页：左侧可编辑时间轴带来源标签，右侧实时地图](docs/screenshots/trip-detail.jpg)

### 每份行程都有一张实时地图

时间轴和地图是同一份数据的两个视图：类别配色的编号针与卡片一一对应，hover 双向联动，滚动时间轴地图自动聚焦；按天切换当日路线。国内自动用高德瓦片，出境自动切 CARTO。

![三日游展示：真实底图上的分日路线](docs/screenshots/landing-showcase.jpg)

### 用真实数据做的目的地演示

六条精选演示行程（苏州、京都、亚丁、冰岛、圣托里尼、摩洛哥），车次、航班、价格都是真实数据，一键即可存为自己的可编辑行程。

![京都演示行程：真实航班 + CARTO 底图分日路线](docs/screenshots/demo-kyoto.jpg)

### 常驻右下角的旅行助手

「小行」在每个页面的右下角。语音或文字对话即可规划新行程、调整节奏、查车票、看天气、找网友攻略。它想做的每个改动都先以提案卡片展示，你确认之后才写入行程；它记住了你哪些偏好，也能在面板里看到并删掉。

![行程页上的旅行助手：对话、工具调用与提案卡](docs/screenshots/copilot.jpg)

## 流水线怎么工作

orchestrator–worker 结构，编排逻辑在服务端自持（`lib/pipeline.ts`），不依赖托管 Agent 平台。8 个智能体按 5 个波次执行：波内并行、波间顺序——旅行规划天然有依赖链（先定玩什么 → 再选住哪 → 再排每天的路线）。

| 波次 | 智能体 | 职责 |
| --- | --- | --- |
| 1 | enrichment · activities 🔍 · food 🔍 · transport 🔍 | 目的地调研；真实景点、餐厅、车次航班 |
| 2 | accommodation 🔍 | 依景点分布选住宿 |
| 3 | scheduling | 以住宿为基准排每日路线 |
| 4 | hub_planner | 汇总成最终行程 |
| 5 | validator | 出行前质检，不过自动修订一轮 |

🔍 = 挂载了 `web_search` 工具（Tavily 后端，可替换）。

实现要点：

- **全程约 2 分钟**。进度经 SSE 实时推送到等待页；失败自动重试，中断后从断点续跑。
- **结构化输出**。每个智能体把 JSON Schema 写进 prompt，DeepSeek 以 `json_object` 模式返回；带工具阶段与 JSON 收口阶段分离（`lib/deepseek.ts`）。
- **单一事实来源**。智能体只读 `trip_context`（Supabase），产物累积写 `agent_outputs` 供下游读取——断点续跑也依赖它。

## 工程配套

| 能力 | 位置 | 回答的问题 | 运行 |
| --- | --- | --- | --- |
| 评估闭环 | `eval/` | 「这次改动有没有让行程变差」——离线 fixtures 断言 + 在线 LLM-as-judge，生成与打分解耦 | `pnpm eval` / `pnpm eval:live` |
| 可观测 | `lib/otel/` | span 追踪，逐智能体归集耗时 / token / 成本，行程页可视化调用链 | `pnpm trace:demo` |
| 护栏 | `lib/guardrails/`、`guardrail/` | 三道提示注入防御：清洗用户输入、检测检索网页、预订链接域名白名单；配红队测试集 | `pnpm redteam` |
| 记忆 | `lib/memory/` | 提取用户长期偏好，向量化存储与召回，跨行程复用 | `pnpm memory:demo` |

检索到的真实网页原文会进入模型上下文，这是间接提示注入的主要攻击面，护栏即为此设计。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router）、React 19、TypeScript 5 |
| 样式 | Tailwind CSS 4、motion 动效 |
| 数据 / 认证 | Supabase（Postgres + Row Level Security + Auth：邮箱密码 / Google OAuth） |
| 模型 | DeepSeek `deepseek-chat`（OpenAI 兼容接口 + function calling），provider 抽象可换模型 |
| 检索 | 自建工具调用循环 + Tavily 搜索后端（可插拔） |
| 地图 | Leaflet + 高德瓦片（国内）/ CARTO（境外），高德 PlaceSearch 地理编码 |

## 如何运行

### 环境要求

- Node.js ≥ 20（开发使用 22）
- [pnpm](https://pnpm.io/)（本项目用 pnpm 管理依赖，请勿用 npm）
- 一个 [Supabase](https://supabase.com) 项目（免费档即可）
- 一把 [DeepSeek](https://platform.deepseek.com) API key

### 步骤

```bash
# 1. 克隆并安装依赖
git clone https://github.com/unumbrela/voyagent.git
cd voyagent
pnpm install

# 2. 配置环境变量
cp .env.local.example .env.local
#    必填 4 项：DEEPSEEK_API_KEY + Supabase 三件套

# 3. 初始化数据库
#    打开 Supabase 后台 → SQL Editor，把 supabase/migrations/ 下的 SQL
#    按文件名顺序（0001_init → 0007_memory_embed_model）依次执行

# 4. 启动开发服务器
pnpm dev
#    打开 http://localhost:3000，注册一个邮箱账号即可使用
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 平台申请，所有智能体共用 |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 同上，仅服务端使用 |
| `TAVILY_API_KEY` | 可选 | 联网搜索；不填则相关智能体不联网、靠模型知识作答 |
| `EMBED_API_BASE / KEY / MODEL` | 可选 | 记忆的语义向量；不填用内置哈希向量兜底 |
| `NEXT_PUBLIC_AMAP_KEY / SECURITY` | 可选 | 首页 3D 演示地图；不填自动降级 Leaflet 2D |

完整清单和申请入口见 [.env.local.example](.env.local.example)。

### 登录说明

邮箱密码注册开箱即用。若要启用 Google 登录：在 Supabase 后台开启 Google Provider，并确保 *Authentication → URL Configuration* 与实际访问的域名完全一致——`localhost`、`127.0.0.1`、局域网 IP 互不相通，PKCE 的 code verifier 存在发起登录那个域名的 cookie 里。

### 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发服务器 |
| `pnpm build` && `pnpm start` | 生产构建与启动 |
| `pnpm lint` | ESLint 检查 |
| `pnpm eval` | 离线评测（读 fixtures 断言，不花 token） |
| `pnpm eval:live` | 在线评测（真实调用 + LLM 评审） |
| `pnpm redteam` | 护栏红队测试 |
| `pnpm trace:demo` | 生成一条可观测追踪示例 |
| `pnpm memory:demo` | 记忆写入 / 召回演示 |
| `pnpm analyze:study` | 汇总 HCI 问卷与埋点数据 |

### 部署

可直接部署到 Vercel：导入仓库后在项目设置里配置与本地相同的环境变量即可。数据库仍用 Supabase 云服务，无需额外改动。

## HCI 研究支持

本项目同时用于人机交互课程的用户评估：

- **交互埋点**：`lib/log.ts` → `POST /api/log` → `interaction_logs` 表，覆盖建行程、规划完成、应用/放弃提案、撤销、拖拽、编辑、保存等事件。
- **评估问卷**：`/study` 页内建 SUS（可用性）、NASA-TLX（任务负荷）与信任量表，作答与埋点同表存储，`pnpm analyze:study` 输出汇总。

## 目录结构

```
app/
  api/            # 路由处理器：trips（规划/编辑/分享/ics）、trains、flights、
                  #   weather、geocode、memories、log、agent …
  trips/[id]/     # 行程详情：可编辑时间轴 + 行程地图 + 可观测面板
  copilot/        # 右下角智能体 Dock（对话 / 提案卡 / 记忆面板）
  study/          # HCI 评估问卷（SUS / NASA-TLX / 信任）
  share/[token]/  # 公开只读分享页
  demo/[slug]/    # 目的地演示行程
lib/
  pipeline.ts     # 编排器：波内并行 / 波间顺序 / 重试 / 断点续跑
  agents/         # 8 个智能体 + schemas / prompt / runAgent（provider 抽象）
  deepseek.ts     # DeepSeek 调用 + function calling 工具循环
  search.ts       # Tavily 搜索后端（可插拔）
  hotels.ts stations.ts airports.ts  # 确定性预订链接（Booking / 12306 / 携程）
  guardrails/     # 提示注入护栏
  otel/           # 追踪与成本归集
  memory/         # 长期记忆 + 向量召回
eval/             # 评测体系（dataset / assertions / judge / report）
guardrail/        # 红队测试集
supabase/migrations/   # 0001–0007 建表 SQL（按序执行）
scripts/          # 演示与走查脚本（trace-demo / memory-demo / ui-shots / readme-shots …）
```

## License

[MIT](LICENSE) © Zihao Guo
