import { parseJsonLoose } from "@/lib/json";
import { span } from "@/lib/otel/trace";

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

const MAX_TOOL_ROUNDS = 4;

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

  // 单次 chat/completions 调用（每次 = 一个 llm span，捕获真实 token 用量）
  const chat = (extra: Record<string, unknown>) =>
    span(
      model,
      "llm",
      async (rec) => {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            stream: false,
            ...extra,
          }),
        });
        if (!res.ok) {
          throw new Error(`DeepSeek API ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: ChatMessage }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (data.usage) {
          rec.setUsage(
            model,
            data.usage.prompt_tokens ?? 0,
            data.usage.completion_tokens ?? 0,
          );
        }
        rec.setMeta("phase", extra.tools ? "tool_round" : "final");
        return data.choices?.[0]?.message;
      },
      { provider: "deepseek" },
    );

  // 第一阶段：带工具的调研循环（仅当挂了工具）。模型自行决定搜索几次。
  // 这一阶段不开 json_object（与工具调用混用不稳定），只为收集真实搜索结果。
  if (useTools) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const msg = await chat({ tools, tool_choice: "auto" });
      if (msg?.tool_calls?.length && opts.onToolCall) {
        messages.push({
          role: "assistant",
          content: msg.content ?? "",
          tool_calls: msg.tool_calls,
        });
        // 同轮多个工具调用并行执行（web 搜索互相独立），按原顺序回填结果
        const results = await Promise.all(
          msg.tool_calls.map((tc) =>
            opts.onToolCall!(tc.function.name, tc.function.arguments),
          ),
        );
        msg.tool_calls.forEach((tc, i) => {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: results[i],
          });
        });
        continue;
      }
      // 模型不再调工具：留下它这轮的草稿作上下文，进入收口阶段
      if (msg?.content) messages.push({ role: "assistant", content: msg.content });
      break;
    }
    messages.push({
      role: "user",
      content:
        "现在基于以上搜索到的真实信息，只输出最终的 JSON 对象（严格符合 Schema），" +
        "不要任何额外文字或代码块。未经搜索证实的具体信息不要编造。",
    });
  }

  // 第二阶段：强制 json_object 收口，保证产出干净合法 JSON（不带工具）。
  const finalMsg = await chat({ response_format: { type: "json_object" } });
  const content = finalMsg?.content;
  if (!content) {
    throw new Error("DeepSeek 返回空内容（可能被 max_tokens 截断）");
  }
  return parseJsonLoose<T>(content);
}
