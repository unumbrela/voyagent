"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, Info } from "./icons";

/**
 * 全站 toast：模块级发射器 + <Toaster/>（挂在 layout），
 * 任意客户端代码 import { toast } 即可，无需 context。
 */
type Kind = "ok" | "err" | "info";
type ToastItem = { id: number; msg: string; kind: Kind };

const listeners = new Set<(t: ToastItem) => void>();
let seq = 0;

export function toast(msg: string, kind: Kind = "ok") {
  const item = { id: ++seq, msg, kind };
  listeners.forEach((l) => l(item));
}

const ICONS: Record<Kind, typeof Info> = {
  ok: CheckCircle2,
  err: AlertTriangle,
  info: Info,
};
const ICON_CLS: Record<Kind, string> = {
  ok: "text-teal",
  err: "text-seal",
  info: "text-muted",
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const push = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(
        () => setItems((prev) => prev.filter((x) => x.id !== t.id)),
        3200
      );
    };
    listeners.add(push);
    return () => void listeners.delete(push);
  }, []);

  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed bottom-5 left-1/2 z-[1100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      <AnimatePresence>
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface py-2 pl-3 pr-4 shadow-lift"
            >
              <Icon className={`h-4 w-4 shrink-0 ${ICON_CLS[t.kind]}`} aria-hidden />
              <span className="text-sm font-medium text-ink">{t.msg}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
