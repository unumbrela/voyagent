import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Hanken_Grotesk,
  Fraunces,
  Noto_Serif_SC,
} from "next/font/google";
import "./globals.css";
import { MotionConfig } from "motion/react";
import { Nav } from "./nav";
import { getUser } from "@/lib/supabase/server";
import { CopilotProvider } from "./copilot/store";
import CopilotDock from "./copilot/CopilotDock";
import { Toaster } from "./ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// UI 小标题：柔和人文无衬线
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// 编辑部大标题（拉丁/数字）：与思源宋体混排——Fraunces 管西文，Noto Serif SC 管汉字
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  style: ["normal", "italic"],
});

// 中文衬线大标题：思源宋体（Google 自动按 unicode-range 切片，按需加载；
// CJK 字体不支持 subsets 声明，preload 关闭避免全量预载）
const notoSerif = Noto_Serif_SC({
  variable: "--font-noto-serif",
  weight: ["600", "900"],
  subsets: [],
  preload: false,
});

export const metadata: Metadata = {
  title: "漫游 · 一个应用安排好整趟旅行",
  description:
    "帮你排好每天的行程，查真实的车票、酒店和门票，都标在地图上。8 个 AI 一起规划。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser().catch(() => null);
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${hanken.variable} ${fraunces.variable} ${notoSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* reducedMotion="user"：尊重系统「减少动态效果」，关闭 motion 动画（无障碍） */}
        <MotionConfig reducedMotion="user">
          <CopilotProvider>
            <Nav email={user?.email ?? null} />
            {children}
            <CopilotDock signedIn={!!user} />
            <Toaster />
          </CopilotProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
