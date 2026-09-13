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
    // When callback is recent, the Rival uses a fallback mechanism rather than repeating the callback
    const afterCooldown = deriveCharacterPlan({ ...base, memories: [memory], recentHumor: ['callback'] });
    expect(afterCooldown.humor?.mechanism).not.toBe('callback');
  });

  it('permits meta humor only when context calls for it and it is not recent', () => {
    expect(deriveCharacterPlan({ ...base, userInput: 'this app is judging me' }).humor).toMatchObject({ mechanism: 'self_aware', target: 'system' });
    // When self_aware is recent, the Rival uses a different mechanism — not necessarily null
    const afterCooldown = deriveCharacterPlan({ ...base, userInput: 'this app is judging me', recentHumor: ['self_aware'] });
    expect(afterCooldown.humor?.mechanism).not.toBe('self_aware');
  });

  it('does not use a callback before enough familiarity exists', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const plan = deriveCharacterPlan({ ...base, relationship: { ...relationship, familiarity: 20 }, memories: [memory] });
    // No callback before familiarity — but the Rival may still choose a different humor mechanism
    expect(plan.humor?.mechanism).not.toBe('callback');
  });

  it('uses relationship depth as a callback and sincerity permission rather than a new score', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const introductory = { ...relationship, familiarity: 20, trust: 20, respect: 20, warmth: 10 };
    // In an introductory phase, callbacks are blocked — but fallback humor may still fire
    const plan = deriveCharacterPlan({ ...base, relationship: introductory, relationshipContext: deriveRivalRelationshipContext(introductory), memories: [memory] });
    expect(plan.humor?.mechanism).not.toBe('callback');
    const trusted = { ...relationship, familiarity: 70, trust: 70, respect: 70, warmth: 55 };
    const recognition = deriveCharacterPlan({ ...base, relationship: trusted, relationshipContext: deriveRivalRelationshipContext(trusted), userInput: 'I finally did it', processInsights: [{ type: 'persistence_after_failure', challengeId: 'c', sourceEventIds: ['a'], description: 'recovered', confidence: 0.9 }] });
    expect(recognition).toMatchObject({ interactionMode: 'sincere_recognition', sincerity: true });
  });

  it.each([
    // Active challenge does NOT auto-hijack the mode (Character-First Hierarchy, Tweak #2/#3)
    // The Rival responds with banter unless the user explicitly states a goal.
    ['issued challenge', { ...base, activeChallenge: challenge }, 'banter'],
    ['submitted evidence', { ...base, activeChallenge: { ...challenge, status: 'evidence_submitted' as const } }, 'challenge_response'],
    ['direct question', { ...base, userInput: 'what do you think?' }, 'question'],
    ['greeting', { ...base, userInput: 'hello' }, 'banter'],
    ['boredom', { ...base, userInput: "I'm bored." }, 'banter'],
    ['question about self', { ...base, userInput: 'What do you think about me?' }, 'question'],
    ['strange person comment', { ...base, userInput: "I'm a strange person." }, 'banter'],
    ['achievement report', { ...base, userInput: 'I finally finished something' }, 'banter'],
    ['casual want statement', { ...base, userInput: 'I want to sleep' }, 'banter'],
    ['roast request', { ...base, userInput: 'roast me' }, 'banter'],
    ['genuine goal statement', { ...base, userInput: 'I want to get better at coding' }, 'challenge_invitation'],
  ])('selects the appropriate interaction scene for %s', (_name, input, interaction) => {
    expect(deriveCharacterPlan(input as CharacterDirectorInput).interactionMode).toBe(interaction);
  });

  it('does not use a callback before enough familiarity exists', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const plan = deriveCharacterPlan({ ...base, relationship: { ...relationship, familiarity: 20 }, memories: [memory] });
    // Callback is blocked before sufficient familiarity — but fallback humor may still fire
    expect(plan.humor?.mechanism).not.toBe('callback');
  });

  it('uses relationship depth as a callback and sincerity permission rather than a new score', () => {
    const memory = { score: 9, item: { id: 'm', userId: 'u', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'alarm', strength: 90, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    const introductory = { ...relationship, familiarity: 20, trust: 20, respect: 20, warmth: 10 };
    // Callbacks blocked in introductory phase — fallback humor may still fire
    expect(deriveCharacterPlan({ ...base, relationship: introductory, relationshipContext: deriveRivalRelationshipContext(introductory), memories: [memory] }).humor?.mechanism).not.toBe('callback');
    const trusted = { ...relationship, familiarity: 70, trust: 70, respect: 70, warmth: 55 };
    const recognition = deriveCharacterPlan({ ...base, relationship: trusted, relationshipContext: deriveRivalRelationshipContext(trusted), userInput: 'I finally did it', processInsights: [{ type: 'persistence_after_failure', challengeId: 'c', sourceEventIds: ['a'], description: 'recovered', confidence: 0.9 }] });
    expect(recognition).toMatchObject({ interactionMode: 'sincere_recognition', sincerity: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tweak #5 — Humor & Cultural Voice
  // ─────────────────────────────────────────────────────────────────────────

  it('Tweak #5: smug mood now triggers fallback humor (high rivalry, no specific condition)', () => {
    // High rivalry → smug mood. Previously smug was not in the fallback trigger.
    const smugRelationship = { ...relationship, rivalry: 80, familiarity: 50 };
    const plan = deriveCharacterPlan({ ...base, userInput: 'hello', relationship: smugRelationship });
    expect(plan.state.mood).toBe('smug');
    // smug is now in the fallback — should get humor
    expect(plan.humor).not.toBeNull();
    expect(plan.humor?.target).toBe('user_statement');
  });

  it('Tweak #5: mock_formal is in the fallback palette and selected when wit is recent', () => {
    // With 'wit' already used, the next fresh mechanism in the new palette is mock_formal
    const plan = deriveCharacterPlan({ ...base, userInput: 'hello', recentHumor: ['wit'] });
    expect(plan.humor?.mechanism).toBe('mock_formal');
  });

  it('Tweak #5: fallback humor cycle covers wit → mock_formal → observational → deadpan → sarcasm → absurd_escalation', () => {
    const all = ['wit', 'mock_formal', 'observational', 'deadpan', 'sarcasm', 'absurd_escalation'];
    for (let i = 0; i < all.length; i++) {
      const usedSoFar = all.slice(0, i);
      const plan = deriveCharacterPlan({ ...base, userInput: 'hello', recentHumor: usedSoFar });
      expect(plan.humor?.mechanism).toBe(all[i]);
    }
  });

  it('Tweak #5: all fallback mechanisms rotate properly — no humor when all are recent', () => {
    const all = ['wit', 'mock_formal', 'observational', 'deadpan', 'sarcasm', 'absurd_escalation'];
    const plan = deriveCharacterPlan({ ...base, userInput: 'hello', recentHumor: all });
    // All exhausted — no humor selected from fallback
    expect(plan.humor).toBeNull();
  });

  it('Tweak #5: dark/serious context still suppresses all humor regardless of mood', () => {
    const plan = deriveCharacterPlan({ ...base, userInput: 'I want to die' });
    expect(plan.humor).toBeNull();
    expect(plan.state.seriousness).toBeGreaterThanOrEqual(7);
  });
});

