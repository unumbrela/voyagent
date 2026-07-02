/**
 * 前端交互埋点 SDK（HCI 用户评估基建）。
 *
 * 用法：`import { logEvent } from "@/lib/log";` 然后 `logEvent("diff_apply", { changedDays: 2 }, tripId)`。
 *
 * 设计：
 *   - 事件先入内存缓冲，定时（FLUSH_MS）批量 POST /api/log，降请求数；
 *     高频事件（拖拽）也不会一条一请求。
 *   - 缓冲超过 MAX_BUFFER 立即 flush，避免长时间不刷丢太多。
 *   - 页面隐藏/卸载（pagehide）用 navigator.sendBeacon 兜底，保证离开前的事件不丢。
 *   - session_id 存 sessionStorage：同一标签页内跨导航保持一致（对应一次「实验会话」）。
 *   - 全部 best-effort：任何异常都吞掉，绝不影响主流程。
 */

export interface LogEvent {
  event_type: string;
  payload?: Record<string, unknown>;
  trip_id?: string | null;
  session_id?: string;
  client_ts?: number;
}

const FLUSH_MS = 4000;
const MAX_BUFFER = 20;

let buffer: LogEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

/** 每标签页一个稳定的 session_id（一次实验会话） */
function sessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const KEY = "hci_session_id";
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid =
        (crypto?.randomUUID?.() as string | undefined) ??
        `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  } catch {
    return "no-storage";
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_MS);
}

/** 立即把缓冲区发出去（fetch keepalive；用于常规批量） */
export function flush() {
  if (typeof window === "undefined" || buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  try {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {
      /* best-effort：失败即丢，不重试不报错 */
    });
  } catch {
    /* 忽略 */
  }
}

/** pagehide 时用 sendBeacon 兜底（比 fetch 更可靠地在卸载期送达） */
function flushBeacon() {
  if (typeof navigator === "undefined" || buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  try {
    const blob = new Blob([JSON.stringify({ events })], {
      type: "application/json",
    });
    if (!navigator.sendBeacon("/api/log", blob)) {
      // sendBeacon 拒收（超限）：退回普通 flush
      buffer = events;
      flush();
    }
  } catch {
    /* 忽略 */
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pagehide", flushBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBeacon();
  });
}

/**
 * 记录一次交互事件。best-effort，不抛错、不 await。
 * @param eventType 事件类型（见迁移文件里的枚举注释，可自由扩展）
 * @param payload   结构化附加信息
 * @param tripId    当前行程 id（可选；全局事件不传）
 */
export function logEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
  tripId?: string | null,
) {
  if (typeof window === "undefined") return;
  install();
  buffer.push({
    event_type: eventType,
    payload,
    trip_id: tripId ?? null,
    session_id: sessionId(),
    client_ts: Date.now(),
  });
  if (buffer.length >= MAX_BUFFER) flush();
  else scheduleFlush();
}
