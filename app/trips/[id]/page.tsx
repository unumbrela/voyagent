"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Status = "pending" | "running" | "done" | "error";

const AGENTS: {
  key: string;
  label: string;
  wave: number;
  provider: "claude" | "deepseek";
}[] = [
  { key: "enrichment", label: "目的地调研", wave: 1, provider: "deepseek" },
  { key: "activities", label: "活动推荐", wave: 1, provider: "claude" },
  { key: "food", label: "餐饮指南", wave: 1, provider: "deepseek" },
  { key: "scheduling", label: "日程编排", wave: 2, provider: "claude" },
  { key: "transport", label: "交通物流", wave: 3, provider: "claude" },
  { key: "hub_planner", label: "综合行程", wave: 4, provider: "claude" },
  { key: "validator", label: "出行质检", wave: 5, provider: "claude" },
];

interface ItineraryItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
}
interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  items: ItineraryItem[];
}
interface Itinerary {
  title: string;
  overview: string;
  days: ItineraryDay[];
  references: { label: string; value: string }[];
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true; // 防止 StrictMode / 重连重复触发

    const es = new EventSource(`/api/trips/${id}/plan`);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "agent_status") {
        setStatuses((s) => ({ ...s, [e.agent]: e.status }));
      } else if (e.type === "done") {
        setItinerary(e.itinerary as Itinerary);
        setFinished(true);
        es.close(); // 关键：关闭以阻止 EventSource 自动重连重跑流水线
      } else if (e.type === "error") {
        setError(e.message);
        setFinished(true);
        es.close();
      }
    };
    es.onerror = () => {
      // 流正常结束也会触发 onerror；仅在未完成时报错
      if (!startedRef.current) return;
    };
    return () => es.close();
  }, [id]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← 新建行程
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">规划进度</h1>

      {/* 进度面板 */}
      <ol className="mt-6 space-y-2">
        {AGENTS.map((a) => {
          const st = statuses[a.key] ?? "pending";
          return (
            <li
              key={a.key}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2.5"
            >
              <Dot status={st} />
              <span className="text-sm font-medium">{a.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  a.provider === "deepseek"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-orange-100 text-orange-700"
                }`}
              >
                {a.provider === "deepseek" ? "DeepSeek" : "Claude"}
              </span>
              <span className="ml-auto text-xs text-neutral-400">
                第 {a.wave} 波 · {statusLabel(st)}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          规划失败：{error}
        </p>
      )}

      {/* 最终行程 */}
      {itinerary && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">{itinerary.title}</h2>
          <p className="mt-2 text-sm text-neutral-600">{itinerary.overview}</p>

          <div className="mt-6 space-y-6">
            {itinerary.days?.map((d) => (
              <div key={d.day} className="rounded-xl border border-neutral-200 p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-medium">
                    第 {d.day} 天 · {d.theme}
                  </h3>
                  <span className="text-xs text-neutral-400">{d.date}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {d.items?.map((it, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="w-16 shrink-0 text-neutral-400">
                        {it.time}
                      </span>
                      <span>
                        <span className="font-medium">{it.title}</span>{" "}
                        <span className="text-neutral-500">{it.detail}</span>
                        {it.est_cost ? (
                          <span className="text-neutral-400">
                            {" "}
                            · 约 {it.est_cost}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {itinerary.references?.length ? (
            <div className="mt-6 rounded-xl bg-neutral-50 p-4">
              <h4 className="text-sm font-medium">关键信息</h4>
              <dl className="mt-2 space-y-1 text-sm">
                {itinerary.references.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <dt className="text-neutral-400">{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      )}

      {!finished && !error && (
        <p className="mt-6 text-sm text-neutral-400">
          编排进行中…（多 agent + web 搜索，约需 1~3 分钟）
        </p>
      )}
    </main>
  );
}

function statusLabel(s: Status) {
  return { pending: "等待", running: "进行中", done: "完成", error: "出错" }[s];
}

function Dot({ status }: { status: Status }) {
  const cls =
    {
      pending: "bg-neutral-300",
      running: "bg-amber-400 animate-pulse",
      done: "bg-green-500",
      error: "bg-red-500",
    }[status] ?? "bg-neutral-300";
  return <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
}
