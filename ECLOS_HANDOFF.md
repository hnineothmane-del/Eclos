# ECLOS HANDOFF

## PHASE
BETA STABILIZATION — Phase 1 Runtime Corrections

## STATUS
All Phase 1 runtime correction tasks are now COMPLETE. Runtime bugs discovered during manual testing have been fixed and verified.

---

## COMPLETED

### Event Schema Reconciliation
- **Problem**: `events.event_type` CHECK constraint in migration `0007_process_observation.sql` did not include `rival_interaction`, `agency_initiative`, `rival_easter_egg_discovered`, `rival_lore_revealed`, or `needs_more_evidence`. These types are emitted at runtime by `ResponsePlanner.ts` and stored via `SupabaseEventStore.append()`, causing a DB constraint violation.
- **Fix**: Created `supabase/migrations/0012_reconcile_event_types.sql` to drop the old constraint and add a new one containing the full authoritative `EventType` union from `packages/domain/src/types/events.ts`.
- **Also**: Added `needs_more_evidence` to `EventType` union in `events.ts` (it was in the DB transition handler in 0011 but missing from the TS type).
- **Also**: Removed `as any` cast in `responsePlanner.ts` on the `rival_interaction` event type.
- **Verified**: `db reset` applied all 12 migrations cleanly.

### ChallengeEngine.issue() Call Contract
- **Problem**: `chat-turn/index.ts` was calling `challengeEngine.issue({ userId: ..., ... })` — passing only the params object. The actual signature is `issue(userId: string, params: IssueChallengeParams)`. This caused `assertAuthenticatedIdentity` to compare `this.authenticatedUserId` against `[object Object]` (the stringified params object), throwing `UnauthorizedChallengeError`.
- **Fix**: Changed call to `challengeEngine.issue(user.id, { userId: user.id, ... })` in `chat-turn/index.ts`.
- **Regression tests added** in `challengeEngine.test.ts`:
  - `issue() accepts the correct userId as first positional argument`
  - `issue() rejects when authenticatedUserId does not match userId arg`

### Error Stack Trace Leakage
- **Fix**: Both `chat-turn/index.ts` and `challenge-action/index.ts` now generate a `correlationId` (UUID), log full exception details server-side, and return only `{ error: '...', correlationId }` to the client.

### Performance Instrumentation
- Added `[TIMING]` console log to `chat-turn/index.ts` measuring: Auth, UsageCheck, ChallengeLookup, AI PlanTurn, Total duration.
- **Next step**: After real runtime test, examine these timing logs to identify wall-clock bottleneck (not yet diagnosed from actual data — Edge Function logs needed).

### Migration Fix (0011)
- Removed a re-declaration of `increment_usage_and_check` in migration `0011` that conflicted with the canonical version in `0009`. This was causing the migration to fail with `cannot change name of input parameter`.

### Unused Variable Fix
- Removed dead `insertPayload` variable from `challengeEngine.ts` that was left after refactoring to RPC-based issuance.

---

## PARTIAL
- **Wall-clock diagnosis**: Instrumentation is in place. Actual bottleneck has NOT been identified yet because it requires live Edge Function logs from a real request. The `[TIMING]` log line will appear in the Supabase Functions serve output when a real request fires.

---

## FILES CHANGED
- `supabase/migrations/0012_reconcile_event_types.sql` [NEW] — Adds missing event types to DB CHECK constraint
- `packages/domain/src/types/events.ts` — Added `needs_more_evidence` to `EventType`
- `packages/domain/src/engine/responsePlanner.ts` — Removed `as any` cast on `rival_interaction` event
- `supabase/functions/chat-turn/index.ts` — Fixed `issue()` call contract; added timing instrumentation; removed stack trace leak
- `supabase/functions/challenge-action/index.ts` — Removed stack trace leak; added correlationId
- `packages/domain/src/challenge/challengeEngine.ts` — Removed dead `insertPayload` variable
- `packages/domain/src/challenge/challengeEngine.test.ts` — Added 2 regression tests for issue() contract
- `supabase/migrations/0011_authorization_and_lifecycle_fixes.sql` — Removed conflicting `increment_usage_and_check` re-declaration

---

## TESTS RUN

```
npm run test --workspace=packages/domain
→ PASS: 38 test files, 458 tests

npm run typecheck --workspace=packages/domain
→ PASS: 0 errors

npm run typecheck --workspace=apps/web
→ PASS: 0 errors

npm run build --workspace=apps/web
→ PASS: 141 modules, dist/ created

npx supabase@2.115.0 db reset
→ PASS: All 12 migrations applied (0001–0012)
```

---

## KNOWN ISSUES

### Wall-clock / Early Termination
Timing instrumentation is in place but actual data has not been captured from a real running request. The `[TIMING]` log will appear in Edge Function serve console when a real request fires. Likely culprit is sequential DB reads inside `ResponsePlanner.planTurn` (relationship, memory, events, humor) — but must confirm with data before optimizing.

### DB Integration Tests Unavailable
`supabase test db` requires Docker/Supabase to be running. Migrations have been applied via `db reset` and are correct. Individual integration test files exist in `supabase/tests/` but cannot run without the local container active.

---

## NEXT ACTION

Run the app manually and inspect the `[TIMING]` log line from the Edge Function console:

```
npx -y supabase@2.115.0 functions serve --env-file .env
npm run dev -w apps/web
```

Send the messages: `hello`, `I want to lose weight`, `Get better at coding`.

Verify:
1. No 500 errors
2. No `events_event_type_check` constraint violations in server logs
3. No `UnauthorizedChallengeError` 
4. `[TIMING]` line appears — identify if any stage is >10s
5. At least one of the test inputs triggers challenge issuance — verify challenge + `challenge_issued` event exist in DB

If wall-clock is still triggering Edge termination, identify the specific stage from [TIMING] and report. Then decide whether to add parallelism to the sequential DB reads in ResponsePlanner (the known candidates: relationship, memory, events, humor) without redesigning the architecture.

After that: BETA STABILIZATION IS COMPLETE → proceed to Vision Restoration / MVP Cut.
