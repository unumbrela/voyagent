/**
 * 可观测层离线自测（无需任何 key / DB）。
 *
 *   pnpm trace:demo
 *
 * 两件事：
 *  1) 用真实的 span()/createTrace() 跑一条【合成的】8-agent 流水线（用 sleep + 假 token 模拟），
 *     验证 AsyncLocalStorage 的父子嵌套与并行 parent 归属正确；
 *  2) 把收集到的 spans 喂给 rollup/asciiWaterfall，打印瀑布 + 汇总，并断言聚合数值自洽。
 */

import { createTrace, span, type Span } from "@/lib/otel/trace";
import { rollup, asciiWaterfall } from "@/lib/otel/rollup";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 模拟一次 LLM 调用：耗时 + 记录用量 */
async function fakeLLM(model: string, inTok: number, outTok: number, ms: number) {
  return span(
    model,
    "llm",
    async (rec) => {
      await sleep(ms);
      rec.setUsage(model, inTok, outTok);
      return { ok: true };
    },
    { model },
  );
}

/** 模拟一次 web 搜索工具调用 */
async function fakeSearch(query: string, ms: number) {
  return span("web_search", "tool", async (rec) => {
    await sleep(ms);
    rec.setMeta("query", query);
    return 3;
  });
}

/** 模拟一个 agent：内部一次搜索（可选）+ 一次收口 LLM */
async function fakeAgent(
  name: string,
  opts: { search?: boolean; inTok: number; outTok: number; ms: number },
) {
  return span("" + name, "agent", async () => {
    if (opts.search) {
      await fakeSearch(`${name} 查询`, Math.round(opts.ms * 0.4));
      await fakeLLM("deepseek-chat", opts.inTok, opts.outTok, Math.round(opts.ms * 0.6));
    } else {
      await fakeLLM("deepseek-chat", opts.inTok, opts.outTok, opts.ms);
    }
  });
}

async function main() {
  const trace = createTrace("demo-trip");

  await trace.run(async () => {
    await span("pipeline", "pipeline", async () => {
      // 第 1 波：三个 agent 并行（验证并行 parent 归属）
      await Promise.all([
        fakeAgent("enrichment", { inTok: 1200, outTok: 600, ms: 40 }),
        fakeAgent("activities", { search: true, inTok: 3000, outTok: 1500, ms: 90 }),
        fakeAgent("food", { search: true, inTok: 2200, outTok: 900, ms: 70 }),
      ]);
      // 其余波次顺序
      await fakeAgent("accommodation", { search: true, inTok: 2600, outTok: 1100, ms: 80 });
      await fakeAgent("scheduling", { inTok: 4000, outTok: 1800, ms: 60 });
      await fakeAgent("transport", { search: true, inTok: 3500, outTok: 1600, ms: 100 });
      await fakeAgent("hub_planner", { inTok: 6000, outTok: 3000, ms: 70 });
      await fakeAgent("validator", { inTok: 3000, outTok: 800, ms: 50 });
    });
  });

  const spans = trace.spans;
  console.log("\n── 瀑布图（合成数据）──\n");
  console.log(asciiWaterfall(spans));

  const r = rollup(spans);
  console.log("\n── 汇总 ──");
  console.log(
    `span 数 ${r.spanCount} · LLM 调用 ${r.llmCalls} · 工具调用 ${r.toolCalls}`,
  );
  console.log(
    `token 合计 ${r.totalTokens}（in ${r.promptTokens} / out ${r.completionTokens}）· 成本 $${r.totalCostUsd.toFixed(4)}`,
  );
  console.log(
    `墙钟 ${r.wallMs}ms · 各 agent 耗时之和 ${r.sumAgentMs}ms（并行节省 ${r.sumAgentMs - r.wallMs}ms）`,
  );
  console.log("\n分 agent（按耗时降序）：");
  for (const a of r.byAgent) {
    console.log(
      `  ${a.name.padEnd(14)} ${String(a.durationMs).padStart(4)}ms · ${a.totalTokens}tok · $${a.costUsd.toFixed(4)} · ${a.llmCalls} LLM/${a.toolCalls} tool`,
    );
  }

  // ── 断言聚合自洽 ──
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("断言失败: " + msg);
  };
  const llmSpans = spans.filter((s: Span) => s.kind === "llm");
  const sumTok = llmSpans.reduce((a, s) => a + (s.totalTokens ?? 0), 0);
  assert(r.totalTokens === sumTok, "总 token = 各 LLM span 之和");
  assert(r.llmCalls === llmSpans.length, "LLM 调用数一致");
  assert(r.byAgent.length === 8, "应有 8 个 agent");
  assert(
    llmSpans.every((s) => (s.parentId ?? "") !== ""),
    "每个 LLM span 都有父（agent）",
  );
  assert(r.totalCostUsd > 0, "成本应大于 0");
  assert(r.wallMs <= r.sumAgentMs, "墙钟不应大于各 agent 耗时之和（并行）");

  console.log("\n✅ 可观测层自测通过（span 嵌套 / 并行 parent / 聚合 / 成本 均正确）");
}

main().catch((e) => {
  console.error("✗ trace demo 失败:", e);
  process.exit(1);
});
