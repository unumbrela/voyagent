"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logEvent } from "@/lib/log";
import { Sparkles, Loader2 } from "@/app/ui/icons";

/**
 * 「载入示例行程」按钮（空状态用）：POST /api/trips/sample 种入
 * 无锡→苏州三日成品行程，直接跳详情页——新用户零成本先玩到全部功能。
 */
export function SampleTripButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/trips/sample", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "载入失败");
      logEvent("sample_trip_create", {}, data.id);
      router.push(`/trips/${data.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-center gap-1.5">
      <button
        onClick={load}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal-tint px-5 py-2.5 text-sm font-semibold text-teal-dark shadow-soft transition hover:-translate-y-px hover:shadow-lift disabled:opacity-60 cursor-pointer"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        {busy ? "正在装箱…" : "先看示例：无锡 → 苏州三日"}
      </button>
      {err && <span className="text-xs text-seal">{err}</span>}
    </span>
  );
}
