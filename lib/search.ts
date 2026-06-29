/**
 * Web 搜索后端（自建「真实数据」工具，替代 Claude 内置 web_search）。
 *
 * 设计：
 *  - 默认接 Tavily（专为 LLM agent 设计，返回干净正文，免费档每月 1000 次）。
 *  - 写成可插拔：只要 webSearch() 的返回结构不变，换 Serper/Bing 只改这一个文件。
 *  - 优雅降级：未配置 TAVILY_API_KEY 时不报错，返回一句提示，
 *    让 agent 基于自身知识作答 —— 这样没有搜索 key 也能纯 DeepSeek 端到端跑通。
 */

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

const TAVILY_URL = "https://api.tavily.com/search";

/** 执行一次 web 搜索；无 key 时返回空数组（由调用方决定如何降级） */
export async function webSearch(
  query: string,
  maxResults = 5,
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
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
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

  if (!process.env.TAVILY_API_KEY) {
    return "（web 搜索未配置 TAVILY_API_KEY，本次未联网；请基于你已有的知识尽力作答。）";
  }

  const results = await webSearch(query, 5);
  if (!results.length) return `未搜到「${query}」的相关结果。`;

  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n");
}
