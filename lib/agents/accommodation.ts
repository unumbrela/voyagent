import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { accommodationSchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import { hotelBookingUrl } from "@/lib/hotels";
import { guardUrls } from "@/lib/guardrails";
import type { AgentContext, TripContext } from "./types";

interface HotelOption {
  name?: string;
  price_per_night_cny?: string;
  booking_url?: string;
  source_url?: string;
  [k: string]: unknown;
}
interface AccommodationPayload {
  options?: HotelOption[];
  [k: string]: unknown;
}

const isPlaceholder = (s?: string) =>
  !s || /见预订链接|实时查询|待查|未知/.test(s);

/**
 * 确定性后处理（不信任模型给的链接，硬保证「真实可下单」）：
 * - 每家酒店的 booking_url 统一覆盖为 Booking.com 深链：能定到酒店名就落到该酒店，
 *   否则落到该城市该日期的真实房态列表。source_url（出处）保留模型从搜索填的值。
 */
function applyBookingLinks(payload: AccommodationPayload, c: TripContext): void {
  const city = c.destination;
  for (const o of payload.options ?? []) {
    const query = isPlaceholder(o.name) ? city : `${o.name} ${city}`;
    o.booking_url = hotelBookingUrl({
      query,
      checkin: c.start_date,
      checkout: c.end_date,
      partySize: c.party_size,
    });
  }
}

/** Accommodation：住宿（依赖活动分布选区位，DeepSeek + 自建 web 搜索，对真实性负责） */
export async function runAccommodation(ctx: AgentContext) {
  const payload = await runAgent<AccommodationPayload>({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    useWebSearch: true,
    schema: accommodationSchema,
    system:
      "你是住宿规划专家，对【真实性】负责。核心铁律：所有酒店名、价格、评分都必须来自 " +
      "web_search 的真实结果，绝不凭记忆编造。\n" +
      "工作流程：\n" +
      "1) 先定【住哪个区域】：结合上游 activities 的景点分布与目的地背景，挑动线最短、" +
      "贴近主要景点或交通枢纽的商圈（在 area_advice 说明理由）。\n" +
      "2) 必须真的多次调用 web_search：搜该城市/该区域的真实酒店（查询词带城市、区域、" +
      "『酒店 推荐 价格 携程 或 booking』、以及星级/风格关键词）。\n" +
      "3) options 给 2~4 家【真实存在】的酒店：名称、类型（酒店/民宿/青旅/公寓）、所在区域" +
      "（注明靠近哪些景点）、每晚价格区间、评分/星级、推荐理由，每条都带 source_url（搜索来源）。\n" +
      "4) 搜不到具体酒店时：name 填『见预订链接』、price_per_night_cny 填『实时查询』、" +
      "source_url 留空——绝不编造酒店名或价格。\n" +
      "【预算意识】：每晚价应与（总预算 ÷ 天数 ÷ 人数 的住宿占比）大致匹配，不要推明显超预算的；" +
      "预算未知则给经济/中端/高端各一档。\n" +
      "booking_url 先填官方平台链接即可（后端会统一替换为真实房态深链）。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["enrichment", "activities"]),
  });
  // 硬保证：预订链接统一覆盖为真实可下单深链
  applyBookingLinks(payload, ctx.context);
  // 输出关：预订链接域白名单安全网（与 transport 对称，防被诱导产出钓鱼链接）
  const urlFindings = guardUrls(payload);
  if (urlFindings.length) {
    console.warn(
      `[guardrail] accommodation 输出链接命中 ${urlFindings.length} 条：`,
      urlFindings.map((f) => f.id).join(", "),
    );
  }
  return payload;
}
