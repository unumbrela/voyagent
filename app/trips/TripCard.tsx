"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MapPin, Trash2 } from "@/app/ui/icons";
import { ConfirmModal } from "@/app/ui/modal";
import { toast } from "@/app/ui/toast";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  planning: "规划中",
  done: "已完成",
  failed: "失败",
};

/** 制图集风封面：等高线 + 虚线路线 + 角落罗盘刻度，色调按目的地稳定映射 */
function CoverArt({ hue }: { hue: string }) {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 320 112"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect width="320" height="112" fill={hue} />
      <g fill="none" stroke="#fff" strokeWidth="1" opacity="0.22">
        <path d="M-10 84c40-26 74-2 108-18s52-38 92-30 74 40 140 22" />
        <path d="M-10 64c44-22 70 4 106-14s58-42 96-32 66 34 138 20" />
        <path d="M-10 104c36-18 82-8 118-26s46-30 88-24 82 44 134 24" />
      </g>
      <path
        d="M36 88C90 66 130 84 176 52s78-22 116-30"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeDasharray="1 7"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="176" cy="52" r="3.5" fill="#fff" opacity="0.9" />
      <g opacity="0.5" stroke="#fff" strokeWidth="1">
        <circle cx="292" cy="26" r="12" fill="none" />
        <path d="M292 16v20M282 26h20" />
      </g>
    </svg>
  );
}

export function TripCard({
  id,
  status,
  createdAt,
  destination,
  dates,
  hue,
}: {
  id: string;
  status: string;
  createdAt: string;
  destination: string;
  dates: string;
  hue: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast(`已删除「${destination}」`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "删除失败", "err");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-surface shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
      <Link href={`/trips/${id}`} className="block">
        {/* 封面 */}
        <div className="relative flex h-28 items-end p-4">
          <CoverArt hue={hue} />
          <span className="absolute right-3 top-3">
            <StatusBadge status={status} />
          </span>
          <span className="relative grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur-sm">
            <MapPin className="h-4 w-4" aria-hidden />
          </span>
        </div>
        {/* 信息 */}
        <div className="p-4">
          <h3 className="font-display truncate text-base font-bold text-ink">
            {destination}
          </h3>
          <p className="font-data mt-1 truncate text-xs text-muted">
            {dates || "未设定日期"}
          </p>
          <p className="mt-2 text-[11px] text-muted/80">
            创建于 {new Date(createdAt).toLocaleDateString("zh-CN")}
          </p>
        </div>
      </Link>

      {/* 删除（悬停浮现） */}
      <button
        onClick={() => setConfirming(true)}
        aria-label={`删除行程 ${destination}`}
        className="absolute bottom-3 right-3 rounded-lg border border-line bg-surface p-2 text-muted opacity-0 shadow-soft transition hover:border-seal/40 hover:text-seal focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onDelete}
        title={`删除「${destination}」？`}
        body="这趟行程、规划过程和打包清单都会一起删掉，删了就找不回来了。"
        confirmText="删除"
        danger
        loading={deleting}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "bg-teal-tint text-teal-dark ring-teal/25"
      : status === "failed"
        ? "bg-seal-tint text-seal ring-seal/25"
        : status === "planning"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-white/90 text-muted ring-black/5";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
