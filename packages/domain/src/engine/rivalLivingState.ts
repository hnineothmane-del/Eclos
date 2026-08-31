/**
 * rivalLivingState.ts — Rival Living-State Snapshot (Task 26)
 *
 * Derives a structured, queryable "internal state" for the Rival from the
 * deterministic Presence Decision and Agency Decision. This is separate from
 * the expression layer: the Rival can have an internal state (e.g. OCCUPIED)
 * while the agency decides to stay QUIET. The living state is what drives the
 * visual representation and — optionally — provides the LLM with context
 * about what the Rival was "doing" when he was interrupted or speaks.
 *
 * GUARANTEES:
 * - Pure function (no side effects, no AI calls, no Date.now())
 * - All time must be supplied via nowIso
 * - Same inputs → same output (deterministic)
 * - Never mutates inputs
 */

import type { PresenceDecision, PresenceState, PresenceActivity, AmbientEventType } from './presenceEngine.js';
import type { RivalInitiativeDecision } from './rivalAgency.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Rival's internal conceptual state — what he is doing or feeling.
 * Distinct from the expression layer (what he chooses to say/show).
 */
export type RivalInternalState =
  | 'active'        // Engaged, watching the user
  | 'observing'     // Silently paying attention
  | 'bored'         // Waiting with low engagement
  | 'resting'       // Light rest — can be interrupted
  | 'sleeping'      // Deep rest — needs a meaningful event to wake
  | 'returning'     // Just woke / just came back
  | 'occupied';     // Doing his own thing (rare character events)

/**
 * What the Rival is conceptually doing (micro-behavior layer).
 * Drives animations and ambient UI.
 */
export type RivalMicroActivity =
  | 'idle'          // Not doing anything specific
  | 'watching'      // Actively monitoring the user
  | 'thinking'      // Processing something
  | 'waiting'       // Waiting for the user
  | 'resting'       // Low-power mode
  | 'sleeping'      // Full rest
  | 'occupied'      // Doing something of his own
  | 'returning';    // Transitioning from away/sleep

/**
 * Whether the Rival is choosing to engage or remain silent.
 * This is the internal decision — not necessarily reflected in output.
 */
export type RivalExpressionMode =
  | 'speaking'      // Will produce a response
  | 'silent'        // Has decided to stay quiet
  | 'observing';    // Watching, may interrupt

/**
 * Extension seam for future interactions.
 * Hook: future touch/poke/wake/tap/Easter-egg interactions route through here.
 */
export type RivalInteractionHook =
  | 'touch'
  | 'tap'
  | 'poke'
  | 'wake'
  | 'interrupt'
  | 'user_roast'
  | 'user_challenge'
  | 'easter_egg'        // future
  | 'mini_game'         // future
  | 'lore_event'        // future
  | 'rare_activity';    // future

/**
 * The complete living-state snapshot for the Rival.
 * This is what the UI, logger, and prompt builder consume.
 */
export interface RivalLivingState {
  /** Core behavioral state — what the Rival "is" right now */
  internalState: RivalInternalState;

  /** Micro-behavior — what he's doing at this moment */
  microActivity: RivalMicroActivity;

  /** Whether he's engaging or being silent */
  expressionMode: RivalExpressionMode;

  /** Which ambient event was authorized (null if silent) */
  authorizedAmbientEvent: AmbientEventType | null;

  /** Whether the user can interact with the Rival right now */
  canInteract: boolean;

  /** Whether this is a meaningful transition (new session, wake, return) */
  isTransition: boolean;

  /** The reason/context for this state */
  reason: string;

  /** Timestamp this was derived at */
  derivedAt: string;

  /**
   * Typed extension seam — what kind of user interaction, if any, was observed.
   * Null means no interaction event was present.
   * Future: route Easter eggs, mini-games, lore through here.
   */
  pendingInteractionHook: RivalInteractionHook | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation
// ─────────────────────────────────────────────────────────────────────────────

function presenceStateToInternal(state: PresenceState): RivalInternalState {
  switch (state) {
    case 'active': return 'active';
    case 'idle': return 'observing';
    case 'observing': return 'observing';
    case 'bored': return 'bored';
    case 'resting': return 'resting';
    case 'sleeping': return 'sleeping';
    case 'awakening': return 'returning';
    case 'returning': return 'returning';
    case 'interrupting': return 'active';
    case 'away': return 'sleeping';
    case 'serious': return 'active';
  }
}

function presenceActivityToMicro(activity: PresenceActivity): RivalMicroActivity {
  switch (activity) {
    case 'idle': return 'idle';
    case 'watching': return 'watching';
    case 'thinking': return 'thinking';
    case 'resting': return 'resting';
    case 'sleeping': return 'sleeping';
    case 'away': return 'sleeping';
    case 'occupied': return 'occupied';
    case 'waiting': return 'waiting';
    case 'returning': return 'returning';
  }
}

const TRANSITION_STATES: ReadonlySet<PresenceState> = new Set([
  'awakening', 'returning', 'interrupting',
]);

const TRANSITION_ACTIONS: ReadonlySet<AmbientEventType> = new Set([
  'sleep_end', 'return_greeting', 'unexpected_wake', 'session_reentry',
]);

/**
 * Derives the Rival's complete living-state snapshot from a presence decision
 * and an optional agency decision. Pure and deterministic.
 */
export function deriveRivalLivingState(
  presence: PresenceDecision,
  agency: RivalInitiativeDecision | null,
  nowIso: string,
): RivalLivingState {
  const internalState = presenceStateToInternal(presence.state);
  const microActivity = presenceActivityToMicro(presence.activity);

  // Determine whether the Rival is choosing to speak or stay silent
  const hasAction = agency !== null && agency.action !== 'QUIET';
  const expressionMode: RivalExpressionMode = hasAction
    ? 'speaking'
    : presence.attention === 'observe'
      ? 'observing'
      : 'silent';

  // canInteract: the user can meaningfully interact (poke, tap, wake)
  const canInteract = internalState === 'resting' || internalState === 'sleeping' || internalState === 'bored';

  // isTransition: a meaningful state change occurred
  const isTransition = TRANSITION_STATES.has(presence.state)
    || (presence.action !== null && TRANSITION_ACTIONS.has(presence.action));

  // Rare/occupied detection for when presence says occupied
  const isOccupied = presence.activity === 'occupied';
  if (isOccupied) {
    // Override internal state to occupied for the rare character event feeling
    return {
      internalState: 'occupied',
      microActivity: 'occupied',
      expressionMode,
      authorizedAmbientEvent: presence.action,
      canInteract: false,
      isTransition: false,
      reason: 'Rival is occupied with something of his own.',
      derivedAt: nowIso,
      pendingInteractionHook: null,
    };
  }

  return {
    internalState,
    microActivity,
    expressionMode,
    authorizedAmbientEvent: presence.action,
    canInteract,
    isTransition,
    reason: presence.reason,
    derivedAt: nowIso,
    pendingInteractionHook: null,
  };
}

/**
 * Registers an incoming user interaction type and returns an updated living
 * state with the appropriate pendingInteractionHook set.
 *
 * Extension seam: future touch/poke/wake/Easter-egg interactions route here.
 * The agency layer will then pick this up on the next evaluation cycle.
 */
export function withInteractionHook(
  state: RivalLivingState,
  hook: RivalInteractionHook,
): RivalLivingState {
  return { ...state, pendingInteractionHook: hook };
}

/**
 * Produces a short human-readable description of the Rival's living state.
 * Used for prompt building and debugging.
 */
export function describeLivingState(state: RivalLivingState): string {
  const activity = `${state.internalState} (${state.microActivity})`;
  const expression = state.expressionMode === 'speaking'
    ? `— speaking (${state.authorizedAmbientEvent ?? 'turn response'})`
    : state.expressionMode === 'observing'
      ? '— observing silently'
      : '— silent';
  return `${activity} ${expression}`;
}
