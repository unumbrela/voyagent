/**
 * 注入特征库：确定性、可解释、可回归。
 *
 * 刻意用「窄而准」的模式压低误报（benign 文本不该命中）。中英双语覆盖，因为
 * 检索原文与用户输入都可能中英混排。每条规则标 category + severity，命中即产 Finding。
 *
 * 说明：模式匹配是第一道廉价防线（快、可测、可审计），不是全部——
 * 真正的纵深防御还包括：中和(sanitize) + 圈定(spotlight) + 输出域白名单(urls)。
 */

import type { Category, Severity } from "./types";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  detail: string;
  re: RegExp;
}

export const RULES: Rule[] = [
  // ── 指令覆盖 ──
  {
    id: "override.ignore_previous",
    category: "instruction_override",
    severity: "high",
    detail: "试图让模型忽略/无视先前指令或系统提示",
    re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|the)\b[^.\n]{0,30}\b(instruction|prompt|rule|direction|context|message)s?\b/i,
  },
  {
    id: "override.ignore_zh",
    category: "instruction_override",
    severity: "high",
    detail: "中文：忽略/无视上文指令或系统提示",
    re: /(忽略|无视|忘记|不要理会|不用管)[^。\n]{0,12}(之前|上述|以上|前面|所有|一切|系统)[^。\n]{0,8}(指令|提示|规则|设定|要求|内容)/,
  },
  // ── 角色混淆 ──
  {
    id: "role.you_are_now",
    category: "role_confusion",
    severity: "high",
    detail: "重定义模型角色（you are now / act as / DAN 等越狱）",
    re: /\b(you are now|from now on you (are|will)|act as (a |an )?(dan\b|developer mode|jailbroken)|enable (dan|developer) mode)\b/i,
  },
  {
    id: "role.you_are_now_zh",
    category: "role_confusion",
    severity: "high",
    detail: "中文：重定义模型角色 / 越狱",
    re: /(你现在是|从现在起你(是|将)|扮演(一个)?(不受限|开发者模式|越狱)|进入开发者模式)/,
  },
  {
    id: "role.fake_system_tag",
    category: "role_confusion",
    severity: "high",
    detail: "伪造 system/assistant 角色标记或对话分隔",
    re: /(^|\n)\s*(system|assistant)\s*:|<\/?(system|assistant|user|im_start|im_end)>|\[\/?(INST|SYS)\]/i,
  },
  // ── 数据外泄 ──
  {
    id: "exfil.reveal_prompt",
    category: "exfiltration",
    severity: "high",
    detail: "套取系统提示 / 内部指令",
    re: /\b(reveal|show|print|repeat|output|tell me|leak|dump)\b[^.\n]{0,30}\b(system prompt|your (instructions|prompt|rules)|initial prompt|the prompt above)\b/i,
  },
  {
    id: "exfil.secrets",
    category: "exfiltration",
    severity: "high",
    detail: "套取密钥 / 环境变量",
    re: /\b(api[_ ]?key|secret|token|password|process\.env|环境变量|密钥)\b|\b(DEEPSEEK|ANTHROPIC|TAVILY|SUPABASE)_[A-Z_]*KEY\b/i,
  },
  // ── 篡改预订/支付链接 ──
  {
    id: "booking.manipulate",
    category: "booking_manipulation",
    severity: "high",
    detail: "诱导把预订/支付/购票链接替换为指定地址",
    re: /\b(change|replace|set|use|redirect)\b[^.\n]{0,40}\b(booking|payment|checkout|purchase|pay)\b[^.\n]{0,30}\b(url|link|address|to https?:\/\/)/i,
  },
  {
    id: "booking.manipulate_zh",
    category: "booking_manipulation",
    severity: "high",
    detail: "中文：诱导替换预订/购票/支付链接",
    re: /(把|将|请)[^。\n]{0,20}(预订|购票|支付|付款|下单)[^。\n]{0,12}(链接|地址|网址)[^。\n]{0,12}(改成|换成|设为|替换)/,
  },
  // ── 工具/命令劫持 ──
  {
    id: "tool.hijack",
    category: "tool_hijack",
    severity: "medium",
    detail: "诱导调用工具 / 执行命令或代码",
    re: /\b(call|invoke|use|run|execute)\b[^.\n]{0,25}\b(the )?(\w+ )?(tool|function|command|shell|code|script)\b|\b(rm -rf|curl |wget |eval\(|atob\()/i,
  },
  // ── 外泄信道 ──
  {
    id: "exfil.markdown_image",
    category: "exfil_channel",
    severity: "high",
    detail: "markdown 图片/链接带查询参数（像素外泄信道）",
    re: /!\[[^\]]*\]\(\s*https?:\/\/[^)]*[?&][^)]+\)/i,
  },
  {
    id: "exfil.param_url",
    category: "exfil_channel",
    severity: "medium",
    detail: "URL 携带疑似外泄参数（data/prompt/leak/secret=…）",
    re: /https?:\/\/[^\s)]+[?&](data|prompt|leak|secret|q|c|exfil|payload)=[^\s)]+/i,
  },
  // ── 隐藏字符走私 ──
  {
    id: "hidden.zero_width",
    category: "hidden_unicode",
    severity: "medium",
    detail: "含零宽/双向控制符/字宽连接符（隐藏指令走私）",
    // 零宽空格族(200B-200F) · 双向嵌入/覆盖(202A-202E) · 字宽连接符(2060) · 方向隔离(2066-2069) · BOM(FEFF)
    re: /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/,
  },
];
