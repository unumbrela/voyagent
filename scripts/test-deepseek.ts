/**
 * DeepSeek 路径冒烟测试。
 * 直接调用走 DeepSeek 的两个 agent（enrichment / food），验证能产出合法结构化 JSON。
 *
 * 运行：
 *   DEEPSEEK_API_KEY=sk-... pnpm test:deepseek
 */
import { runEnrichment } from "@/lib/agents/enrichment";
import { runFood } from "@/lib/agents/food";
import type { AgentContext } from "@/lib/agents/types";

interface Enrichment {
  summary: string;
  best_seasons: string[];
  currency: string;
  language: string;
  safety_notes: string[];
  local_tips: string[];
}
interface Food {
  dining: {
    name: string;
    cuisine: string;
    area: string;
    price_level: string;
    note: string;
  }[];
}

const ctx: AgentContext = {
  context: {
    destination: "东京",
    origin: "北京",
    start_date: "2026-09-01",
    end_date: "2026-09-05",
    budget: 12000,
    travel_style: "美食 + 文化，节奏轻松",
    party_size: 2,
    constraints: {},
  },
  upstream: {},
};

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

async function main() {
  console.log("→ 测试 Enrichment (DeepSeek deepseek-chat)…");
  const enr = (await runEnrichment(ctx)) as Enrichment;
  console.log(JSON.stringify(enr, null, 2));
  assert(typeof enr.summary === "string" && enr.summary.length > 0, "summary 非空字符串");
  assert(Array.isArray(enr.best_seasons), "best_seasons 是数组");
  assert(typeof enr.currency === "string", "currency 是字符串");
  assert(Array.isArray(enr.local_tips), "local_tips 是数组");
  console.log("✓ Enrichment 结构正确\n");

  console.log("→ 测试 Food (DeepSeek deepseek-chat)…");
  const food = (await runFood(ctx)) as Food;
  console.log(`返回 ${food.dining?.length ?? 0} 家餐厅，示例：`);
  console.log(JSON.stringify(food.dining?.slice(0, 3), null, 2));
  assert(Array.isArray(food.dining) && food.dining.length > 0, "dining 非空数组");
  assert(
    food.dining.every((d) => typeof d.name === "string" && typeof d.cuisine === "string"),
    "每家餐厅有 name/cuisine",
  );
  console.log("✓ Food 结构正确\n");

  console.log("✅ DeepSeek provider 路径全部通过");
}

main().catch((e) => {
  console.error("✗ 测试失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
