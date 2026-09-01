# Walkthrough: Rival Agency & Initiative Engine (Task 25)

## STATUS
Complete. The Rival Agency and Initiative Engine is fully implemented as a deterministic decision layer prior to the LLM response generation. 

## FILES CHANGED
- `packages/domain/src/engine/rivalAgency.ts` (New)
- `packages/domain/src/engine/rivalAgency.test.ts` (New)
- `packages/domain/src/engine/responsePlanner.ts`
- `packages/domain/src/ai/prompts/promptBuilder.ts`
- `packages/domain/src/types/events.ts`
- Multiple test files updated (`responsePlanner.test.ts`, `verticalSlice.test.ts`, `rivalExperience.test.ts`) to adapt to the new explicit `null` support for ambient silence.

## AGENCY BEHAVIORS IMPLEMENTED
The system now explicitly decides whether it should take initiative (or stay quiet) based purely on recent user behavior, character state, relationships, insights, memory, and presence changes. The `QUIET` decision is intentionally favored to ensure conservative behavior.

## INITIATIVE TYPES
- `RETURN_GREETING`
- `WAKE`
- `IDLE_OBSERVATION`
- `BORED_REACTION`
- `UNRESOLVED_FOLLOWUP`
- `CALLBACK_INTERRUPTION`
- `CHALLENGE_PROVOCATION`
- `USER_ROAST_RESPONSE`
- `RARE_CHARACTER_EVENT`
- `QUIET`

## PRIORITY RULES
1. **SERIOUS_INTERVENTION (100)**: Overrides everything. Silences normal ambient behavior in serious contexts.
2. **CHALLENGE_CRITICAL (90)**: Completely silences the Rival when waiting for the user to submit evidence or while judging.
3. **RETURN_WAKE (80)**: High priority given to greeting a user who has returned from a long absence.
4. **USER_INTERACTION (70)**: High priority for direct roasts from the user.
5. **UNRESOLVED_FOLLOWUP (60)**: Memory-driven persistence to return to unresolved claims.
6. **HIGH_VALUE_CALLBACK (50)**: Opportunistic interruption using extremely high-value insights or permanent memory.
7. **MEANINGFUL_OBSERVATION / CHALLENGE_PROVOCATION (40)**: For prolonged stalls and sudden challenge invitations.
8. **BOREDOM_IDLE (30)**: Low-priority idle banter.
9. **RARE_EVENT (20)**: Easter eggs.
10. **QUIET (0)**: Default behavior.

## COOLDOWNS / BUDGETS
Implemented explicit time-window checks using the `eventStore`. 
- `BORED_REACTION` has a 1-hour cooldown.
- `UNRESOLVED_FOLLOWUP` has a 1-hour cooldown.
- `CALLBACK_INTERRUPTION` has a 30-minute cooldown.
- `RARE_CHARACTER_EVENT` has a 4-hour cooldown.
- `CHALLENGE_PROVOCATION` has a 2-hour cooldown.

## INTEGRATION PATH
`ResponsePlanner` now fetches the `agencyDecision` immediately before challenge and prompt generation. 
- If no user input was provided and the agency decides to be `QUIET`, the planner intercepts and returns `null`, preventing any LLM generation and skipping the AI call entirely.
- If initiative is taken, the LLM receives the `DETERMINISTIC RIVAL INITIATIVE` in the `promptBuilder` and renders it naturally into the output.
- A new domain event `agency_initiative` is appended to the ledger strictly after successful decisions to drive cooldowns.

## AI CALL COUNT
Unchanged. Remains exactly 1 LLM call per normal interaction.
Ambient interactions use exactly 0 AI calls unless specifically authorized to act by the deterministic agency engine.

## TEST RESULTS
All 353 unit tests pass. 
- Covered serious suppression, critical challenge suppression, priority rules, cooldowns, and determinism.
- `verticalSlice.test.ts` integration loop passes smoothly with the new engine in the loop.

## BUILD / TYPECHECK RESULTS
- Typecheck is completely clean. 
- Build executes with zero errors.

## UNVERIFIED ITEMS
N/A - the deterministic backend flow performs as requested. No live UI deployment required for this backend slice.

## DEVIATIONS
- Did not implement arbitrary web-access logic as per instruction to wait for external context integration.
- `USER_INTERACTION_REACTION` hook requires a future event mapper for specific poke/tap UI behaviors; the architecture supports it but it is currently unmapped until front-end features arrive.
