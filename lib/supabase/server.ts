import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 用户态服务端客户端：anon key + 绑定请求 cookie 的会话，受 RLS 约束。
 * 用于「以登录用户身份」读写（建 trip、读/存行程、列表）——RLS 自动按 user_id 隔离。
 * 在 Server Component 里 cookie 不可写，setAll 的异常被吞掉（会话刷新交给 middleware）。
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — 填好 .env.local 再用。",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 内无法写 cookie：忽略，会话刷新由 middleware 负责
        }
      },
    },
  });
}

/** 取当前登录用户（未登录返回 null） */
export async function getUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * 服务端管理客户端：使用 service_role key，绕过 RLS。
 * 仅在服务端（Route Handler / Server Action）使用，绝不暴露给浏览器。
 * 编排引擎用它读写 trip_context / agent_outputs / itineraries。
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — 复制 .env.local.example 为 .env.local 并填写。",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
