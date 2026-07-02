/**
 * 记忆抽取：从原始信号（建行程输入 / Copilot 消息 / 编辑反馈）里蒸馏出
 * 【持久、可泛化】的用户偏好，忽略一次性的临时诉求。
 *
 * 两条路径：
 *   - 确定性规则（本文件）：零 key、可离线测、可审计；覆盖高频偏好槽位。
 *   - LLM 抽取（extractLLM）：语义更广，生产环境用；产出同样的 CandidateMemory。
 * index.ts 会在有 DEEPSEEK key 时优先 LLM、否则回退规则。
 */

import { DEEPSEEK } from "@/lib/deepseek";
import { runAgent } from "@/lib/agents/runAgent";
import type { CandidateMemory } from "./types";

interface Rule {
  subject: string; // 偏好槽位（同槽位新记忆会 supersede 旧的）
  re: RegExp;
  text: string; // 第三人称陈述
  importance: number; // 1~5
}

// 槽位命名：<域>.<维度>。互斥偏好（早起/晚起、省钱/豪华）共用槽位以便冲突消解；
// 并列兴趣（博物馆/美食）各占独立槽位以便共存。
const RULES: Rule[] = [
  { subject: "pace.wake_time", re: /(怕|讨厌|不(喜欢|想)|不要)[^，。]{0,4}早起|不早起|起不来|睡到自然醒/, text: "用户不喜欢早起，行程尽量安排较晚出发", importance: 4 },
  { subject: "pace.wake_time", re: /喜欢早起|早鸟|早点出发|一早就/, text: "用户喜欢早起、愿意一早出发", importance: 3 },
  { subject: "pace.intensity", re: /节奏(慢|轻松)|轻松|悠闲|不(想|要)(太)?赶|别排太满|慢慢玩/, text: "用户偏好轻松慢节奏，不喜欢排太满", importance: 4 },
  { subject: "pace.intensity", re: /暴走|紧凑|多打卡|尽量多|行程满一点|特种兵/, text: "用户偏好紧凑高强度、尽量多打卡", importance: 4 },
  { subject: "interest.museum", re: /博物馆|美术馆|艺术|展览|画廊/, text: "用户喜欢博物馆/美术馆等艺术文化场所", importance: 3 },
  { subject: "interest.food", re: /美食|好吃|吃货|餐厅|小吃|火锅|米其林|苍蝇馆|地道菜/, text: "用户看重美食体验", importance: 4 },
  { subject: "interest.nature", re: /自然|风景|山|海|湖|徒步|户外|公园|露营/, text: "用户喜欢自然风光与户外", importance: 3 },
  { subject: "interest.shopping", re: /购物|逛街|买买买|商场|奥莱|买手店/, text: "用户喜欢购物", importance: 3 },
  { subject: "interest.nightlife", re: /夜生活|酒吧|夜景|清吧|livehouse|夜市/, text: "用户喜欢夜生活/夜景", importance: 3 },
  { subject: "interest.history", re: /历史|古迹|古镇|文化|寺庙|遗址|老城/, text: "用户对历史人文感兴趣", importance: 3 },
  { subject: "budget.level", re: /预算(有限|紧)|便宜|性价比|省钱|穷游|平价/, text: "用户预算敏感、看重性价比", importance: 4 },
  { subject: "budget.level", re: /豪华|高端|五星|不差钱|品质游|奢华/, text: "用户偏好高端品质、预算宽松", importance: 4 },
  { subject: "diet.spicy", re: /不(能|吃|爱)辣|怕辣|清淡/, text: "用户不吃辣/偏清淡", importance: 4 },
  { subject: "diet.spicy", re: /爱吃辣|无辣不欢|重口/, text: "用户爱吃辣", importance: 3 },
  { subject: "diet.veg", re: /素食|吃素|vegetarian|不吃肉/, text: "用户素食", importance: 5 },
  { subject: "diet.halal", re: /清真|穆斯林|halal|不吃猪肉/, text: "用户需要清真饮食", importance: 5 },
  { subject: "companion.kids", re: /带(小孩|娃|孩子|宝宝)|亲子|遛娃|一家/, text: "用户常带小孩出行，需要亲子友好安排", importance: 5 },
  { subject: "companion.partner", re: /情侣|蜜月|男女朋友|二人世界|对象/, text: "用户与伴侣出行，偏好浪漫二人行程", importance: 3 },
  { subject: "companion.parents", re: /父母|爸妈|老人|长辈|带娃带老/, text: "用户与长辈出行，节奏需照顾老人", importance: 4 },
  { subject: "transport.no_fly", re: /不(坐|想坐|敢坐)飞机|怕飞|恐飞/, text: "用户不坐飞机，优先高铁/陆路", importance: 5 },
  { subject: "transport.prefer_rail", re: /喜欢(坐)?(高铁|火车|动车)|坐火车/, text: "用户偏好高铁出行", importance: 3 },
];

const CAP_SAMPLE = 200;

/** 规则抽取：一段文本可命中多条（每槽位取首个命中，避免同槽位互斥项都进） */
export function extractDeterministic(
  text: string,
  source: string,
): CandidateMemory[] {
  if (!text) return [];
  const t = text.slice(0, CAP_SAMPLE * 5);
  const bySubject = new Map<string, CandidateMemory>();
  for (const r of RULES) {
    if (bySubject.has(r.subject)) continue; // 同槽位只取先命中的
    if (r.re.test(t)) {
      bySubject.set(r.subject, {
        kind: "semantic",
        subject: r.subject,
        text: r.text,
        importance: r.importance,
        source,
      });
    }
  }
  return [...bySubject.values()];
}

const extractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "subject", "text", "importance"],
        properties: {
          kind: { type: "string" }, // semantic | episodic
          subject: { type: "string" }, // 偏好槽位；情景记忆或无槽位填 ""
          text: { type: "string" }, // 第三人称一句话
          importance: { type: "number" }, // 1~5
        },
      },
    },
  },
};

/** LLM 抽取（生产路径）：更广的语义覆盖，产出同样的 CandidateMemory */
export async function extractLLM(
  text: string,
  source: string,
): Promise<CandidateMemory[]> {
  const out = await runAgent<{
    memories: {
      kind: string;
      subject: string;
      text: string;
      importance: number;
    }[];
  }>({
    provider: "deepseek",
    model: DEEPSEEK.chat,
    maxTokens: 1200,
    schema: extractSchema,
    system:
      "你是用户画像记忆抽取器。从用户的一段话里蒸馏出【持久、可跨行程复用】的偏好或事实，" +
      "忽略一次性的临时诉求（如“这次想去某餐厅”）。每条用第三人称一句话陈述（“用户…”）。\n" +
      "- kind：偏好/事实用 semantic；具体发生的事件用 episodic。\n" +
      "- subject：语义记忆给一个稳定槽位名（如 pace.wake_time / diet.spicy / interest.museum / " +
      "budget.level / companion.kids / transport.no_fly），同一维度用同一槽位；情景记忆 subject 填空串。\n" +
      "- importance：1~5，越核心越高（饮食禁忌/同行人 4~5，一般兴趣 3）。\n" +
      "没有可沉淀的持久信息时返回空数组。只输出结构化 JSON。",
    userPrompt: `来源：${source}\n用户输入：\n${text.slice(0, 1500)}`,
  });

  const valid = new Set(["semantic", "episodic"]);
  return (out.memories ?? [])
    .filter((m) => m.text && valid.has(m.kind))
    .map((m) => ({
      kind: m.kind as CandidateMemory["kind"],
      subject: m.subject?.trim() ? m.subject.trim() : null,
      text: m.text.trim(),
      importance: Math.min(5, Math.max(1, Math.round(m.importance || 3))),
      source,
    }));
}
