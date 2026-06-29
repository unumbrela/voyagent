"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

// 地图依赖浏览器（Leaflet 直接操作 DOM），仅客户端加载，避免 SSR
const TripMap = dynamic(() => import("./TripMap"), { ssr: false });

type Status = "pending" | "running" | "done" | "error";
type Phase = "loading" | "planning" | "ready" | "error";

const AGENTS: { key: string; label: string; wave: number; search?: boolean }[] = [
  { key: "enrichment", label: "目的地调研", wave: 1 },
  { key: "activities", label: "活动推荐", wave: 1, search: true },
  { key: "food", label: "餐饮指南", wave: 1 },
  { key: "accommodation", label: "住宿推荐", wave: 2, search: true },
  { key: "scheduling", label: "日程编排", wave: 3 },
  { key: "transport", label: "交通物流", wave: 4, search: true },
  { key: "hub_planner", label: "综合行程", wave: 5 },
  { key: "validator", label: "出行质检", wave: 6 },
];

const KINDS = ["activity", "food", "rest", "transit"];

interface ItineraryItem {
  time: string;
  title: string;
  kind: string;
  detail: string;
  est_cost: number;
  /** 购票/预订链接（从 detail 剥离出来，单独存；不在 detail 文本里展示） */
  booking_url?: string;
}
interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  items: ItineraryItem[];
}
interface Reference {
  label: string;
  value: string;
}
interface Meta {
  destination: string | null;
  origin: string | null;
  start_date: string | null;
  end_date: string | null;
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [meta, setMeta] = useState<Meta>({
    destination: null,
    origin: null,
    start_date: null,
    end_date: null,
  });
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const startedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载失败");
        setMeta({
          destination: data.destination,
          origin: data.origin,
          start_date: data.start_date,
          end_date: data.end_date,
        });

        // 已完成 → 直接渲染存好的行程，不再重跑流水线（P1 幂等）
        if (data.status === "done" && Array.isArray(data.days)) {
          setTitle(`${data.destination ?? ""} 行程`.trim());
          setDays(normalizeDays(data.days as ItineraryDay[]));
          setReferences((data.references as Reference[]) ?? []);
          setPhase("ready");
          return;
        }

        // 未完成 → 触发编排并流式渲染进度
        setPhase("planning");
        const es = new EventSource(`/api/trips/${id}/plan`);
        esRef.current = es;
        es.onmessage = (ev) => {
          const e = JSON.parse(ev.data);
          if (e.type === "agent_status") {
            setStatuses((s) => ({ ...s, [e.agent]: e.status }));
          } else if (e.type === "done") {
            const it = e.itinerary as {
              title?: string;
              overview?: string;
              days?: ItineraryDay[];
              references?: Reference[];
            };
            setTitle(it?.title ?? "");
            setOverview(it?.overview ?? "");
            setDays(normalizeDays(it?.days ?? []));
            setReferences(it?.references ?? []);
            setPhase("ready");
            es.close();
          } else if (e.type === "error") {
            setError(e.message);
            setPhase("error");
            es.close();
          }
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
  }, [id]);

  // ── 编辑操作 ──
  const touch = () => {
    setDirty(true);
    setSaveMsg(null);
  };
  function updateItem(
    di: number,
    ii: number,
    field: keyof ItineraryItem,
    value: string | number,
  ) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di
          ? d
          : {
              ...d,
              items: d.items.map((it, y) =>
                y !== ii ? it : { ...it, [field]: value },
              ),
            },
      ),
    );
    touch();
  }
  function deleteItem(di: number, ii: number) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di ? d : { ...d, items: d.items.filter((_, y) => y !== ii) },
      ),
    );
    touch();
  }
  function addItem(di: number) {
    setDays((prev) =>
      prev.map((d, x) =>
        x !== di
          ? d
          : {
              ...d,
              items: [
                ...d.items,
                { time: "", title: "新条目", kind: "activity", detail: "", est_cost: 0 },
              ],
            },
      ),
    );
    touch();
  }

  // 拖拽排序（支持跨天）
  const dragSrc = useRef<{ d: number; i: number } | null>(null);
  function dropOnto(dd: number, di: number) {
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!src || (src.d === dd && src.i === di)) return;
    setDays((prev) => {
      const next = prev.map((d) => ({ ...d, items: [...d.items] }));
      const [moved] = next[src.d].items.splice(src.i, 1);
      let target = di;
      if (src.d === dd && src.i < di) target -= 1;
      next[dd].items.splice(target, 0, moved);
      return next;
    });
    touch();
  }

  async function save() {
    setSaveMsg("保存中…");
    try {
      const res = await fetch(`/api/trips/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, references }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setDirty(false);
      setSaveMsg("已保存 ✓");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← 新建行程
      </Link>

      {/* 规划进度（仅编排中显示） */}
      {(phase === "loading" || phase === "planning") && (
        <>
          <h1 className="mt-4 text-2xl font-semibold">规划进度</h1>
          <ol className="mt-6 space-y-2">
            {AGENTS.map((a) => {
              const st = statuses[a.key] ?? "pending";
              return (
                <li
                  key={a.key}
                  className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2.5"
                >
                  <Dot status={st} />
                  <span className="text-sm font-medium">{a.label}</span>
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                    DeepSeek
                  </span>
                  {a.search && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      联网
                    </span>
                  )}
                  <span className="ml-auto text-xs text-neutral-400">
                    第 {a.wave} 波 · {statusLabel(st)}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 text-sm text-neutral-400">
            {phase === "loading"
              ? "加载中…"
              : "编排进行中…（多 agent + web 搜索，约需 1~3 分钟）"}
          </p>
        </>
      )}

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* 可编辑行程 */}
      {phase === "ready" && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">{title || "我的行程"}</h1>
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className="text-xs text-neutral-500">{saveMsg}</span>
              )}
              <button
                onClick={save}
                disabled={!dirty}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
          {overview && (
            <p className="mt-2 text-sm text-neutral-600">{overview}</p>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            可拖拽条目排序、直接修改内容；交通条目可点「🔍 搜车票」换乘真实车次。
          </p>

          {/* 行程地图：起点 → 每日各站 → 路线可视化 */}
          {days.length > 0 && <TripMap days={days} meta={meta} />}

          <div className="mt-6 space-y-6">
            {days.map((d, di) => (
              <div
                key={di}
                className="rounded-xl border border-neutral-200 p-4"
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-medium">
                    第 {d.day} 天 · {d.theme}
                  </h3>
                  <span className="text-xs text-neutral-400">{d.date}</span>
                </div>

                <ul className="mt-3 space-y-2">
                  {d.items.map((it, ii) => (
                    <ItemCard
                      key={ii}
                      item={it}
                      meta={meta}
                      onDragStart={() => (dragSrc.current = { d: di, i: ii })}
                      onDrop={() => dropOnto(di, ii)}
                      onChange={(f, v) => updateItem(di, ii, f, v)}
                      onDelete={() => deleteItem(di, ii)}
                    />
                  ))}
                </ul>

                {/* 末尾放置区 + 添加 */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOnto(di, d.items.length)}
                  className="mt-2 flex items-center justify-between"
                >
                  <span className="text-[11px] text-neutral-300">
                    拖到此处放到本日末尾
                  </span>
                  <button
                    onClick={() => addItem(di)}
                    className="rounded border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-500"
                  >
                    + 添加条目
                  </button>
                </div>
              </div>
            ))}
          </div>

          {references.length ? (
            <div className="mt-6 rounded-xl bg-neutral-50 p-4">
              <h4 className="text-sm font-medium">关键信息</h4>
              <dl className="mt-2 space-y-1 text-sm">
                {references.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <dt className="shrink-0 text-neutral-400">{r.label}</dt>
                    <dd>
                      <Linkify text={r.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}

/** 单个行程条目卡片：可拖拽、可编辑、交通条目可搜车票 */
function ItemCard({
  item,
  meta,
  onDragStart,
  onDrop,
  onChange,
  onDelete,
}: {
  item: ItineraryItem;
  meta: Meta;
  onDragStart: () => void;
  onDrop: () => void;
  onChange: (field: keyof ItineraryItem, value: string | number) => void;
  onDelete: () => void;
}) {
  // null=未展开；"train"=搜车票；"flight"=搜航班
  const [searchMode, setSearchMode] = useState<null | "train" | "flight">(null);
  const bookingUrl = item.booking_url || extractUrl(item.detail);
  const link = bookingMeta(item.kind); // { label, cls }
  // 城际交通才显示搜车票/搜航班；打车/地铁/步行等本地交通不显示
  const longHaul = item.kind === "transit" && !LOCAL_TRANSIT_RE.test(`${item.title} ${item.detail}`);

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="rounded-lg border border-neutral-200 bg-white p-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 cursor-grab select-none text-neutral-300" title="拖拽排序">
          ⠿
        </span>
        <input
          value={item.time}
          onChange={(e) => onChange("time", e.target.value)}
          placeholder="时间"
          className="w-20 shrink-0 rounded border border-transparent px-1 py-0.5 text-sm text-neutral-500 hover:border-neutral-200 focus:border-neutral-400 focus:outline-none"
        />
        <div className="flex-1">
          <input
            value={item.title}
            onChange={(e) => onChange("title", e.target.value)}
            placeholder="标题"
            className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-medium hover:border-neutral-200 focus:border-neutral-400 focus:outline-none"
          />
          <textarea
            value={item.detail}
            onChange={(e) => onChange("detail", e.target.value)}
            placeholder="详情"
            rows={Math.max(1, Math.ceil((item.detail?.length || 0) / 40))}
            className="mt-0.5 w-full resize-none rounded border border-transparent px-1 py-0.5 text-sm text-neutral-500 hover:border-neutral-200 focus:border-neutral-400 focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <select
              value={KINDS.includes(item.kind) ? item.kind : "activity"}
              onChange={(e) => onChange("kind", e.target.value)}
              className="rounded border border-neutral-200 px-1 py-0.5 text-neutral-500"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-neutral-400">¥</span>
            <input
              type="number"
              value={item.est_cost || 0}
              onChange={(e) => onChange("est_cost", Number(e.target.value))}
              className="w-16 rounded border border-neutral-200 px-1 py-0.5"
            />
            {bookingUrl && (
              <a
                href={bookingUrl}
                target="_blank"
                rel="noreferrer"
                className={`rounded px-2 py-0.5 font-medium text-white ${link.cls}`}
              >
                {link.label}
              </a>
            )}
            {longHaul && (
              <>
                <button
                  onClick={() =>
                    setSearchMode((m) => (m === "train" ? null : "train"))
                  }
                  className="text-emerald-700 hover:underline"
                >
                  🔍 搜车票
                </button>
                <button
                  onClick={() =>
                    setSearchMode((m) => (m === "flight" ? null : "flight"))
                  }
                  className="text-sky-700 hover:underline"
                >
                  ✈️ 搜航班
                </button>
              </>
            )}
            <button
              onClick={onDelete}
              className="ml-auto text-neutral-400 hover:text-red-600"
              title="删除"
            >
              ✕
            </button>
          </div>

          {searchMode && longHaul && (
            <TransitSearch
              meta={meta}
              mode={searchMode}
              onPick={(t) => {
                onChange("title", t.name);
                // 详情只留干净信息，购票链接单独存到 booking_url（按钮跳转）
                onChange(
                  "detail",
                  `${t.depart} → ${t.arrive} · ${t.duration} · ${t.price_cny}`,
                );
                onChange("est_cost", parsePrice(t.price_cny));
                onChange("kind", "transit");
                onChange("booking_url", t.booking_url);
                setSearchMode(null);
              }}
            />
          )}
        </div>
      </div>
    </li>
  );
}

interface Transit {
  name: string;
  depart: string;
  arrive: string;
  duration: string;
  price_cny: string;
  booking_url: string;
  source_url: string;
  airline?: string; // 仅航班
}

/** 交通换乘实时搜索：mode=train 搜真实车次 / mode=flight 搜真实航班，下拉点选替换条目 */
function TransitSearch({
  meta,
  mode,
  onPick,
}: {
  meta: Meta;
  mode: "train" | "flight";
  onPick: (t: Transit) => void;
}) {
  const [from, setFrom] = useState(meta.origin ?? "");
  const [to, setTo] = useState(meta.destination ?? "");
  const [date, setDate] = useState(meta.start_date ?? "");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Transit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isFlight = mode === "flight";
  const endpoint = isFlight ? "/api/flights" : "/api/trains";
  const accent = isFlight
    ? { border: "border-sky-200", bg: "bg-sky-50/50", btn: "bg-sky-600 hover:bg-sky-700", hover: "hover:border-sky-400", noun: "航班", empty: "未搜到航班" }
    : { border: "border-emerald-200", bg: "bg-emerald-50/50", btn: "bg-emerald-600 hover:bg-emerald-700", hover: "hover:border-emerald-400", noun: "趟", empty: "未搜到车次" };

  async function run() {
    if (!from || !to) {
      setErr("请填出发地和到达地");
      return;
    }
    setLoading(true);
    setErr(null);
    setItems(null);
    try {
      const q = new URLSearchParams({ from, to, date });
      const res = await fetch(`${endpoint}?${q.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "搜索失败");
      setItems((isFlight ? data.flights : data.trains) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`mt-2 rounded-lg border ${accent.border} ${accent.bg} p-2.5`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="出发地"
          className="w-24 rounded border border-neutral-300 px-1.5 py-1"
        />
        <span className="text-neutral-400">→</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="到达地"
          className="w-24 rounded border border-neutral-300 px-1.5 py-1"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-neutral-300 px-1.5 py-1"
        />
        <button
          onClick={run}
          disabled={loading}
          className={`rounded px-2.5 py-1 font-medium text-white disabled:opacity-50 ${accent.btn}`}
        >
          {loading ? "搜索中…" : isFlight ? "搜航班" : "搜车票"}
        </button>
      </div>
      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
      {items && (
        <>
          {items.length > 0 && (
            <p className="mt-2 text-[11px] text-neutral-500">
              共 {items.length} {accent.noun} · 滚动浏览，点选替换该条目
            </p>
          )}
          <ul className="mt-1 max-h-80 space-y-1 overflow-y-auto pr-1">
            {items.length === 0 && (
              <li className="text-xs text-neutral-500">{accent.empty}</li>
            )}
            {items.map((t, i) => (
              <li key={i}>
                <button
                  onClick={() => onPick(t)}
                  className={`w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-left text-xs ${accent.hover}`}
                >
                  <span className="font-medium">{t.name}</span>
                  {t.airline ? (
                    <span className="text-neutral-500"> {t.airline}</span>
                  ) : null}{" "}
                  <span className="text-neutral-600">
                    {t.depart} → {t.arrive}
                  </span>{" "}
                  <span className="text-neutral-400">
                    {t.duration} · {t.price_cny}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 从文本里抽第一个 URL（购票链接用） */
function extractUrl(text: string): string | null {
  const m = text?.match(/https?:\/\/[^\s，。）)]+/);
  return m ? m[0] : null;
}
function parsePrice(s: string): number {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** 本地短途交通（不显示搜车票/搜航班） */
const LOCAL_TRANSIT_RE =
  /打车|出租|网约车|滴滴|地铁|公交|步行|巴士|班车|接驳|缆车|轮渡|摆渡|taxi|metro|subway|walk|bus/i;

/** 按条目类别决定跳转按钮的文案与配色 */
function bookingMeta(kind: string): { label: string; cls: string } {
  if (kind === "transit")
    return { label: "🎫 购票", cls: "bg-blue-600 hover:bg-blue-700" };
  if (kind === "rest")
    return { label: "🏨 预订", cls: "bg-rose-600 hover:bg-rose-700" };
  return { label: "🔗 查看", cls: "bg-neutral-600 hover:bg-neutral-700" };
}

/** 把 detail 里的购票/预订 URL 剥离到 item.booking_url，detail 只留干净文字 */
function normalizeDays(days: ItineraryDay[]): ItineraryDay[] {
  return (days ?? []).map((d) => ({
    ...d,
    items: (d.items ?? []).map((it) => {
      const url = it.booking_url || extractUrl(it.detail || "") || undefined;
      let detail = it.detail ?? "";
      if (url) {
        const idx = detail.indexOf(url);
        if (idx >= 0) {
          const head = detail
            .slice(0, idx)
            .replace(/[·,，;；\s]*(购票|预订|订票|详情|链接|预定)?\s*[:：]?\s*$/, "")
            .trim();
          const tail = detail.slice(idx + url.length).trim();
          detail = (head + (tail ? ` ${tail}` : "")).trim();
        }
      }
      return { ...it, detail, booking_url: url };
    }),
  }));
}

/** 把文本里的 URL 渲染成可点击链接 */
function Linkify({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/[^\s，。）)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            购票/详情
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function statusLabel(s: Status) {
  return { pending: "等待", running: "进行中", done: "完成", error: "出错" }[s];
}

function Dot({ status }: { status: Status }) {
  const cls =
    {
      pending: "bg-neutral-300",
      running: "bg-amber-400 animate-pulse",
      done: "bg-green-500",
      error: "bg-red-500",
    }[status] ?? "bg-neutral-300";
  return <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
}
