/**
 * 示例行程「无锡 → 苏州 · 江南三日」：给新用户零成本体验完整产品。
 *
 * 数据与落地页实景演示（app/ShowcaseTrip.tsx）同源同趟——地点/车次/票价均真实、
 * 手工核对；两处结构不同（这里是 itinerary schema，那里是展示用 Stop），改数据请两边同步。
 * 日期动态取「下一个周五」起三天，保证车票/酒店深链落到未来真实日期。
 */

import { railBookingUrl } from "@/lib/stations";
import { hotelBookingUrl } from "@/lib/hotels";

export interface SampleItem {
  time: string;
  title: string;
  kind: "activity" | "food" | "rest" | "transit";
  detail: string;
  est_cost: number;
  why: string;
  source_url?: string;
  booking_url?: string;
}

export interface SampleDay {
  day: number;
  date: string;
  theme: string;
  items: SampleItem[];
}

/** 下一个周五（严格晚于今天）的 ISO 日期 */
export function nextFriday(from = new Date()): string {
  const d = new Date(from);
  const gap = ((5 - d.getDay() + 7) % 7) || 7; // 周五=5；今天是周五则取下周五
  d.setDate(d.getDate() + gap);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface SampleItinerary {
  title: string;
  overview: string;
  start_date: string;
  end_date: string;
  days: SampleDay[];
  references: { label: string; value: string }[];
}

/** 以 startDate（默认下一个周五）为第一天，构造完整示例行程 */
export async function buildSampleItinerary(
  startDate?: string,
): Promise<SampleItinerary> {
  const d0 = startDate ?? nextFriday();
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);

  // 预订深链确定性生成（12306 / Booking 真实房态），与流水线同一套构造器
  const [outboundUrl, inboundUrl] = await Promise.all([
    railBookingUrl("无锡", "苏州", d0),
    railBookingUrl("苏州", "无锡", d2),
  ]);
  const hotelUrl = hotelBookingUrl({
    query: "书香府邸平江府 苏州",
    checkin: d0,
    checkout: d2,
    partySize: 2,
  });

  const days: SampleDay[] = [
    {
      day: 1,
      date: d0,
      theme: "入城 · 拙政园与平江夜色",
      items: [
        {
          time: "09:04",
          title: "沪宁城际 G7215 · 无锡 → 苏州",
          kind: "transit",
          detail: "无锡 09:04 → 09:24 苏州 · 20 分 · 二等座 ¥19.5",
          est_cost: 19.5,
          why: "早班城际 20 分钟直达，到站即在古城北缘，寄存行李后全天不赶",
          source_url: outboundUrl,
          booking_url: outboundUrl,
        },
        {
          time: "10:00",
          title: "书香府邸 · 平江府",
          kind: "rest",
          detail: "平江路历史街区内的园林式老宅酒店，先寄存行李 · ¥688/晚",
          est_cost: 688,
          why: "住进街区里，出门即水巷，去拙政园/苏博步行可达，夜游零通勤",
          source_url: hotelUrl,
          booking_url: hotelUrl,
        },
        {
          time: "10:40",
          title: "拙政园",
          kind: "activity",
          detail: "中国四大名园之首，五进院落一步一景；旺季需提前一日实名预约",
          est_cost: 80,
          why: "苏州园林的巅峰之作，上午人少光线好，留足两小时",
        },
        {
          time: "12:30",
          title: "裕兴记面馆（西北街）",
          kind: "food",
          detail: "招牌两面黄：脆底浇头面，苏式面点老字号",
          est_cost: 45,
          why: "就在拙政园与苏博之间，不为吃饭绕路",
        },
        {
          time: "14:00",
          title: "苏州博物馆",
          kind: "activity",
          detail: "贝聿铭封山之作，片石假山如水墨；免费，需公众号预约",
          est_cost: 0,
          why: "建筑本身即展品，与拙政园一墙之隔，顺路即达",
        },
        {
          time: "18:30",
          title: "平江路 · 摇橹船夜游",
          kind: "activity",
          detail: "小桥流水枕河人家，船娘唱一段评弹 · 约 30 分钟 ¥55",
          est_cost: 55,
          why: "夜色里的水巷是苏州的另一面，回酒店步行五分钟",
        },
      ],
    },
    {
      day: 2,
      date: d1,
      theme: "虎丘塔影 · 七里山塘",
      items: [
        {
          time: "09:00",
          title: "虎丘",
          kind: "activity",
          detail: "吴中第一名胜：千年斜塔、剑池与试剑石",
          est_cost: 70,
          why: "苏东坡说「到苏州不游虎丘乃憾事也」，早去避开旅行团",
        },
        {
          time: "11:00",
          title: "七里山塘 · 山塘街",
          kind: "activity",
          detail: "古运河畔水上人家，可乘手摇船沿河看老宅",
          est_cost: 0,
          why: "从虎丘沿山塘河一路进城，动线顺、免门票",
        },
        {
          time: "12:00",
          title: "荣阳楼（山塘街）",
          kind: "food",
          detail: "百年老店：生煎馒头配卤汁豆腐干",
          est_cost: 35,
          why: "本地人排队的老字号，就在山塘街上",
        },
        {
          time: "14:00",
          title: "留园",
          kind: "activity",
          detail: "与拙政园齐名的吴中名园，移步换景的范本",
          est_cost: 55,
          why: "比拙政园安静，冠云峰与鸳鸯厅值得慢看",
        },
        {
          time: "19:30",
          title: "网师园 · 夜花园",
          kind: "activity",
          detail: "昆曲评弹实景演出，园林夜游联票 ¥100",
          est_cost: 100,
          why: "夜苏州的精华：在真园林里听一折昆曲，体验独此一家",
        },
      ],
    },
    {
      day: 3,
      date: d2,
      theme: "金鸡湖畔 · 满载而归",
      items: [
        {
          time: "08:30",
          title: "同得兴精品面馆（十全街）",
          kind: "food",
          detail: "一碗枫镇大肉面，苏式头汤面的讲究",
          est_cost: 28,
          why: "苏州人的早晨从头汤面开始，赶早去汤最清",
        },
        {
          time: "10:30",
          title: "诚品书店（金鸡湖）",
          kind: "activity",
          detail: "大陆首家诚品，湖畔消磨一上午",
          est_cost: 0,
          why: "从古城切换到湖畔的现代苏州，雨天备选也稳妥",
        },
        {
          time: "13:30",
          title: "金鸡湖湖滨步道 · 东方之门",
          kind: "activity",
          detail: "环湖天际线与「秋裤楼」，苏州的现代面孔",
          est_cost: 0,
          why: "饭后沿湖散步消食，摩天轮与音乐喷泉都在这一段",
        },
        {
          time: "15:30",
          title: "采芝斋（观前街总店）",
          kind: "food",
          detail: "一百五十年苏式糖果铺，捎份伴手礼",
          est_cost: 80,
          why: "回程顺路观前街，松子糖/苏式话梅带得走的苏州味",
        },
        {
          time: "17:23",
          title: "沪宁城际 G7042 · 苏州 → 无锡",
          kind: "transit",
          detail: "苏州 17:23 → 17:42 无锡 · 19 分 · 二等座 ¥19.5",
          est_cost: 19.5,
          why: "晚高峰前返程，到无锡赶得上晚饭",
          source_url: inboundUrl,
          booking_url: inboundUrl,
        },
      ],
    },
  ];

  return {
    title: "无锡 → 苏州 · 江南三日",
    overview:
      "一趟可以直接出发的江南小旅行：第一天入古城看园林、夜游平江路；第二天从虎丘沿七里山塘进城，晚上在网师园听昆曲；第三天切换到金鸡湖的现代苏州，带上伴手礼晚饭前到家。车次、门票、老字号均为真实数据，预订链接可直接下单。",
    start_date: d0,
    end_date: d2,
    days,
    references: [
      {
        label: "去程",
        value: "沪宁城际 G7215 无锡 09:04 → 苏州 09:24 · 二等座 ¥19.5",
      },
      {
        label: "返程",
        value: "沪宁城际 G7042 苏州 17:23 → 无锡 17:42 · 二等座 ¥19.5",
      },
      {
        label: "住宿",
        value: "书香府邸·平江府 · 两晚约 ¥1376 · 平江路历史街区内",
      },
      {
        label: "预约提醒",
        value: "拙政园、苏州博物馆均需提前实名预约；网师园夜花园 19:30 开演",
      },
    ],
  };
}
