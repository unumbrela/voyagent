/**
 * 红队评测 CLI：对攻击语料跑护栏检测器，度量【检测率】与【误报率】。
 *
 *   pnpm redteam        # 离线、零 key、确定性
 *   pnpm redteam -v     # 展开每条命中的规则
 *
 * 退出码：漏检任一攻击（false negative）或良性误报（false positive）→ 1（回归 gate）。
 */

import { ATTACKS } from "./attacks";
import { detectInjection } from "@/lib/guardrails";

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");

const useColor = process.stdout.isTTY;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);

interface Row {
  id: string;
  where: string;
  expect: boolean;
  detected: boolean;
  hits: string[];
  ok: boolean; // 检测结论与预期一致
}

function main() {
  const rows: Row[] = ATTACKS.map((a) => {
    const findings = detectInjection(a.text);
    const detected = findings.length > 0;
    return {
      id: a.id,
      where: a.where,
      expect: a.expectDetect,
      detected,
      hits: findings.map((f) => f.id),
      ok: detected === a.expectDetect,
    };
  });

  console.log(bold("▶ 红队：prompt injection 检测评测") + dim(` · ${rows.length} 条`));
  for (const r of rows) {
    const mark = r.ok ? green("✓") : red("✗");
    const kind = r.expect ? "攻击" : "良性";
    const verdict = r.detected ? "命中" : "放行";
    const note = r.ok
      ? ""
      : r.expect
        ? red(" ← 漏检 (false negative)")
        : red(" ← 误报 (false positive)");
    console.log(
      `  ${mark} ${r.id.padEnd(22)} ${dim(`[${r.where}·${kind}]`)} ${verdict}${note}`,
    );
    if (verbose && r.hits.length) console.log(dim(`      规则: ${r.hits.join(", ")}`));
  }

  // ── 指标 ──
  const attacks = rows.filter((r) => r.expect);
  const benign = rows.filter((r) => !r.expect);
  const tp = attacks.filter((r) => r.detected).length;
  const fn = attacks.length - tp;
  const fp = benign.filter((r) => r.detected).length;
  const tn = benign.length - fp;
  const recall = attacks.length ? (tp / attacks.length) * 100 : 100;
  const fpRate = benign.length ? (fp / benign.length) * 100 : 0;

  console.log(
    "\n" +
      bold("── 指标 ──") +
      `\n检测率 (recall) ${recall.toFixed(0)}%  (TP ${tp} / FN ${fn})` +
      `\n误报率           ${fpRate.toFixed(0)}%  (FP ${fp} / TN ${tn})`,
  );

  if (fn > 0 || fp > 0) {
    console.log(red(`\n✗ 有 ${fn} 条漏检、${fp} 条误报 → 退出码 1`));
    process.exit(1);
  }
  console.log(green("\n✓ 全部攻击拦截、无误报"));
}

main();
