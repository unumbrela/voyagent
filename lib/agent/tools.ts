/**
 * Copilot「小行」的工具箱：schema（OpenAI/DeepSeek function-calling 定义）+ 执行器。
 * 全部复用项目既有能力，不重造：交通搜索、天气、候选、web 搜索、编辑(refine)、建行程(pipeline)。
 *
 * 工具执行时既返回「给模型的文本」（进 tool 消息驱动下一步推理），
 * 也可通过 ctx.emit 立刻把生成式 UI 卡片 / 改动 / 跳转事件推给前端。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchTrains, searchFlights } from "@/lib/transport";
import { fetchWeather } from "@/lib/weather-fetch";
import { normalizeCandidates } from "@/lib/candidates";
import { runWebSearchTool } from "@/lib/search";
import { researchXhs, isXhsUrl } from "@/lib/xhs/research";
import { runRefine } from "@/lib/agents/refine";
import { runPacking } from "@/lib/agents/packing";
import { createTrip } from "@/lib/trips";
import { diffItinerary } from "@/lib/diff";
import { wmoMeta } from "@/lib/weather";
import { summarizeBudget, KIND_META, formatCny } from "@/lib/budget";
import type {
  AgentContext,
  AgentName,
  TripContext,
} from "@/lib/agents/types";
import type { AgentEvent, AppState, ItinDay, Reference } from "./types";

export interface ToolCtx {
  supabase: SupabaseClient; // cookie 客户端（RLS 按 owner 隔离）
  userId: string;
  appState: AppState;
  emit: (e: AgentEvent) => void;
}

interface ToolDef {
  def: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
}

const S = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const obj = (
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

/** 从 DB 组装 refine 需要的 AgentContext（trip_context + 上游产物，均走 RLS） */
async function buildAgentContext(
  supabase: SupabaseClient,
  tripId: string,
): Promise<{ ctx: AgentContext; destination: string } | null> {
  const [{ data: c }, { data: outputs }] = await Promise.all([
    supabase.from("trip_context").select("*").eq("trip_id", tripId).single(),
    supabase
      .from("agent_outputs")
      .select("agent_name, payload, status")
      .eq("trip_id", tripId),
  ]);
  if (!c) return null;

  const constraints = (c.constraints ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const context: TripContext = {
    destination: c.destination,
    origin: str(constraints.origin),
    start_date: c.start_date,
    end_date: c.end_date,
    now: str(constraints.now),
    depart_time: str(constraints.depart_time),
    return_by_time: str(constraints.return_by_time),
    budget: c.budget,
    travel_style: c.travel_style,
    party_size: c.party_size ?? 1,
    constraints,
  };
  const upstream: Partial<Record<AgentName, unknown>> = {};
  for (const o of outputs ?? []) {
    if (o.status === "done" && o.payload)
      upstream[o.agent_name as AgentName] = o.payload;
  }
  return { ctx: { context, upstream }, destination: c.destination };
}

export const TOOLS: Record<string, ToolDef> = {
  // ── 搜真实车次 ──
  search_trains: {
    def: {
      type: "function",
      function: {
        name: "search_trains",
        description:
          "搜索两地之间真实的高铁/动车车次（含时刻与票价区间，带 12306 购票深链）。用于换乘、找更早/更晚的班次等。",
        parameters: obj(
          {
            from: { type: "string", description: "出发地（城市或车站），缺省用行程出发地" },
            to: { type: "string", description: "到达地，缺省用行程目的地" },
            date: { type: "string", description: "日期 YYYY-MM-DD，可空" },
          },
          [],
        ),
      },
    },
    run: async (args, ctx) => {
      const from = S(args.from) || ctx.appState.meta?.origin || "";
      const to = S(args.to) || ctx.appState.meta?.destination || "";
      const date = S(args.date) || ctx.appState.meta?.start_date || null;
      if (!from || !to) return "缺少出发地/到达地，无法搜车次。";
      ctx.emit({ type: "tool_call", name: "search_trains", label: `搜索 ${from}→${to} 车次` });
      const items = await searchTrains(from, to, date);
      ctx.emit({ type: "tool_result", name: "search_trains", card: { kind: "trains", from, to, date, items } });
      if (!items.length) return `未搜到 ${from}→${to} 的车次（可能未配置搜索或该线路无直达）。`;
      const top = items.slice(0, 6).map((t) => `${t.name} ${t.depart}→${t.arrive} ${t.duration} ${t.price_cny}`).join("；");
      return `找到 ${items.length} 趟车次，已在界面展示可点选卡片。示例：${top}`;
    },
  },

  // ── 搜真实航班 ──
  search_flights: {
    def: {
      type: "function",
      function: {
        name: "search_flights",
        description: "搜索两地之间真实航班（含时刻与票价区间，带携程/Google Flights 深链）。",
        parameters: obj(
          {
            from: { type: "string", description: "出发地，缺省用行程出发地" },
            to: { type: "string", description: "到达地，缺省用行程目的地" },
            date: { type: "string", description: "日期 YYYY-MM-DD，可空" },
          },
          [],
        ),
      },
    },
    run: async (args, ctx) => {
      const from = S(args.from) || ctx.appState.meta?.origin || "";
      const to = S(args.to) || ctx.appState.meta?.destination || "";
      const date = S(args.date) || ctx.appState.meta?.start_date || null;
      if (!from || !to) return "缺少出发地/到达地，无法搜航班。";
      ctx.emit({ type: "tool_call", name: "search_flights", label: `搜索 ${from}→${to} 航班` });
      const items = await searchFlights(from, to, date);
      ctx.emit({ type: "tool_result", name: "search_flights", card: { kind: "flights", from, to, date, items } });
      if (!items.length) return `未搜到 ${from}→${to} 的航班。`;
      const top = items.slice(0, 6).map((f) => `${f.name}(${f.airline}) ${f.depart}→${f.arrive} ${f.price_cny}`).join("；");
      return `找到 ${items.length} 个航班，已展示可点选卡片。示例：${top}`;
    },
  },

  // ── 天气 ──
  get_weather: {
    def: {
      type: "function",
      function: {
        name: "get_weather",
        description: "查询目的地按日期的每日天气（最高/最低温、降水概率）。仅未来约 16 天有预报。",
        parameters: obj(
          {
            dest: { type: "string", description: "目的地，缺省用行程目的地" },
            start: { type: "string", description: "起始日期 YYYY-MM-DD" },
            end: { type: "string", description: "结束日期 YYYY-MM-DD" },
          },
          [],
        ),
      },
    },
    run: async (args, ctx) => {
      const dest = S(args.dest) || ctx.appState.meta?.destination || "";
      const start = S(args.start) || ctx.appState.meta?.start_date || "";
      const end = S(args.end) || ctx.appState.meta?.end_date || start;
      if (!dest || !start) return "缺少目的地/日期，无法查天气。";
      ctx.emit({ type: "tool_call", name: "get_weather", label: `查询 ${dest} 天气` });
      const daily = await fetchWeather(dest, start, end);
      ctx.emit({ type: "tool_result", name: "get_weather", card: { kind: "weather", dest, daily } });
      const days = Object.entries(daily);
      if (!days.length) return `没有 ${dest} 在该日期的预报（可能超出 16 天预报范围）。`;
      const summary = days
        .map(([d, w]) => `${d} ${wmoMeta(w.code).label} ${w.tmin}~${w.tmax}° 降水${w.pop}%`)
        .join("；");
      return `天气：${summary}`;
    },
  },

  // ── 候选池 ──
  list_candidates: {
    def: {
      type: "function",
      function: {
        name: "list_candidates",
        description: "列出该行程各 agent 备选、但未被选进最终行程的真实候选（景点/餐厅/酒店/车次），供替换。",
        parameters: obj({}, []),
      },
    },
    run: async (_args, ctx) => {
      const tripId = ctx.appState.tripId;
      if (!tripId) return "当前不在某个行程里，没有候选可列。";
      const { data: rows } = await ctx.supabase
        .from("agent_outputs")
        .select("agent_name, payload, status")
        .eq("trip_id", tripId);
      const outputs: Partial<Record<AgentName, unknown>> = {};
      for (const r of rows ?? [])
        if (r.status === "done" && r.payload)
          outputs[r.agent_name as AgentName] = r.payload;
      const items = normalizeCandidates(outputs);
      ctx.emit({ type: "tool_result", name: "list_candidates", card: { kind: "candidates", items } });
      if (!items.length) return "暂无候选。";
      return `共 ${items.length} 个候选，已展示卡片（用户可加入某天）。`;
    },
  },

  // ── web 搜索（攻略/答疑）──
  web_search: {
    def: {
      type: "function",
      function: {
        name: "web_search",
        description: "联网搜索实时信息（攻略、营业状态、政策、交通等）用于答疑。返回若干标题+链接+摘要。",
        parameters: obj(
          { query: { type: "string", description: "搜索查询词，尽量具体" } },
          ["query"],
        ),
      },
    },
    run: async (args, ctx) => {
      const query = S(args.query);
      if (!query) return "缺少搜索词。";
      ctx.emit({ type: "tool_call", name: "web_search", label: `搜索「${query}」` });
      return await runWebSearchTool(JSON.stringify({ query }));
    },
  },

  // ── 小红书攻略提炼（目的地驱动，聚合多篇社区帖子）──
  research_xhs: {
    def: {
      type: "function",
      function: {
        name: "research_xhs",
        description:
          "聚合小红书等社区的多篇帖子，为某个目的地提炼结构化玩法/美食攻略（含最佳时段、建议天数、实用贴士与避坑）。" +
          "用户问「小红书上怎么玩 X / X 有什么好玩好吃的 / 网友都去哪」、或想参考社区玩法时调用；" +
          "目的地缺省用当前行程目的地。会把结果做成可一键加入行程的卡片。",
        parameters: obj(
          {
            destination: { type: "string", description: "目的地城市，缺省用当前行程目的地" },
            focus: { type: "string", description: "聚焦方向（可空），如 美食/citywalk/亲子/小众/夜生活" },
          },
          [],
        ),
      },
    },
    run: async (args, ctx) => {
      const destination =
        S(args.destination) || ctx.appState.meta?.destination || "";
      if (!destination)
        return "还不知道要看哪个城市的小红书攻略，先告诉我目的地吧。";
      const focus = S(args.focus);
      ctx.emit({
        type: "tool_call",
        name: "research_xhs",
        label: `翻小红书上的${destination}${focus ? `·${focus}` : ""}热门玩法…`,
      });
      const result = await researchXhs(destination, focus);
      if ("error" in result) return result.error;
      ctx.emit({
        type: "tool_result",
        name: "research_xhs",
        card: { kind: "xhs_guide", guide: result },
      });
      const xhsN = result.sources.filter((s) => isXhsUrl(s.url)).length;
      const srcNote = xhsN
        ? `参考了 ${result.sources.length} 篇网友攻略（含 ${xhsN} 篇小红书）`
        : `参考了 ${result.sources.length} 篇网友攻略（本次小红书原帖召回较少，已用其他网友攻略补充）`;
      return `已整理「${destination}」的玩法攻略：${result.spots.length} 个玩法、${result.eats.length} 处美食，${srcNote}，已在界面展示卡片（用户可一键加入行程）。`;
    },
  },

  // ── 编辑当前行程（复用 refine）──
  edit_itinerary: {
    def: {
      type: "function",
      function: {
        name: "edit_itinerary",
        description:
          "按自然语言指令修改【当前已打开的行程】（加/减/换/移动条目、调节奏等）。只在用户明确想改行程时调用。",
        parameters: obj(
          {
            instruction: { type: "string", description: "具体修改指令" },
            day: { type: "number", description: "只改某一天则填天号（1 起）；改整段则省略" },
          },
          ["instruction"],
        ),
      },
    },
    run: async (args, ctx) => {
      const tripId = ctx.appState.tripId;
      const current = ctx.appState.itinerary?.days ?? [];
      if (!tripId || !current.length)
        return "当前没有已打开的行程，无法修改。可以先创建或打开一个行程。";
      const instruction = S(args.instruction);
      if (!instruction) return "缺少修改指令。";
      const scope: "all" | { day: number } =
        typeof args.day === "number" ? { day: args.day } : "all";

      const built = await buildAgentContext(ctx.supabase, tripId);
      if (!built) return "读不到该行程的上下文。";

      ctx.emit({ type: "tool_call", name: "edit_itinerary", label: "调整行程中…" });
      const currentItinerary = {
        title: ctx.appState.itinerary?.title ?? "",
        days: current,
        references: [],
      };
      const result = (await runRefine(
        built.ctx,
        currentItinerary,
        instruction,
        scope,
      )) as { days?: ItinDay[]; references?: Reference[] };

      const revised = Array.isArray(result.days) ? result.days : [];
      if (!revised.length) return "修改结果为空，未改动。";

      // scope=day 只替换该天，其余保留当前（不丢未保存的编辑）
      let finalDays: ItinDay[];
      if (scope === "all") finalDays = revised;
      else {
        const one = revised.find((d) => d.day === scope.day);
        finalDays = one
          ? current.map((d) => (d.day === scope.day ? one : d))
          : current;
      }
      const refs = Array.isArray(result.references) ? result.references : undefined;

      const diff = diffItinerary(current, finalDays);
      const changedItems = diff.days.reduce(
        (n, d) => n + d.added.length + d.removed.length + d.changed.length,
        0,
      );
      // 用户开启「改动前先预览」时，一律走预览卡（禁用小改动直接生效）——RQ1 控制权变量
      const small =
        !ctx.appState.alwaysPreview && diff.changedCount <= 1 && changedItems <= 2;
      const summary = small
        ? `已调整（${changedItems} 处）`
        : `建议改动 ${diff.changedCount} 天`;

      if (small) {
        ctx.emit({ type: "action", kind: "apply_patch", days: finalDays, references: refs, summary });
        return `${summary}，已直接应用（用户可撤销）。`;
      }
      ctx.emit({ type: "proposal", days: finalDays, references: refs, diff, summary });
      return `${summary}，已给出预览卡，等用户确认应用。`;
    },
  },

  // ── 预算汇总（读当前行程快照 + trip_context 预算）──
  get_budget_summary: {
    def: {
      type: "function",
      function: {
        name: "get_budget_summary",
        description:
          "汇总【当前已打开行程】的花费估算：总额、是否超预算、人均、按类别（活动/餐饮/住宿/交通）细分。用户问预算/花费/超支时调用。",
        parameters: obj({}, []),
      },
    },
    run: async (_args, ctx) => {
      const tripId = ctx.appState.tripId;
      const days = ctx.appState.itinerary?.days ?? [];
      if (!tripId || !days.length) return "当前没有已打开的行程，无法汇总预算。";
      ctx.emit({ type: "tool_call", name: "get_budget_summary", label: "汇总预算中…" });
      const { data: c } = await ctx.supabase
        .from("trip_context")
        .select("budget, party_size")
        .eq("trip_id", tripId)
        .single();
      const s = summarizeBudget(
        days,
        typeof c?.budget === "number" ? c.budget : null,
        typeof c?.party_size === "number" ? c.party_size : null,
      );
      const byKind = (Object.keys(KIND_META) as (keyof typeof s.byKind)[])
        .filter((k) => s.byKind[k] > 0)
        .map((k) => `${KIND_META[k].label} ${formatCny(s.byKind[k])}`)
        .join("、");
      const budgetLine =
        s.budget != null
          ? s.overBudget
            ? `预算 ${formatCny(s.budget)}，超支 ${formatCny(Math.abs(s.remaining ?? 0))}`
            : `预算 ${formatCny(s.budget)}，还剩 ${formatCny(s.remaining ?? 0)}`
          : "未设预算";
      return `估算总额 ${formatCny(s.total)}（人均 ${formatCny(s.perPerson)}）；${budgetLine}。按类别：${byKind || "无"}。按天：${s.byDay.map((v, i) => `D${i + 1} ${formatCny(v)}`).join("、")}。`;
    },
  },

  // ── 生成打包清单（复用 packing agent，写回行程）──
  generate_packing: {
    def: {
      type: "function",
      function: {
        name: "generate_packing",
        description:
          "为【当前已打开的行程】生成打包清单（结合目的地、季节、天气、活动类型），并保存到行程的打包清单面板。已有清单则直接汇总现状。",
        parameters: obj({}, []),
      },
    },
    run: async (_args, ctx) => {
      const tripId = ctx.appState.tripId;
      const days = ctx.appState.itinerary?.days ?? [];
      if (!tripId || !days.length) return "当前没有已打开的行程，无法生成打包清单。";

      const { data: itin } = await ctx.supabase
        .from("itineraries")
        .select("packing")
        .eq("trip_id", tripId)
        .maybeSingle();
      const existing = (itin?.packing ?? null) as
        | { label: string; checked: boolean }[]
        | null;
      if (Array.isArray(existing) && existing.length) {
        const done = existing.filter((it) => it.checked).length;
        return `该行程已有打包清单（${existing.length} 项，已勾选 ${done} 项），在行程页「打包清单」面板可查看勾选。`;
      }

      ctx.emit({ type: "tool_call", name: "generate_packing", label: "生成打包清单中…" });
      const built = await buildAgentContext(ctx.supabase, tripId);
      if (!built) return "读不到该行程的上下文。";

      // 尽力带上天气摘要（拿不到就不带）
      let weatherHint: string | undefined;
      try {
        const m = ctx.appState.meta;
        if (m?.destination && m.start_date && m.end_date) {
          const daily = await fetchWeather(m.destination, m.start_date, m.end_date);
          const vals = Object.values(daily);
          if (vals.length) {
            const tmax = Math.max(...vals.map((v) => v.tmax));
            const tmin = Math.min(...vals.map((v) => v.tmin));
            const rainy = vals.filter((v) => v.pop >= 40).length;
            weatherHint = `气温约 ${tmin}~${tmax}°C${rainy ? `，其中 ${rainy} 天可能有雨` : ""}`;
          }
        }
      } catch {
        /* 天气是增强信息 */
      }

      const generated = await runPacking(built.ctx, days, weatherHint);
      const packing = (generated.items ?? [])
        .filter((it) => it.label?.trim())
        .map((it, i) => ({
          id: `g${i}`,
          label: it.label.trim(),
          group: it.group || "其他",
          checked: false,
        }));
      await ctx.supabase
        .from("itineraries")
        .update({ packing })
        .eq("trip_id", tripId);
      const preview = packing.slice(0, 8).map((p) => p.label).join("、");
      return `已生成 ${packing.length} 项打包清单并保存（如：${preview}…），在行程页「打包清单」面板可勾选管理。`;
    },
  },

  // ── 从零创建行程（触发 8-agent 流水线）──
  create_trip: {
    def: {
      type: "function",
      function: {
        name: "create_trip",
        description:
          "为用户创建一个全新行程并开始智能规划。仅当已收集到【目的地】和【出发/返回日期】后再调用；缺信息应先在对话里追问。",
        parameters: obj(
          {
            destination: { type: "string", description: "目的地城市" },
            start_date: { type: "string", description: "出发日期 YYYY-MM-DD" },
            end_date: { type: "string", description: "返回日期 YYYY-MM-DD" },
            origin: { type: "string", description: "出发地城市，可空" },
            budget: { type: "number", description: "预算（人民币），可空" },
            travel_style: { type: "string", description: "旅行风格，如 美食/文化/亲子/休闲，可空" },
            party_size: { type: "number", description: "人数，缺省 1" },
          },
          ["destination", "start_date", "end_date"],
        ),
      },
    },
    run: async (args, ctx) => {
      const destination = S(args.destination);
      const start_date = S(args.start_date);
      const end_date = S(args.end_date);
      if (!destination) return "还需要知道目的地。";
      if (!start_date || !end_date) return "还需要出发和返回日期才能开始规划。";
      try {
        const tripId = await createTrip(ctx.supabase, ctx.userId, {
          destination,
          start_date,
          end_date,
          origin: S(args.origin) || null,
          budget: typeof args.budget === "number" ? args.budget : null,
          travel_style: S(args.travel_style) || null,
          party_size: typeof args.party_size === "number" ? args.party_size : 1,
          now: ctx.appState.now,
        });
        ctx.emit({ type: "action", kind: "navigate", tripId });
        return `已创建「${destination}」行程并开始规划，正在跳转到该行程页面查看进度。`;
      } catch (e) {
        return `创建失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
};

export const TOOL_DEFS = Object.values(TOOLS).map((t) => t.def);
