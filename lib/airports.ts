/**
 * 航班预订深链（确定性生成，保证「真实可下单」）——对标 stations.ts 之于铁路。
 *
 * 不信任模型给的航班链接（易杜撰），用城市 IATA 码 + 日期确定性拼出深链：
 *  - 两端都能解析出 IATA 城市码 → 携程机票单程列表深链（落地即该航线该日期的真实航班+票价）
 *  - 否则 → Google Flights 自然语言深链（全球通用兜底，同样落到真实航班）
 *
 * IATA 城市码（metropolitan code）覆盖主流出行城市；查不到即走 Google Flights 兜底，
 * 因此无需维护全量机场表。source_url（出处）仍由 agent 从搜索结果填写。
 */

// 城市名 → IATA 城市码（大写）。键为中文/英文常见名，规范化后匹配。
const CITY_IATA: Record<string, string> = {
  // 中国大陆
  北京: "BJS", 上海: "SHA", 广州: "CAN", 深圳: "SZX", 成都: "CTU",
  杭州: "HGH", 西安: "XIY", 重庆: "CKG", 武汉: "WUH", 南京: "NKG",
  昆明: "KMG", 厦门: "XMN", 青岛: "TAO", 长沙: "CSX", 三亚: "SYX",
  海口: "HAK", 天津: "TSN", 大连: "DLC", 沈阳: "SHE", 哈尔滨: "HRB",
  郑州: "CGO", 济南: "TNA", 福州: "FOC", 贵阳: "KWE", 南宁: "NNG",
  兰州: "LHW", 乌鲁木齐: "URC", 拉萨: "LXA", 桂林: "KWL", 丽江: "LJG",
  呼和浩特: "HET", 银川: "INC", 西宁: "XNN", 太原: "TYN", 石家庄: "SJW",
  合肥: "HFE", 南昌: "KHN", 温州: "WNZ", 宁波: "NGB", 无锡: "WUX",
  // 港澳台
  香港: "HKG", 澳门: "MFM", 台北: "TPE", 高雄: "KHH",
  // 亚洲
  东京: "TYO", 大阪: "OSA", 名古屋: "NGO", 札幌: "SPK", 福冈: "FUK",
  首尔: "SEL", 釜山: "PUS", 曼谷: "BKK", 普吉: "HKT", 清迈: "CNX",
  新加坡: "SIN", 吉隆坡: "KUL", 巴厘岛: "DPS", 雅加达: "JKT",
  河内: "HAN", 胡志明: "SGN", 马尼拉: "MNL", 迪拜: "DXB", 多哈: "DOH",
  德里: "DEL", 孟买: "BOM", 加德满都: "KTM", 科伦坡: "CMB",
  // 欧洲
  伦敦: "LON", 巴黎: "PAR", 罗马: "ROM", 米兰: "MIL", 马德里: "MAD",
  巴塞罗那: "BCN", 法兰克福: "FRA", 慕尼黑: "MUC", 柏林: "BER",
  阿姆斯特丹: "AMS", 苏黎世: "ZRH", 维也纳: "VIE", 莫斯科: "MOW",
  伊斯坦布尔: "IST",
  // 美洲
  纽约: "NYC", 洛杉矶: "LAX", 旧金山: "SFO", 芝加哥: "CHI",
  西雅图: "SEA", 华盛顿: "WAS", 波士顿: "BOS", 多伦多: "YTO",
  温哥华: "YVR",
  // 大洋洲
  悉尼: "SYD", 墨尔本: "MEL", 奥克兰: "AKL",
};

/** 归一化城市名到候选键：原名、去逗号后段、去「市/省」后缀、去机场后缀 */
function candidates(raw: string): string[] {
  const head = raw.split(/[，,、\s]/)[0].trim();
  const noSuffix = head.replace(/[市省]$/, "");
  // 去掉常见机场/航站后缀（如「上海虹桥」→「上海」）
  const noAirport = noSuffix.replace(
    /(虹桥|浦东|首都|大兴|宝安|白云|双流|天府|萧山|咸阳|国际机场|机场)$/,
    "",
  );
  return [...new Set([raw.trim(), head, noSuffix, noAirport].filter(Boolean))];
}

/** 查城市 IATA 码；查不到返回 null */
export function lookupIata(raw: string): string | null {
  if (!raw) return null;
  for (const c of candidates(raw)) {
    if (CITY_IATA[c]) return CITY_IATA[c];
  }
  // 前缀匹配兜底（如「上海虹桥国际」未被后缀规则清干净时）
  for (const [name, code] of Object.entries(CITY_IATA)) {
    if (candidates(raw).some((c) => c.startsWith(name) && name.length >= 2)) {
      return code;
    }
  }
  return null;
}

/**
 * 构造航班预订深链：两端 IATA 已知→携程单程列表深链；否则→Google Flights 自然语言深链。
 */
export function flightBookingUrl(
  fromCity: string,
  toCity: string,
  date: string | null,
): string {
  const from = lookupIata(fromCity);
  const to = lookupIata(toCity);
  if (from && to) {
    const dateParam = isDate(date) ? `?depdate=${date}` : "";
    return `https://flights.ctrip.com/online/list/oneway-${from.toLowerCase()}-${to.toLowerCase()}${dateParam}`;
  }
  // 兜底：Google Flights 接受自然语言 q，解析城市并落到真实航班
  const onDate = isDate(date) ? ` on ${date}` : "";
  const q = `flights from ${fromCity} to ${toCity}${onDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

function isDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
