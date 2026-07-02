/**
 * Agent Memory 生命周期离线自测（零 key / 零 DB）。
 *
 *   pnpm memory:demo
 *
 * 用纯逻辑（extract/embed/consolidate/rank）+ 一个内存版 store 走完整闭环，
 * 验证 Agent Memory 的四个关键性质：
 *   1) 抽取 + 巩固：从多段话沉淀出偏好，去重不炸库；
 *   2) 相关性召回：查询按记忆流打分，相关记忆排前；
 *   3) 冲突消解：同槽位新偏好 supersede 旧偏好；
 *   4) 近重复合并 + 强化：重复表达不新增、只强化。
 */

import {
  extractDeterministic,
  consolidate,
  rankMemories,
  scoreMemory,
  embed,
  LOCAL_MODEL,
  type CandidateMemory,
  type MemoryItem,
} from "@/lib/memory";
import { randomUUID } from "node:crypto";

const USER = "demo-user";
const nowMs = Date.now();

/** 极简内存 store：把 store.ts 的写入语义（consolidate→apply）复刻到数组上 */
class MemStore {
  items: MemoryItem[] = [];

  async remember(cands: CandidateMemory[]) {
    const pairs = await Promise.all(
      cands.map(async (cand) => ({ cand, embedding: await embed(cand.text) })),
    );
    const plan = consolidate(this.items, pairs);
    const iso = new Date().toISOString();
    for (const s of plan.supersedes) {
      const it = this.items.find((x) => x.id === s.id);
      if (it) it.active = false;
    }
    for (const u of plan.updates) {
      const it = this.items.find((x) => x.id === u.id);
      if (it) {
        it.importance = u.importance;
        it.useCount += 1;
        if (u.text) it.text = u.text;
      }
    }
    for (const c of plan.inserts) {
      this.items.push({
        id: randomUUID(),
        userId: USER,
        kind: c.kind,
        subject: c.subject,
        text: c.text,
        importance: c.importance,
        embedding: pairs.find((p) => p.cand === c)!.embedding,
        embedModel: LOCAL_MODEL,
        createdAt: iso,
        lastUsedAt: iso,
        useCount: 0,
        source: c.source,
        active: true,
      });
    }
    return plan;
  }

  async recall(query: string, k = 5) {
    const q = await embed(query);
    const top = rankMemories(this.items, q, nowMs, k, { minRelevance: 0.02 });
    // 强化：被召回的记忆 use_count++（镜像 store.ts recall 的行为）
    for (const s of top) s.item.useCount += 1;
    return top;
  }

  get active() {
    return this.items.filter((i) => i.active);
  }
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error("断言失败: " + msg);
};

async function main() {
  const store = new MemStore();

  // ── 1) 从几段真实用户话里抽取 + 巩固 ──
  const utterances = [
    "帮我规划东京，我怕早起，节奏别太赶，最爱逛美术馆",
    "预算有限，尽量便宜点，找点地道美食",
    "我带着小孩，得亲子友好一些",
  ];
  console.log("── 1) 抽取 + 巩固 ──");
  for (const u of utterances) {
    const cands = extractDeterministic(u, "copilot");
    const plan = await store.remember(cands);
    console.log(
      `  「${u.slice(0, 16)}…」→ 抽取 ${cands.length} 条，新增 ${plan.inserts.length}`,
    );
  }
  console.log(`  当前活跃记忆 ${store.active.length} 条：`);
  for (const m of store.active) console.log(`    · [${m.subject}] ${m.text}`);
  assert(store.active.length >= 5, "应沉淀出多条偏好");

  // ── 2) 相关性召回：问博物馆，应召回"爱美术馆" ──
  console.log("\n── 2) 相关性召回（query: 东京 博物馆 艺术展）──");
  const top = await store.recall("东京 博物馆 艺术展", 3);
  for (const s of top)
    console.log(
      `  ${s.score.toFixed(3)}  (rel ${s.relevance.toFixed(2)}) ${s.item.text}`,
    );
  assert(top[0].item.subject === "interest.museum", "美术馆偏好应排第一");

  // ── 3) 冲突消解：用户改口"其实喜欢早起"，同槽位 supersede 旧的 ──
  console.log("\n── 3) 冲突消解（用户改口：其实我喜欢早起）──");
  const before = store.active.find((m) => m.subject === "pace.wake_time");
  const plan = await store.remember(
    extractDeterministic("其实我挺喜欢早起的，早点出发", "copilot"),
  );
  const after = store.active.find((m) => m.subject === "pace.wake_time");
  console.log(`  supersede ${plan.supersedes.length} 条；现槽位记忆：${after?.text}`);
  assert(plan.supersedes.length === 1, "旧的早起偏好应被 supersede");
  assert(before?.text !== after?.text && !!after, "同槽位应更新为新偏好");
  assert(
    store.items.filter((m) => m.subject === "pace.wake_time" && m.active).length === 1,
    "同槽位活跃记忆应唯一",
  );

  // ── 4) 近重复合并：换个说法重复"爱美食"，不新增只 update ──
  console.log("\n── 4) 近重复合并（不炸库）──");
  const cntBefore = store.active.length;
  const plan2 = await store.remember(extractDeterministic("我就是个吃货，超看重美食", "copilot"));
  console.log(
    `  新增 ${plan2.inserts.length}、update ${plan2.updates.length}；活跃记忆 ${cntBefore}→${store.active.length}`,
  );
  assert(plan2.inserts.length === 0, "近重复不应新增记忆");
  assert(plan2.updates.length === 1, "近重复应命中既有记忆做 update");
  assert(store.active.length === cntBefore, "近重复不应增加记忆总数");

  // ── 5) 召回强化：再次召回博物馆，use_count 增长 ──
  console.log("\n── 5) 召回强化（use_count 增长）──");
  const museum = () => store.active.find((m) => m.subject === "interest.museum")!;
  const useBefore = museum().useCount;
  await store.recall("美术馆 展览", 3);
  const useAfter = museum().useCount;
  console.log(`  博物馆记忆 use_count ${useBefore}→${useAfter}`);
  assert(useAfter > useBefore, "被召回的记忆应被强化（use_count++）");

  // ── embed 确定性 ──
  const e1 = await embed("测试确定性");
  const e2 = await embed("测试确定性");
  assert(JSON.stringify(e1) === JSON.stringify(e2), "同文本 embedding 应确定");

  // ── 6) 向量空间不匹配保护：维度不同应视为不可比（relevance=0），而非静默算垃圾相似度 ──
  const crossSpace: MemoryItem = { ...museum(), embedding: [0.1, 0.2, 0.3, 0.4] };
  const s = scoreMemory(crossSpace, await embed("博物馆"), nowMs);
  console.log(`\n── 6) 跨向量空间保护：relevance=${s.relevance} ──`);
  assert(s.relevance === 0, "维度不同的记忆 relevance 应为 0（防跨空间漏召回/误召回）");

  console.log(
    "\n✅ Agent Memory 自测通过（抽取/巩固 · 相关性召回 · 冲突消解 · 近重复强化 · embed 确定性）",
  );
}

main().catch((e) => {
  console.error("✗ memory demo 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
