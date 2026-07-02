# Eval：多智能体行程规划的评测体系

回答一个 Agent 工程师必须能答的问题：**「你怎么知道你的 Agent 变好了 / 没退化？」**

评测分两层，刻意解耦「生成」与「打分」：

```
用例(dataset) ──┬─ [离线] 读 fixtures/*.json ────┐
                └─ [--live] 内存流水线真实重跑 ──┘→ PipelineResult
                                                     │
                              ┌──────────────────────┴───────────────────┐
                        确定性断言(assertions)                 LLM-as-Judge(judge)
                        硬约束/反幻觉，纯函数，零 key            主观质量，rubric 1~5 分
                                                     │
                                          scorecard + report + CI gate
```

## 跑

```bash
pnpm eval                 # 离线：对着 fixtures 跑确定性断言（无需任何 key，CI 用这个）
pnpm eval --case tokyo-5d # 只跑单个用例
pnpm eval --judge         # 追加 LLM-as-Judge 打分（需 DEEPSEEK_API_KEY）
pnpm eval:live            # 真实重跑内存流水线刷新 fixtures + 评审（需 DEEPSEEK_API_KEY）
```

任何 **high 级断言失败 → 退出码 1**，可直接作为 CI 回归门禁。

## 确定性断言（`assertions.ts`）

把项目里散落的「硬规则」收成一套可回归检查，每条对应线上的一处不变式：

| 断言 | 级别 | 对应线上实现 |
| --- | --- | --- |
| `day_count` / `dates_consecutive` | high | 行程天数须与日期吻合 |
| `departure_first` | high | `finalize.ensureDepartureFirst`：首日第一项是去程出发 |
| `transport_grounded` / `accommodation_grounded` | high | **反幻觉**：有具体车次/航班/酒店名 → 必须带 `source_url` |
| `outbound_after_now` / `outbound_after_depart_time` | high | `transport.enforceTimeWindows`：不推已发车/过早的去程 |
| `inbound_before_return_by` | medium | 返程到达早于「最晚到达时间」 |
| `*_booking_url` | medium | 每个选项都有可下单链接 |
| `budget_fit` | medium | 花费合计不大幅超预算 |
| `items_valid` / `references_present` | low | 字段完整、附来源 |

这些是**纯函数**，因此离线、确定、可进 CI——是「反幻觉率降到 0」这类简历结论的可复现证据。

## LLM-as-Judge（`judge.ts`）

硬约束之外的「好不好」交给评审模型，用显式 rubric（可行性 / 动线 / 预算贴合 / 风格契合 / 节奏，各 1~5 分）压住评分漂移。

## 用例与 fixtures

- `dataset.ts`：用例集，挑有区分度的组合（跨境航班 vs 国内高铁、当天出发、紧/宽预算、有/无出发地）。
- `fixtures/*.json`：已保存的流水线产物，让评测**离线可复现**。`osaka-flawed.json` 有意埋入 4 处缺陷（少一天、首项是入住、编造车次、当天已发车），用来演示评测确实能抓到回归——`pnpm eval` 会看到它 4 个 high 失败。
- `--live` 会用真实模型重算并覆盖 fixtures。

## 扩展方向

- 工具调用准确率评测（Copilot「小行」该调 `create_trip`/`edit_itinerary` 时有没有调、参数对不对）。
- 轨迹级评测（多 agent 的 token/延迟/成本瀑布，接 Langfuse）。
- 对抗用例（prompt injection：web 搜索抓到的恶意网页能否越权改行程）。
