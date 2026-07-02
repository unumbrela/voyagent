/**
 * 护栏（guardrails）共享类型。
 *
 * 威胁模型：本 Agent 会把【检索到的真实网页原文】喂给模型，这是 prompt injection 的
 * 头号攻击面（间接注入）；此外还有用户输入（直接注入）与模型输出（被诱导产出钓鱼预订链接）。
 * 三道关：输入(guardInput) → 检索(guardRetrieval) → 输出(guardUrls)。
 */

export type Severity = "high" | "medium" | "low";

export type Category =
  | "instruction_override" // 指令覆盖：忽略上文/系统提示
  | "role_confusion" // 角色混淆：you are now / system:
  | "exfiltration" // 数据外泄：套系统提示/密钥/env
  | "booking_manipulation" // 篡改预订/支付链接
  | "tool_hijack" // 诱导调用/执行工具或命令
  | "exfil_channel" // 外泄信道：带参 URL / markdown 图片
  | "hidden_unicode" // 隐藏字符走私（零宽/双向控制符）
  | "untrusted_url"; // 输出链接不在可信域

export interface Finding {
  id: string; // 命中的规则 id
  category: Category;
  severity: Severity;
  detail: string; // 人可读说明
  sample?: string; // 命中的片段（截断）
}

/** 一次检索/输入扫描的结果 */
export interface GuardResult {
  /** 经中和 + 圈定（spotlight）后的安全文本，可安全喂给模型 */
  text: string;
  findings: Finding[];
}

export const maxSeverity = (fs: Finding[]): Severity | null => {
  if (fs.some((f) => f.severity === "high")) return "high";
  if (fs.some((f) => f.severity === "medium")) return "medium";
  if (fs.some((f) => f.severity === "low")) return "low";
  return null;
};

/** 压成可放进 span meta / 日志的紧凑摘要 */
export function summarizeFindings(fs: Finding[]): Record<string, unknown> {
  const byCat: Record<string, number> = {};
  for (const f of fs) byCat[f.category] = (byCat[f.category] ?? 0) + 1;
  return { count: fs.length, max: maxSeverity(fs), byCat };
}
