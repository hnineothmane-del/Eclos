import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RivalInteractionHook, RivalLivingState } from './rivalLivingState.js';

export type RivalEasterEggId = 'caught_occupied';

export interface RivalEasterEggDecision {
  id: RivalEasterEggId | null;
  authorized: boolean;
  speechAuthorized: boolean;
  visualCue: 'caught' | null;
  sourceEventIds: string[];
  reason: string;
}

export interface RivalEasterEggInput {
  nowIso: string;
  interaction: RivalInteractionHook | null;
  relationship: RelationshipState;
  livingState: RivalLivingState;
  activeChallenge: Challenge | null;
  serious: boolean;
  events: readonly DomainEvent[];
}

const ELIGIBLE_INTERACTIONS = new Set<RivalInteractionHook>(['tap', 'poke', 'wake']);
const ELIGIBLE_STATES = new Set<RivalLivingState['internalState']>(['observing', 'bored', 'resting', 'occupied']);
const MIN_FAMILIARITY = 55;
const MIN_PRIOR_INTERACTIONS = 3;
const MIN_SPAN_MS = 10 * 60 * 1000;

function elapsedMs(from: string, to: string): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function interactionEvents(events: readonly DomainEvent[]): DomainEvent[] {
  return events.filter((event) => (event.eventType as string) === 'rival_interaction');
}

/** One non-random, one-time secret: catch an established Rival while occupied. */
export function deriveRivalEasterEgg(input: RivalEasterEggInput): RivalEasterEggDecision {
  const none = (reason: string): RivalEasterEggDecision => ({ id: null, authorized: false, speechAuthorized: false, visualCue: null, sourceEventIds: [], reason });
  if (!input.interaction || !ELIGIBLE_INTERACTIONS.has(input.interaction)) return none('interaction is not eligible');
  if (input.serious || input.activeChallenge?.status === 'evidence_submitted' || input.activeChallenge?.status === 'needs_more_evidence') return none('critical context suppresses secret');
  if (!ELIGIBLE_STATES.has(input.livingState.internalState)) return none('Rival is not in an eligible living state');
  if (input.relationship.familiarity < MIN_FAMILIARITY) return none('insufficient familiarity');
  if (input.events.some((event) => event.eventType === 'rival_easter_egg_discovered' && (event.payload as { id?: unknown }).id === 'caught_occupied')) return none('secret already discovered');

  const prior = interactionEvents(input.events).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (prior.length < MIN_PRIOR_INTERACTIONS) return none('insufficient interaction history');
  if (elapsedMs(prior[0].createdAt, input.nowIso) < MIN_SPAN_MS) return none('interaction history is not meaningfully spaced');

  return {
    id: 'caught_occupied',
    authorized: true,
    speechAuthorized: true,
    visualCue: 'caught',
    sourceEventIds: prior.slice(-MIN_PRIOR_INTERACTIONS).map((event) => event.id),
    reason: 'Established user caught the Rival during an eligible quiet living state.',
  };
}
