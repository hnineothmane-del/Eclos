import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RivalEasterEggDecision } from './rivalEasterEgg.js';
import type { RivalLivingState } from './rivalLivingState.js';
import type { RivalRelationshipContext } from './rivalRelationshipContext.js';

export type RivalLoreCategory = 'habit' | 'possession' | 'origin_hint' | 'preference' | 'fictional_life' | 'running_bit';
export type LoreRevealLevel = 'hint' | 'known';

export interface RivalLoreFact {
  id: 'strategic_naps' | 'cosmic_phone' | 'roasteria_reference' | 'mug_of_unknown_contents' | 'classified_business';
  category: RivalLoreCategory;
  statement: string;
  minimumFamiliarity: number;
}

export interface RivalLoreDecision {
  fact: RivalLoreFact | null;
  revealLevel: LoreRevealLevel | null;
  newlyRevealed: boolean;
  sourceEventIds: string[];
  reason: string;
}

export interface RivalLoreInput {
  nowIso: string;
  userInput: string;
  relationship: RelationshipState;
  livingState: RivalLivingState;
  activeChallenge: Challenge | null;
  serious: boolean;
  easterEgg: RivalEasterEggDecision | null;
  events: readonly DomainEvent[];
  relationshipContext?: RivalRelationshipContext;
}

export const RIVAL_LORE_FACTS: readonly RivalLoreFact[] = [
  { id: 'strategic_naps', category: 'habit', statement: 'The Rival insists his naps are strategic.', minimumFamiliarity: 35 },
  { id: 'cosmic_phone', category: 'possession', statement: 'The Rival claims to own a cosmic phone and refuses to explain its service plan.', minimumFamiliarity: 55 },
  { id: 'roasteria_reference', category: 'origin_hint', statement: 'The Rival sometimes references “Roasteria,” then denies it is a place.', minimumFamiliarity: 45 },
  { id: 'mug_of_unknown_contents', category: 'preference', statement: 'The Rival is oddly protective of a mug whose contents remain unspecified.', minimumFamiliarity: 50 },
  { id: 'classified_business', category: 'fictional_life', statement: 'The Rival occasionally claims to have classified business, without evidence.', minimumFamiliarity: 60 },
];

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// Lore is ambient character context. It must never compete with work already
// underway; an issued/negotiated challenge remains conversational.
const WORK_IN_PROGRESS = new Set<Challenge['status']>(['accepted', 'started', 'attempted', 'evidence_submitted', 'needs_more_evidence']);

function elapsedMs(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
}

function reveals(events: readonly DomainEvent[], id: RivalLoreFact['id']): DomainEvent[] {
  return events.filter((event) => event.eventType === 'rival_lore_revealed' && (event.payload as { loreId?: unknown }).loreId === id);
}

function mentions(input: string, terms: readonly string[]): boolean {
  const normalized = input.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

/** Selects one compact fictional detail. It never establishes facts about user reality. */
export function deriveRivalLore(input: RivalLoreInput): RivalLoreDecision {
  const none = (reason: string): RivalLoreDecision => ({ fact: null, revealLevel: null, newlyRevealed: false, sourceEventIds: [], reason });
  if (input.serious || (input.activeChallenge && WORK_IN_PROGRESS.has(input.activeChallenge.status))) return none('serious or active-work context suppresses lore');

  let fact: RivalLoreFact | undefined;
  if (input.easterEgg?.authorized) fact = RIVAL_LORE_FACTS.find((item) => item.id === 'cosmic_phone');
  else if (mentions(input.userInput, ['where are you from', 'where do you come from', 'roasteria'])) fact = RIVAL_LORE_FACTS.find((item) => item.id === 'roasteria_reference');
  else if (input.livingState.internalState === 'resting' || input.livingState.internalState === 'sleeping') fact = RIVAL_LORE_FACTS.find((item) => item.id === 'strategic_naps');
  else if (input.livingState.internalState === 'occupied' && mentions(input.userInput, ['what are you doing', 'busy', 'doing'])) fact = RIVAL_LORE_FACTS.find((item) => item.id === 'classified_business');
  else if (mentions(input.userInput, ['what is that', 'your mug', 'drink'])) fact = RIVAL_LORE_FACTS.find((item) => item.id === 'mug_of_unknown_contents');
  if (!fact) return none('no contextually relevant lore');
  if (input.relationship.familiarity < fact.minimumFamiliarity) return none('relationship familiarity is too low');
  if (fact.id === 'classified_business' && (input.relationshipContext?.disclosurePermission ?? 10) < 6) {
    return none('relationship depth does not permit deeper fictional disclosure');
  }

  const prior = reveals(input.events, fact.id);
  const latest = prior.at(-1);
  if (latest && elapsedMs(latest.createdAt, input.nowIso) < COOLDOWN_MS) return none('lore cooldown active');
  const level: LoreRevealLevel = prior.length === 0 ? 'hint' : 'known';
  return {
    fact,
    revealLevel: level,
    newlyRevealed: prior.length === 0,
    sourceEventIds: [...(input.easterEgg?.sourceEventIds || []), ...prior.slice(-1).map((event) => event.id)],
    reason: prior.length === 0 ? 'first contextually appropriate lore hint' : 'relevant known lore callback after cooldown',
  };
}
