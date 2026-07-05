/**
 * Web 搜索后端（自建「真实数据」工具，替代 Claude 内置 web_search）。
 *
 * 设计：
 *  - 默认接 Tavily（专为 LLM agent 设计，返回干净正文，免费档每月 1000 次）。
 *  - 写成可插拔：只要 webSearch() 的返回结构不变，换 Serper/Bing 只改这一个文件。
 *  - 优雅降级：未配置 TAVILY_API_KEY 时不报错，返回一句提示，
 *    让 agent 基于自身知识作答 —— 这样没有搜索 key 也能纯 DeepSeek 端到端跑通。
 */

import { span } from "@/lib/otel/trace";
import { guardRetrieval, summarizeFindings } from "@/lib/guardrails";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  /** 整页清洗后的原文（仅 includeRaw 时有）；用于提取完整时刻表等长内容 */
  raw?: string;
}

const TAVILY_URL = "https://api.tavily.com/search";

/**
 * 执行一次 web 搜索；无 key 时返回空数组（由调用方决定如何降级）。
 * includeRaw=true 时请求整页原文（车次时刻表这类需要完整列表的场景用）。
 * includeDomains 非空时把结果限定在这些域内（如只看 xiaohongshu.com）。
 */
export async function webSearch(
  query: string,
  maxResults = 5,
  includeRaw = false,
  includeDomains?: string[],
): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: maxResults,
      search_depth: includeRaw ? "advanced" : "basic",
      include_raw_content: includeRaw,
      ...(includeDomains?.length ? { include_domains: includeDomains } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    results?: {
      title?: string;
      url?: string;
      content?: string;
      raw_content?: string;
    }[];
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
    raw: r.raw_content ?? undefined,
  }));
}

/** DeepSeek（OpenAI 兼容）function-calling 工具定义 */
export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "搜索互联网获取实时信息，用于核实景点是否存在/营业、交通线路与票务、" +
      "餐厅营业状态等。返回若干条标题、链接与正文摘要。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "搜索查询词，尽量具体（含地名、对象、年份等）",
        },
      },
    },
  },
} as const;

/**
 * 工具执行器：解析模型传来的 arguments（JSON 字符串），执行搜索，
 * 把结果压成一段紧凑文本回传给模型。无 key 时返回降级提示。
 */
export async function runWebSearchTool(argsJson: string): Promise<string> {
  let query = "";
  try {
    query = String((JSON.parse(argsJson) as { query?: unknown }).query ?? "");
  } catch {
    return "搜索参数解析失败：arguments 不是合法 JSON。";
  }
  if (!query) return "搜索参数缺少 query。";

  return span(
    "web_search",
    "tool",
    async (rec) => {
      rec.setMeta("query", query);
      const { text, findings } = await runWebSearchInner(query);
      if (findings.length) {
        // 把注入命中记进 trace（可观测层可见），并在服务端告警
        rec.setMeta("guardrail", summarizeFindings(findings));
        console.warn(
          `[guardrail] 检索内容命中 ${findings.length} 条注入特征：`,
          findings.map((f) => f.id).join(", "),
        );
      }
      return text;
    },
    { query },
  );
}

/** web 搜索工具的实际执行体（被 span 包裹） */
async function runWebSearchInner(
  query: string,
): Promise<{ text: string; findings: import("@/lib/guardrails").Finding[] }> {
  if (!process.env.TAVILY_API_KEY) {
    return {
      text:
        "【搜索不可用：未配置 TAVILY_API_KEY】本次无法联网核实。" +
        "严禁编造具体车次/航班号、时刻或票价；请改为：给出官方购票/查询链接" +
        "（铁路 https://www.12306.cn ，机票走航司官网或携程/去哪儿），" +
        "票价时刻一律标注「请在官方平台实时查询」。",
      findings: [],
    };
  }

  const results = await webSearch(query, 6);
  if (!results.length) {
    return {
      text:
        `未搜到「${query}」的可靠结果。不要编造；请给出官方购票/查询链接，` +
        `并标注「请在官方平台实时查询」。`,
      findings: [],
    };
  }

  // 检索关：中和 + 圈定 + 扫描后再交给模型（外部原文一律视为不可信数据）
  return guardRetrieval(results);
}
