"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type GeoStatus = "idle" | "locating" | "ok" | "failed";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 出发地：自动定位填入，失败可手填。进页面即定位，故初始态就是 locating。
  const [origin, setOrigin] = useState("");
  const [geo, setGeo] = useState<GeoStatus>("locating");

  // 仅发起浏览器定位请求；setState 只在异步回调里发生（不在 effect 里同步 setState）。
  function requestGeo() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo("failed");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const place = await reverseGeocode(
            pos.coords.latitude,
            pos.coords.longitude,
          );
          if (place) {
            setOrigin(place);
            setGeo("ok");
          } else {
            setGeo("failed");
          }
        } catch {
          setGeo("failed");
        }
      },
      () => setGeo("failed"), // 用户拒绝授权 / 定位失败 → 手填
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  // 进页面即尝试自动定位（订阅浏览器 geolocation 外部系统，是 effect 的正当用途；
  // 仅「设备不支持定位」这一同步分支会立即 setState，无级联风险，豁免该启发式规则）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    requestGeo();
  }, []);

  // 按钮「重新定位」：事件处理器里同步置位 locating 没问题
  function onRelocate() {
    setGeo("locating");
    requestGeo();
  }

  // 当前时间（本地）：用于过滤「已过站」的车次。每分钟刷新一次显示。
  const [now, setNow] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(formatLocal(new Date()));
    const t = setInterval(() => setNow(formatLocal(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      destination: fd.get("destination"),
      origin: (fd.get("origin") as string)?.trim() || null,
      start_date: fd.get("start_date") || null,
      end_date: fd.get("end_date") || null,
      // 提交时取最新本地时间；浏览器拿不到时为空，由下方手填时间兜底
      now: typeof Date !== "undefined" ? formatLocal(new Date()) : null,
      depart_time: fd.get("depart_time") || null, // 去程最早出发时间（可选）
      return_by_time: fd.get("return_by_time") || null, // 返程最晚到达时间（可选）
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
        <Field label="出发地">
          <div className="flex gap-2">
            <input
              name="origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder={geo === "locating" ? "正在定位…" : "如：北京"}
              className={inputCls}
            />
            <button
              type="button"
              onClick={onRelocate}
              disabled={geo === "locating"}
              className="shrink-0 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-600 hover:border-neutral-900 disabled:opacity-50"
            >
              {geo === "locating" ? "定位中…" : "📍 定位"}
            </button>
          </div>
          <GeoHint geo={geo} />
        </Field>

        <Field label="目的地" required>
          <input
            name="destination"
            required
            placeholder="如：东京"
            className={inputCls}
          />
        </Field>

        <p className="text-xs text-neutral-400">
          {now ? `当前时间：${now}（自动获取）` : "未能获取当前时间"}，
          用于过滤已发车的班次；也可在下方手动指定出发/返程时间。
        </p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="出发日期">
            <input type="date" name="start_date" className={inputCls} />
          </Field>
          <Field label="出发时间（可选，最早）">
            <input type="time" name="depart_time" className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="返回日期">
            <input type="date" name="end_date" className={inputCls} />
          </Field>
          <Field label="返程最晚到达（可选）">
            <input type="time" name="return_by_time" className={inputCls} />
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

/** 本地时间格式化为 "YYYY-MM-DD HH:MM"（不带时区，按旅客本地时间理解） */
function formatLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

/**
 * 反向地理编码：经纬度 → 地名。用 BigDataCloud 的免费客户端接口（无需 key、支持 CORS）。
 * 返回中文地名，失败返回 null。
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  const city = d.city || d.locality || d.principalSubdivision || "";
  const parts = [city, d.countryName].filter(Boolean);
  return parts.length ? parts.join("，") : null;
}

function GeoHint({ geo }: { geo: GeoStatus }) {
  const text =
    geo === "locating"
      ? "正在获取当前位置…"
      : geo === "ok"
        ? "已自动定位，可手动修改"
        : geo === "failed"
          ? "未能自动定位，请手动填写出发地"
          : "";
  if (!text) return null;
  return (
    <span
      className={`mt-1 block text-xs ${
        geo === "failed" ? "text-amber-600" : "text-neutral-400"
      }`}
    >
      {text}
    </span>
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
