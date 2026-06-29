import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude API client（服务端单例）。
 * 读取 ANTHROPIC_API_KEY。所有 agent 调用都走这个 client。
 */
let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY — 复制 .env.local.example 为 .env.local 并填写。",
      );
    }
    _client = new Anthropic();
  }
  return _client;
}

/** 分层模型选型：复杂 agent 用 Opus，轻量 agent 用 Haiku。 */
export const MODELS = {
  opus: "claude-opus-4-8",
  haiku: "claude-haiku-4-5",
} as const;
