import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** 每个请求都过一遍：刷新会话 + 未登录跳 /login（详见 updateSession）。
 *  Next 16 用 proxy 约定取代 middleware（nodejs 运行时，适配 Supabase）。 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 跳过静态资源；其余（含页面与 /api）都经过，以保证会话 cookie 持续刷新
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|glb|gltf|mp3|wav|ogg|mp4|webm|mov|m4v)$).*)",
  ],
};
