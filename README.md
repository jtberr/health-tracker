# Project Starter Template

A reusable AI-assisted development starter kit: a project-context layer that keeps AI coding
assistants oriented across sessions, combined with three specialized subagent roles that enforce
a design → implement → review workflow. Deliberately **not tied to one AI vendor** — it works
with Claude Code, Gemini CLI, OpenAI Codex CLI, GitHub Copilot, Windsurf, and any other
AI coding assistant that reads markdown files. (Cursor is not currently supported — see the note
in `AGENTS.md`.)

**New to this template?** See [`GETTING-STARTED.md`](./GETTING-STARTED.md) for a full walkthrough
from a raw idea through design, implementation, review, and shipping — including exactly when
and how to invoke each subagent.

## What's In This Template

```
AGENTS.md                          ← The cross-tool standard context file — read natively by Codex CLI,
                                      Copilot, Windsurf, and most other AI coding tools
CLAUDE.md                          ← Claude Code adapter: imports AGENTS.md + ai-context files
GEMINI.md                          ← Gemini CLI adapter: imports AGENTS.md + ai-context files
ai-context/
  DECISIONS.md                     ← Every significant decision made and why
  PROGRESS.md                      ← Current status, what's done, what's next
agent-roles/
  architect.md                     ← Canonical, tool-agnostic role definition
  developer.md                     ← Canonical, tool-agnostic role definition
  qa-reviewer.md                   ← Canonical, tool-agnostic role definition
docs/architecture/
  _template.md                     ← Per-feature design doc template
docs/
  codex-agents-example.toml        ← Starting point for OpenAI Codex CLI's user-level custom agents
.github/workflows/
  ci.yml                           ← CI pipeline skeleton: type check → lint → unit tests → build → e2e → merge gate
.claude/agents/                    ← Claude Code native subagent adapters (architect, developer, qa-reviewer)
.gemini/agents/                    ← Gemini CLI native subagent adapters (architect, developer, qa-reviewer)
```

Two layers, working together, each built to not lock you into one AI tool:

1. **Project context** (`AGENTS.md` + a thin adapter per tool that doesn't yet read it natively,
   plus `ai-context/`) — gives any AI assistant the project's tech stack, conventions, decision
   history, and current status at the start of every session, since the AI has no memory between
   sessions otherwise. `AGENTS.md` is the actual content; `CLAUDE.md` and `GEMINI.md` just import
   it for the two tools that don't read `AGENTS.md` directly.
2. **Subagent roles** (`agent-roles/` as the canonical definition, with native adapters per tool
   in `.claude/agents/` and `.gemini/agents/`) — splits AI-assisted development
   into three separate roles with different tool access, so no single agent both writes the code
   and grades its own homework. If your tool doesn't have native subagent support, paste the
   relevant `agent-roles/*.md` file in as instructions when you want that role.

## How to Use This Template

### Starting a new project
1. Use the **"Use this template"** button on GitHub (or copy this folder's contents) into your new repo's root
2. Fill in `AGENTS.md` — replace the bracketed placeholder text with your project's actual stack and conventions
3. Start coding — whichever tool you use auto-discovers its native subagent adapter
   (`.claude/agents/` or `.gemini/agents/`), no setup needed. On Codex CLI,
   copy `docs/codex-agents-example.toml` into `~/.codex/agents/` once, since Codex's custom
   agents are user-level rather than repo-level.

### The workflow

The full three-role flow is for **feature-sized work** — anything with real design surface (new
modules, data-model changes, new API routes, changes spanning multiple parts of the system). For
**trivial changes with an obvious approach** — small bugfixes, copy tweaks, config edits,
dependency bumps — skip the architect and hand the task straight to the developer; no design doc
required. When in doubt, treat it as a feature.

For a feature:

1. The **architect** subagent writes a design doc in `docs/architecture/` (copy `_template.md`
   as a starting point) — module boundaries, data model, API surface, alternatives considered,
   testing strategy. It cannot write application code.
2. The **developer** subagent implements against that design doc and writes unit tests alongside
   the code. For a feature it reads the design doc first and won't proceed without one; for a
   trivial change it just implements.
3. The **qa-reviewer** subagent writes independent acceptance/integration tests from the spec
   itself — not from what the code happens to do — and reviews adversarially. It's read-only on
   application code; if something's broken, it reports rather than fixes. If a change skipped the
   design doc as "trivial" but review reveals real design surface, qa-reviewer flags it and sends
   it back through the architect rather than reviewing it as if the classification held up.
4. You approve. You define "done" and are the actual gate on production, not any agent.

`AGENTS.md` documents this workflow under "AI Agent Workflow" so any session — human or AI —
starting from that file knows it exists, even without already knowing to check `.claude/agents/`.

### Filling in the files (recommended order)
1. **AGENTS.md** — describe the project, tech stack, and your team first; this orients every AI session
2. **DECISIONS.md** — record your tech stack choices and the reasoning before you forget
3. **PROGRESS.md** — fill in as development begins; update every session
4. **.github/workflows/ci.yml** — adjust the stack-specific steps if you're not on Next.js/TypeScript/Supabase
5. **docs/architecture/_template.md** — copy per feature as the architect subagent produces design docs

### Ending an AI coding session
- Update `ai-context/PROGRESS.md` — move completed items, update what's in progress
- Add any new decisions to `ai-context/DECISIONS.md` with reasoning

**The AI has no memory between sessions. PROGRESS.md is the handoff.**

### For a monorepo (multiple apps in one repo)

Going into a monorepo — one repo, several independently-deployable apps in their own subfolders —
scales two things beyond a single app; the other two need nothing.

- **Context layer** (per app): one full copy of `AGENTS.md` / `CLAUDE.md` / `ai-context/` at the
  repo root for site-wide context, plus another copy inside each app's subfolder for that app's
  own stack and progress. Point the root `CLAUDE.md` at both levels so a session opened at the
  root gets everything with no manual file requests:

  ```
  @AGENTS.md
  @ai-context/DECISIONS.md
  @ai-context/PROGRESS.md
  @<app-folder>/AGENTS.md
  @<app-folder>/ai-context/DECISIONS.md
  @<app-folder>/ai-context/PROGRESS.md
  ```

  Give each app's own `CLAUDE.md` the matching single-level list as a fallback for sessions opened
  inside that app folder.

- **CI** (per app): copy `.github/workflows/ci.yml` once per app (e.g. `ci-tools.yml`,
  `ci-www.yml`), each with a `paths:` filter and `working-directory` set to that app's folder —
  so each app gets its own gate and only builds when it changes. The fields to uncomment are noted
  at the top of `ci.yml`.

- **Design docs and subagents** (no change): `docs/architecture/` is scoped root vs. app-level and
  the `architect`/`developer` roles already handle both — no setup needed. `agent-roles/` and the
  `.claude` / `.gemini` adapters stay as one copy at the repo root; those tools
  discover them by walking up to the root, so the same roles cover every app automatically. (Codex
  agents are user-level, so `docs/codex-agents-example.toml` is unaffected either way.)

## Why This Works

AI coding assistants are powerful but stateless — they start every session cold, and a single
agent that designs, implements, and reviews its own work has no independent check on its own
mistakes. This template's two layers address both problems:

- Project context gives the AI what it needs to make consistent decisions aligned with your
  architecture, understand your team's experience level, and know where you left off.
- Separating architect / developer / qa-reviewer means the person testing the code isn't the
  person who wrote it, and the person reviewing against spec isn't grading their own homework —
  the same reason human teams don't let one engineer self-approve their own PR to production.

The more accurately the context files reflect the current state of the project, the more useful
the AI becomes; the more consistently the subagent workflow is followed, the fewer bugs slip
through because "the tests I wrote pass" quietly stood in for "this matches the spec."

## Tips

- **Keep PROGRESS.md current** — it's the most important file for day-to-day work
- **Record decisions immediately** — the reasoning is easy to forget; write it down when it's fresh
- **Be honest about team experience** in AGENTS.md — the AI tailors its explanations accordingly
- **Don't skip the design doc for features** — the developer subagent will refuse to proceed on feature-sized work without one, by design (trivial fixes go straight to the developer, no doc needed)
- **Let qa-reviewer stay independent** — it tests against the spec, not the code, so it catches what the developer's own tests miss
- **You're still the gate** — no subagent marks anything production-ready; that approval is yours alone
