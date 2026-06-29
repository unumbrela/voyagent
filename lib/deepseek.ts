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

/** OpenAI 兼容的 chat message（含可选 tool_calls / tool 角色） */
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface DeepSeekJSONOpts {
  model: string;
  system: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** 可选：挂载 function-calling 工具（如 web_search）；传了就走工具循环 */
  tools?: unknown[];
  /** 工具执行器：收到 (工具名, arguments JSON 字符串)，返回结果文本 */
  onToolCall?: (name: string, argsJson: string) => Promise<string>;
}

const MAX_TOOL_ROUNDS = 5;

export async function callDeepSeekJSON<T = unknown>(
  opts: DeepSeekJSONOpts,
): Promise<T> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "Missing DEEPSEEK_API_KEY — 在 .env.local 填写后再调用 DeepSeek agent。",
    );
  }
  const { model, system, userPrompt, schema, maxTokens = 4096, tools } = opts;
  const useTools = Array.isArray(tools) && tools.length > 0;

  // 把目标结构讲清楚。无工具时配合 response_format=json_object，
  // 有工具时不强制 json_object（避免与工具调用混用），靠指令 + 宽松解析。
  const sys =
    `${system}\n\n` +
    `最终只输出一个 JSON 对象，严格符合下面的 JSON Schema；` +
    `不要包含任何额外文字，不要用 markdown 代码块包裹。\n` +
    `JSON Schema:\n${JSON.stringify(schema)}`;

  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: userPrompt },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // 最后一轮强制收口：禁用工具，要求直接产出 JSON
    const exhausted = round === MAX_TOOL_ROUNDS;
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    };
    if (useTools && !exhausted) {
      body.tools = tools;
      body.tool_choice = "auto";
    } else {
      // 收口轮 / 无工具：用 json_object 模式拿到干净 JSON
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: ChatMessage; finish_reason?: string }[];
    };
    const msg = data.choices?.[0]?.message;

    // 模型要求调用工具 → 执行后把结果回灌，继续下一轮
    if (msg?.tool_calls?.length && opts.onToolCall && !exhausted) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      });
      for (const tc of msg.tool_calls) {
        const result = await opts.onToolCall(
          tc.function.name,
          tc.function.arguments,
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
      continue;
    }

    const content = msg?.content;
    if (!content) {
      throw new Error("DeepSeek 返回空内容（可能被 max_tokens 截断）");
    }
    return parseJsonLoose<T>(content);
  }

  throw new Error(`DeepSeek 工具循环超过 ${MAX_TOOL_ROUNDS} 轮仍未收口`);
}
