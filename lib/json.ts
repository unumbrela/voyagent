/** 宽松解析模型返回的 JSON：先直接解析，失败则截取最外层 {} 再试 */
export function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new Error("结构化输出解析失败：返回的不是合法 JSON");
  }
}
