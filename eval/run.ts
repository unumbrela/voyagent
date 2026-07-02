/**
 * 评测 CLI。
 *
 *   pnpm eval                 # 离线：对着 eval/fixtures/*.json 跑确定性断言（无需任何 key，适合 CI）
 *   pnpm eval --judge         # 追加 LLM-as-Judge 打分（需 DEEPSEEK_API_KEY）
 *   pnpm eval --live          # 真实重跑内存流水线并刷新 fixtures（需 DEEPSEEK_API_KEY）
 *   pnpm eval --case tokyo-5d # 只跑指定用例
 *
 * 退出码：任何 high 级断言失败 → 1（可直接做 CI 回归 gate）。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, findCase } from "./dataset";
import { runAssertions } from "./assertions";
import { judge } from "./judge";
import { runLocalPipeline } from "./localPipeline";
import type { CaseReport, Check, EvalCase, PipelineResult } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const REPORTS = join(HERE, "report");

// ── argv ──
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const LIVE = has("--live");
const JUDGE = has("--judge");
const onlyId = opt("--case");

// ── 颜色（终端友好，非 TTY 自动关闭）──
const useColor = process.stdout.isTTY;
const c = (code: string, s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);

const sevMark = (ch: Check) =>
  ch.pass
    ? green("✓")
    : ch.severity === "high"
      ? red("✗ HIGH")
      : ch.severity === "medium"
        ? yellow("▲ MED")
        : dim("· LOW");

function fixturePath(id: string) {
  return join(FIXTURES, `${id}.json`);
}

async function resultFor(ec: EvalCase): Promise<PipelineResult> {
  if (LIVE) {
    const r = await runLocalPipeline(ec);
    if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(fixturePath(ec.id), JSON.stringify(r, null, 2));
    return r;
  }
  const p = fixturePath(ec.id);
  if (!existsSync(p)) {
    throw new Error(
      `缺少 fixture：${p}\n先跑一次 --live 生成（需 DEEPSEEK_API_KEY），或补一份手写 fixture。`,
    );
  }
  return JSON.parse(readFileSync(p, "utf8")) as PipelineResult;
}

async function evalCase(ec: EvalCase): Promise<CaseReport> {
  const result = await resultFor(ec);
  const checks = runAssertions(ec, result);
  const report: CaseReport = {
    id: ec.id,
    desc: ec.desc,
    checks,
    source: LIVE ? "live" : "fixture",
  };
  if (JUDGE) {
    try {
      report.judge = await judge(ec, result);
    } catch (e) {
      console.error(
        yellow(`  [judge] ${ec.id} 评审失败：${e instanceof Error ? e.message : e}`),
      );
    }
  }
  return report;
}

function printCase(r: CaseReport) {
  const highFails = r.checks.filter((x) => !x.pass && x.severity === "high");
  const anyFail = r.checks.some((x) => !x.pass);
  const head = highFails.length
    ? red("FAIL")
    : anyFail
      ? yellow("WARN")
      : green("PASS");
  console.log(
    `\n${bold(r.id)} ${dim("· " + r.desc)} ${dim("[" + r.source + "]")}  ${head}`,
  );
  for (const ch of r.checks) {
    const line = `  ${sevMark(ch)}  ${ch.name} ${dim("— " + ch.detail)}`;
    console.log(line);
  }
  if (r.judge) {
    const s = r.judge.scores;
    console.log(
      dim(
        `  judge: overall ${r.judge.overall}/5 · 可行${s.feasibility} 动线${s.route_efficiency} 预算${s.budget_fit} 风格${s.style_match} 节奏${s.pacing}`,
      ),
    );
    if (r.judge.weaknesses?.length)
      console.log(dim(`         弱点: ${r.judge.weaknesses.join("；")}`));
  }
}

function writeReports(reports: CaseReport[]) {
  if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });
  writeFileSync(
    join(REPORTS, "latest.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), reports }, null, 2),
  );

  const lines: string[] = [
    `# 评测报告`,
    ``,
    `运行时间：${new Date().toISOString()} · 模式：${LIVE ? "live" : "fixture"}${JUDGE ? " + judge" : ""}`,
    ``,
    `| 用例 | 结果 | high | med | low 失败 | judge overall |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];
  for (const r of reports) {
    const h = r.checks.filter((x) => !x.pass && x.severity === "high").length;
    const m = r.checks.filter((x) => !x.pass && x.severity === "medium").length;
    const l = r.checks.filter((x) => !x.pass && x.severity === "low").length;
    const verdict = h ? "❌ FAIL" : m || l ? "⚠️ WARN" : "✅ PASS";
    lines.push(
      `| ${r.id} | ${verdict} | ${h} | ${m} | ${l} | ${r.judge ? r.judge.overall + "/5" : "—"} |`,
    );
  }
  writeFileSync(join(REPORTS, "latest.md"), lines.join("\n") + "\n");
}

async function main() {
  const cases = onlyId
    ? [findCase(onlyId)].filter((x): x is EvalCase => !!x)
    : CASES;
  if (cases.length === 0) {
    console.error(red(`没有匹配的用例：${onlyId ?? "(全部)"}`));
    process.exit(2);
  }

  console.log(
    bold(`▶ 评测 ${cases.length} 个用例`) +
      dim(` · ${LIVE ? "live 重跑" : "离线 fixture"}${JUDGE ? " · LLM-as-Judge 开" : ""}`),
  );

  const reports: CaseReport[] = [];
  for (const ec of cases) {
    try {
      const r = await evalCase(ec);
      reports.push(r);
      printCase(r);
    } catch (e) {
      console.error(red(`\n${ec.id} 执行失败：${e instanceof Error ? e.message : e}`));
      reports.push({
        id: ec.id,
        desc: ec.desc,
        source: LIVE ? "live" : "fixture",
        checks: [
          { name: "run", pass: false, severity: "high", detail: String(e) },
        ],
      });
    }
  }

  writeReports(reports);

  // ── 汇总 ──
  const allChecks = reports.flatMap((r) => r.checks);
  const highFails = allChecks.filter((x) => !x.pass && x.severity === "high");
  const medFails = allChecks.filter((x) => !x.pass && x.severity === "medium");
  const passRate =
    allChecks.length === 0
      ? 0
      : Math.round((allChecks.filter((x) => x.pass).length / allChecks.length) * 100);

  console.log(
    "\n" +
      bold("── 汇总 ──") +
      `\n断言通过率 ${passRate}%（${allChecks.filter((x) => x.pass).length}/${allChecks.length}）` +
      `  ${red(highFails.length + " high")} · ${yellow(medFails.length + " medium")}`,
  );
  console.log(dim(`报告已写入 eval/report/latest.{json,md}`));

  if (highFails.length > 0) {
    console.log(red(`\n✗ 存在 ${highFails.length} 个 high 级失败 → 退出码 1（回归 gate）`));
    process.exit(1);
  }
  console.log(green(`\n✓ 无 high 级失败`));
}

main().catch((e) => {
  console.error(red("评测崩溃："), e);
  process.exit(2);
});
