"use client";

/**
 * /study —— HCI 用户评估问卷页（骨架）。
 *
 * 三份量表：SUS（系统可用性）、NASA-TLX（任务负荷）、信任量表。
 * 提交时以 event_type='survey' 写入 interaction_logs（复用埋点通道），
 * payload 含：participant、condition（baseline/enhanced）、各量表原始作答 + 计算分。
 *
 * 说明：这是评估基建的骨架，题目与计分为标准量表的中文改写，可按论文需要增删。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { logEvent, flush } from "@/lib/log";

// ── SUS：10 题，奇数题正向、偶数题反向；1~5 李克特 ──
const SUS_ITEMS = [
  "我愿意经常使用这个系统。",
  "我觉得这个系统过于复杂。",
  "我认为这个系统很容易使用。",
  "我需要技术人员的帮助才能使用这个系统。",
  "我觉得系统的各项功能整合得很好。",
  "我觉得系统存在太多不一致的地方。",
  "我想大多数人能很快学会使用它。",
  "我觉得系统使用起来很笨拙。",
  "使用这个系统我很有信心。",
  "在开始使用前我需要学习很多东西。",
];

// ── NASA-TLX：6 维，0~100（业绩维为反向，分低=表现好）──
const TLX_DIMS = [
  { key: "mental", label: "脑力需求", hint: "需要多少思考、判断、记忆？" },
  { key: "physical", label: "体力需求", hint: "需要多少操作、点击、拖拽？" },
  { key: "temporal", label: "时间压力", hint: "节奏是否紧张、有压迫感？" },
  { key: "performance", label: "业绩水平", hint: "你对完成质量的满意度（越左越满意）" },
  { key: "effort", label: "努力程度", hint: "为达成目标付出多少努力？" },
  { key: "frustration", label: "挫败感", hint: "过程中有多沮丧、烦躁？" },
] as const;

// ── 信任量表：5 题，1~7；最后一题反向 ──
const TRUST_ITEMS = [
  { text: "我信任这个系统给出的推荐。", reverse: false },
  { text: "系统的推荐通常是可靠的。", reverse: false },
  { text: "我能理解系统为什么这样推荐。", reverse: false },
  { text: "当系统给出信息来源时，我更愿意相信它。", reverse: false },
  { text: "我担心系统会编造不真实的信息。", reverse: true },
];

export default function StudyPage() {
  const [participant, setParticipant] = useState("");
  const [condition, setCondition] = useState<"baseline" | "enhanced">("baseline");
  const [sus, setSus] = useState<(number | null)[]>(Array(10).fill(null));
  const [tlx, setTlx] = useState<Record<string, number>>(
    Object.fromEntries(TLX_DIMS.map((d) => [d.key, 50])),
  );
  const [trust, setTrust] = useState<(number | null)[]>(Array(5).fill(null));
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const susScore = useMemo(() => {
    if (sus.some((v) => v == null)) return null;
    const vals = sus as number[];
    // 奇数题(索引偶) 正向：val-1；偶数题(索引奇) 反向：5-val
    const sum = vals.reduce(
      (acc, val, i) => acc + (i % 2 === 0 ? val - 1 : 5 - val),
      0,
    );
    return Math.round(sum * 2.5 * 10) / 10; // 0~100
  }, [sus]);

  const trustScore = useMemo(() => {
    if (trust.some((v) => v == null)) return null;
    const vals = trust.map((v, i) =>
      TRUST_ITEMS[i].reverse ? 8 - (v as number) : (v as number),
    );
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }, [trust]);

  const tlxScore = useMemo(
    () =>
      Math.round(
        (TLX_DIMS.reduce((a, d) => a + tlx[d.key], 0) / TLX_DIMS.length) * 10,
      ) / 10,
    [tlx],
  );

  const complete =
    participant.trim() !== "" && susScore != null && trustScore != null;

  function submit() {
    if (!complete) {
      setErr("请填写编号并完成 SUS、信任量表全部题目。");
      return;
    }
    setErr(null);
    logEvent("survey", {
      participant: participant.trim(),
      condition,
      sus: { items: sus, score: susScore },
      tlx: { items: tlx, score: tlxScore },
      trust: { items: trust, score: trustScore },
    });
    flush(); // 立即送出，避免用户马上离开
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-20 text-center">
        <h1 className="font-serif mt-4 text-2xl font-bold text-ink">
          问卷已提交，谢谢你！
        </h1>
        <p className="mt-3 text-sm text-muted">
          你的作答已记录（编号 {participant}，条件 {condition}）。
        </p>
        <div className="mt-6 flex justify-center gap-3 text-sm">
          <button
            onClick={() => {
              setDone(false);
              setParticipant("");
              setSus(Array(10).fill(null));
              setTrust(Array(5).fill(null));
              setTlx(Object.fromEntries(TLX_DIMS.map((d) => [d.key, 50])));
            }}
            className="rounded-md border border-line bg-surface px-4 py-2 font-medium text-ink transition hover:bg-surface-2"
          >
            再填一份
          </button>
          <Link
            href="/"
            className="rounded-lg bg-teal px-4 py-2 font-semibold text-white shadow-soft transition hover:bg-teal-dark"
          >
            回首页
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <span className="ed-eyebrow">用户评估</span>
      <h1 className="font-serif mt-2 text-2xl font-bold tracking-tight text-ink">
        使用体验问卷
      </h1>
      <p className="mt-2 text-sm text-muted">
        请在完成规划任务后填写。约 3 分钟。所有题目请凭真实感受作答。
      </p>

      {/* 被试信息 */}
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">
            被试编号 <span className="text-seal">*</span>
          </span>
          <input
            value={participant}
            onChange={(e) => setParticipant(e.target.value)}
            placeholder="如：P01"
            className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">
            实验条件
          </span>
          <select
            value={condition}
            onChange={(e) =>
              setCondition(e.target.value as "baseline" | "enhanced")
            }
            className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20"
          >
            <option value="baseline">基线（表单 + 接受/拒绝）</option>
            <option value="enhanced">增强（混合主动 + 可解释 + 证据）</option>
          </select>
        </label>
      </section>

      {/* SUS */}
      <Section
        title="一、系统可用性（SUS）"
        desc="1 = 非常不同意，5 = 非常同意"
        right={susScore != null ? `得分 ${susScore}/100` : "未完成"}
      >
        <ol className="space-y-4">
          {SUS_ITEMS.map((q, i) => (
            <li key={i}>
              <p className="text-sm text-ink/80">
                {i + 1}. {q}
              </p>
              <Likert
                n={5}
                value={sus[i]}
                onChange={(v) =>
                  setSus((s) => s.map((x, j) => (j === i ? v : x)))
                }
              />
            </li>
          ))}
        </ol>
      </Section>

      {/* NASA-TLX */}
      <Section
        title="二、任务负荷（NASA-TLX）"
        desc="拖动滑块：越靠左越低，越靠右越高"
        right={`均值 ${tlxScore}/100`}
      >
        <div className="space-y-5">
          {TLX_DIMS.map((d) => (
            <div key={d.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink/80">
                  {d.label}
                </span>
                <span className="text-xs tabular-nums text-muted/80">
                  {tlx[d.key]}
                </span>
              </div>
              <p className="text-xs text-muted/80">{d.hint}</p>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={tlx[d.key]}
                onChange={(e) =>
                  setTlx((t) => ({ ...t, [d.key]: Number(e.target.value) }))
                }
                className="mt-1 w-full accent-teal"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* 信任 */}
      <Section
        title="三、对 AI 的信任"
        desc="1 = 非常不同意，7 = 非常同意"
        right={trustScore != null ? `均值 ${trustScore}/7` : "未完成"}
      >
        <ol className="space-y-4">
          {TRUST_ITEMS.map((q, i) => (
            <li key={i}>
              <p className="text-sm text-ink/80">
                {i + 1}. {q.text}
                {q.reverse && (
                  <span className="ml-1 text-xs text-muted/80">（反向题）</span>
                )}
              </p>
              <Likert
                n={7}
                value={trust[i]}
                onChange={(v) =>
                  setTrust((s) => s.map((x, j) => (j === i ? v : x)))
                }
              />
            </li>
          ))}
        </ol>
      </Section>

      {err && <p className="mt-6 text-sm text-seal">{err}</p>}
      <button
        onClick={submit}
        disabled={!complete}
        className="mt-6 w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-teal-dark disabled:opacity-50 cursor-pointer"
      >
        提交问卷
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        需登录后提交（作答绑定当前账号与会话）。
      </p>
    </main>
  );
}

function Section({
  title,
  desc,
  right,
  children,
}: {
  title: string;
  desc: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-card border border-line bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-base font-bold text-ink">{title}</h2>
        {right && (
          <span className="rounded-pill bg-teal-tint px-2.5 py-0.5 text-xs font-medium text-teal-dark">
            {right}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{desc}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 李克特单选（1~n） */
function Likert({
  n,
  value,
  onChange,
}: {
  n: number;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {Array.from({ length: n }, (_, k) => k + 1).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`h-9 w-9 rounded-lg border text-sm font-medium transition ${
            value === v
              ? "border-teal bg-teal text-white shadow-soft"
              : "border-line text-muted hover:border-teal"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
