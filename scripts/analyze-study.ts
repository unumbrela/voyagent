/**
 * P4 用户评估数据分析（离线脚本）。
 *
 * 用 service_role key 读全量 interaction_logs（绕过 RLS，仅本地/研究者运行，绝不入浏览器），
 * 按 session 聚合行为指标、并入同 session 的问卷分（SUS/NASA-TLX/信任），
 * 再按实验条件（baseline / enhanced）汇总，输出控制台报告 + 可选 CSV。
 *
 * 运行：
 *   pnpm analyze:study                 # 仅打印报告
 *   pnpm analyze:study --csv out/      # 另外导出 sessions.csv / by-condition.csv 到 out/
 *
 * 依赖 .env.local 里的 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── 连接 ──
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY —— 请在 .env.local 填好后再运行。",
  );
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── 类型 ──
interface LogRow {
  id: string;
  user_id: string | null;
  trip_id: string | null;
  session_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

type Condition = "baseline" | "enhanced" | "unknown";

interface SessionMetrics {
  session_id: string;
  participant: string;
  condition: Condition;
  events: number;
  durationSec: number;
  // 行为指标
  edits: number; // item_add + item_delete + drag_move + diff_apply（对行程的实质改动次数）
  applyCount: number; // diff_apply（接受 AI 改动）
  discardCount: number; // diff_discard（拒绝 AI 改动）
  applyRatio: number | null; // apply /(apply+discard)
  undoCount: number;
  chatCount: number; // chat_send（对话轮数）
  reorderCount: number; // pref_reorder_request（偏好重排）
  traceOpened: number; // trace_open + trace_expand_agent（过程可见化使用）
  sourceOpen: number; // source_open（点开取证来源，信任校准行为）
  voiceCount: number; // voice_input（多模态）
  // 问卷分（无则 null）
  sus: number | null;
  tlx: number | null;
  trust: number | null;
}

// ── 工具 ──
const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;
const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (xs: number[]): number | null => {
  const m = mean(xs);
  if (m == null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const fmt = (v: number | null, d = 1): string =>
  v == null ? "—" : v.toFixed(d);
/** 取某字段（可空）为数值型指标数组，跳过 null */
const col = (rows: SessionMetrics[], pick: (s: SessionMetrics) => number | null) =>
  rows.map(pick).filter((x): x is number => x != null);

// ── 拉全量日志 ──
async function fetchAll(): Promise<LogRow[]> {
  const all: LogRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("interaction_logs")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`读取 interaction_logs 失败：${error.message}`);
    const batch = (data ?? []) as LogRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

// ── 单 session 指标 ──
function computeSession(session: string, rows: LogRow[]): SessionMetrics {
  const times = rows.map((r) => new Date(r.created_at).getTime());
  const durationSec = rows.length
    ? (Math.max(...times) - Math.min(...times)) / 1000
    : 0;

  const count = (type: string) => rows.filter((r) => r.event_type === type).length;

  // 问卷（取该 session 最后一条 survey）
  const surveys = rows.filter((r) => r.event_type === "survey");
  const last = surveys[surveys.length - 1]?.payload as
    | {
        participant?: unknown;
        condition?: unknown;
        sus?: { score?: unknown };
        tlx?: { score?: unknown };
        trust?: { score?: unknown };
      }
    | undefined;

  const condition: Condition =
    last?.condition === "baseline" || last?.condition === "enhanced"
      ? last.condition
      : "unknown";

  const applyCount = count("diff_apply");
  const discardCount = count("diff_discard");
  const denom = applyCount + discardCount;

  return {
    session_id: session,
    participant: typeof last?.participant === "string" ? last.participant : "",
    condition,
    events: rows.length,
    durationSec,
    edits: count("item_add") + count("item_delete") + count("drag_move") + applyCount,
    applyCount,
    discardCount,
    applyRatio: denom ? applyCount / denom : null,
    undoCount: count("undo"),
    chatCount: count("chat_send"),
    reorderCount: count("pref_reorder_request"),
    traceOpened: count("trace_open") + count("trace_expand_agent"),
    sourceOpen: count("source_open"),
    voiceCount: count("voice_input"),
    sus: num(last?.sus?.score),
    tlx: num(last?.tlx?.score),
    trust: num(last?.trust?.score),
  };
}

// ── 条件汇总 ──
function summarizeCondition(cond: string, rows: SessionMetrics[]) {
  const withSurvey = rows.filter((r) => r.sus != null || r.trust != null);
  const line = (
    label: string,
    pick: (s: SessionMetrics) => number | null,
    d = 1,
  ) => {
    const xs = col(rows, pick);
    return `  ${label.padEnd(18)} n=${String(xs.length).padStart(2)}  均值 ${fmt(mean(xs), d).padStart(7)}  中位 ${fmt(median(xs), d).padStart(7)}  SD ${fmt(sd(xs), d).padStart(7)}`;
  };
  console.log(`\n【条件：${cond}】 session=${rows.length}  含问卷=${withSurvey.length}`);
  console.log("  — 行为指标 —");
  console.log(line("任务时长(秒)", (s) => s.durationSec));
  console.log(line("实质编辑次数", (s) => s.edits));
  console.log(line("接受AI改动", (s) => s.applyCount));
  console.log(line("拒绝AI改动", (s) => s.discardCount));
  console.log(line("接受率", (s) => s.applyRatio, 2));
  console.log(line("撤销次数", (s) => s.undoCount));
  console.log(line("对话轮数", (s) => s.chatCount));
  console.log(line("偏好重排", (s) => s.reorderCount));
  console.log(line("过程面板使用", (s) => s.traceOpened));
  console.log(line("点开来源", (s) => s.sourceOpen));
  console.log(line("语音输入", (s) => s.voiceCount));
  console.log("  — 量表 —");
  console.log(line("SUS(0-100)", (s) => s.sus));
  console.log(line("NASA-TLX", (s) => s.tlx));
  console.log(line("信任(1-7)", (s) => s.trust, 2));
}

// ── CSV ──
function toCsv(sessions: SessionMetrics[]): string {
  const headers = [
    "session_id", "participant", "condition", "events", "durationSec",
    "edits", "applyCount", "discardCount", "applyRatio", "undoCount",
    "chatCount", "reorderCount", "traceOpened", "sourceOpen", "voiceCount",
    "sus", "tlx", "trust",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const s of sessions) {
    lines.push(
      [
        s.session_id, s.participant, s.condition, s.events, s.durationSec.toFixed(1),
        s.edits, s.applyCount, s.discardCount, s.applyRatio ?? "", s.undoCount,
        s.chatCount, s.reorderCount, s.traceOpened, s.sourceOpen, s.voiceCount,
        s.sus ?? "", s.tlx ?? "", s.trust ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

function conditionCsv(byCond: Record<string, SessionMetrics[]>): string {
  const metrics: [string, (s: SessionMetrics) => number | null][] = [
    ["durationSec", (s) => s.durationSec],
    ["edits", (s) => s.edits],
    ["applyCount", (s) => s.applyCount],
    ["discardCount", (s) => s.discardCount],
    ["applyRatio", (s) => s.applyRatio],
    ["undoCount", (s) => s.undoCount],
    ["chatCount", (s) => s.chatCount],
    ["reorderCount", (s) => s.reorderCount],
    ["traceOpened", (s) => s.traceOpened],
    ["sourceOpen", (s) => s.sourceOpen],
    ["voiceCount", (s) => s.voiceCount],
    ["sus", (s) => s.sus],
    ["tlx", (s) => s.tlx],
    ["trust", (s) => s.trust],
  ];
  const lines = ["condition,metric,n,mean,median,sd"];
  for (const [cond, rows] of Object.entries(byCond)) {
    for (const [name, pick] of metrics) {
      const xs = col(rows, pick);
      lines.push(
        [cond, name, xs.length, mean(xs) ?? "", median(xs) ?? "", sd(xs) ?? ""].join(","),
      );
    }
  }
  return lines.join("\n");
}

// ── 主流程 ──
async function main() {
  const csvIdx = process.argv.indexOf("--csv");
  const csvDir = csvIdx >= 0 ? process.argv[csvIdx + 1] : null;

  console.log("→ 读取 interaction_logs …");
  const logs = await fetchAll();
  console.log(`  共 ${logs.length} 条事件`);
  if (!logs.length) {
    console.log("暂无数据：确认 0004 迁移已执行、且被试登录后产生过交互/填了问卷。");
    return;
  }

  // 按 session 分组（无 session_id 的归到 "(no-session)"）
  const bySession = new Map<string, LogRow[]>();
  for (const r of logs) {
    const sid = r.session_id ?? "(no-session)";
    (bySession.get(sid) ?? bySession.set(sid, []).get(sid)!).push(r);
  }

  const sessions = [...bySession.entries()]
    .map(([sid, rows]) => computeSession(sid, rows))
    .sort((a, b) => a.condition.localeCompare(b.condition));

  // 事件类型分布（总体）
  const typeCount = new Map<string, number>();
  for (const r of logs) typeCount.set(r.event_type, (typeCount.get(r.event_type) ?? 0) + 1);
  console.log("\n【事件类型分布】");
  for (const [t, c] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(22)} ${c}`);
  }

  console.log(`\n【会话总览】 共 ${sessions.length} 个 session`);
  const byCond: Record<string, SessionMetrics[]> = {};
  for (const s of sessions) (byCond[s.condition] ??= []).push(s);
  for (const cond of ["baseline", "enhanced", "unknown"]) {
    if (byCond[cond]?.length) summarizeCondition(cond, byCond[cond]);
  }

  // 提示：两组齐全时给一句对比速览
  if (byCond.baseline?.length && byCond.enhanced?.length) {
    const d = (pick: (s: SessionMetrics) => number | null) =>
      (mean(col(byCond.enhanced, pick)) ?? NaN) - (mean(col(byCond.baseline, pick)) ?? NaN);
    console.log("\n【增强 − 基线（均值差，正=增强更高）】");
    console.log(`  SUS ${fmt(d((s) => s.sus))}  |  TLX ${fmt(d((s) => s.tlx))}  |  信任 ${fmt(d((s) => s.trust), 2)}  |  时长(秒) ${fmt(d((s) => s.durationSec))}  |  点开来源 ${fmt(d((s) => s.sourceOpen))}`);
    console.log("  （正式显著性检验请用导出的 CSV 在 R/Python/SPSS 里做配对 t 检验或 Wilcoxon）");
  }

  if (csvDir) {
    mkdirSync(csvDir, { recursive: true });
    const p1 = join(csvDir, "sessions.csv");
    const p2 = join(csvDir, "by-condition.csv");
    writeFileSync(p1, toCsv(sessions), "utf8");
    writeFileSync(p2, conditionCsv(byCond), "utf8");
    console.log(`\n✓ 已导出：\n  ${p1}\n  ${p2}`);
  } else {
    console.log("\n提示：加 --csv <目录> 可导出 sessions.csv / by-condition.csv 供统计软件使用。");
  }
}

main().catch((e) => {
  console.error("✗ 分析失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
