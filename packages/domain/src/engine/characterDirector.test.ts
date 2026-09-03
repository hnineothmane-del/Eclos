import { describe, expect, it } from 'vitest';
import { deriveCharacterPlan } from './characterDirector.js';
import type { CharacterDirectorInput } from './characterDirector.js';
import { deriveRivalRelationshipContext } from './rivalRelationshipContext.js';

const relationship = { userId: 'u', respect: 55, warmth: 45, trust: 60, rivalry: 72, familiarity: 65, curiosity: 55, mode: 'permanent_rival' as const, updatedAt: '2026-01-01T00:00:00Z' };
const base: CharacterDirectorInput = { userInput: 'hello', relationship, activeChallenge: null, memories: [], processInsights: [], recentHumor: [] };
const challenge = { id: 'c', userId: 'u', goalId: null, domain: 'general', objective: 'Prove it', difficulty: 5, constraints: [], expectedDurationMinutes: null, verificationLevel: 'self_report' as const, hypothesis: null, status: 'issued' as const, evidenceRound: 0, createdAt: 'x', updatedAt: 'x' };

describe('character director', () => {
  it.each([
    ['ordinary banter', { ...base }, 'smug', 'banter'],
    ['vulnerability', { ...base, userInput: 'I feel hopeless' }, 'serious', 'serious_intervention'],
    ['user troll', { ...base, userInput: 'you suck' }, 'amused', 'pushback'],
    ['quiet turn', { ...base, userInput: 'ok' }, 'smug', 'quiet'],
  ])('chooses %s deterministically', (_name, input, mood, interaction) => {
    const plan = deriveCharacterPlan(input as CharacterDirectorInput);
    expect(plan.state.mood).toBe(mood);
    expect(plan.interactionMode).toBe(interaction);
    expect(plan).toEqual(deriveCharacterPlan(input as CharacterDirectorInput));
  });

  it('uses a grounded process insight and preserves its event chain', () => {
    const plan = deriveCharacterPlan({ ...base, userInput: 'I am thinking', processInsights: [{ type: 'initialization_delay', challengeId: 'c', sourceEventIds: ['start', 'signal'], description: 'delay', confidence: 0.9 }] });
    expect(plan.interactionMode).toBe('observation');
    expect(plan.humor).toMatchObject({ mechanism: 'observational', target: 'process_insight', sourceEventIds: ['start', 'signal'] });
  });

  it('suppresses humor for vulnerability and sincere recovery', () => {
    expect(deriveCharacterPlan({ ...base, userInput: 'I am scared' }).humor).toBeNull();
    const plan = deriveCharacterPlan({ ...base, userInput: 'I finally did it', processInsights: [{ type: 'persistence_after_failure', challengeId: 'c', sourceEventIds: ['a', 'b'], description: 'recovered', confidence: 0.9 }] });
    expect(plan).toMatchObject({ interactionMode: 'sincere_recognition', sincerity: true, humor: null });
  });

  it('uses callbacks only with familiarity and respects mechanism cooldowns', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    expect(deriveCharacterPlan({ ...base, memories: [memory] }).humor?.mechanism).toBe('callback');
    expect(deriveCharacterPlan({ ...base, memories: [memory], recentHumor: ['callback'] }).humor).toBeNull();
  });

  it('permits meta humor only when context calls for it and it is not recent', () => {
    expect(deriveCharacterPlan({ ...base, userInput: 'this app is judging me' }).humor).toMatchObject({ mechanism: 'self_aware', target: 'system' });
    expect(deriveCharacterPlan({ ...base, userInput: 'this app is judging me', recentHumor: ['self_aware'] }).humor).toBeNull();
  });

  it.each([
    ['issued challenge', { ...base, activeChallenge: challenge }, 'challenge_invitation'],
    ['submitted evidence', { ...base, activeChallenge: { ...challenge, status: 'evidence_submitted' as const } }, 'challenge_response'],
    ['direct question', { ...base, userInput: 'what do you think?' }, 'question'],
  ])('selects the appropriate interaction scene for %s', (_name, input, interaction) => {
    expect(deriveCharacterPlan(input as CharacterDirectorInput).interactionMode).toBe(interaction);
  });

  it('does not use a callback before enough familiarity exists', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const plan = deriveCharacterPlan({ ...base, relationship: { ...relationship, familiarity: 20 }, memories: [memory] });
    expect(plan.humor).toBeNull();
  });

  it('uses relationship depth as a callback and sincerity permission rather than a new score', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const introductory = { ...relationship, familiarity: 20, trust: 20, respect: 20, warmth: 10 };
    expect(deriveCharacterPlan({ ...base, relationship: introductory, relationshipContext: deriveRivalRelationshipContext(introductory), memories: [memory] }).humor).toBeNull();
    const trusted = { ...relationship, familiarity: 70, trust: 70, respect: 70, warmth: 55 };
    const recognition = deriveCharacterPlan({ ...base, relationship: trusted, relationshipContext: deriveRivalRelationshipContext(trusted), userInput: 'I finally did it', processInsights: [{ type: 'persistence_after_failure', challengeId: 'c', sourceEventIds: ['a'], description: 'recovered', confidence: 0.9 }] });
    expect(recognition).toMatchObject({ interactionMode: 'sincere_recognition', sincerity: true });
  });
});
