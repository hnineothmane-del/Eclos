import { describe, expect, it } from 'vitest';
import { deriveAgencyDecision, type AgencyInput, AGENCY_PRIORITIES } from './rivalAgency.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { CharacterPlan } from './characterDirector.js';
import type { SelectedMemory } from './rivalMemorySelector.js';
import type { SelectedInsight } from './rivalInsightSelector.js';
import type { RelationshipState } from '../types/relationship.js';
import type { DomainEvent } from '../types/events.js';
import { deriveRivalRelationshipContext } from './rivalRelationshipContext.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-02-01T00:00:00Z';

const baseRelationship: RelationshipState = {
  userId: 'u1',
  respect: 50,
  warmth: 50,
  trust: 50,
  rivalry: 50,
  familiarity: 60,
  curiosity: 50,
  mode: 'adaptive',
  updatedAt: NOW,
};

const baseCharacterPlan: CharacterPlan = {
  state: {
    mood: 'amused',
    seriousness: 3,
    intensity: 5,
    curiosity: 5,
  },
  interactionMode: 'observation',
  sincerity: false,
  target: 'current_behavior',
  humor: null,
};

const basePresence: PresenceDecision = {
  state: 'active',
  activity: 'watching',
  attention: 'ignore',
  action: null,
  reason: 'no_worthy_event',
  sourceEventIds: [],
  generatedAt: NOW,
};

const baseInput: AgencyInput = {
  allEvents: [],
  userInput: '',
  activeChallenge: null,
  presence: basePresence,
  relationship: baseRelationship,
  characterPlan: baseCharacterPlan,
  selectedMemory: null,
  selectedInsight: null,
  processInsights: [],
  recentInitiatives: [],
  nowIso: NOW,
};

function mkInitiativeEvent(category: string, time: string): DomainEvent {
  return {
    id: `ev-${category}-${time}`,
    userId: 'u1',
    eventType: 'agency_initiative',
    source: 'system',
    payload: { category },
    createdAt: time,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RivalAgency', () => {
  it('defaults to QUIET when there is no worthy initiative', () => {
    const dec = deriveAgencyDecision(baseInput);
    expect(dec.action).toBe('QUIET');
    expect(dec.priority).toBe(AGENCY_PRIORITIES.QUIET);
  });

  it('translates presence return_greeting to RETURN_REMARK', () => {
    const presence = { ...basePresence, action: 'return_greeting' as const };
    const dec = deriveAgencyDecision({ ...baseInput, presence });
    expect(dec.action).toBe('RETURN_REMARK');
    expect(dec.priority).toBe(AGENCY_PRIORITIES.RETURN_WAKE);
  });

  it('suppresses ordinary agency and enforces QUIET in a serious context', () => {
    const presence = { ...basePresence, action: 'return_greeting' as const };
    const characterPlan = { ...baseCharacterPlan, state: { ...baseCharacterPlan.state, seriousness: 8 } };
    const dec = deriveAgencyDecision({ ...baseInput, presence, characterPlan });
    expect(dec.action).toBe('QUIET');
    // Priority should be high to suppress other things
    expect(dec.priority).toBe(AGENCY_PRIORITIES.SERIOUS_INTERVENTION);
  });

  it('suppresses interruptions if challenge is critical (evidence submitted)', () => {
    const presence = { ...basePresence, action: 'idle_reaction' as const };
    const dec = deriveAgencyDecision({ 
      ...baseInput, 
      presence, 
      activeChallenge: { id: 'c1', status: 'evidence_submitted' } as any 
    });
    expect(dec.action).toBe('QUIET');
    expect(dec.priority).toBe(AGENCY_PRIORITIES.CHALLENGE_CRITICAL);
  });

  it('emits USER_ROAST_RESPONSE if user inputs a roast', () => {
    const dec = deriveAgencyDecision({ ...baseInput, userInput: 'you are a stupid bot' });
    expect(dec.action).toBe('USER_ROAST_RESPONSE');
    expect(dec.priority).toBe(AGENCY_PRIORITIES.USER_INTERACTION);
  });

  it('prioritizes high-value insights over boredom', () => {
    const presence = { ...basePresence, state: 'bored' as const };
    const insight: SelectedInsight = {
      insight: { key: 'i1', family: 'repeated_strategy_switch', description: '', evidenceCount: 3, confidence: 0.8, temporalPattern: 'recurring', epistemicStatus: 'derived', firstObservedAt: NOW, lastObservedAt: NOW, provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: NOW } },
      score: 40,
      reason: 'high score',
    };
    const dec = deriveAgencyDecision({ ...baseInput, presence, selectedInsight: insight });
    // CALLBACK_INTERRUPTION has priority 50, BOREDOM_IDLE is 30
    expect(dec.action).toBe('CALLBACK_INTERRUPTION');
  });

  it('cooldown prevents repeated UNRESOLVED_FOLLOWUP', () => {
    const memory: SelectedMemory = {
      memory: { key: 'm1', type: 'unresolved', epistemicStatus: 'observed', description: '', verbatimQuote: null, confidence: 0.8, strength: 1, provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: NOW } },
      score: 80,
      reason: 'unresolved',
    };
    // First turn: emits
    const dec1 = deriveAgencyDecision({ ...baseInput, selectedMemory: memory });
    expect(dec1.action).toBe('UNRESOLVED_FOLLOWUP');

    // Second turn within cooldown window: suppressed
    const recentInitiatives = [mkInitiativeEvent('UNRESOLVED_FOLLOWUP', NOW)];
    const dec2 = deriveAgencyDecision({ ...baseInput, selectedMemory: memory, recentInitiatives });
    expect(dec2.action).toBe('QUIET');
  });

  it('emits a rare character event when authorized by presence', () => {
    const presence = { ...basePresence, action: 'rare_character_event' as const };
    const dec = deriveAgencyDecision({ ...baseInput, presence });
    const expected = ['RARE_CHARACTER_EVENT', 'FICTIONAL_INTERRUPTION', 'SELF_AMUSEMENT', 'ABORTED_THOUGHT'];
    expect(expected).toContain(dec.action);
    expect(dec.priority).toBe(AGENCY_PRIORITIES.RARE_EVENT);
  });

  it('selects ambient life categories from state and known lore without randomness', () => {
    const boredPresence = { ...basePresence, state: 'bored' as const, activity: 'waiting' as const, action: 'rare_character_event' as const };
    expect(deriveAgencyDecision({ ...baseInput, presence: boredPresence })).toMatchObject({ action: 'SELF_AMUSEMENT' });
    const occupiedPresence = { ...basePresence, activity: 'occupied' as const, action: 'rare_character_event' as const };
    const loreEvent = { id: 'lore-1', userId: 'u1', eventType: 'rival_lore_revealed' as const, source: 'system' as const, payload: { loreId: 'cosmic_phone' }, createdAt: '2026-01-01T00:00:00Z' };
    expect(deriveAgencyDecision({ ...baseInput, presence: occupiedPresence, allEvents: [loreEvent] })).toMatchObject({ action: 'FICTIONAL_INTERRUPTION' });
  });

  it('suppresses repeat ambient life moments with global and category cooldowns', () => {
    const presence = { ...basePresence, state: 'bored' as const, action: 'rare_character_event' as const };
    expect(deriveAgencyDecision({ ...baseInput, presence, recentInitiatives: [mkInitiativeEvent('SELF_AMUSEMENT', NOW)] })).toMatchObject({ action: 'QUIET' });
  });

  it('keeps old callback interruptions unavailable before the relationship is familiar', () => {
    const memory: SelectedMemory = {
      memory: { key: 'm1', type: 'callback', epistemicStatus: 'observed', description: '', verbatimQuote: null, confidence: 0.9, strength: 10, provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: NOW } },
      score: 90, reason: 'callback',
    };
    const introductory = { ...baseRelationship, familiarity: 15, trust: 15, warmth: 10, respect: 20 };
    expect(deriveAgencyDecision({ ...baseInput, relationship: introductory, relationshipContext: deriveRivalRelationshipContext(introductory), selectedMemory: memory })).toMatchObject({ action: 'QUIET' });
  });

  it('deterministically sorts candidates by priority', () => {
    // Both user roast (priority 70) and return greeting (priority 80)
    const presence = { ...basePresence, action: 'return_greeting' as const };
    const dec = deriveAgencyDecision({ ...baseInput, presence, userInput: 'idiot' });
    // Deliberate user interaction (85) > passive return/wake (80)
    expect(dec.action).toBe('USER_ROAST_RESPONSE');
  });

  it('routes interaction hooks correctly', () => {
    const dec = deriveAgencyDecision({ ...baseInput, interactionHook: 'poke' });
    expect(dec.action).toBe('USER_INTERACTION_REACTION');
    expect(dec.requestedInteractionMode).toBe('pushback');
  });
});
