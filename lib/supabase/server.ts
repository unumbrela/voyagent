import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
