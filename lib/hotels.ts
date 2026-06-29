/**
 * 住宿预订深链（确定性生成，保证「真实可下单」）。
 *
 * 设计与 stations.ts（铁路）同philosophy：不信任模型给的链接（易杜撰），
 * 用城市/酒店名 + 入离日期 + 人数确定性拼出 Booking.com 的搜索结果深链——
 * 落地即该酒店/该城市、该日期的真实可订房列表（全球通用，中国城市同样覆盖）。
 *
 * source_url（搜索来源）仍由 agent 从 web_search 结果填写，用于「信息出处」核验；
 * booking_url 则统一由这里覆盖，确保点开就是真实平台的真实房态。
 */

export interface HotelBookingOpts {
  /** 搜索词：精确到「酒店名 + 城市」时落到该酒店；只给城市时落到该城市列表 */
  query: string;
  /** 入住日期 YYYY-MM-DD（= 行程出发日） */
  checkin?: string | null;
  /** 退房日期 YYYY-MM-DD（= 行程返回日） */
  checkout?: string | null;
  /** 入住人数 */
  partySize?: number | null;
}

/** 拼 Booking.com 搜索结果深链（真实房态，永不杜撰） */
export function hotelBookingUrl(opts: HotelBookingOpts): string {
  const params = new URLSearchParams();
  params.set("ss", opts.query.trim());
  if (isDate(opts.checkin)) params.set("checkin", opts.checkin!);
  if (isDate(opts.checkout)) params.set("checkout", opts.checkout!);
  if (opts.partySize && opts.partySize > 0) {
    params.set("group_adults", String(opts.partySize));
  }
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/** 携程酒店城市关键词搜索深链（中国用户更顺手的备选） */
export function ctripHotelUrl(city: string): string {
  return `https://hotels.ctrip.com/hotels/list?city=&keyword=${encodeURIComponent(
    city.trim(),
  )}`;
}

function isDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
