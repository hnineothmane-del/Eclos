/**
 * rivalInteraction.ts — Rival Interaction Outcome (Task 28)
 *
 * Deterministically resolves user→Rival physical interactions (tap, poke, wake,
 * user_roast) into a typed outcome that downstream layers consume.
 *
 * GUARANTEES
 * - Pure function (no side effects, no AI calls, no Date.now())
 * - All time supplied via nowIso
 * - Same inputs → same output (deterministic)
 * - Visual-only path costs 0 AI calls
 * - Never mutates inputs
 */

import type { RivalInteractionHook, RivalLivingState } from './rivalLivingState.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { RelationshipState } from '../types/relationship.js';
import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RivalReaction =
  | 'amused'
  | 'annoyed'
  | 'startled'
  | 'curious'
  | 'ignores'
  | 'pushback';

export interface InteractionOutcome {
  /** The resolved reaction type — drives visual + optional prompt context */
  reaction: RivalReaction;
  /** Whether the Rival is allowed to speak (one generation call max) */
  speechAuthorized: boolean;
  /** True when no speech is needed — visual/state-only path, 0 AI calls */
  visualOnly: boolean;
  /**
   * Hidden-condition seam for future tasks.
   * Default: always false in Task 28.
   * Future: sufficient familiarity + repeated poke + certain state → hidden event.
   */
  hiddenConditionMet: boolean;
  /** Key used for cooldown tracking in the event ledger */
  cooldownKey: string;
  /** Why this outcome was selected (for debugging + tests) */
  reason: string;
}

export interface InteractionRecord {
  interactionType: string;
  occurredAt: string;
}

export interface InteractionInput {
  interaction: RivalInteractionHook;
  livingState: RivalLivingState;
  presence: PresenceDecision;
  relationship: RelationshipState;
  activeChallenge: Challenge | null;
  recentInteractions: readonly InteractionRecord[];
  nowIso: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SPEECH_COOLDOWN_MS   = 3 * 60 * 1000;   // 3 minutes per interaction type
const REACTION_COOLDOWN_MS = 30 * 1000;        // 30 seconds before any visible reaction
const MIN_FAMILIARITY_FOR_POKE = 30;           // ignore pokes from strangers

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function elapsedMs(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
}

function isOnReactionCooldown(input: InteractionInput, key: string): boolean {
  return input.recentInteractions.some(
    (r) => r.interactionType === key && elapsedMs(r.occurredAt, input.nowIso) < REACTION_COOLDOWN_MS,
  );
}

function isSpeechOnCooldown(input: InteractionInput, key: string): boolean {
  return input.recentInteractions.some(
    (r) => r.interactionType === key && elapsedMs(r.occurredAt, input.nowIso) < SPEECH_COOLDOWN_MS,
  );
}

/** Returns suppression reason or null if interaction may proceed. */
function suppressionReason(input: InteractionInput): string | null {
  // Never interrupt challenge-critical moments
  if (
    input.activeChallenge?.status === 'evidence_submitted' ||
    input.activeChallenge?.status === 'needs_more_evidence'
  ) return 'challenge_critical';

  // Serious context: no comedic escalation
  if (input.presence.state === 'serious') return 'serious_context';

  // Occupied state: Rival has more important things to do
  if (input.livingState.internalState === 'occupied') return 'rival_occupied';

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction resolvers (one per supported type)
// ─────────────────────────────────────────────────────────────────────────────

function resolveTapPoke(input: InteractionInput): InteractionOutcome {
  const { livingState, relationship } = input;
  const cooldownKey = 'tap_poke';

  // If asleep: redirect to wake path
  if (livingState.internalState === 'sleeping') {
    return resolveWake(input);
  }

  // Hard reaction cooldown: no response at all
  if (isOnReactionCooldown(input, cooldownKey)) {
    return {
      reaction: 'ignores',
      speechAuthorized: false,
      visualOnly: true,
      hiddenConditionMet: false,
      cooldownKey,
      reason: 'tap/poke reaction cooldown active — ignoring',
    };
  }

  // Too unfamiliar: he ignores strangers
  if (relationship.familiarity < MIN_FAMILIARITY_FOR_POKE) {
    return {
      reaction: 'ignores',
      speechAuthorized: false,
      visualOnly: true,
      hiddenConditionMet: false,
      cooldownKey,
      reason: 'familiarity too low — ignoring poke',
    };
  }

  // Speech on cooldown: visual reaction only, vary the glyph
  if (isSpeechOnCooldown(input, cooldownKey)) {
    const reactions: RivalReaction[] = ['annoyed', 'curious', 'ignores'];
    const idx = Math.floor(new Date(input.nowIso).getTime() / 1000) % reactions.length;
    return {
      reaction: reactions[idx],
      speechAuthorized: false,
      visualOnly: true,
      hiddenConditionMet: false,
      cooldownKey,
      reason: 'speech cooldown active — visual reaction only',
    };
  }

  // Determine spoken reaction by relationship state
  const reaction: RivalReaction =
    relationship.mode === 'permanent_rival' ? 'annoyed' :
    relationship.warmth >= 50              ? 'amused'   : 'curious';

  return {
    reaction,
    speechAuthorized: true,
    visualOnly: false,
    hiddenConditionMet: false,
    cooldownKey,
    reason: `poke/tap reaction: ${reaction} (warmth=${relationship.warmth}, mode=${relationship.mode})`,
  };
}

function resolveWake(input: InteractionInput): InteractionOutcome {
  const { livingState } = input;
  const cooldownKey = 'wake';

  // Already awake: small dry reaction rather than a full wake sequence
  if (livingState.internalState !== 'sleeping' && livingState.internalState !== 'resting') {
    const speechAllowed = !isSpeechOnCooldown(input, cooldownKey);
    return {
      reaction: 'curious',
      speechAuthorized: speechAllowed,
      visualOnly: !speechAllowed,
      hiddenConditionMet: false,
      cooldownKey,
      reason: 'wake called but Rival is not sleeping — small dry reaction',
    };
  }

  // Hard reaction cooldown: ignore repeated waking
  if (isOnReactionCooldown(input, cooldownKey)) {
    return {
      reaction: 'ignores',
      speechAuthorized: false,
      visualOnly: true,
      hiddenConditionMet: false,
      cooldownKey,
      reason: 'wake cooldown active — ignoring',
    };
  }

  // Full wake path: startled if sleeping, annoyed if resting
  return {
    reaction: livingState.internalState === 'sleeping' ? 'startled' : 'annoyed',
    speechAuthorized: true,
    visualOnly: false,
    hiddenConditionMet: false,
    cooldownKey,
    reason: `wake from ${livingState.internalState} — speech authorized`,
  };
}

function resolveUserRoast(input: InteractionInput): InteractionOutcome {
  const cooldownKey = 'user_roast';
  const speechAllowed = !isSpeechOnCooldown(input, cooldownKey);
  return {
    reaction: 'pushback',
    speechAuthorized: speechAllowed,
    visualOnly: !speechAllowed,
    hiddenConditionMet: false,
    cooldownKey,
    reason: speechAllowed
      ? 'user roast received — Rival authorized to push back'
      : 'user roast: speech cooldown active — visual pushback only',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a fully deterministic outcome for a user→Rival interaction.
 *
 * Callers should check `visualOnly` first. If true → skip AI call entirely.
 * If false → pass outcome into prompt builder for context-aware rendering.
 */
export function deriveInteractionOutcome(input: InteractionInput): InteractionOutcome {
  // Global suppression gate
  const suppressed = suppressionReason(input);
  if (suppressed) {
    return {
      reaction: 'ignores',
      speechAuthorized: false,
      visualOnly: true,
      hiddenConditionMet: false,
      cooldownKey: String(input.interaction),
      reason: `suppressed: ${suppressed}`,
    };
  }

  switch (input.interaction) {
    case 'tap':
    case 'poke':
      return resolveTapPoke(input);
    case 'wake':
      return resolveWake(input);
    case 'user_roast':
      return resolveUserRoast(input);
    default:
      // Unimplemented future interactions — silently ignore
      return {
        reaction: 'ignores',
        speechAuthorized: false,
        visualOnly: true,
        hiddenConditionMet: false,
        cooldownKey: String(input.interaction),
        reason: `interaction type '${String(input.interaction)}' not yet implemented`,
      };
  }
}

/**
 * Extracts interaction records from the domain event ledger for cooldown
 * tracking. Pass the result of recentForUser() here.
 */
export function extractInteractionRecords(events: readonly DomainEvent[]): InteractionRecord[] {
  return events
    .filter((e) => (e.eventType as string) === 'rival_interaction')
    .map((e) => ({
      interactionType: String((e.payload as any)?.interactionType ?? ''),
      occurredAt: e.createdAt,
    }));
}

/**
 * Short description of an interaction outcome for the prompt builder.
 * Only injected when speechAuthorized is true.
 */
export function describeInteractionOutcome(outcome: InteractionOutcome): string {
  return `Rival reaction: ${outcome.reaction} — ${outcome.reason}`;
}
