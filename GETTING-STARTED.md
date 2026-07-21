# Getting Started: From Idea to Shipped Feature

A step-by-step walkthrough of using this template on a brand-new project, starting with nothing
but an idea and ending with a tested, reviewed feature ready to ship. Written for someone who has
never used this workflow before.

## Before you start: what you're actually doing

Three roles do the work — **architect**, **developer**, **qa-reviewer** — plus you. You are never
one of the three roles. You're the person who has the idea, approves the design, and makes the
final call on what ships. Nothing goes to production because a subagent said so; it goes to
production because you said so.

---

## Phase 1 — Set up the repo (one time, per project)

1. Create your new repo from this template — click **"Use this template"** on GitHub, or copy
   this folder's contents into a new empty repo.
2. Open the new repo in your AI coding tool of choice (Claude Code, Gemini CLI, Codex CLI, or
   anything else that reads `AGENTS.md`; Cursor is not currently supported — see `AGENTS.md`). The workflow below is the same everywhere; only
   the way you *invoke* a role differs by tool (covered in Phase 2). One caveat: tools without
   native subagents have no architect/developer/qa-reviewer to call — for those, paste the relevant
   `agent-roles/*.md` file in as instructions when you want that role to act.
3. Open `AGENTS.md` and fill in what you already know, even roughly:
   - **What This Is** — a sentence or two, even if vague. "An app that helps X do Y" is enough.
   - **Developer Context** — your name and experience level, honestly. This is what makes the
     AI's explanations land at the right depth for you.
   - **Tech Stack** — defaults to React/Next.js/TypeScript/Supabase; change it if you're building
     something else. If you do change it, also update `.github/workflows/ci.yml` to match — it's
     wired for `npm` / `tsc` / `next build` by default, so leaving it will make CI fail in Phase 6.
   - Leave **Conventions**, **Absolute Rules**, and **What Not To Do** blank for now — fill these
     in as real decisions get made, not up front.
4. Set the project name in `ai-context/DECISIONS.md` and `ai-context/PROGRESS.md` (both open with a
   `[Project Name]` placeholder); leave the rest of both files as-is — you fill those in as you go
   (Phase 7). From here on, your tool's context file auto-loads `AGENTS.md` plus both `ai-context/`
   files at the start of every session, so you never have to ask it to re-read them.
5. That's the whole setup. You don't need a written spec yet — that's what Phase 2 is for.

---

## Phase 2 — Turn your idea into a design doc (architect)

This is where "an idea in my head" becomes something concrete enough to build. You do not need
requirements written down already — the architect's job is specifically to ask you the questions
that produce them.

1. Invoke the **architect** subagent and describe your idea in plain language, as roughly as you
   actually have it. Don't over-prepare — the architect is supposed to extract structure from
   you, not the other way around.

   Example (Claude Code — name the subagent in plain language):
   > `Use the architect subagent. I want to build an app where users can track their reading list
   > and get notified when a book they want becomes available at their local library. I don't have
   > requirements written down yet — help me figure out what this actually needs to do.`

   How you invoke the role differs by tool: **Claude Code** — name it in plain language ("use the
   architect subagent") or let it auto-delegate on the role's description; **Gemini CLI** —
   `@architect`; **Codex CLI** — reference the agent by name in your prompt. Each tool's
   adapter-file location is in the table in `AGENTS.md`.

2. Expect back-and-forth. The architect should ask what's in scope, what's explicitly out of
   scope, who the user is, and what "done" looks like for a first version. Answer honestly,
   including "I don't know" or "I hadn't thought about that" — that's normal, and the process is
   built around it.

3. The architect writes a design doc in `docs/architecture/`, based on `docs/architecture/_template.md`.
   Expect it to cover the problem/goal, requirements (functional, non-functional, and explicitly
   out-of-scope items), proposed design (module boundaries, data model, API surface), alternatives
   considered, risks and open questions, testing strategy, and CI/pipeline impact.

4. **Read the whole doc.** This is the first of your two hard gates in this process. Don't skim
   it — the developer builds against this document and qa-reviewer tests against it, so anything
   wrong or missing here propagates forward. Push back and ask for revisions on anything you're
   not sure about.

---

## Phase 3 — Approve the design (you)

1. Once the doc looks right, mark it approved — fill in the **Approved by** line at the top of
   the doc, or just tell your AI tool "the design doc is approved" and have it note that in the
   file.
2. Nothing moves to implementation before this. If you're tempted to skip straight to building
   because the idea "seems simple," check whether it's actually simple enough to skip the
   architect entirely (see Phase 8) — or whether you're just skipping a step you shouldn't.

---

## Phase 4 — Implement the feature (developer)

1. Invoke the **developer** subagent and point it at the approved design doc.

   Example (Claude Code):
   > `@developer implement the reading-list tracker per docs/architecture/reading-list-tracker.md`

2. The developer reads the design doc first — if you invoke it without an approved doc existing,
   it should tell you that rather than guessing. It implements the code, writes unit tests
   covering the logic including edge cases, and runs the test suite itself before reporting done.

3. Read its summary, but don't treat "the developer says it's done" as the finish line. By
   design, the developer cannot mark its own work as fully verified — that's the next role's job,
   for the same reason a human engineer doesn't self-approve their own pull request.

---

## Phase 5 — Independent testing and review (qa-reviewer)

1. Invoke the **qa-reviewer** subagent.

   Example (Claude Code):
   > `@qa-reviewer review the reading-list tracker implementation against docs/architecture/reading-list-tracker.md`

2. qa-reviewer works from the spec, not the code — it reads the design doc and the changes
   independently, writes its own acceptance tests aimed at what the developer's unit tests might
   have missed (edge cases, failure modes, boundary conditions), runs the full suite, and reports
   pass/fail honestly. It separately flags anything that technically passes tests but doesn't
   actually match what the design doc intended.

3. qa-reviewer cannot edit code. If something's broken, it reports it — it doesn't fix it. That's
   deliberate: mixing "found the bug" with "fixed the bug" in one role reintroduces the
   self-grading problem this whole structure exists to avoid.

4. Read the report. If qa-reviewer flags a mismatch with the spec — or flags that the work
   actually needed a design doc it never got — that goes back to developer or architect
   respectively before you proceed. Don't wave it through.

---

## Phase 6 — You approve, and it ships (you + CI)

1. You define "done." No subagent's report is itself an approval — you read the design doc, the
   developer's summary, and qa-reviewer's report, and you decide.
2. Push the change. `.github/workflows/ci.yml` runs automatically on the pull request: type check
   → lint → unit tests → build → integration/e2e tests → merge gate. This is the automated safety
   net underneath the subagent workflow — a second independent check before merge, even if
   something slipped past qa-reviewer.
3. Merge to `main` once CI is green and you've signed off. That's the actual production gate:
   you, backed by an automated pipeline — not any agent's say-so.

---

## Phase 7 — Close out the session

Before you stop for the day, or the AI's context runs out:
1. Update `ai-context/PROGRESS.md` — move what's done into "Completed," update "Up Next" with the
   real next step.
2. Add anything you decided along the way to `ai-context/DECISIONS.md`, with the reasoning, not
   just the choice.

This matters because the AI has no memory between sessions — `PROGRESS.md` is the only thing
telling your next session (today, tomorrow, or after a computer switch) where things stand.

---

## Phase 8 — The next feature

Repeat Phases 2–7 for each new piece of work, with one shortcut: not everything needs the full
architect → developer → qa-reviewer flow. Small, obvious changes — bugfixes, copy tweaks, config
edits, dependency bumps — can skip straight to developer, no design doc required. Anything with
real design surface (new modules, data-model changes, new API routes, anything touching multiple
parts of the system) goes through the full flow. When you're not sure which one you're looking
at, treat it as a feature — that's the built-in default, and it's the safer side to err on.
qa-reviewer still reviews everything either way; only the design-doc step is skippable, and even
then qa-reviewer can send a "trivial" change back through the architect if it turns out not to be.

---

**The whole loop, in one line**: idea → architect turns it into a spec you approve → developer
builds it → qa-reviewer independently verifies it → you approve and CI backs you up → you record
what happened → repeat.
