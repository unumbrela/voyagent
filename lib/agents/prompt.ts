import type { AgentContext, AgentName, TripContext } from "./types";

/** 把单一事实来源渲染成 prompt 文本块 */
export function contextBlock(c: TripContext): string {
  const lines = [
    `出发地: ${c.origin ?? "未填（按未知出发地处理，去程交通从略或给通用建议）"}`,
    `目的地: ${c.destination}`,
    `日期: ${c.start_date ?? "未定"} ~ ${c.end_date ?? "未定"}`,
    `当前时间: ${c.now ?? "未知"}`,
    `去程最早出发时间: ${c.depart_time ?? "未指定"}`,
    `返程最晚到达时间: ${c.return_by_time ?? "未指定"}`,
    `预算: ${c.budget ?? "未定"}`,
    `旅行风格: ${c.travel_style ?? "未定"}`,
    `人数: ${c.party_size}`,
  ];
  // origin 已单列，剔除后再渲染其余约束，避免重复
  const rest = { ...(c.constraints ?? {}) };
  delete rest.origin;
  if (Object.keys(rest).length) {
    lines.push(`其他约束: ${JSON.stringify(rest)}`);
  }
  return lines.join("\n");
}

/** 把指定上游 agent 的产物渲染成 prompt 文本块 */
export function upstreamBlock(ctx: AgentContext, keys: AgentName[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    if (ctx.upstream[k] !== undefined) {
      parts.push(`## 上游产物 [${k}]\n${JSON.stringify(ctx.upstream[k], null, 2)}`);
    }
  }
  return parts.join("\n\n");
}
