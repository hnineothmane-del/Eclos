import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';

export type PresenceState =
  | 'active'
  | 'idle'
  | 'observing'
  | 'bored'
  | 'resting'
  | 'sleeping'
  | 'awakening'
  | 'interrupting'
  | 'away'
  | 'returning'
  | 'serious';

export type PresenceActivity = 'idle' | 'watching' | 'thinking' | 'resting' | 'sleeping' | 'away' | 'occupied' | 'waiting' | 'returning';
export type PresenceUserActivity = 'engaged' | 'idle' | 'away';
export type PresenceAttention = 'ignore' | 'observe' | 'interrupt' | 'greet' | 'resume_previous_context';
export type PresenceOpportunity = 'user_returned' | 'long_idle' | 'challenge_waiting' | 'user_stalled' | 'major_success' | 'major_failure' | 'new_session' | 'serious_context' | 'unusual_event';
export type AmbientEventType = 'ambient_observation' | 'ambient_comment' | 'unexpected_wake' | 'sleep_start' | 'sleep_end' | 'return_greeting' | 'idle_reaction' | 'session_reentry' | 'rare_character_event';
export type PresenceInteraction = 'touch' | 'tap' | 'poke' | 'wake' | 'interrupt' | 'user_roast' | 'user_challenge';
export type PresenceReason = 'serious_context' | 'challenge_critical' | 'user_returned' | 'long_absence' | 'long_idle' | 'user_stalled' | 'unusual_event' | 'cooldown' | 'no_worthy_event';

/** Reserved for a future verified information adapter. Never browser-provided. */
export interface VerifiedExternalContext {
  source: string;
  timestamp: string;
  summary: string;
}

export interface AmbientEventRecord {
  type: AmbientEventType;
  occurredAt: string;
}

export interface PresenceInput {
  currentTimeIso: string;
  state: PresenceState;
  sessionStartedAt: string;
  lastUserInteractionAt: string;
  lastRivalActionAt?: string | null;
  lastAmbientEventAt?: string | null;
  userActivity: PresenceUserActivity;
  relationship: RelationshipState;
  activeChallenge?: Challenge | null;
  seriousness?: number;
  opportunity?: PresenceOpportunity | null;
  sourceEventIds?: readonly string[];
  recentAmbientEvents?: readonly AmbientEventRecord[];
  externalContext?: VerifiedExternalContext | null;
}

export interface PresenceDecision {
  state: PresenceState;
  activity: PresenceActivity;
  attention: PresenceAttention;
  action: AmbientEventType | null;
  reason: PresenceReason;
  sourceEventIds: string[];
  generatedAt: string;
  externalContext?: VerifiedExternalContext | null;
}

export type PresenceAnimationHint = 'still' | 'watching' | 'thinking' | 'waiting' | 'resting' | 'sleeping' | 'awakening' | 'departing' | 'returning' | 'serious';

/** The typed boundary between deterministic presence and the lightweight UI. */
export interface PresenceVisualState {
  state: PresenceState;
  activity: PresenceActivity;
  attention: PresenceAttention;
  intensity: 1 | 2 | 3;
  animationHint: PresenceAnimationHint;
  canInteract: boolean;
  reason: PresenceReason;
}

export const PRESENCE_TIMING = {
  IDLE_MS: 2 * 60 * 1000,
  OBSERVE_MS: 6 * 60 * 1000,
  BORED_MS: 12 * 60 * 1000,
  REST_MS: 20 * 60 * 1000,
  SLEEP_MS: 30 * 60 * 1000,
  AWAY_MS: 30 * 60 * 1000,
  AMBIENT_COOLDOWN_MS: 20 * 60 * 1000,
  MAX_SESSION_AMBIENT_EVENTS: 1,
} as const;

const challengeCriticalStatuses = new Set(['evidence_submitted', 'needs_more_evidence']);

function elapsedMs(from: string, to: string): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function isCoolingDown(input: PresenceInput, type: AmbientEventType): boolean {
  return (input.recentAmbientEvents || []).some((event) =>
    event.type === type && elapsedMs(event.occurredAt, input.currentTimeIso) < PRESENCE_TIMING.AMBIENT_COOLDOWN_MS,
  );
}

function exceedsAmbientBudget(input: PresenceInput): boolean {
  const sessionStarted = new Date(input.sessionStartedAt).getTime();
  if (!Number.isFinite(sessionStarted)) return false;
  return (input.recentAmbientEvents || []).filter((event) => new Date(event.occurredAt).getTime() >= sessionStarted).length >= PRESENCE_TIMING.MAX_SESSION_AMBIENT_EVENTS;
}

function mayEmit(input: PresenceInput, type: AmbientEventType): boolean {
  return !isCoolingDown(input, type) && !exceedsAmbientBudget(input);
}

function decision(input: PresenceInput, state: PresenceState, activity: PresenceActivity, attention: PresenceAttention, action: AmbientEventType | null, reason: PresenceReason): PresenceDecision {
  return {
    state,
    activity,
    attention,
    action,
    reason,
    sourceEventIds: [...(input.sourceEventIds || [])],
    generatedAt: input.currentTimeIso,
    externalContext: input.externalContext || null,
  };
}

export function toPresenceVisualState(decision: PresenceDecision): PresenceVisualState {
  const map: Record<PresenceState, Pick<PresenceVisualState, 'animationHint' | 'intensity'>> = {
    active: { animationHint: decision.activity === 'thinking' ? 'thinking' : 'watching', intensity: 1 },
    idle: { animationHint: 'still', intensity: 1 },
    observing: { animationHint: 'watching', intensity: 2 },
    bored: { animationHint: 'waiting', intensity: 1 },
    resting: { animationHint: 'resting', intensity: 1 },
    sleeping: { animationHint: 'sleeping', intensity: 1 },
    awakening: { animationHint: 'awakening', intensity: 2 },
    interrupting: { animationHint: 'watching', intensity: 3 },
    away: { animationHint: 'departing', intensity: 1 },
    returning: { animationHint: 'returning', intensity: 2 },
    serious: { animationHint: 'serious', intensity: 2 },
  };
  const visual = map[decision.state];
  return { ...visual, state: decision.state, activity: decision.activity, attention: decision.attention, canInteract: decision.state === 'sleeping' || decision.state === 'resting', reason: decision.reason };
}

/**
 * Pure presence resolver. It never renders prose, persists state, schedules
 * work, or calls an AI provider. Null actions are the normal silent outcome.
 */
export function resolvePresence(input: PresenceInput): PresenceDecision {
  const idleElapsed = elapsedMs(input.lastUserInteractionAt, input.currentTimeIso);
  const serious = (input.seriousness || 0) >= 7 || input.opportunity === 'serious_context';
  const criticalChallenge = !!input.activeChallenge && challengeCriticalStatuses.has(input.activeChallenge.status);

  if (serious) return decision(input, 'serious', 'watching', 'ignore', null, 'serious_context');
  if (criticalChallenge) return decision(input, 'active', 'watching', 'ignore', null, 'challenge_critical');

  if (input.state === 'sleeping' && input.userActivity === 'engaged') {
    const action = mayEmit(input, 'sleep_end') ? 'sleep_end' : null;
    return decision(input, 'awakening', 'thinking', action ? 'greet' : 'ignore', action, action ? 'user_returned' : 'cooldown');
  }
  if (input.state === 'awakening') return decision(input, 'active', 'watching', 'ignore', null, 'no_worthy_event');

  if (input.state === 'away' && input.userActivity === 'engaged') {
    if (idleElapsed < PRESENCE_TIMING.AWAY_MS) return decision(input, 'active', 'watching', 'ignore', null, 'no_worthy_event');
    const action = mayEmit(input, 'return_greeting') ? 'return_greeting' : null;
    return decision(input, 'returning', 'returning', action ? 'greet' : 'ignore', action, action ? 'user_returned' : 'cooldown');
  }
  if (input.state === 'returning') return decision(input, 'active', 'watching', 'resume_previous_context', null, 'no_worthy_event');

  if (input.userActivity === 'away' && idleElapsed >= PRESENCE_TIMING.AWAY_MS) {
    return decision(input, 'away', 'away', 'ignore', null, 'long_absence');
  }
  if (input.opportunity === 'unusual_event' && input.relationship.familiarity >= 60) {
    const action = mayEmit(input, 'rare_character_event') ? 'rare_character_event' : null;
    return decision(input, 'active', 'occupied', action ? 'observe' : 'ignore', action, action ? 'unusual_event' : 'cooldown');
  }
  if (input.userActivity === 'engaged') return decision(input, 'active', 'watching', 'ignore', null, 'no_worthy_event');

  if (idleElapsed >= PRESENCE_TIMING.SLEEP_MS) {
    const action = mayEmit(input, 'sleep_start') ? 'sleep_start' : null;
    return decision(input, 'sleeping', 'sleeping', 'ignore', action, action ? 'long_idle' : 'cooldown');
  }
  if (idleElapsed >= PRESENCE_TIMING.REST_MS) return decision(input, 'resting', 'resting', 'ignore', null, 'long_idle');
  if (idleElapsed >= PRESENCE_TIMING.BORED_MS) return decision(input, 'bored', 'waiting', 'observe', null, 'long_idle');
  if (idleElapsed >= PRESENCE_TIMING.OBSERVE_MS) {
    const shouldInterrupt = input.opportunity === 'user_stalled' && input.relationship.familiarity >= 35 && input.relationship.trust >= 30;
    const action = shouldInterrupt && mayEmit(input, 'idle_reaction') ? 'idle_reaction' : null;
    return decision(input, 'observing', 'watching', action ? 'interrupt' : 'observe', action, action ? 'user_stalled' : 'no_worthy_event');
  }
  if (idleElapsed >= PRESENCE_TIMING.IDLE_MS) return decision(input, 'idle', 'idle', 'observe', null, 'no_worthy_event');
  return decision(input, 'active', 'watching', 'ignore', null, 'no_worthy_event');
}
