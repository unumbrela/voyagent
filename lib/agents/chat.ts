import { callDeepSeekJSON } from "@/lib/deepseek";
import { DEEPSEEK } from "@/lib/deepseek";
import { contextBlock, upstreamBlock } from "./prompt";
import type { AgentContext } from "./types";

/** 一条对话消息（与前端 ChatPanel / itineraries.chat 对齐） */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  /** 面向用户的自然语言回复（问答或对改动的说明） */
  reply: string;
  /** answer=只回答不改行程；edit=给出改动后的完整行程 */
  action: "answer" | "edit";
  /** action=edit 时的完整 days（结构同 itinerarySchema.days） */
  days: unknown[];
  /** action=edit 时的关键信息（可空数组） */
  references: { label: string; value: string }[];
  /** action=edit 时对改动的一句话摘要，供预览卡展示 */
  change_summary: string;
}

// 输出结构（folding 进 prompt，DeepSeek 走 json_object + 宽松解析）
const chatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "action", "days", "references", "change_summary"],
  properties: {
    reply: { type: "string" },
    action: { type: "string", enum: ["answer", "edit"] },
    change_summary: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "date", "theme", "items"],
        properties: {
          day: { type: "number" },
          date: { type: "string" },
          theme: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["time", "title", "kind", "detail", "est_cost"],
              properties: {
                time: { type: "string" },
                title: { type: "string" },
                kind: { type: "string" },
                detail: { type: "string" },
                est_cost: { type: "number" },
                // 可解释与取证（可选）：原条目带 why/source_url 时原样保留
                why: { type: "string" },
                source_url: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** 把多轮对话渲染成 prompt 文本 */
function historyBlock(history: ChatMessage[]): string {
  return history
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
    .join("\n");
}

/**
 * Chat：多轮对话式旅行助手。既能就行程/目的地答疑（action=answer），
 * 也能按用户意图修订行程（action=edit，给出完整 days）。
 *
 * 与 refine 的差别：有对话记忆、可纯问答；改动不直接落库，由上层返回给前端预览后再应用。
 * 铁律沿用 refine：只按意图动，其余原样保留；不得编造车次/航班/酒店/票价，
 * 需要新增交通/住宿时取材自上游真实候选，保留已有 booking_url。
 */
export function runChat(
  ctx: AgentContext,
  currentItinerary: unknown,
  history: ChatMessage[],
  /** 输入护栏检测到注入时的安全提示，附加到 system（见 guardrails） */
  securityNote = "",
) {
  const prefs = (ctx.context.constraints?.preferences ?? null) as unknown;
  const prefsBlock =
    prefs && JSON.stringify(prefs) !== "{}"
      ? `\n## 用户偏好（👍喜欢 / 👎不喜欢，优化时尽量贴合）\n${JSON.stringify(prefs)}\n`
      : "";

  return callDeepSeekJSON<ChatResult>({
    model: DEEPSEEK.chat,
    maxTokens: 8000,
    schema: chatSchema as unknown as Record<string, unknown>,
    system:
      "你是随行旅行助手，正在和用户就一份【已成形的行程】多轮对话。\n" +
      "判断用户这次的意图：\n" +
      "- 若只是**咨询/答疑**（问天气、交通怎么买票、某地怎么玩、行程是否合理等），" +
      "则 action=\"answer\"，把回答写进 reply，days 返回空数组 []，change_summary 留空。\n" +
      "- 若是**要改行程**（加/减/换活动、调节奏、改预算、换住宿或交通等），" +
      "则 action=\"edit\"，reply 用一两句话说明你改了什么，change_summary 给更简短的一句话摘要，" +
      "并在 days 里返回**改动后的完整行程**（所有天，不只改动的那天）。\n" +
      "改行程的硬性要求（务必遵守）：\n" +
      "- 未被本次意图涉及的条目/天，**原样保留**（time/title/kind/detail/est_cost/why/source_url 一字不改），不要润色或重排。\n" +
      "- **不得编造**车次/航班/酒店名/票价；需要新增交通或住宿时，优先取材自下方上游 activities/food/accommodation/transport 的真实候选；拿不准的标『实时查询』。\n" +
      "- 保持天数与每天的 day/date 不变；首日第一项仍应是【去程出发】、尾日结尾仍是【返程】（若原行程如此）。\n" +
      "reply 用中文，自然、简洁、口语化。" +
      securityNote,
    userPrompt:
      `行程参数：\n${contextBlock(ctx.context)}\n` +
      prefsBlock +
      `\n## 当前行程（改动请在此基础上进行）\n${JSON.stringify(currentItinerary, null, 2)}\n\n` +
      `## 对话历史（最后一条是用户本次的话）\n${historyBlock(history)}\n\n` +
      `## 可取材的真实候选（避免编造）\n${upstreamBlock(ctx, [
        "activities",
        "food",
        "accommodation",
        "transport",
      ])}`,
  });
}
