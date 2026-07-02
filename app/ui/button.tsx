"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "./icons";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-teal text-white hover:bg-teal-dark shadow-soft disabled:hover:bg-teal",
  secondary:
    "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "border border-seal/35 text-seal hover:bg-seal-tint",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1",
  md: "h-9 px-4 text-sm gap-1.5",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

/** 全站统一按钮：primary 青瓷 / secondary 描边 / ghost / danger 印章红描边 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", loading, className, children, disabled, ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors cursor-pointer",
          "disabled:opacity-55 disabled:cursor-not-allowed",
          VARIANTS[variant],
          SIZES[size],
          className
        )}
        {...rest}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  }
);
