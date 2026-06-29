import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * OAuth 回调（Google 等第三方登录）。
 * 浏览器端 signInWithOAuth 走 PKCE：Google 认证后带 ?code= 回到这里，
 * 这里用 code 换取会话并写入 cookie，再跳回 next。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";
  const oauthError =
    searchParams.get("error_description") || searchParams.get("error");

  const back = (path: string) => {
    // 生产环境可能在反代后：优先用 x-forwarded-host 拼回真实域名
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (process.env.NODE_ENV !== "development" && forwardedHost) {
      return NextResponse.redirect(`https://${forwardedHost}${path}`);
    }
    return NextResponse.redirect(`${origin}${path}`);
  };

  if (oauthError) {
    return back(`/login?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return back("/login?error=" + encodeURIComponent("缺少授权码"));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return back(`/login?error=${encodeURIComponent(error.message)}`);
  }
  return back(next);
}
