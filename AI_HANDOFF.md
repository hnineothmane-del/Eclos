# AI Rival (Roast App) — AI Handoff & Project Context

> **Project Name:** AI Rival MVP (Roast App)  
> **Repository Path:** `c:/Users/a/Desktop/Roast app`  
> **Status:** Tasks 1–4 Completed & Verified (112 Domain Tests Passing, 2 Web Tests Passing, 26 Supabase Foundation Tests Passing)

---

## 1. Executive Summary & Architecture

AI Rival is a competitive/roast-style AI accountability app where an AI rival motivates, challenges, and roasts the user based on verified progress and behavioral evidence.

### Core Architectural Invariants
* **Deterministic Backend Authority**: Game logic, challenge state transitions, respect/trust calculations, and difficulty scaling are **100% deterministic** pure TypeScript/SQL code.
* **Advisory AI**: Gemini/LLM outputs generate dialogue, roasts, and advisory content ONLY. LLMs **never** directly mutate authoritative system state or respect scores.
* **Tech Stack**:
  * **Frontend**: React + TypeScript (Vite) in `apps/web`
  * **Hosting**: Cloudflare Pages / Workers
  * **Database & Auth**: Supabase (Postgres, RLS, Edge Functions)
  * **Domain Logic**: `packages/domain` (Pure TypeScript monorepo package)
  * **Billing**: Lemon Squeezy integration
* **No Unnecessary Complexity**: No vector DBs, Redis, ORMs, microservices, or complex state stores.

---

## 2. Completed Milestones

### ✅ Task 1: Monorepo Foundation
* Npm workspaces setup (`apps/web`, `packages/domain`).
* Vite + React + TypeScript web app skeleton.
* Root tooling: Vitest, ESLint (flat config), TypeScript, GitHub Actions CI workflow (`.github/workflows/ci.yml`).

### ✅ Task 2: Supabase Database Foundation (`supabase/migrations/`)
* `0001_core_tables.sql`: 13 core tables:
  1. `goals`
  2. `chat_messages`
  3. `relationship_state`
  4. `challenges`
  5. `evidence_submissions`
  6. `judgments`
  7. `memory_items`
  8. `humor_ledger`
  9. `events`
  10. `capability_observations`
  11. `subscriptions`
  12. `webhook_events`
  13. `usage_counters`
* `0002_rls_and_grants.sql`: Strict RLS, SELECT-only policies, event immutability trigger.
* `0003_authoritative_functions.sql`: `SECURITY DEFINER` SQL functions.
* 26 SQL structural tests passing in `supabase/tests/database_foundation.test.ts`.

### ✅ Task 3: Shared Domain Types (`packages/domain/src/types/`)
* Complete domain models: `relationship.ts`, `goal.ts`, `challenge.ts`, `memory.ts`, `capability.ts`, `events.ts`, `chat.ts`, `billing.ts`, `aiContract.ts`.

### ✅ Task 4: Deterministic Domain Logic (`packages/domain/src/`)
* `util/clamp.ts`: Safe math clamping helper.
* `engine/respectEngine.ts`: Deterministic Respect & Relationship Delta Engine + Effort Signal derivation (`deriveEffortSignal`).
* `challenge/lifecycle.ts`: Challenge state machine transition validator (`validateTransition`).
* `challenge/difficulty.ts`: Next challenge difficulty calculation (`computeNextDifficulty`).
* `memory/retrieval.ts`: Memory item relevance ranking (`rankMemories`).

---

## 3. Project Structure

```text
Roast app/
├── apps/
│   └── web/                   # React + TypeScript + Vite frontend
│       └── src/
│           ├── App.tsx
│           └── main.tsx
├── packages/
│   └── domain/                # Pure TypeScript domain logic & types
│       └── src/
│           ├── ai/
│           ├── billing/
│           ├── challenge/      # Challenge lifecycle & difficulty calculation
│           ├── engine/         # Respect engine & effort calculation
│           ├── memory/         # Memory ranking algorithm
│           ├── types/          # Shared TS domain interfaces & unions
│           └── util/           # Pure utilities (clamp, etc.)
├── supabase/
│   ├── functions/             # Supabase Edge Functions
│   ├── migrations/            # 0001_core_tables, 0002_rls_and_grants, 0003_authoritative_functions
│   └── tests/                 # SQL structure Vitest suite
├── docs/
│   └── ARCHITECTURE.md
└── package.json               # Root workspace scripts
```

---

## 4. Key Verification & CLI Commands

Run these commands from the workspace root (`c:/Users/a/Desktop/Roast app`):

```bash
# Install dependencies
npm install

# Typecheck all TypeScript code
npm run typecheck

# Run unit tests across all workspaces (114 passing tests)
npm run test

# Run Supabase database structure tests
npx vitest run supabase/tests/database_foundation.test.ts

# Build domain package & web frontend
npm run build
```

---

## 5. Next Steps / Tasks Ahead

When resuming work, the next task in the MVP roadmap is **Task 5 (AI Provider Abstraction & Prompt Engine)** or **Task 6 (Supabase Edge Functions / Backend Integration)**.

* **Task 5 Focus**: Implement `packages/domain/src/ai/` provider interface wrapping Gemini, prompt formatting, roast generation fallback, and response validation against `AIResponseContract`.
* **Rules for Next AI Assistant**:
  * Do NOT modify existing passing tests or architecture without explicit prompt.
  * Keep all domain logic in `packages/domain` strictly pure (no side effects, no network/DB calls inside `packages/domain`).
  * Ensure `npm run typecheck`, `npm run test`, and `npm run build` pass clean before completing any task.
