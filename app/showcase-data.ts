/**
 * 落地页「行程 + 地图」实景演示的共享数据与类别词汇表。
 * 被 ShowcaseTrip（列表）与两套地图组件（高德 3D / Leaflet 降级）共用，
 * 保证左侧时间轴、地图针脚、路线三处口径一致。
 * 数据为手工核对的真实地点/车次/票价；坐标为真实 WGS-84（上高德底图前用 lib/gcj02 加偏）。
 */

export type Kind = "activity" | "food" | "rest" | "transit";

/** 类别 → 中文短标（列表分类小徽标 / 地图名称标签副题） */
export const KIND_LABEL: Record<Kind, string> = {
  activity: "景点",
  food: "美食",
  rest: "住宿",
  transit: "交通",
};

/** 类别 → 类别色（与 globals.css --c-* 对齐；针脚 / 徽标 / 列表节点共用） */
export const KIND_COLOR: Record<Kind, string> = {
  activity: "var(--c-activity)",
  food: "var(--c-food)",
  rest: "var(--c-rest)",
  transit: "var(--c-transit)",
};

/** 类别色的落地十六进制（地图上需要真实色值，如高德 marker 描边 / 阴影） */
export const KIND_HEX: Record<Kind, string> = {
  activity: "#6366f1",
  food: "#f97316",
  rest: "#10b981",
  transit: "#3b82f6",
};

/** 地图针脚内嵌的类别图标（lucide 路径，白色描边）。
 *  与列表节点的 lucide 组件同形，左右一眼可对应。 */
export const KIND_SVG: Record<Kind, string> = {
  activity:
    '<path d="M10 18v-7"/><path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  food:
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  rest:
    '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  transit:
    '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
};

export const iconSvg = (kind: Kind) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${KIND_SVG[kind]}</svg>`;

export interface Stop {
  time: string;
  title: string;
  /** 地图名称标签用的短名（去掉括号/说明，避免标签过长） */
  short: string;
  kind: Kind;
  detail: string;
  /** 显示用花费（"¥80" / "¥688/晚" / null=免费不显示） */
  cost: string | null;
  lat: number;
  lon: number;
  /** transit 条目以登机牌票根呈现 */
  ticket?: {
    line: string;
    no: string;
    from: string;
    to: string;
    dep: string;
    arr: string;
    dur: string;
    seat: string;
  };
}

export interface ShowDay {
  day: number;
  date: string;
  dow: string;
  theme: string;
  tab: string;
  summary: string;
  stops: Stop[];
}

export const DAYS: ShowDay[] = [
  {
    day: 1,
    date: "07.10",
    dow: "周五",
    theme: "入城 · 拙政园与平江夜色",
    tab: "园林平江",
    summary: "今日约 ¥888 · 含首晚住宿",
    stops: [
      {
        time: "09:04",
        title: "沪宁城际 G7215 · 无锡 → 苏州",
        short: "苏州站",
        kind: "transit",
        detail: "",
        cost: "¥19.5",
        lat: 31.331,
        lon: 120.612,
        ticket: {
          line: "沪宁城际",
          no: "G7215",
          from: "无锡",
          to: "苏州",
          dep: "09:04",
          arr: "09:24",
          dur: "20 分",
          seat: "二等座",
        },
      },
      {
        time: "10:00",
        title: "书香府邸 · 平江府",
        short: "书香府邸",
        kind: "rest",
        detail: "先寄存行李，出门就是平江路",
        cost: "¥688/晚",
        lat: 31.3182,
        lon: 120.6338,
      },
      {
        time: "10:40",
        title: "拙政园",
        short: "拙政园",
        kind: "activity",
        detail: "中国四大名园之首，宜提前一日预约",
        cost: "¥80",
        lat: 31.3236,
        lon: 120.629,
      },
      {
        time: "12:30",
        title: "裕兴记面馆（西北街）",
        short: "裕兴记面馆",
        kind: "food",
        detail: "两面黄脆底浇头，苏式面点老字号",
        cost: "¥45",
        lat: 31.3249,
        lon: 120.622,
      },
      {
        time: "14:00",
        title: "苏州博物馆",
        short: "苏州博物馆",
        kind: "activity",
        detail: "贝聿铭封山之作，片石假山如水墨",
        cost: "免费预约",
        lat: 31.3228,
        lon: 120.6262,
      },
      {
        time: "18:30",
        title: "平江路 · 摇橹船夜游",
        short: "平江路",
        kind: "activity",
        detail: "小桥流水枕河人家，船娘唱一段评弹",
        cost: "¥55",
        lat: 31.3152,
        lon: 120.6336,
      },
    ],
  },
  {
    day: 2,
    date: "07.11",
    dow: "周六",
    theme: "虎丘塔影 · 七里山塘",
    tab: "虎丘山塘",
    summary: "今日约 ¥260",
    stops: [
      {
        time: "09:00",
        title: "虎丘",
        short: "虎丘",
        kind: "activity",
        detail: "吴中第一名胜，千年斜塔与剑池",
        cost: "¥70",
        lat: 31.3402,
        lon: 120.5766,
      },
      {
        time: "11:00",
        title: "七里山塘 · 山塘街",
        short: "七里山塘",
        kind: "activity",
        detail: "古运河畔水上人家，可乘手摇船",
        cost: null,
        lat: 31.3196,
        lon: 120.607,
      },
      {
        time: "12:00",
        title: "荣阳楼（山塘街）",
        short: "荣阳楼",
        kind: "food",
        detail: "百年老店，生煎馒头配卤汁豆腐干",
        cost: "¥35",
        lat: 31.3232,
        lon: 120.6012,
      },
      {
        time: "14:00",
        title: "留园",
        short: "留园",
        kind: "activity",
        detail: "与拙政园齐名，移步换景的范本",
        cost: "¥55",
        lat: 31.3226,
        lon: 120.5949,
      },
      {
        time: "19:30",
        title: "网师园 · 夜花园",
        short: "网师园",
        kind: "activity",
        detail: "昆曲评弹实景演出，夜苏州的精华",
        cost: "¥100",
        lat: 31.302,
        lon: 120.6321,
      },
    ],
  },
  {
    day: 3,
    date: "07.12",
    dow: "周日",
    theme: "金鸡湖畔 · 满载而归",
    tab: "金鸡湖返程",
    summary: "今日约 ¥128 · 含返程车票",
    stops: [
      {
        time: "08:30",
        title: "同得兴精品面馆（十全街）",
        short: "同得兴面馆",
        kind: "food",
        detail: "一碗枫镇大肉面，苏式头汤面的讲究",
        cost: "¥28",
        lat: 31.3035,
        lon: 120.6288,
      },
      {
        time: "10:30",
        title: "诚品书店（金鸡湖）",
        short: "诚品书店",
        kind: "activity",
        detail: "大陆首家诚品，湖畔消磨一上午",
        cost: null,
        lat: 31.3218,
        lon: 120.6923,
      },
      {
        time: "13:30",
        title: "金鸡湖湖滨步道 · 东方之门",
        short: "东方之门",
        kind: "activity",
        detail: "环湖天际线，苏州的现代面孔",
        cost: null,
        lat: 31.3125,
        lon: 120.676,
      },
      {
        time: "15:30",
        title: "采芝斋（观前街总店）",
        short: "采芝斋",
        kind: "food",
        detail: "一百五十年苏式糖果铺，捎份伴手礼",
        cost: "¥80",
        lat: 31.3128,
        lon: 120.6238,
      },
      {
        time: "17:23",
        title: "沪宁城际 G7042 · 苏州 → 无锡",
        short: "苏州站",
        kind: "transit",
        detail: "",
        cost: "¥19.5",
        lat: 31.331,
        lon: 120.612,
        ticket: {
          line: "沪宁城际",
          no: "G7042",
          from: "苏州",
          to: "无锡",
          dep: "17:23",
          arr: "17:42",
          dur: "19 分",
          seat: "二等座",
        },
      },
    ],
  },
];

/** 两点球面距离（km），用于「今日动线」统计（真实 WGS-84） */
export function haversineKm(a: Stop, b: Stop): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
