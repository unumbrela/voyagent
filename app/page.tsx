"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      destination: fd.get("destination"),
      start_date: fd.get("start_date") || null,
      end_date: fd.get("end_date") || null,
      budget: fd.get("budget") ? Number(fd.get("budget")) : null,
      travel_style: fd.get("travel_style") || null,
      party_size: Number(fd.get("party_size") || 1),
    };
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      router.push(`/trips/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">智能旅行规划</h1>
      <p className="mt-2 text-sm text-neutral-500">
        7 个专家 agent 协作（orchestrator-worker 架构）：调研 · 活动 · 美食 · 日程 ·
        交通 · 综合 · 质检。
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field label="目的地" required>
          <input
            name="destination"
            required
            placeholder="如：东京"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="出发日期">
            <input type="date" name="start_date" className={inputCls} />
          </Field>
          <Field label="返回日期">
            <input type="date" name="end_date" className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="预算">
            <input
              type="number"
              name="budget"
              placeholder="如：10000"
              className={inputCls}
            />
          </Field>
          <Field label="人数">
            <input
              type="number"
              name="party_size"
              defaultValue={2}
              min={1}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="旅行风格">
          <input
            name="travel_style"
            placeholder="如：美食 + 文化，节奏轻松"
            className={inputCls}
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "创建中…" : "开始规划"}
        </button>
      </form>
    </main>
  );
}

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
