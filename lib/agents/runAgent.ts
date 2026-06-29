import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { callDeepSeekJSON } from "@/lib/deepseek";
import { parseJsonLoose } from "@/lib/json";

export type Provider = "anthropic" | "deepseek";

export interface RunAgentOpts {
  /** 模型提供方，默认 anthropic */
  provider?: Provider;
  model: string;
  system: string;
  userPrompt: string;
  /** 结构化输出 json_schema */
  schema: Record<string, unknown>;
  /** 是否挂载服务端 web 搜索工具（仅 anthropic 支持） */
  useWebSearch?: boolean;
  /** 仅 Opus 系支持；Haiku/DeepSeek 不传 */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * 通用单 agent 调用封装，按 provider 分派。
 * - anthropic: 流式 + output_config.format 结构化输出 + web_search 续跑
 * - deepseek: OpenAI 兼容 chat/completions + json_object 模式
 * 两条路径都返回解析后的对象。
 */
export async function runAgent<T = unknown>(opts: RunAgentOpts): Promise<T> {
  if (opts.provider === "deepseek") {
    return callDeepSeekJSON<T>({
      model: opts.model,
      system: opts.system,
      userPrompt: opts.userPrompt,
      schema: opts.schema,
      maxTokens: opts.maxTokens ?? 4096,
    });
  }
  return runAnthropic<T>(opts);
}

async function runAnthropic<T>(opts: RunAgentOpts): Promise<T> {
  const client = anthropic();
  const {
    model,
    system,
    userPrompt,
    schema,
    useWebSearch = false,
    effort,
    maxTokens = 16000,
  } = opts;

  const output_config: Record<string, unknown> = {
    format: { type: "json_schema", schema },
  };
  if (effort) output_config.effort = effort;

  const params: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    output_config,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (effort) params.thinking = { type: "adaptive" };
  if (useWebSearch) {
    params.tools = [{ type: "web_search_20260209", name: "web_search" }];
  }

  const messages = params.messages as Array<Record<string, unknown>>;
  const MAX_CONTINUATIONS = 6;

  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const stream = client.messages.stream(
      params as unknown as Anthropic.MessageStreamParams,
    );
    const msg = await stream.finalMessage();

    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (msg.stop_reason === "refusal") {
      throw new Error(`Claude 拒绝了请求 (${model})`);
    }

    const text = msg.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    )?.text;
    if (!text) throw new Error("响应中没有文本块，无法解析结构化输出");
    return parseJsonLoose<T>(text);
  }
  throw new Error(`agent 续跑超过 ${MAX_CONTINUATIONS} 次仍未完成 (${model})`);
}
