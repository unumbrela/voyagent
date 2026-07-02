/**
 * 确定性断言：把项目里散落的「硬规则」收成一套可回归的检查。
 *
 * 全部是纯函数，只吃 (EvalCase, PipelineResult)，不碰网络/模型/DB——
 * 所以能对着 fixture 离线跑、进 CI 做回归。任何 high 级失败都应 gating。
 *
 * 覆盖的不变式（与线上 finalize.ts / transport.ts / validator 一一对应）：
 *  1. 天数与日期连续  2. 每天非空  3. 去程置顶  4. 交通接地(反幻觉)
 *  5. 住宿接地(反幻觉) 6. 去程晚于当前时间 7. 返程早于最晚到达 8. 预算贴合
 *  9. 条目字段完整   10. 有参考来源
 */

import type {
  Check,
  EvalCase,
  ItinItem,
  PipelineResult,
  Severity,
} from "./types";

// ── 小工具 ──

const PLACEHOLDER = /见购票|见预订|实时查询|待定|未知|N\/A/i;
const isConcrete = (s: string): boolean =>
  !!s && s.trim().length >= 2 && !PLACEHOLDER.test(s);

const clockMinutes = (s: string): number | null => {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const dateOnly = (s: string | null): string => (s ?? "").slice(0, 10);

/** 从 start_date 起推 n 天的日期串（YYYY-MM-DD） */
function expectedDates(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function inclusiveDays(start: string, end: string): number {
  const a = new Date(start + "T00:00:00Z").getTime();
  const b = new Date(end + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000) + 1;
}

const ok = (name: string, detail: string): Check => ({
  name,
  pass: true,
  severity: "low",
  detail,
});
const fail = (name: string, severity: Severity, detail: string): Check => ({
  name,
  pass: false,
  severity,
  detail,
});

/** 一条 transit 条目看起来是否是「从出发地出发的去程」（对齐 finalize.ts 的判定） */
function looksLikeDeparture(it: ItinItem, origin: string, dest: string): boolean {
  if (it.kind !== "transit") return false;
  const text = `${it.title} ${it.detail}`;
  const mentionsOrigin = !!origin && text.includes(origin);
  const departish =
    /出发|去程|前往|启程|购票|乘.*(高铁|动车|火车|飞机|航班)/.test(text) ||
    (!!dest && text.includes(dest));
  return mentionsOrigin && departish;
}

// ── 断言主体 ──

export function runAssertions(c: EvalCase, r: PipelineResult): Check[] {
  const checks: Check[] = [];
  const { input } = c;
  const days = r.itinerary?.days ?? [];

  // 1. 天数正确
  const expDays =
    c.expect?.days ??
    (input.start_date && input.end_date
      ? inclusiveDays(input.start_date, input.end_date)
      : null);
  if (expDays != null) {
    checks.push(
      days.length === expDays
        ? ok("day_count", `${days.length} 天，符合预期`)
        : fail(
            "day_count",
            "high",
            `期望 ${expDays} 天，实际 ${days.length} 天`,
          ),
    );

    // 日期连续且与出发日对齐
    if (input.start_date) {
      const exp = expectedDates(input.start_date, days.length);
      const bad = days.findIndex((d, i) => dateOnly(d.date) !== exp[i]);
      checks.push(
        bad < 0
          ? ok("dates_consecutive", "日期连续且与出发日对齐")
          : fail(
              "dates_consecutive",
              "high",
              `第 ${bad + 1} 天日期 ${days[bad]?.date}，期望 ${exp[bad]}`,
            ),
      );
    }
  }

  // 2. 每天非空
  const emptyDay = days.findIndex((d) => !(d.items?.length > 0));
  checks.push(
    emptyDay < 0
      ? ok("days_nonempty", "每天都有条目")
      : fail("days_nonempty", "medium", `第 ${emptyDay + 1} 天没有条目`),
  );

  // 3. 去程置顶（填了出发地才检查）——对齐 finalize.ensureDepartureFirst
  if (isConcrete(input.origin ?? "")) {
    const first = days[0]?.items?.[0];
    checks.push(
      first && looksLikeDeparture(first, input.origin!, input.destination)
        ? ok("departure_first", "首日第一项是去程出发")
        : fail(
            "departure_first",
            "high",
            `首日第一项应是「去程出发」，实际是 ${first ? `${first.kind}:${first.title}` : "（空）"}`,
          ),
    );
  }

  // 4. 交通接地（反幻觉）：具体车次/航班号必须带来源；每条都要有购票链接
  checks.push(...groundingChecks("transport", collectTransport(r)));

  // 5. 住宿接地（反幻觉）
  checks.push(
    ...groundingChecks(
      "accommodation",
      (r.accommodation?.options ?? []).map((o) => ({
        name: o.name,
        source_url: o.source_url,
        booking_url: o.booking_url,
      })),
    ),
  );

  // 6. 去程晚于当前时间（出发日=当前日时）+ 不早于指定最早出发时间
  checks.push(...outboundTimeChecks(c, r));

  // 7. 返程到达早于「最晚到达时间」
  if (input.return_by_time) {
    const ceil = clockMinutes(input.return_by_time);
    const bad = (r.transport?.inbound?.options ?? []).filter((o) => {
      const a = clockMinutes(o.arrive);
      return a != null && ceil != null && a >= ceil;
    });
    checks.push(
      bad.length === 0
        ? ok("inbound_before_return_by", `返程均早于 ${input.return_by_time}`)
        : fail(
            "inbound_before_return_by",
            "medium",
            `${bad.length} 个返程班次到达晚于 ${input.return_by_time}`,
          ),
    );
  }

  // 8. 预算贴合（软信号）：活动条目花费合计不应大幅超预算
  if (input.budget && input.budget > 0) {
    const spend = days
      .flatMap((d) => d.items ?? [])
      .reduce((s, it) => s + (Number(it.est_cost) || 0), 0);
    const ratio = spend / input.budget;
    checks.push(
      ratio <= 1.15
        ? ok("budget_fit", `活动花费合计 ¥${spend}，预算 ¥${input.budget}`)
        : fail(
            "budget_fit",
            "medium",
            `活动花费合计 ¥${spend}，超预算 ¥${input.budget} 的 ${Math.round((ratio - 1) * 100)}%`,
          ),
    );
  }

  // 9. 条目字段完整
  const allItems = days.flatMap((d) => d.items ?? []);
  const badItem = allItems.find(
    (it) =>
      !it.title ||
      !it.kind ||
      typeof it.est_cost !== "number" ||
      it.est_cost < 0,
  );
  checks.push(
    !badItem
      ? ok("items_valid", `${allItems.length} 个条目字段完整`)
      : fail(
          "items_valid",
          "low",
          `存在字段缺失/非法的条目：${JSON.stringify(badItem).slice(0, 80)}`,
        ),
  );

  // 10. 有参考来源
  checks.push(
    (r.itinerary?.references?.length ?? 0) > 0
      ? ok("references_present", `${r.itinerary.references.length} 条参考`)
      : fail("references_present", "low", "行程未附任何参考来源"),
  );

  return checks;
}

/** 汇总去程/返程全部班次，做接地检查 */
function collectTransport(
  r: PipelineResult,
): { name: string; source_url: string; booking_url: string }[] {
  const legs = [r.transport?.outbound, r.transport?.inbound].filter(Boolean);
  return legs.flatMap((leg) =>
    (leg!.options ?? []).map((o) => ({
      name: o.name,
      source_url: o.source_url,
      booking_url: o.booking_url,
    })),
  );
}

/**
 * 反幻觉不变式：
 *  - 给了【具体】名字（真实车次/航班号/酒店名，非占位符）→ 必须有 source_url，否则视为「疑似编造」= high；
 *  - 任何 option 都必须有 booking_url（用户能去下单）。
 */
function groundingChecks(
  label: string,
  opts: { name: string; source_url: string; booking_url: string }[],
): Check[] {
  if (opts.length === 0) {
    return [ok(`${label}_grounded`, "无可选项，跳过接地检查")];
  }
  const fabricated = opts.filter(
    (o) => isConcrete(o.name) && !isConcrete(o.source_url),
  );
  const noBooking = opts.filter((o) => !isConcrete(o.booking_url));
  const out: Check[] = [];
  out.push(
    fabricated.length === 0
      ? ok(`${label}_grounded`, `${opts.length} 个选项具体名均带来源`)
      : fail(
          `${label}_grounded`,
          "high",
          `疑似编造（有具体名但无来源）：${fabricated.map((o) => o.name).join("、")}`,
        ),
  );
  out.push(
    noBooking.length === 0
      ? ok(`${label}_booking_url`, "每个选项都有购票/预订链接")
      : fail(
          `${label}_booking_url`,
          "medium",
          `${noBooking.length} 个选项缺购票/预订链接`,
        ),
  );
  return out;
}

/** 去程时刻检查：出发日=当前日时须晚于当前时间；不早于指定最早出发时间 */
function outboundTimeChecks(c: EvalCase, r: PipelineResult): Check[] {
  const { input } = c;
  const opts = r.transport?.outbound?.options ?? [];
  if (opts.length === 0) return [ok("outbound_after_now", "无去程可选项，跳过")];

  const checks: Check[] = [];
  const sameDay =
    input.now && input.start_date && dateOnly(input.now) === input.start_date;
  if (sameDay) {
    const nowMin = clockMinutes(input.now!);
    const late = opts.filter((o) => {
      const d = clockMinutes(o.depart);
      return d != null && nowMin != null && d <= nowMin;
    });
    checks.push(
      late.length === 0
        ? ok("outbound_after_now", `去程均晚于当前时间 ${input.now}`)
        : fail(
            "outbound_after_now",
            "high",
            `${late.length} 个去程班次已发车（早于/等于当前 ${input.now}）：${late
              .map((o) => `${o.name} ${o.depart}`)
              .join("、")}`,
          ),
    );
  }
  if (input.depart_time) {
    const floor = clockMinutes(input.depart_time);
    const early = opts.filter((o) => {
      const d = clockMinutes(o.depart);
      return d != null && floor != null && d < floor;
    });
    checks.push(
      early.length === 0
        ? ok("outbound_after_depart_time", `去程均不早于 ${input.depart_time}`)
        : fail(
            "outbound_after_depart_time",
            "high",
            `${early.length} 个去程班次早于最早出发时间 ${input.depart_time}`,
          ),
    );
  }
  return checks;
}
