import { callDeepSeekJSON, DEEPSEEK } from "@/lib/deepseek";
import { contextBlock } from "./prompt";
import type { AgentContext } from "./types";

/** 打包清单一项（label + 分组），id/checked 由路由/前端补齐 */
export interface PackingItem {
  label: string;
  group: string;
}

const GROUPS = ["证件", "衣物", "电子", "洗漱", "其他"] as const;

const packingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "group"],
        properties: {
          label: { type: "string" },
          group: { type: "string", enum: [...GROUPS] },
        },
      },
    },
  },
} as const;

/**
 * Packing：结合目的地、日期/季节、天气与活动类型，生成一份可勾选的打包清单。
 * 季节由日期推断；若给了天气摘要则据此增减（雨具/防晒/保暖等）。不编造，宁少勿滥。
 */
export function runPacking(
  ctx: AgentContext,
  days: { theme?: string; items?: { kind?: string; title?: string }[] }[],
  weatherHint?: string,
) {
  // 活动概览：给模型一点行程语境（户外/城市/美食比重等）
  const themes = days.map((d) => d.theme).filter(Boolean).join("、");
  const kinds = new Set<string>();
  for (const d of days) for (const it of d.items ?? []) if (it.kind) kinds.add(it.kind);

  return callDeepSeekJSON<{ items: PackingItem[] }>({
    model: DEEPSEEK.chat,
    maxTokens: 2000,
    schema: packingSchema as unknown as Record<string, unknown>,
    system:
      "你是出行打包助手。为这趟旅行列一份**实用、精简**的打包清单，" +
      `按分组归类：${GROUPS.join(" / ")}。\n` +
      "要求：\n" +
      "- 结合目的地、季节（据日期推断）、天气与活动类型来定（如多雨→雨具、户外多→防晒/舒适鞋、寒冷→保暖层）。\n" +
      "- 每项简短具体（如「充电宝」「防晒霜 SPF50」「身份证/护照」），总数控制在 15~25 项，宁缺毋滥、不要凑数。\n" +
      "- 只列通用可靠的物品，不编造与该目的地无关的东西。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      `行程主题：${themes || "（未提供）"}\n` +
      `涉及的活动类型：${[...kinds].join("、") || "（未知）"}\n` +
      (weatherHint ? `天气摘要：${weatherHint}\n` : "") +
      `\n请据此生成打包清单。`,
  });
}
