import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * 空态：制图线稿插画（罗盘 / 行李 / 地图）+ 标题 + 提示 + 可选操作。
 * 插画用品牌青瓷细线，气质与地图针脚一致。
 */
type Art = "compass" | "luggage" | "map";

function ArtSvg({ kind }: { kind: Art }) {
  const stroke = "var(--teal)";
  const faint = "var(--line-strong)";
  const common = {
    fill: "none",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "compass")
    return (
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <circle cx="44" cy="44" r="30" stroke={stroke} {...common} />
        <circle cx="44" cy="44" r="36" stroke={faint} strokeDasharray="2 5" {...common} />
        <path d="M56 32 47 47l-15 9 9-15z" stroke={stroke} {...common} />
        <circle cx="44" cy="44" r="2.5" fill={stroke} />
        <path d="M44 8v6M44 74v6M8 44h6M74 44h6" stroke={faint} {...common} />
      </svg>
    );
  if (kind === "luggage")
    return (
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <rect x="24" y="30" width="40" height="42" rx="6" stroke={stroke} {...common} />
        <path d="M35 30v-8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8" stroke={stroke} {...common} />
        <path d="M33 40v22M55 40v22" stroke={faint} {...common} />
        <path d="M12 78h64" stroke={faint} strokeDasharray="3 5" {...common} />
      </svg>
    );
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
      <path d="M14 24l20-8 20 8 20-8v48l-20 8-20-8-20 8z" stroke={stroke} {...common} />
      <path d="M34 16v48M54 24v48" stroke={faint} {...common} />
      <path d="M22 44c8-10 16 6 24-2s12-8 18-2" stroke={stroke} strokeDasharray="3 4" {...common} />
      <circle cx="64" cy="38" r="3" fill={stroke} />
    </svg>
  );
}

export function Empty({
  art = "compass",
  title,
  hint,
  action,
  className,
}: {
  art?: Art;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center py-10 text-center",
        className
      )}
    >
      <ArtSvg kind={art} />
      <p className="font-display mt-4 text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
