import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "./runAgent";
import { transportSchema } from "./schemas";
import { contextBlock, upstreamBlock } from "./prompt";
import { railBookingUrl } from "@/lib/stations";
import type { AgentContext, TripContext } from "./types";

interface TransportOption {
  depart: string;
  arrive: string;
  mode?: string;
  booking_url?: string;
  [k: string]: unknown;
}
interface TransportLeg {
  options?: TransportOption[];
  [k: string]: unknown;
}
interface TransportPayload {
  outbound?: TransportLeg;
  inbound?: TransportLeg;
  [k: string]: unknown;
}

/** 从 "上海虹桥 16:00" 这类字符串里抽出当天分钟数；抽不到返回 null */
function clockMinutes(s: string): number | null {
  const m = s?.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 确定性时间过滤（硬保证，不依赖模型自觉）：
 * - 去程：剔除出发时间早于【底线】的班次。底线 = max(当前时间[仅出发日=今天], 指定的最早出发时间)。
 * - 返程：剔除到达时间不早于【返程最晚到达】的班次。
 * 解析不出时刻的班次保留；过滤后若某腿为空则回退保留原列表（避免开天窗，交给 validator 标注）。
 */
function enforceTimeWindows(payload: TransportPayload, c: TripContext): void {
  const nowMin =
    c.now && c.start_date && c.now.slice(0, 10) === c.start_date
      ? clockMinutes(c.now.slice(11))
      : null;
  const departFloor = Math.max(
    nowMin ?? -1,
    c.depart_time ? (clockMinutes(c.depart_time) ?? -1) : -1,
  );
  if (departFloor >= 0 && payload.outbound?.options?.length) {
    const kept = payload.outbound.options.filter((o) => {
      const d = clockMinutes(o.depart);
      return d == null || d >= departFloor;
    });
    if (kept.length) payload.outbound.options = kept;
  }

  const arriveCeil = c.return_by_time ? clockMinutes(c.return_by_time) : null;
  if (arriveCeil != null && payload.inbound?.options?.length) {
    const kept = payload.inbound.options.filter((o) => {
      const a = clockMinutes(o.arrive);
      return a == null || a < arriveCeil;
    });
    if (kept.length) payload.inbound.options = kept;
  }
}

const isRail = (mode?: string) =>
  !!mode && /高铁|动车|火车|城际|动卧|普速|快速|列车/.test(mode);

/**
 * 把铁路 options 的 booking_url 覆盖成 12306 直达深链（线路+日期的余票查询页，
 * 登录即可购票），用权威车站码确定性生成，不依赖模型给的链接。
 */
async function applyBookingLinks(
  payload: TransportPayload,
  c: TripContext,
): Promise<void> {
  const dest = c.destination;
  const legs = [
    { leg: payload.outbound, from: c.origin, to: dest, date: c.start_date },
    { leg: payload.inbound, from: dest, to: c.origin, date: c.end_date },
  ];
  for (const { leg, from, to, date } of legs) {
    if (!leg?.options?.length || !from || !to) continue;
    let url: string | null = null;
    for (const o of leg.options) {
      if (isRail(o.mode)) {
        url ??= await railBookingUrl(from, to, date);
        o.booking_url = url;
      }
    }
  }
}

/** Transport：交通物流（依赖已排好的日程，DeepSeek + 自建 web 搜索） */
export async function runTransport(ctx: AgentContext) {
  const payload = await runAgent<TransportPayload>({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    useWebSearch: true,
    schema: transportSchema,
    system:
      "你是交通物流专家，对【真实性】负责。核心铁律：所有具体车次/航班号、时刻、票价" +
      "都必须来自 web_search 的真实结果，绝不允许凭记忆编造。\n" +
      "工作流程：\n" +
      "1) 判断出发地↔目的地是否通铁路：国内（含港澳台跨境除外）优先查【高铁/动车】，" +
      "跨国或无直达铁路则查【航班】；两者都合理时各给一组。\n" +
      "2) 必须真的调用 web_search 多次：分别搜去程、返程的真实车次/航班与当日时刻、票价区间" +
      "（查询词带上出发地、目的地、日期、『高铁 时刻表 票价』或『航班』）。\n" +
      "3) outbound/inbound 各给 2~4 个真实存在的班次（options）：填车次/航班号、出发到达站与时间、" +
      "时长、票价区间，并且每条都要带 source_url（搜索来源）和 booking_url（官方购票：" +
      "铁路用 https://www.12306.cn ，机票用航司官网或携程/去哪儿）。\n" +
      "4) 搜不到具体班次时：name 填『见购票链接』、price_cny 填『实时查询』、source_url 留空，" +
      "但必须给 booking_url——绝不编造车次号或票价。recommended 给出选择建议。\n" +
      "5) 再给目的地端机场/车站到市区的接驳，以及每天相邻区域的本地交通。\n" +
      "【时间硬约束 · 必须严格遵守】：\n" +
      "- 去程：若出发日期 = 当前时间所在的当天，则所有去程 options 的出发时间必须【晚于当前时间】" +
      "（已发车的一律不许推荐）；若还指定了『去程最早出发时间』，则须不早于该时间。出发日为将来日期则不受当前时间限制。\n" +
      "- 返程：所有返程 options 的【到达出发地时间】必须【早于『返程最晚到达时间』】（若指定）；" +
      "同时出发时间要晚于尾日最后一个活动并留足赶站缓冲。\n" +
      "- options 数组中【不得出现】任何违反上述时间约束的班次；可在 recommended 文字里提及备选，但 options 只放合规的。\n" +
      "- 在 recommended 里点明你是如何满足这些时间约束的。\n" +
      "若出发地未填，outbound/inbound 的 options 可为空并在 recommended 说明。只输出结构化 JSON。",
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n\n` +
      upstreamBlock(ctx, ["scheduling"]),
  });
  // 硬保证：再用代码剔除越界班次，不依赖模型自觉
  enforceTimeWindows(payload, ctx.context);
  // 铁路购票链接替换成 12306 直达深链
  await applyBookingLinks(payload, ctx.context);
  return payload;
}
