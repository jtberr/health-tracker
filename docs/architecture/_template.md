# [Feature/Module Name] — Design Doc

**Status:** Draft | In Review | Approved
**Author:** architect (agent)
**Date:** YYYY-MM-DD
**Approved by:** [Jeff — required before Developer starts]

## 1. Problem / Goal
What are we building and why? One or two paragraphs — no implementation detail yet.

## 2. Requirements
- Functional requirements (what it must do)
- Non-functional requirements (performance, security, data retention, etc.)
- Explicit out-of-scope items (as important as what's in-scope)

## 3. Proposed Design

### 3.1 Module boundaries
What are the pieces (components, API routes, services) and how do they divide
responsibility? A short diagram or bullet tree is fine.

### 3.2 Data model
- New/changed Supabase tables, columns, relationships
- RLS (Row Level Security) policy notes — who can read/write what
- Migration approach (new migration file, backfill needed?)

### 3.3 API / interface surface
- New Next.js routes or server actions
- Request/response shapes (TypeScript types)
- Auth requirements per route

### 3.4 State & UI (if applicable)
- Key React components and their responsibility
- Client vs. server component split
- Where state lives (server state via Supabase, client state via React)

## 4. Alternatives Considered
What else was considered and why was it rejected? (Even a short "considered X,
rejected because Y" is enough — this is what prevents relitigating decisions later.)

## 5. Risks & Open Questions
- Anything uncertain, anything that needs a decision from Jeff before proceeding
- Anything that could break existing functionality

## 6. Testing Strategy
- What unit tests the Developer should write (and roughly what they cover)
- What acceptance/integration tests QA should write from this spec
- Any data fixtures or Supabase test project setup needed

## 7. CI/Pipeline Impact
Does this change require new secrets, new pipeline steps, new environment
variables, or changes to .github/workflows/ci.yml? If yes, specify exactly.

---
**Definition of Done for this feature:**
[Filled in by Jeff or agreed with Jeff — not the agent's call alone]
