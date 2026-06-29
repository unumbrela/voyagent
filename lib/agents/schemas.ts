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

// ── accommodation：住宿 ──
// 每家酒店都要可核实：来源链接 + 真实预订深链；未搜到则标"实时查询"、不得编造。
const accommodationOption = obj({
  name: str, // 真实酒店名；未搜到填 "见预订链接"
  type: str, // 酒店/民宿/青旅/公寓
  area: str, // 所在区域/商圈，注明靠近哪些景点或交通枢纽
  price_per_night_cny: str, // 每晚价或区间（人民币），以平台实时为准；未知填 "实时查询"
  rating: str, // 评分/星级（来自搜索）；未知填 ""
  why: str, // 推荐理由：位置/性价比/契合风格
  booking_url: str, // 预订深链（由后端确定性覆盖为真实房态链接）
  source_url: str, // 信息来源链接（来自搜索结果）；未搜到填 ""
});

export const accommodationSchema = obj({
  recommended: str, // 一句话首选：选哪家、为何（位置/预算/契合度）
  area_advice: str, // 选区建议：结合活动分布说明住哪个区域动线最短
  options: { type: "array", items: accommodationOption }, // 2~4 家真实可选
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
// 每个具体班次都要可核实：来源链接 + 官方购票链接，未搜到则标注"实时查询"、不得编造。
const transportOption = obj({
  mode: str, // 高铁/动车/飞机/大巴/轮渡
  name: str, // 车次或航班号，如 "G7" / "MU515"；未搜到填 "见购票链接"
  depart: str, // 出发站/机场 + 时间，如 "上海虹桥 09:00"
  arrive: str, // 到达站/机场 + 时间
  duration: str, // 时长，如 "约4h28m"
  price_cny: str, // 票价或区间（人民币），注明以官方实时为准；未知填 "实时查询"
  booking_url: str, // 官方购票链接（12306 / 航司官网 / 携程）
  source_url: str, // 信息来源链接（来自搜索结果）；未搜到填 ""
});

const transportLeg = obj({
  from: str, // 出发地
  to: str, // 目的地
  recommended: str, // 一句话推荐：选哪个班次、为何（衔接/价格/时长）
  options: { type: "array", items: transportOption }, // 2~4 个真实可选班次
});

export const transportSchema = obj({
  outbound: transportLeg, // 去程：出发地 → 目的地
  inbound: transportLeg, // 返程：目的地 → 出发地
  airport_transfer: str, // 目的地端 机场/车站 ↔ 市区/酒店
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
