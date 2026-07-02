/**
 * 输出域白名单：预订/购票链接是钓鱼注入的重灾区——攻击者常诱导模型把 booking_url
 * 换成仿冒站。本项目的 booking_url 本就由 stations/airports/hotels.ts 确定性生成，
 * 这里再加一道白名单校验作为安全网：非可信域的预订链接一律判为 untrusted_url 并置空。
 *
 * 注意 source_url（证据来源）故意【不】做域白名单——来源可以是任意新闻/官网/博客，
 * 白名单会误杀；对它只做协议校验（仅 https，拒 javascript:/data: 等危险 scheme）。
 */

import type { Finding } from "./types";

/** 可信预订/购票域（后缀匹配，覆盖子域） */
const TRUSTED_BOOKING_HOSTS = [
  "12306.cn",
  "ctrip.com",
  "trip.com",
  "qunar.com",
  "fliggy.com",
  "booking.com",
  "agoda.com",
  "google.com", // google.com/travel/flights
  "airchina.com.cn",
  "ceair.com", // 东航
  "csair.com", // 南航
  "juneyaoair.com",
  "hnair.com",
  "ana.co.jp",
  "jal.co.jp",
];

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** 该 URL 是否落在可信预订域内 */
export function isTrustedBookingUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return TRUSTED_BOOKING_HOSTS.some(
    (h) => host === h || host.endsWith("." + h),
  );
}

/** source_url 只需是安全协议（https） */
export function isSafeSourceUrl(url: string): boolean {
  return !url || isHttps(url);
}

/**
 * 递归清洗 payload 里的 booking_url / source_url：
 *  - booking_url 不在白名单 → 置空 + 产 high Finding；
 *  - source_url 非 https → 置空 + 产 medium Finding。
 * 原地修改传入对象（与 transport.applyBookingLinks 一致的落地方式），返回 findings。
 */
export function guardUrls(payload: unknown): Finding[] {
  const findings: Finding[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      const rec = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (k === "booking_url" && typeof v === "string" && v) {
          if (!isTrustedBookingUrl(v)) {
            findings.push({
              id: "url.untrusted_booking",
              category: "untrusted_url",
              severity: "high",
              detail: "预订链接不在可信域，已置空",
              sample: v.slice(0, 80),
            });
            rec[k] = "";
          }
        } else if (k === "source_url" && typeof v === "string" && v) {
          if (!isSafeSourceUrl(v)) {
            findings.push({
              id: "url.unsafe_source",
              category: "untrusted_url",
              severity: "medium",
              detail: "来源链接协议不安全（非 https），已置空",
              sample: v.slice(0, 80),
            });
            rec[k] = "";
          }
        } else if (v && typeof v === "object") {
          walk(v);
        }
      }
    }
  };
  walk(payload);
  return findings;
}
