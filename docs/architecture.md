# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |
| Module checks | `specs/module-N/`, `scripts/check.mjs` | Each module's spec, instructions, rubric and acceptance tests; `npm run check` runs them |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`, except where a module has
   moved it to a database: Module 2 part 2 moves stock to a Supabase
   `inventory` table, read through `lib/copper/inventory.ts`. Facts that don't
   change daily (prices, colors) stay in the files.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 2: Ask Copper, the shopping chatbot

**Summary:** A floating chat panel on the landing page that answers questions
about products, colours, prices, totals and stock. The model doesn't guess:
it picks from four read-only tools, and the panel shows every step it took.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/page.tsx` | Mounts `<AskCopper aiConfigured={isAiConfigured()} />`; no new page or route. The header gains an **Ask Copper** link to `#ask` |
| Components | `components/copper/ask-copper.tsx`, `components/copper/tool-call-card.tsx` | The launcher, the side sheet with its **Use tools** switch, the stations (tool menu, thinking, tool calls, reply) and the open tool card |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper({ messages, useTools })` returns a live `Progress` at once and streams the model's steps into it in the background |
| Tools | `lib/copper/assistant/tools.ts` | `get_products`, `get_prices`, `calculate_cost`, `check_availability`, with zod contracts. Prices come from the catalog; stock from `readInventory()` on every call |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`, Copper's system prompt |
| Data | `lib/copper/data/inventory.json` (part 1), Supabase `inventory` table (part 2) | Stock per product colour, read through `lib/copper/inventory.ts` |
| AI calls | `callStream({ module: 2, feature: "ask-copper" })` | The default Gemini model with thought summaries on, up to 5 steps per question. A typical question with one tool call is roughly 2,000 input and 200 output tokens, a fraction of a cent |

**Data flow:** shopper types a question → the panel calls the `askCopper`
Server Action with this chat's history → `callStream` sends the conversation
(plus instructions and tools when **Use tools** is on) to Gemini → when the
model asks for a tool, the app runs it (catalog or stock list) and hands the
result back → each stream part updates a `Progress` snapshot, sent to the
panel through `createLive` → the panel redraws the stations and the reply.

**Decisions and trade-offs:**

- Tools on and tools off are two separate chats with separate histories, so
  the tools-off model can't copy an answer the tools worked out.
- With tools off, no instructions are sent either: telling the model to
  "always use your tools" and then giving it none makes it return nothing.
- Every update carries a fresh copy of everything so far, so the panel can
  simply redraw and a missed update loses nothing.
- Thought summaries are rendered with a tiny bold/code markdown renderer
  rather than the full Streamdown stack, to keep the panel light.

**Risks and open questions:** the model can still misread a tool result or a
question, so the panel shows the tool's real input and output beside the
reply. Stock answers are only as fresh as the inventory source (part 2 moves
it to Supabase). The tools only read, so a wrong call can't change anything.
