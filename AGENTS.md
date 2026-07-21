# Health Tracker — AI Agent Context

> This file is read automatically by AI coding assistants (Claude Code, Copilot, etc.)
> at the start of every session. Keep it current. It is the single most important context file.

---

## What This Is

A multi-user health tracking app for logging daily food intake (calories, protein), body weight,
and body fat %, with trend charts, barcode/description food lookup, and reusable saved meals.
Built for individual users who want to track these with minimal daily effort.

## Developer Context

- **Jeff Berry (solo developer)**: 20 years in C#, SQL Server, ASP.NET Web Forms. No prior
  experience in React, Next.js, or TypeScript. Bridge explanations to familiar Web Forms/C#
  patterns where possible, e.g.:
  - React Server Components ≈ classic Web Forms/ASP.NET rendering fully on the server before the
    page ships to the browser; Client Components are the parts that need actual postback-free
    interactivity in the browser (closer to what you'd have reached for JS/jQuery for).
  - Server Actions (`'use server'` functions called directly from a form) ≈ a Web Forms
    code-behind event handler (`Button1_Click`), but explicitly invoked and type-checked
    end-to-end, with no ViewState or page lifecycle underneath it.
  - Supabase ≈ SQL Server, but with a client library instead of ADO.NET/Entity Framework, and Row
    Level Security policies doing the authorization checks you'd otherwise hand-write in a
    data-access layer.
  - TypeScript types ≈ C# static typing, but structural (an object matching the right shape is
    the right type) rather than nominal (an object doesn't need to declare which type it "is").

---

## Tech Stack
- **Framework**: React / Next.js 14+ (App Router)
- **Language**: TypeScript — explicit types, no `any`
- **Styling**: Tailwind CSS
- **Database**: Supabase (Postgres + Auth + Row Level Security)
- **Charts**: Recharts
- **Hosting**: Vercel

## Repository Structure

Not yet scaffolded (greenfield — see `docs/architecture/food-weight-tracker.md` §3.1 for the full,
current-to-the-design tree). Planned shape:

```
src/
  app/
    (auth)/         ← login/signup pages
    (app)/          ← authenticated routes; layout.tsx is the single auth gate
    api/lookup/     ← server-side proxy Route Handlers for external food-lookup APIs
    auth/callback/  ← Supabase auth code exchange
  components/       ← client components, grouped by feature (food/, meals/, metrics/, trends/, ui/)
  lib/
    domain/         ← pure, framework-free business logic (primary unit-test target)
    actions/        ← 'use server' Server Actions (all mutations)
    lookup/         ← server-only external food-database adapters
    supabase/       ← Supabase client factories (server + browser)
    types.ts        ← shared row/DTO types
supabase/
  migrations/       ← SQL migrations (schema, RLS policies, triggers, views)
  seed.sql          ← test/dev fixture data
```

## Running the Project
```bash
npm run dev        # Start dev server
npm run build       # Production build
npm run lint         # Lint
npm test              # Unit tests
npm run test:e2e       # Acceptance/integration tests (per docs/architecture/*/§6)
```
These scripts don't exist yet in this greenfield repo — the `developer` subagent adds them when
scaffolding the Next.js app, and `.github/workflows/ci.yml` already expects all of them to exist.

---

## AI Agent Workflow

This project uses three specialized roles — architect, developer, qa-reviewer — with the
canonical, tool-agnostic definition of each in `agent-roles/`. Whatever AI coding assistant
you're using, one of these applies:

| Tool | Main context file | Subagent adapter |
|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file) | `.claude/agents/` (native) |
| Gemini CLI | `GEMINI.md` (imports this file) | `.gemini/agents/` (native) |
| OpenAI Codex CLI | `AGENTS.md` (read natively) | `docs/codex-agents-example.toml` — copy to `~/.codex/agents/` (user-level only, doesn't auto-load from the repo) |
| Copilot, Windsurf, Amp, Devin, Aider, Zed, Jules, VS Code, JetBrains Junie, etc. | `AGENTS.md` (read natively) | No native subagent adapter provided — paste the relevant `agent-roles/*.md` file as instructions when you want that role |

**Cursor is not currently supported.** Its native subagent mechanism couldn't be verified (Cursor
loads reusable prompts as `/`-commands from `.cursor/commands/`, not from a `.cursor/agents/`
folder), so no Cursor adapter ships with this template. Cursor still reads `AGENTS.md` for project
context, so you can use it by pasting the relevant `agent-roles/*.md` file as instructions — the
same fallback as any tool in the last row above.

The three roles:

- **architect** — designs features and writes a design doc in `docs/architecture/` (start from
  `docs/architecture/_template.md`) before any code is written; also owns `.github/workflows/ci.yml`.
  Cannot write application code.
- **developer** — implements against the architect's design doc; writes unit tests alongside code.
  Cannot mark its own work as fully verified.
- **qa-reviewer** — writes independent acceptance/integration tests from the spec (not from the
  implementation) and reviews code adversarially. Cannot edit application code. Gates production.
  If a change skipped the design doc as "trivial" but turns out to have real design surface,
  qa-reviewer kicks it back through the architect rather than reviewing it as-is.

**When the full flow applies**: use architect → developer → qa-reviewer for feature-sized work —
anything with real design surface (new modules, data-model changes, new API routes, anything
touching multiple parts of the system). For trivial changes with an obvious approach — small
bugfixes, copy tweaks, config edits, dependency bumps — skip the architect and go straight to the
developer; no design doc required. When in doubt, it's a feature. qa-reviewer still gates anything
headed for production.

**Workflow for a feature**: architect produces/updates the design doc → developer implements
against it → qa-reviewer writes independent tests and reviews → Jeff approves. Jeff is the
actual gate on production, not any agent.

If you add or change a tool-specific adapter, edit the matching `agent-roles/*.md` file too —
that's the source of truth the adapters are meant to stay in sync with.

## How to Start a Coding Session

Your AI tool's native context file (`CLAUDE.md`, `GEMINI.md`, or `AGENTS.md` directly) auto-loads
this file plus `ai-context/PROGRESS.md` and `ai-context/DECISIONS.md` every session — just state
your task, no need to ask for these to be read.

**For a feature** (per "When the full flow applies" above): invoke the `architect` subagent first
if no design doc exists yet for it in `docs/architecture/`. **For a trivial change**: go straight
to the `developer` — no design doc needed.

**At the end of every session:**
- Update `ai-context/PROGRESS.md` — move completed items to done, update what's in progress
- Add any new decisions to `ai-context/DECISIONS.md` with the reasoning

**The AI has no memory between sessions.** PROGRESS.md is the handoff.

---

## Conventions
- All business logic lives in `lib/domain/` as pure, framework-free functions — no Next.js/React/
  Supabase imports in there. This is the primary unit-test target; keep it that way.
- Server components by default; client components only where interactivity requires it (forms,
  charts, camera/barcode scanning, optimistic UI).
- Mutations are Next.js Server Actions (`lib/actions/*`), not hand-rolled REST endpoints. Route
  Handlers are reserved for the two cases that genuinely need them: the Supabase auth callback,
  and the read-only external food-lookup proxy (`app/api/lookup/*`) — see Absolute Rules.
- TypeScript throughout, explicit types, no `any` (mirrors the discipline of C#'s static typing,
  which Jeff already has habits for).
- Every new table gets RLS policies in the same migration that creates it — never a follow-up.

## Absolute Rules
- Row Level Security must be enabled on every table, with `user_id = auth.uid()` on every
  select/insert/update/delete policy. No table ships without it.
- `user_id` is always taken from the authenticated server-side session — never accepted as
  client input on any action or route.
- The Supabase **service-role key** is never shipped to the browser and never used outside
  trusted server-only contexts (CI/test seeding). Everything user-facing goes through the
  RLS-scoped anon client.
- No user data is sent to a third party beyond what a feature's design doc explicitly calls for
  (e.g. barcode/search query text sent to Open Food Facts/USDA — never account identity, email,
  or other tracking data alongside it).

## What Not To Do
- Don't call third-party APIs (food lookup providers, etc.) directly from client components —
  always go through a server-side proxy Route Handler, so API keys stay server-only.
- Don't derive "today" or day boundaries from the server's clock or a naive UTC-truncation of a
  timestamp — local-day grouping depends on the per-entry captured timezone (see
  `ai-context/DECISIONS.md`, "Food-entry timestamps stored in UTC with per-entry timezone
  capture"). Getting this wrong silently mis-buckets entries near midnight.
- Don't denormalize computed values (like daily totals) into stored columns — sum on read from
  the source rows/view instead, so there's one source of truth.
- Don't skip the architect step for feature-sized work (new tables, new routes, anything with
  real design surface) just because this is a solo project — the design-doc-first flow is what
  keeps a fast-moving AI-assisted codebase from drifting into an undocumented mess. Trivial
  changes (copy tweaks, config edits, dependency bumps) can skip straight to `developer`.
