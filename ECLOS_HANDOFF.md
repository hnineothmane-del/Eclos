# ECLOS HANDOFF

## PHASE
BETA STABILIZATION

## CURRENT TASK
Local chat-turn authentication/runtime verification

## COMPLETED
- Diagnosed root cause of local 401 Unauthorized on `POST /functions/v1/chat-turn`:
  1. `ensureSession()` in `apps/web/src/lib/api.ts` was blindly trusting unverified cached sessions from browser `localStorage` without validating whether the user still existed in GoTrue/DB (stale sessions after `supabase db reset` were never cleared).
  2. `supabase.functions.invoke()` calls in `apps/web/src/lib/api.ts` were called without explicit headers; in the absence of a verified local session token, `@supabase/supabase-js`'s internal `fetchWithAuth` falls back to sending `Authorization: Bearer <anonKey>`.
  3. In `supabase/functions/chat-turn/index.ts` and `supabase/functions/challenge-action/index.ts`, `authClient.auth.getUser()` was called without passing the extracted token, failing with `invalid claim: missing sub claim` when given the anon key.
- Fixed `apps/web/src/lib/api.ts`:
  1. `ensureSession()` is now self-healing: it checks token expiration, attempts refresh, verifies the user against GoTrue via `getUser()`, purges stale/dead sessions via `signOut()`, and falls back to `signInAnonymously()`.
  2. All edge function invocations (`chatTurn`, `ambientTurn`, `rivalInteraction`, `acceptChallenge`, `startChallenge`, `attemptChallenge`, `declineChallenge`, `submitEvidence`) explicitly pass `headers: { Authorization: \`Bearer \${session.access_token}\` }`, guaranteeing a valid bearer token is always transmitted.
- Fixed `supabase/functions/chat-turn/index.ts` and `challenge-action/index.ts`:
  1. Explicitly extracts `token` from `authHeader` and passes it directly to `authClient.auth.getUser(token)`.
- Fixed web test suites (`HomePage.test.tsx`, `RivalPresence.test.tsx`):
  1. Updated `HomePage.test.tsx` to match the authoritative challenge return contract and the non-auto-chaining lifecycle (`accept` -> `START WORK` -> `LOG ATTEMPT` -> submit proof).
  2. Updated `RivalPresence.test.tsx` timer advancements to correctly tick through each presence threshold.

## FILES CHANGED
- `apps/web/src/lib/api.ts` — Self-healing `ensureSession()` and explicit `Authorization: Bearer <token>` on all `invoke()` calls
- `supabase/functions/chat-turn/index.ts` — Explicit token extraction and passing to `authClient.auth.getUser(token)`
- `supabase/functions/challenge-action/index.ts` — Explicit token extraction and passing to `authClient.auth.getUser(token)`
- `apps/web/src/HomePage.test.tsx` — Test mocks aligned with non-speculative challenge return and lifecycle
- `apps/web/src/components/RivalPresence.test.tsx` — Timer advancement aligned with PresenceEngine thresholds
- `apps/web/src/components/useRivalPresence.ts` — `useEffect` dependency updated to re-schedule timeouts upon state resolution

## TESTS
```powershell
npm run test --workspace=packages/domain
npm run typecheck --workspace=packages/domain
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
npm run build --workspace=apps/web
```

## RESULTS
- `npm run test --workspace=packages/domain` → **38 passed (38), 458 passed (458)**
- `npm run typecheck --workspace=packages/domain` → **PASS (0 errors)**
- `npm run typecheck --workspace=apps/web` → **PASS (0 errors)**
- `npm run test --workspace=apps/web` → **4 passed (4), 23 passed (23)**
- `npm run build --workspace=apps/web` → **PASS (built dist/ in 3.17s)**

## RUNTIME VERIFICATION
Verified real local Supabase runtime execution via the exact `ensureSession()` + `functions.invoke('chat-turn')` path:
1. `hello`:
   - Status: **200 OK** (10,293ms)
   - Response: *"Hello. Are you going to give me something real to work with, or was 'hello' your entire opening strategy today?"*
   - Intent: `banter` | Mode: `direct`
   - Entitlement: `{ tier: 'free', active: true, dailyLimit: 20, currentInteractions: 1 }`
2. `I want to lose weight.`:
   - Status: **200 OK** (6,422ms)
   - Response: *"Everyone *wants* to. Announcing it burns about half a calorie. If you're serious, don't give me a grand plan—tell me the exact thing you're changing today, right now. You've got 60 seconds to give me a direct answer."*
   - Intent: `challenge` | Mode: `direct`
   - Challenge issued: `d78b6c10-b2e0-401e-b83f-b84f6926afe8` (recorded in Postgres `challenges` table, `challenge_issued` event recorded in `events` table)
   - Entitlement: `{ tier: 'free', active: true, dailyLimit: 20, currentInteractions: 2 }`
3. `Get better at coding`:
   - Status: **200 OK** (8,788ms)
   - Response: *"Declaring a goal isn't progress. You want to get better at coding? Pick a language, pick a small tool, and show me working code. Let's see if you actually mean it."*
   - Intent: `challenge` | Mode: `direct`
   - Entitlement: `{ tier: 'free', active: true, dailyLimit: 20, currentInteractions: 3 }`
4. `roast me`:
   - Status: **200 OK** (6,558ms)
   - Response: *"You just set a weight loss goal and your immediate next move is asking me to roast you—as if getting insulted burns calories. Stop looking for entertainment and go do something that actually moves the scale."*
   - Intent: `roast` | Mode: `direct` (contextually aware of previous turn)
   - Entitlement: `{ tier: 'free', active: true, dailyLimit: 20, currentInteractions: 4 }`
- Database state verified:
  - Challenge row exists with status `issued`, `difficulty: 5`, objective matching the prompt.
  - Events table verified: `subscription_created`, `usage_incremented`, `challenge_issued`, `agency_initiative` all successfully persisted.
  - Zero `events_event_type_check` violations.
  - Zero `UnauthorizedChallengeError` violations.
  - Zero 401 Unauthorized responses.

## REMAINING
- No functional blockers remaining in Phase 1 runtime foundation.
- Wall-clock per-turn latency averages 6-10s (primarily Gemini API response time + sequential DB reads in ResponsePlanner); within local Deno function timeout limits (~60s), but can be optimized during Phase 5 (Performance Optimization) without altering domain contracts.

## NEXT ACTION
Phase 1 foundation stabilization is fully verified. Ready to proceed to **Phase 2: RIVAL PERSONALITY RESTORATION** (Humor, Context Stacking, Natural Goal Recognition).
