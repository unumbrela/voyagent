"use client";

/**
 * 运营可观测面板：一次多智能体规划的 token / 成本 / 延迟瀑布。
 * 读 GET /api/trips/[id]/spans（rollup + waterfall），纯展示。
 * 与「规划过程」内容摘要（RQ2）互补——这里回答「多快、多贵、卡在哪」。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Kind = "pipeline" | "agent" | "llm" | "tool";

interface WaterfallRow {
  id: string;
  depth: number;
  name: string;
  kind: Kind;
  offsetMs: number;
  durationMs: number;
  model?: string;
  totalTokens?: number;
  costUsd?: number;
  error?: string | null;
}
interface AgentRollup {
  name: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  llmCalls: number;
  toolCalls: number;
  error: string | null;
}
interface Rollup {
  spanCount: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  wallMs: number;
  sumAgentMs: number;
  byAgent: AgentRollup[];
}

const KIND_COLOR: Record<Kind, string> = {
  pipeline: "#4a7fb5",
  agent: "#0f8b8b",
  llm: "#6366f1",
  tool: "#f97316",
};
const KIND_LABEL: Record<Kind, string> = {
  pipeline: "流水线",
  agent: "Agent",
  llm: "LLM",
  tool: "工具",
};

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtUsd = (u: number) => `$${u.toFixed(4)}`;
const fmtTok = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-soft">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-serif mt-0.5 text-xl font-bold text-ink tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export default function ObservabilityPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ rollup: Rollup; waterfall: WaterfallRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/spans`);
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <div className="p-8 text-muted">加载追踪数据…</div>;
  if (err) return <div className="p-8 text-seal">加载失败：{err}</div>;
  if (!data || !data.waterfall.length)
    return (
      <div className="p-8 text-muted">
        暂无追踪数据。重新生成一次行程（<code>/trips/{id}</code>）后即可看到 token/成本/延迟瀑布。
      </div>
    );

  const { rollup, waterfall } = data;
  const totalSpan = Math.max(...waterfall.map((r) => r.offsetMs + r.durationMs), 1);
  const saved = rollup.sumAgentMs - rollup.wallMs;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <a
        href={`/trips/${id}`}
        className="mb-4 inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted shadow-soft transition hover:-translate-y-px hover:text-ink"
      >
        ← 返回行程
      </a>
      <div className="mt-4">
        <span className="ed-eyebrow">开发者视图</span>
      </div>
      <h1 className="font-serif mt-2 text-2xl font-bold tracking-tight text-ink">
        规划追踪 · 可观测
      </h1>
      <p className="mt-1 text-sm text-muted">
        一次多智能体规划的执行瀑布：token 用量、折算成本、各 agent 延迟。
      </p>

      {/* 汇总 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="总成本" value={fmtUsd(rollup.totalCostUsd)} hint={`${rollup.llmCalls} 次 LLM 调用`} />
        <Stat
          label="总 token"
          value={fmtTok(rollup.totalTokens)}
          hint={`in ${fmtTok(rollup.promptTokens)} / out ${fmtTok(rollup.completionTokens)}`}
        />
        <Stat label="墙钟时长" value={fmtMs(rollup.wallMs)} hint={`串行需 ${fmtMs(rollup.sumAgentMs)}`} />
        <Stat
          label="并行节省"
          value={fmtMs(saved > 0 ? saved : 0)}
          hint={`工具调用 ${rollup.toolCalls} 次`}
        />
      </div>

      {/* 瀑布 */}
      <div className="mt-6 rounded-card border border-line bg-surface p-4 shadow-soft">
        <div className="mb-3 flex items-center gap-3 text-xs text-muted">
          {(["pipeline", "agent", "llm", "tool"] as Kind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
        <div className="space-y-1">
          {waterfall.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <div
                className="shrink-0 truncate text-ink"
                style={{ width: 190, paddingLeft: r.depth * 12 }}
                title={r.name}
              >
                <span className="mr-1" style={{ color: KIND_COLOR[r.kind] }}>
                  {r.kind === "llm" ? "▸" : r.kind === "tool" ? "◇" : "■"}
                </span>
                {r.name}
              </div>
              <div className="relative h-4 flex-1 rounded bg-surface-2">
                <div
                  className="absolute top-0 h-4 rounded"
                  style={{
                    left: `${(r.offsetMs / totalSpan) * 100}%`,
                    width: `${Math.max((r.durationMs / totalSpan) * 100, 0.8)}%`,
                    background: r.error ? "var(--seal)" : KIND_COLOR[r.kind],
                    opacity: r.kind === "pipeline" ? 0.35 : 0.85,
                  }}
                  title={r.error ?? undefined}
                />
              </div>
              <div className="font-data w-28 shrink-0 text-right text-muted">
                {fmtMs(r.durationMs)}
                {r.totalTokens ? ` · ${fmtTok(r.totalTokens)}t` : ""}
                {r.costUsd ? ` · ${fmtUsd(r.costUsd)}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 分 agent */}
      <div className="mt-6 rounded-card border border-line bg-surface p-4 shadow-soft">
        <div className="mb-2 text-sm font-medium text-ink">分 agent（按耗时降序）</div>
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line text-left">
              <th className="py-1.5 font-normal">Agent</th>
              <th className="py-1.5 text-right font-normal">耗时</th>
              <th className="py-1.5 text-right font-normal">token</th>
              <th className="py-1.5 text-right font-normal">成本</th>
              <th className="py-1.5 text-right font-normal">LLM/工具</th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {rollup.byAgent.map((a) => (
              <tr key={a.name} className="border-b border-line/60 last:border-0">
                <td className="py-1.5">
                  {a.name}
                  {a.error && <span className="ml-1 text-seal">✗</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmtMs(a.durationMs)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtTok(a.totalTokens)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtUsd(a.costUsd)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted">
                  {a.llmCalls}/{a.toolCalls}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
