# 将智能旅行规划器改造为「人机交互」毕设项目 — 改造方案

> 定位：毕业设计 / 较大工程。目标不是重写功能，而是把现有「AI 系统工程展示」重心
> 转到「人的一侧」，补齐 HCI 毕设答辩必看的三件事：**交互创新、可用性、用户评估**，
> 同时保留（并复用）已有的多智能体后端作为技术深度支撑。

---

## 0. 研究主线（用于开题 / 论文题目）

**题目建议**：面向复杂规划任务的「混合主动式人–AI 协作」交互设计与评估
——以旅行行程共创为例
（*Mixed-Initiative Human–AI Collaboration for Complex Planning: Design and Evaluation*）

**一句话叙事**：旅行行程是一个开放式、约束多、需要反复权衡的复杂产物。让用户与一个
多智能体 AI「共创」它时，如何设计人与机器之间的**主动权分配、过程可见性、证据可信性**，
使用户既省力、又保有掌控感与恰当的信任？

**三个研究问题（RQ）**
- RQ1（控制权 / 混合主动）：把「表单 + 自然语言对话 + 直接操作」统一到同一份共享状态、
  且 AI 的每次改动都以「可撤销的 diff 预览」先呈现，能否在降低操作负担的同时保住用户掌控感？
- RQ2（可解释 / 过程可见）：把多智能体的「黑箱」升级为可探索的「推理/取证过程」
  （它搜了什么、选了谁、为什么、放弃了谁），能否提升用户对 AI 的理解与信任？
- RQ3（信任校准）：为每条 AI 结论标注**来源 + 核实状态**（已核实 / 实时查询 / 未核实），
  能否帮助用户校准信任、并更快发现 AI 的错误？

这三条恰好对应下面三个交互创新点，且都能落到你现有代码上。

---

## 1. 现状盘点（改造起点）

已具备（HCI 富矿，需「提炼」而非「新建」）：
- 表单式创建（自动定位、时间感知）：`app/page.tsx`
- 可拖拽排序 / 跨天移动 / 内联编辑的时间轴：`app/trips/[id]/page.tsx`、`Timeline.tsx`
- 全站 AI Copilot「小行」：事件流 + 生成式卡片 + **diff 预览后再应用 + 撤销**
  `app/copilot/CopilotDock.tsx`、`app/api/agent/*`、`lib/agent/*`
- 对话式助手、候选探索池、打包清单、预算看板、地图、天气、倒计时、分享/日历导出
- 多智能体后端（8 agent，波内并行/波间顺序）+ SSE 实时进度 + 证据取证（不编造）
- 交互数据基建雏形：`supabase/migrations/0003_interaction.sql`（chat / packing / 👍👎偏好）

结论：**交互创新点已有 70% 的地基**，缺的是①把它们做成可对比的「设计决策」；
②过程/证据的可见化还不够；③完全没有**用户评估**环节。

---

## 2. 三个交互创新点（论文的核心贡献）

### 创新点 A — 可控的混合主动式共创（对应 RQ1）
把「填表→提交→看结果」升级为**三模态共编同一份行程状态**：
- 自然语言对话（小行主动追问：预算？节奏？带娃/带老人？偏好？）
- 直接操作（拖拽、内联编辑，已具备）
- 轻量表单/滑块（节奏、预算、兴趣权重）
- **统一协议：propose → review(diff) → commit / undo**——AI 的任何改动都先以可撤销的
  差异卡呈现，用户确认才落库。你在 `ChatPanel`/`CopilotDock` 已有雏形，需**统一并前置为
  贯穿全站的交互契约**，并作为论文里可命名的「设计模式」。

落点文件：`app/trips/[id]/page.tsx`（共享状态 + 编辑）、`app/copilot/*`、`lib/diff.ts`。

### 创新点 B — 多智能体过程可见化 / 可解释（对应 RQ2）
现在 8 个 agent 只是「点亮的圆点」。升级为**可展开的推理/取证轨迹**：
- 每个 agent：它读了什么上下文、发起了哪些 web 搜索、命中哪些结果、
  **选了谁 vs 放弃了谁（候选池就是现成的「被放弃项」）**、给出的理由。
- 每条最终推荐加「为什么推荐它」+ 置信度。
落点：进度面板（`app/trips/[id]/page.tsx` 的 `AGENTS` 段）、`lib/pipeline.ts`（回调里多带
过程数据）、候选池 `CandidatePool`、`app/api/trips/[id]/plan`。

### 创新点 C — 证据锚定的信任校准（对应 RQ3）
你后端已经「取证、不编造、带 source_url / booking_url」。把它**在 UI 上显性化**为
可信度徽章：`已核实（有来源）/ 实时查询 / 未核实`，并允许用户一键核对来源。
论文里作为「provenance display → 信任校准」的可测变量。
落点：`ItemCard`、references 区、`lib/transport.ts`/`lib/hotels.ts` 已产出的字段。

---

## 3. 分阶段实施计划

> 每阶段给出「做什么 / 主要落点 / 产出物」。建议按 P0→P4 顺序，P0 与 P4 是毕设的
> 「研究骨架」，中间三阶段是「交互实现」。

### P0 — 研究骨架 + 评估基建（先做，1 周）
- 重写 `README` / 新增 `docs/` 叙事：从「复现多智能体架构」改为「人–AI 协作交互研究」。
- **交互日志埋点**：复用/扩展 `0003_interaction.sql`，新增一张 `interaction_logs` 表
  （trip_id, user_id, event_type, payload jsonb, ts）。前端统一一个 `logEvent()` 打点：
  发起对话、应用/放弃 diff、拖拽、撤销、点开来源、修改条目……
- 定义评估指标与量表（见 §4），准备任务脚本与问卷页 `/study`。
- 产出：开题报告草稿、指标定义、埋点 SDK。

### P1 — 创新点 A：混合主动式共创（2 周）
- 把 `page.tsx` 的行程状态、`CopilotDock`、`ChatPanel` 收敛到**单一共享控制器**
  （`app/copilot/store.tsx` 已有 `ItineraryController`，据此统一）。
- 小行支持「从零对话建行程」：机器主动追问 → 边聊边在右侧长出行程（复用 SSE + 事件流）。
- 统一 `propose→review→commit→undo` 协议，diff 卡样式统一、全站一致。
- 加偏好滑块（节奏/预算/兴趣），拖动即触发局部重排（复用 `refine` 端点）+ 动效过渡。
- 产出：可对比的「增强版」交互；埋点覆盖。

### P2 — 创新点 B：过程可见化（1.5 周）
- 进度面板升级为可展开轨迹；`pipeline` 回调多带「搜索词/命中/选择理由」。
- 候选池标注「为什么没被选中 / 被谁的哪条替代」，与最终行程双向高亮。
- 每条推荐加「为什么」气泡。
- 产出：explainability 版本（作为评估里的一个实验条件）。

### P3 — 创新点 C + 多模态 + 无障碍（1.5 周）
- 可信度徽章 + 一键核对来源（信任校准）。
- 多模态：语音输入（Web Speech API）、地图点选目的地（Leaflet 已在）、可选图片识别地点。
- 无障碍：键盘全可达、ARIA、焦点管理、对比度、`prefers-reduced-motion` 关动效。
- 产出：完整交互系统 + 演示效果。

### P4 — 用户评估 + 论文（2~3 周）
- 招募 12~20 名被试，任务如「¥6000 内规划成都 4 天美食+文化行程」。
- 组内对比：**基线**（表单 + 接受/拒绝，无解释、无 diff 预览）vs **增强**（混合主动 +
  过程可见 + 证据徽章）。任务顺序 counterbalance。
- 收集：SUS（可用性）、NASA-TLX（认知负荷）、信任量表、任务时长、编辑次数、
  主观满意度 + 半结构访谈 + 行为日志。
- 分析 + 撰写。产出：论文 + 答辩 demo。

---

## 4. 评估设计（毕设的关键差异化）

- **实验设计**：组内（within-subjects），2 条件（基线 / 增强），counterbalanced，
  同难度双任务避免学习效应。
- **自变量**：交互条件（是否混合主动 + 是否可解释 + 是否证据徽章）。
  可拆成 2×2 做更细的消融，或整体两组以保证样本量。
- **因变量 / 量表**：
  - 可用性：SUS（10 题）
  - 认知负荷：NASA-TLX
  - 信任：Human-AI trust scale（如 Madsen & Gregor / Cahour）
  - 效率：任务完成时间、达成约束所需编辑次数
  - 客观信任校准：AI 故意注入一处可疑数据，看用户是否借证据徽章发现
  - 行为日志：diff 应用/放弃比例、撤销次数、来源点开率、对话轮数
  - 定性：主观满意度 + 半结构访谈
- **样本**：12~20 人（毕设通常 12+ 即可），知情同意。
- **假设**：H1 增强组 SUS↑、TLX↓；H2 增强组信任更「校准」（不是盲目更高）、
  发现注入错误比例↑；H3 增强组掌控感与满意度↑。

---

## 5. 技术深度支撑（应对「工程量」质疑）

- 多智能体编排（orchestrator-worker，波内并行/波间顺序）：`lib/pipeline.ts`、`lib/agents/*`
- 自建 function-calling web 搜索 + 证据取证 + 确定性预订深链：`lib/deepseek.ts`、
  `lib/search.ts`、`lib/stations.ts`、`lib/airports.ts`、`lib/hotels.ts`
- SSE 流式 + AG-UI 事件协议：`app/api/.../plan`、`app/api/agent`、`lib/agent/*`
- 可靠性：单 agent 退避重试、断点续跑、validator 闭环修订（`lib/pipeline.ts`）
- 数据：Supabase + Auth + RLS 用户隔离 + 交互日志（新增）

> 论文里把它们定位为「支撑交互研究的系统实现」，而非主贡献——重心始终在人的一侧。

---

## 6. 风险与取舍

- **不要全推倒重来**：现有交互地基是最大优势，改造以「提炼 + 补齐评估」为主。
- **评估是最易被砍又最提分的环节**：即便功能少一个，也要保住 P0 埋点 + P4 用户研究。
- **样本量 / 招募**：提前规划，12 人起步，双任务组内设计降低人数需求。
- **AI 不确定性**：证据徽章 + 注入错误任务反而把「AI 会错」变成研究亮点，而非缺陷。

---

## 7. 建议的下一步

1. 确认研究主线与三个 RQ（可微调）。
2. 我先落 **P0**：改 README 叙事 + 建 `interaction_logs` 表 + 前端 `logEvent()` 埋点 + `/study` 问卷页骨架。
3. 再按 P1→P3 逐个交互创新点实现，每步配埋点。
4. P4 跑评估、出图、写作。

---

## 8. 实施进展

### P0 — 研究骨架 + 评估基建 ✅
- `supabase/migrations/0004_interaction_logs.sql`：埋点日志表 + RLS（需手动在 Supabase 执行）。
- `app/api/log/route.ts`：批量写入端点（兼容 sendBeacon，未登录静默）。
- `lib/log.ts`：前端 `logEvent()`（缓冲 + 定时/pagehide flush，sessionStorage 会话号）。
- 接入关键事件：`trip_create`/`plan_done`/`save`/`undo`/`item_*`/`drag_move`/`candidate_add`/
  `diff_apply`/`diff_discard`/`chat_send`/`source_open`（首页、行程页、CopilotDock）。
- `app/study/page.tsx`：SUS + NASA-TLX + 信任量表，提交为 `event_type='survey'`。
- README 顶部改为 HCI 研究定位。

### P1 — 混合主动式共创（RQ1）✅
- 复用已存的共享控制器 / `create_trip` 从零对话建行程 / propose→review→commit→undo。
- 新增 `PreferencePanel`（节奏/预算/兴趣滑块 → 组合指令 → refine 预览式重排 → 确认才提交）。
- `refine` 端点加 `preview` 标志（只算不写库，保证「预览不改库」）。
- CopilotDock「改动前先让我确认」开关（`AppState.alwaysPreview` → `edit_itinerary` 决策），
  即 RQ1 可对照实验的**控制权自变量**。

### P2 — 多智能体过程可见化（RQ2）✅
- `lib/trace.ts`：把 `agent_outputs` 归纳成每个 agent「做了什么/首选/候选数/取证来源」。
- `app/api/trips/[id]/trace/route.ts`：纯读库端点。
- 行程页 `ProcessTrace` 面板：逐 agent 可展开，绿色徽章=带可核实来源、橙色=有未选入候选；
  埋点 `trace_open`/`trace_expand_agent`/`source_open(via:trace)`。
- 候选池每个候选打「已选入行程 / 备选」标签（选中 vs 放弃可见化）。

### P3 — 证据可信度(RQ3) + 多模态 + 无障碍 ✅
- 可信度徽章：`ItemCard` 按候选取证信息标「✓ 已核实来源 / 🔗 可查证 / ⚠ 待核实」，
  「已核实」可点开来源核对；行程页顶部加图例。取证索引复用 `/candidates`（含 source_url）。
  埋点 `source_open(via:item_badge)`。
- 多模态：CopilotDock 语音输入（Web Speech API，中文识别，`useVoiceDictation`），埋点 `voice_input`。
- 无障碍：`layout` 加 `MotionConfig reducedMotion="user"`（motion 动画随系统关闭）；
  CSS 已有 `prefers-reduced-motion`；`lang="zh-CN"`；图标按钮补 `aria-label`。

### P4 — 数据分析脚手架 ✅（评估执行/写作待办）
- `scripts/analyze-study.ts`（`pnpm analyze:study [--csv <目录>]`）：service_role 读全量
  `interaction_logs`，按 session 聚合行为指标（任务时长/编辑次数/接受率/撤销/对话轮数/
  偏好重排/过程面板使用/点开来源/语音）+ 并入同 session 问卷分（SUS/TLX/信任），
  按 baseline/enhanced 汇总（n/均值/中位/SD）+ 增强−基线速览，可导出 sessions.csv /
  by-condition.csv 供 R/Python/SPSS 做配对 t / Wilcoxon 检验。
- 已冒烟通过：脚本能连库、`interaction_logs` 表已存在（0004 已应用），当前 0 条（待被试使用产生）。

### 可选补强
- 地图点选目的地（首页表单）✅：`app/MapPicker.tsx`（Leaflet 无 key + CARTO 瓦片，
  点选→BigDataCloud 反地理编码回填目的地，已填目的地则前向地理编码居中）；首页「🗺️ 地图选点」
  可选展开，目的地输入改为受控，埋点 `destination_pick_map`。

### 具身数字人（Embodied Agent，RQ 扩展：拟人化对信任/参与度的影响）✅
- 3D 数字人：Ready Player Me 头像（`public/avatar.glb`，含 ARKit+Oculus Visemes）+ three.js/R3F。
  - 表情：`emotion`（idle/thinking/happy/concerned）驱动 ARKit blendshape + 自动眨眼；`app/copilot/DigitalHuman.tsx`。
  - 口型：`wawa-lipsync` 从 TTS 音频实时分析 viseme（provider 无关）→ `viseme_*` morph；无音频时程序化口型。
  - 发声：`app/api/tts/route.ts` 云 TTS（OpenAI/Azure/ElevenLabs 按 env 自动选；未配置→501→前端回退浏览器 Web Speech）。
  - 接入：`CopilotDock` 顶部可开关的数字人画面 + 静音；表情随事件流派生（tool_call→思考、apply→开心、error→抱歉）；
    助手回复→`speak()`。埋点 `avatar_toggle`/`avatar_mute`/`avatar_speak`。尊重 `prefers-reduced-motion`。
  - 依赖：`three`、`@react-three/fiber`、`@react-three/drei`、`wawa-lipsync`、`@types/three`。
  - 手动步骤：如需更自然音色，在 `.env.local` 配置一种云 TTS key（见 `.env.local.example`）；不配也能用（Web Speech）。

### 待办
- P4 执行：招募被试、按 §4 组内设计跑实验（记得让被试在 `/study` 选对 condition）、分析、写作。
- 可选补强：每条推荐的「为什么推荐」需改 agent prompt 输出 rationale。
