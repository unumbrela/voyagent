import { cx } from "./cx";

/** 骨架块：微光扫过（.skeleton 定义在 globals.css） */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** 行程页加载骨架：刊头 + 两张日卡 */
export function TripSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="加载中">
      <div className="rounded-card border border-line bg-surface p-5 shadow-soft">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-2/3" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-card border border-line bg-surface p-5 shadow-soft"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 列表面板加载骨架（候选池 / 追踪 / 观测等） */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
