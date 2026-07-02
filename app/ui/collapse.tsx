"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, type LucideIcon } from "./icons";
import { cx } from "./cx";

/**
 * 折叠面板：行程页各功能区（候选池/偏好/追踪/打包/助手/搜车票）的统一容器。
 * 白卡 + 图标题头 + 旋转箭头 + 高度动画；受控或非受控均可。
 */
export function Panel({
  icon: Icon,
  title,
  meta,
  actions,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children,
  className,
  bodyClassName,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  /** 标题右侧的小元信息（计数等） */
  meta?: ReactNode;
  /** 头部右侧动作区（不触发折叠） */
  actions?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onToggle?.(next);
  };

  return (
    <div
      className={cx(
        "rounded-card border border-line bg-surface shadow-soft",
        className
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
        >
          {Icon && <Icon className="h-4 w-4 shrink-0 text-teal-dark" aria-hidden />}
          <span className="font-display truncate text-sm font-semibold text-ink">
            {title}
          </span>
          {meta && <span className="shrink-0">{meta}</span>}
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.18 }}
            className="ml-auto shrink-0 text-muted"
            aria-hidden
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className={cx("border-t border-line px-4 py-3", bodyClassName)}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
