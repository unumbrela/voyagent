/**
 * 交通实时搜索（车次/航班）—— 从 /api/trains、/api/flights 抽出的共用核心。
 *
 * 路由与 Copilot 智能体工具（lib/agent/tools.ts）共用同一实现：
 * Tavily 抓整页时刻表原文 + DeepSeek 提取【全部】班次，每条带来源 + 确定性预订深链。
 * 不编造：搜不到就少返回（空数组）。未配置 TAVILY_API_KEY 时 webSearch 返回空 → 返回空数组。
 */

import { callDeepSeekJSON, DEEPSEEK } from "@/lib/deepseek";
import { webSearch } from "@/lib/search";
import { railBookingUrl } from "@/lib/stations";
import { flightBookingUrl } from "@/lib/airports";

export interface TrainOption {
  name: string;
  depart: string;
  arrive: string;
  duration: string;
  price_cny: string;
  source_url: string;
  booking_url?: string;
}

export interface FlightOption {
  name: string;
  airline: string;
  depart: string;
  arrive: string;
  duration: string;
  price_cny: string;
  source_url: string;
  booking_url?: string;
}

const trainsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["trains"],
  properties: {
    trains: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "depart", "arrive", "duration", "price_cny", "source_url"],
        properties: {
          name: { type: "string" },
          depart: { type: "string" },
          arrive: { type: "string" },
          duration: { type: "string" },
          price_cny: { type: "string" },
          source_url: { type: "string" },
        },
      },
    },
  },
};

const flightsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["flights"],
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "airline",
          "depart",
          "arrive",
          "duration",
          "price_cny",
          "source_url",
        ],
        properties: {
          name: { type: "string" },
          airline: { type: "string" },
          depart: { type: "string" },
          arrive: { type: "string" },
          duration: { type: "string" },
          price_cny: { type: "string" },
          source_url: { type: "string" },
        },
      },
    },
  },
};

/** 搜真实高铁/动车车次；每条带 12306 直达购票深链。搜不到返回 []。 */
export async function searchTrains(
  from: string,
  to: string,
  date: string | null,
): Promise<TrainOption[]> {
  const results = await webSearch(
    `${from}到${to} 高铁 动车 时刻表 全部车次 票价`,
    5,
    true,
  );
  const corpus = results
    .map((r) => `【来源 ${r.url}】\n${r.raw || r.content}`)
    .join("\n\n")
    .slice(0, 18000);
  if (!corpus.trim()) return [];

  const result = await callDeepSeekJSON<{ trains: TrainOption[] }>({
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: trainsSchema,
    system:
      `你是车票时刻表解析助手。下面是若干来源页面的原文，包含 ${from}→${to} 的高铁/动车时刻表。` +
      "请把其中出现的【所有】该线路车次【完整提取】出来（一条繁忙线路通常 20~40 趟，不要只给几趟），" +
      "每趟填：车次号、出发站+时间、到达站+时间、时长、票价区间、source_url（取自对应【来源】行的链接）。" +
      "按出发时间从早到晚排序、去重。只提取原文里真实出现的车次，不要编造；票价/余票以 12306 实时为准。",
    userPrompt: `线路：${from} → ${to}，日期：${date ?? "未指定"}\n\n时刻表原文：\n${corpus}`,
  });

  const booking = await railBookingUrl(from, to, date);
  return (result.trains ?? []).map((t) => ({ ...t, booking_url: booking }));
}

/** 搜真实航班；每条带携程/Google Flights 确定性预订深链。搜不到返回 []。 */
export async function searchFlights(
  from: string,
  to: string,
  date: string | null,
): Promise<FlightOption[]> {
  const results = await webSearch(
    `${from}到${to} 航班 时刻表 票价 ${date ?? ""}`,
    5,
    true,
  );
  const corpus = results
    .map((r) => `【来源 ${r.url}】\n${r.raw || r.content}`)
    .join("\n\n")
    .slice(0, 18000);
  if (!corpus.trim()) return [];

  const result = await callDeepSeekJSON<{ flights: FlightOption[] }>({
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: flightsSchema,
    system:
      `你是航班时刻表解析助手。下面是若干来源页面的原文，包含 ${from}→${to} 的航班信息。` +
      "请把其中出现的【所有】该航线航班【完整提取】出来（不要只给几趟），" +
      "每趟填：航班号、航空公司、出发机场+时间、到达机场+时间、时长、票价区间、" +
      "source_url（取自对应【来源】行的链接）。" +
      "按出发时间从早到晚排序、去重。只提取原文里真实出现的航班，不要编造；票价以官方实时为准。",
    userPrompt: `航线：${from} → ${to}，日期：${date ?? "未指定"}\n\n原文：\n${corpus}`,
  });

  const booking = flightBookingUrl(from, to, date);
  return (result.flights ?? []).map((f) => ({ ...f, booking_url: booking }));
}
