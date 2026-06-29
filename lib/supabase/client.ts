import { createBrowserClient } from "@supabase/ssr";

/**
 * 浏览器端客户端：使用 anon key，受 RLS 约束。
 * 当前脚手架前端主要通过 API 路由操作，这个 client 预留给后续直连场景
 * （如订阅 Realtime、用户认证）。
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
