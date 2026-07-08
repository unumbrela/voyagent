<div align="center">

**English** | [简体中文](README.zh-CN.md)

</div>

<h1 align="center">voyagent 漫游</h1>

<p align="center">A multi-agent travel planner that only puts <b>verifiable</b> things in your itinerary.</p>

<p align="center">
  <a href="https://voyagent-five.vercel.app"><b>Live demo → voyagent-five.vercel.app</b></a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e?logo=supabase&logoColor=white" />
  <img alt="DeepSeek" src="https://img.shields.io/badge/LLM-DeepSeek-4d6bfe" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green" />
</p>

![voyagent landing page](docs/screenshots/landing-hero.jpg)

## What it does

Tell it where you start, where you're going, your dates, budget and travel style. Eight server-side agents split the work, search the web for real attractions, restaurants, hotels, trains and flights, and assemble a complete itinerary — from the outbound train to the ride home — in about two minutes.

The reason this project exists: ask a plain LLM for an itinerary and it will happily invent hotels that don't exist and quote trains that stopped running years ago. voyagent treats **truthfulness as a hard constraint**, enforced by code rather than by prompt:

- Every itinerary item carries a confidence tag — **verified / checkable / unverified** — and verified items link to the web page they came from.
- Booking links (12306, Trip.com/Ctrip, Booking.com) are assembled deterministically from known URL patterns. The model never generates a URL.
- If a fact can't be confirmed online, it's labeled "check live availability" instead of being made up. Departures that have already left today are filtered out by code.

> **Note:** the product UI is currently Chinese-only — the target scenario is travel from/within China (12306 trains, AMap, Ctrip). Email sign-up on the live demo works out of the box.

## A tour in four screenshots

### An itinerary you can actually edit

Drag to reorder, edit any field inline, delete or add items. Transport items embed a real train/flight search — pick a result and it replaces the item in place. Saving is idempotent: reopening a trip never re-runs the pipeline or overwrites your edits. Costs are tracked per item, planned vs. actual.

![Trip detail page: editable timeline with verified-source tags on the left, live map on the right](docs/screenshots/trip-detail.jpg)

### Every trip on a live map

The itinerary and the map are two views of the same thing: numbered, category-colored pins match the cards one-to-one, hover links both ways, and scrolling the timeline focuses the map. Day chips switch the visible route. Tiles come from AMap inside China and CARTO abroad, chosen automatically.

![Three-day showcase trip with day-by-day routes on a real map](docs/screenshots/landing-showcase.jpg)

### Destination demos with real data

Six curated demo trips (Suzhou, Kyoto, Yading, Iceland, Santorini, Morocco) built on real train numbers, flights and prices — one click saves any of them as your own editable trip.

![Kyoto demo trip: real flights, per-day routes on a CARTO basemap](docs/screenshots/demo-kyoto.jpg)

### A 3D travel copilot

"Xiaoxing" is a real-time three.js avatar with cloud TTS and lip sync. Talk to it by voice or text: plan a new trip, reshuffle a day, search tickets, check the weather. Any change it wants to make is shown as a proposal card first — nothing touches your itinerary until you confirm.

![3D digital human copilot docked over the trip page](docs/screenshots/copilot.jpg)

## How the pipeline works

Orchestrator–worker, self-hosted in `lib/pipeline.ts` — no managed agent platform. Eight agents run in five waves: parallel inside a wave, sequential between waves, because travel planning has a dependency chain (decide what to do → then where to stay → then how to route each day).

| Wave | Agents | Job |
| --- | --- | --- |
| 1 | enrichment · activities 🔍 · food 🔍 · transport 🔍 | destination research; real attractions, restaurants, trains & flights |
| 2 | accommodation 🔍 | pick hotels near where the activities cluster |
| 3 | scheduling | build day-by-day routes anchored at the hotel |
| 4 | hub_planner | assemble the final itinerary |
| 5 | validator | pre-trip QA; a failed check triggers one automatic revision round |

🔍 = has a `web_search` tool (Tavily backend, pluggable).

Implementation notes:

- **~2 minutes end to end.** Progress streams to a waiting page over SSE; failed agents retry, and an interrupted run resumes from its checkpoint.
- **Structured output.** Each agent gets its JSON Schema in the prompt and DeepSeek answers in `json_object` mode; the tool-calling phase and the JSON-finalizing phase are separated (`lib/deepseek.ts`).
- **Single source of truth.** Agents read only `trip_context` (Supabase); outputs accumulate in `agent_outputs` for downstream agents — which is also what makes resume-from-checkpoint work.

## Engineering extras

| Capability | Where | What it answers | Run |
| --- | --- | --- | --- |
| Eval loop | `eval/` | "Did this change make trips worse?" — offline fixture assertions + online LLM-as-judge, generation and scoring decoupled | `pnpm eval` / `pnpm eval:live` |
| Observability | `lib/otel/` | span tracing with per-agent latency / tokens / cost, visualized on the trip page | `pnpm trace:demo` |
| Guardrails | `lib/guardrails/`, `guardrail/` | three layers against prompt injection: sanitize user input, screen retrieved pages, whitelist booking-link domains — with a red-team suite | `pnpm redteam` |
| Memory | `lib/memory/` | extract long-term user preferences, store as vectors, recall across trips | `pnpm memory:demo` |

Retrieved web pages go straight into model context — that's the main indirect-prompt-injection surface, and what the guardrails are built for.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4, motion |
| Data / auth | Supabase (Postgres + Row Level Security + Auth: email/password, Google OAuth) |
| Model | DeepSeek `deepseek-chat` (OpenAI-compatible API + function calling), behind a provider abstraction |
| Retrieval | hand-rolled tool-calling loop + Tavily search backend (pluggable) |
| Maps | Leaflet + AMap tiles (China) / CARTO (abroad), AMap PlaceSearch geocoding |
| Avatar | three.js (glTF) + cloud TTS + wawa-lipsync |

## Getting started

### Prerequisites

- Node.js ≥ 20 (developed on 22)
- [pnpm](https://pnpm.io/) (this repo uses pnpm — don't use npm)
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [DeepSeek](https://platform.deepseek.com) API key

### Steps

```bash
# 1. Clone and install
git clone https://github.com/unumbrela/voyagent.git
cd voyagent
pnpm install

# 2. Configure environment
cp .env.local.example .env.local
#    Fill in the 4 required vars: DEEPSEEK_API_KEY + the 3 Supabase keys

# 3. Initialize the database
#    Supabase dashboard → SQL Editor: run the files in supabase/migrations/
#    in filename order (0001_init → 0007_memory_embed_model)

# 4. Start the dev server
pnpm dev
#    Open http://localhost:3000 and sign up with any email
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | ✅ | from the DeepSeek platform; shared by all agents |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | same page; server-side only |
| `TAVILY_API_KEY` | optional | web search; without it, search-dependent agents answer from model knowledge |
| `ZENMUX_API_KEY` + TTS vars | optional | avatar voice; falls back to browser Web Speech |
| `EMBED_API_BASE / KEY / MODEL` | optional | semantic vectors for memory; falls back to a built-in hash embedding |
| `NEXT_PUBLIC_AMAP_KEY / SECURITY` | optional | 3D demo map on the landing page; degrades to Leaflet 2D |

Full list with sign-up links in [.env.local.example](.env.local.example).

### Sign-in notes

Email/password works out of the box. For Google sign-in: enable the Google provider in Supabase and make sure *Authentication → URL Configuration* matches the exact origin you browse from — `localhost`, `127.0.0.1` and a LAN IP are different origins, and the PKCE code verifier lives in a cookie scoped to the origin that started the flow.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | dev server |
| `pnpm build` && `pnpm start` | production build & serve |
| `pnpm lint` | ESLint |
| `pnpm eval` | offline eval (fixture assertions, no tokens spent) |
| `pnpm eval:live` | live eval (real calls + LLM judge) |
| `pnpm redteam` | guardrail red-team suite |
| `pnpm trace:demo` | generate a sample observability trace |
| `pnpm memory:demo` | memory write/recall demo |
| `pnpm analyze:study` | aggregate HCI survey + interaction logs |

### Deployment

Deploys directly to Vercel: import the repo and set the same environment variables in the project settings. The database stays on Supabase cloud — nothing else to change.

## HCI research support

The project doubles as the platform for a human–computer interaction user study:

- **Interaction logging**: `lib/log.ts` → `POST /api/log` → `interaction_logs`, covering trip creation, plan completion, proposal apply/dismiss, undo, drag, edit and save events.
- **Built-in surveys**: `/study` serves SUS (usability), NASA-TLX (task load) and a trust scale; answers land in the same table, and `pnpm analyze:study` produces the summary.

## Project layout

```
app/
  api/            # route handlers: trips (plan/edit/share/ics), trains, flights,
                  #   weather, geocode, memories, tts, log, agent …
  trips/[id]/     # trip detail: editable timeline + live map + observability panel
  copilot/        # 3D copilot (CopilotDock + DigitalHuman3D)
  study/          # HCI surveys (SUS / NASA-TLX / trust)
  share/[token]/  # public read-only share page
  demo/[slug]/    # destination demo trips
lib/
  pipeline.ts     # orchestrator: waves, retries, checkpoint resume
  agents/         # 8 agents + schemas / prompts / runAgent (provider abstraction)
  deepseek.ts     # DeepSeek client + function-calling tool loop
  search.ts       # Tavily search backend (pluggable)
  hotels.ts stations.ts airports.ts  # deterministic booking links (Booking / 12306 / Ctrip)
  guardrails/     # prompt-injection defenses
  otel/           # tracing & cost aggregation
  memory/         # long-term memory + vector recall
eval/             # eval system (dataset / assertions / judge / report)
guardrail/        # red-team test set
supabase/migrations/   # 0001–0007 schema SQL (run in order)
scripts/          # demos & checks (trace-demo / memory-demo / ui-shots / readme-shots …)
```

## License

[MIT](LICENSE) © Zihao Guo
