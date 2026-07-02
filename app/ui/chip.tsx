import type { ReactNode } from "react";
import { cx } from "./cx";

type Tone = "teal" | "ink" | "seal" | "muted" | "amber";

const TONES: Record<Tone, string> = {
  teal: "bg-teal-tint text-teal-dark",
  ink: "bg-surface-2 text-ink",
  seal: "bg-seal-tint text-seal",
  muted: "bg-surface-2 text-muted",
  amber: "bg-amber-50 text-amber-700",
};

/** 小标签胶囊：状态 / 元信息 / 计数 */
export function Chip({
  tone = "muted",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** 邮戳式印章徽章（「已核实」等证据标记，印章红，微旋转） */
export function SealStamp({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx("seal-stamp", className)}>{children}</span>;
}
