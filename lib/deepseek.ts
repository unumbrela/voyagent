import { parseJsonLoose } from "@/lib/json";

/**
 * DeepSeek provider（OpenAI 兼容接口）。
 * 与 Claude 不同：DeepSeek 没有 json_schema 严格结构化输出，只有 json_object 模式，
 * 所以这里把 schema 写进 prompt 指令，开启 response_format=json_object，再解析。
 * DeepSeek 也没有内置 web 搜索工具，走 DeepSeek 的 agent 不带搜索。
 */

export const DEEPSEEK = {
  chat: "deepseek-chat", // DeepSeek-V3，通用对话，适合轻量结构化任务
  reasoner: "deepseek-reasoner", // DeepSeek-R1，强推理
} as const;

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

export interface DeepSeekJSONOpts {
  model: string;
  system: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export async function callDeepSeekJSON<T = unknown>(
  opts: DeepSeekJSONOpts,
): Promise<T> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "Missing DEEPSEEK_API_KEY — 在 .env.local 填写后再调用 DeepSeek agent。",
    );
  }
  const { model, system, userPrompt, schema, maxTokens = 4096 } = opts;

  // json_object 模式要求 prompt 里出现 “json”，并把目标结构讲清楚
  const sys =
    `${system}\n\n` +
    `只输出一个 JSON 对象，严格符合下面的 JSON Schema；` +
    `不要包含任何额外文字，不要用 markdown 代码块包裹。\n` +
    `JSON Schema:\n${JSON.stringify(schema)}`;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek 返回空内容（可能被 max_tokens 截断）");
  }
  return parseJsonLoose<T>(content);
}
