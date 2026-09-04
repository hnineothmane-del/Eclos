# ECLOS HANDOFF

## PHASE
BETA STABILIZATION

## CURRENT TASK
challenge-action module loading & end-to-end lifecycle verification

## COMPLETED
- Diagnosed root cause of `InvalidWorkerCreation` in `supabase/functions/challenge-action/index.ts:3:33`:
  - `chat-turn` had its own `deno.json` and `import_map.json` pointing `@ai-rival/domain` to `../../../packages/domain/dist/index.js`.
  - `challenge-action` had NO local `deno.json` or `import_map.json`, so Supabase CLI fell back to the root `supabase/functions/import_map.json`.
  - The fallback import map contained only 2 directory levels (`../../packages/domain/dist/index.js`), which failed to resolve relative to `supabase/functions/challenge-action/`.
- Fixed `challenge-action`:
  - Created `supabase/functions/challenge-action/deno.json` and `supabase/functions/challenge-action/import_map.json` with the identical 3-level relative mapping (`../../../packages/domain/dist/index.js`) proven in `chat-turn`.
  - In `apps/web/src/lib/api.ts`, unwrapped `data?.data ?? data` from `acceptChallenge`, `startChallenge`, `attemptChallenge`, and `declineChallenge` so callers receive the pure `Challenge` entity rather than `{ data: Challenge }`.
- Verified end-to-end challenge lifecycle:
  - Auth → `chat-turn` (issues challenge) → `challenge-action` `accept` → `challenge-action` `start` → `challenge-action` `submit_evidence`.
  - Verified Postgres rows in `challenges` and `events` table: `challenge_issued`, `challenge_accepted`, `challenge_started`, `evidence_submitted` all written atomically without schema or authorization errors.

## FILES CHANGED
- `supabase/functions/challenge-action/deno.json` [NEW] — Function-level Deno import map matching `chat-turn`
- `supabase/functions/challenge-action/import_map.json` [NEW] — Function-level import map matching `chat-turn`
- `apps/web/src/lib/api.ts` — Unwrap `data?.data ?? data` from challenge actions

## TESTS
```powershell
npm run typecheck --workspace=packages/domain
npm run typecheck --workspace=apps/web
npm run test --workspace=packages/domain
npm run test --workspace=apps/web
npm run build --workspace=apps/web
```

## RESULTS
- `npm run typecheck --workspace=packages/domain` → **PASS (0 errors)**
- `npm run typecheck --workspace=apps/web` → **PASS (0 errors)**
- `npm run test --workspace=packages/domain` → **PASS (38 test files, 458 tests)**
- `npm run test --workspace=apps/web` → **PASS (4 test files, 23 tests)**
- `npm run build --workspace=apps/web` → **PASS (dist/ built in 4.35s)**

## RUNTIME VERIFICATION
Verified full challenge flow end-to-end against local Supabase runtime:
1. `chat-turn` issued challenge `96416c44-8b85-4d71-b4ef-2ab229b03f2b` (status: `issued`)
2. `challenge-action` action `accept` succeeded without worker error (status: `accepted`)
3. `challenge-action` action `start` succeeded (status: `started`)
4. `challenge-action` action `submit_evidence` succeeded (status: `evidence_submitted`)
5. DB events recorded: `subscription_created`, `usage_incremented`, `challenge_issued`, `challenge_accepted`, `challenge_started`, `evidence_submitted`

## REMAINING
None. Beta stabilization of all V1 runtime systems (auth, events, chat-turn, challenge-action, full lifecycle) is verified and working.

## NEXT ACTION
Proceed to **Phase 2: RIVAL PERSONALITY RESTORATION** (Humor, Context Stacking, Natural Goal Recognition).
