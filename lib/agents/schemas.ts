/**
 * 每个 agent 的结构化输出 json_schema。
 * 通过 output_config.format 强制 Claude 返回规范 JSON，直接写进 agent_outputs.payload。
 *
 * 注意结构化输出的 schema 限制：所有 object 必须 additionalProperties:false 且
 * required 列出全部属性（不支持 minLength/maximum 等约束）。所以这里把字段都设为 required，
 * 模型用空串/0 填充缺失项。
 */

const obj = (
  properties: Record<string, unknown>,
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const str = { type: "string" };
const num = { type: "number" };
const strArr = { type: "array", items: { type: "string" } };

// ── enrichment：目的地背景调研 ──
export const enrichmentSchema = obj({
  summary: str,
  best_seasons: strArr,
  currency: str,
  language: str,
  safety_notes: strArr,
  local_tips: strArr,
});

// ── activities：景点/活动推荐 ──
export const activitiesSchema = obj({
  activities: {
    type: "array",
    items: obj({
      name: str,
      category: str, // 文化/自然/购物/夜生活...
      area: str,
      why: str,
      est_cost: num, // 当地货币或人民币估算
      duration_hours: num,
    }),
  },
});

// ── food：餐饮指南 ──
export const foodSchema = obj({
  dining: {
    type: "array",
    items: obj({
      name: str,
      cuisine: str,
      area: str,
      price_level: str, // $ / $$ / $$$
      note: str,
    }),
  },
});

// ── scheduling：逐日行程框架 ──
export const schedulingSchema = obj({
  days: {
    type: "array",
    items: obj({
      day: num,
      date: str,
      theme: str,
      blocks: {
        type: "array",
        items: obj({
          time: str, // 上午/下午/晚上 或 09:00
          title: str,
          kind: str, // activity/food/rest/transit
          detail: str,
        }),
      },
    }),
  },
});

// ── transport：交通物流 ──
export const transportSchema = obj({
  outbound: str, // 去程：从出发地到目的地的主要交通（航班/高铁/长途等）
  inbound: str, // 返程：从目的地回出发地
  airport_transfer: str, // 目的地机场/车站 ↔ 市区
  intercity: str, // 目的地内/周边的城际中转（如有）
  local: {
    type: "array",
    items: obj({
      from_area: str,
      to_area: str,
      mode: str, // 地铁/步行/出租/巴士
      note: str,
    }),
  },
});

// ── hub_planner：综合后的最终行程 ──
export const itinerarySchema = obj({
  title: str,
  overview: str,
  days: {
    type: "array",
    items: obj({
      day: num,
      date: str,
      theme: str,
      items: {
        type: "array",
        items: obj({
          time: str,
          title: str,
          kind: str,
          detail: str,
          est_cost: num,
        }),
      },
    }),
  },
  references: {
    type: "array",
    items: obj({ label: str, value: str }),
  },
});

// ── validator：出行前质检报告 ──
export const validatorSchema = obj({
  passed: { type: "boolean" },
  issues: {
    type: "array",
    items: obj({
      severity: str, // high/medium/low
      area: str,
      note: str,
    }),
  },
  suggestions: strArr,
});
