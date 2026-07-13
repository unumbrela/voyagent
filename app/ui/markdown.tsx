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
