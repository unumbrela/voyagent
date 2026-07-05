"use client";

/**
 * 聊天气泡里的 Markdown 渲染（react-markdown + GFM）。
 * AI 回复常含 加粗/列表/表格/代码，之前按纯文本渲染满屏星号——这里统一转成排版。
 * 样式按聊天气泡收紧（小间距、小标题），链接一律新开页；表格横向滚动防撑破气泡。
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-md min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-dark underline decoration-teal/40 underline-offset-2 hover:decoration-teal"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-1.5 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 供 TTS 用：把 Markdown 剥成可朗读的纯文本（数字人不该念出「星号星号」）。
 * 只做轻量正则（流式增量文本也适用），不追求完美解析。
 */
export function stripMarkdown(md: string): string {
  return (
    md
      // 代码块围栏/行内代码
      .replace(/```[a-zA-Z0-9]*\n?/g, "")
      .replace(/`([^`]+)`/g, "$1")
      // 图片除 alt，链接留文字
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // 加粗/斜体/删除线
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      // 标题/引用/列表记号/分割线
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*([-*_]\s*){3,}$/gm, "")
      // 表格竖线读起来是噪音
      .replace(/\|/g, " ")
      .trim()
  );
}
