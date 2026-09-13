import { describe, expect, it, vi } from 'vitest';
import { ResponsePlanner } from './responsePlanner.js';
import { FakeAIProvider } from '../ai/fakeProvider.js';
import { deriveCharacterPlan } from './characterDirector.js';
import { deriveProcessInsights } from './processInsights.js';
import { computeNextDifficulty } from '../challenge/difficulty.js';
import { selectChallengePrimitive } from '../challenge/challengeSelector.js';
import { validateTransition } from '../challenge/lifecycle.js';
import { computeRespectEvent } from './respectEngine.js';
import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';
import type { RelationshipState } from '../types/relationship.js';

const relationship: RelationshipState = {
  userId: 'new-user', respect: 50, warmth: 45, trust: 60, rivalry: 70,
  familiarity: 50, curiosity: 55, mode: 'permanent_rival', updatedAt: '2026-01-01T00:00:00Z',
};

const challenge: Challenge = {
  id: 'challenge-1', userId: 'new-user', goalId: null, domain: 'coding', objective: 'Get better at coding',
  difficulty: 3, constraints: [], expectedDurationMinutes: 1, verificationLevel: 'self_report',
  hypothesis: null, status: 'started', evidenceRound: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function event(id: string, eventType: DomainEvent['eventType'], createdAt: string, payload: Record<string, unknown> = {}): DomainEvent {
  return { id, userId: 'new-user', eventType, createdAt, payload: { challenge_id: challenge.id, ...payload }, source: eventType.startsWith('process_') ? 'user_action' : 'system' };
}

function plannerFor(events: DomainEvent[] = [], provider = new FakeAIProvider()) {
  const generate = vi.spyOn(provider, 'generate');
  const deps = {
    modelRouter: { forChat: () => provider },
    relationshipStore: { get: vi.fn().mockResolvedValue(relationship) },
    memoryStore: { retrieveRelevant: vi.fn().mockResolvedValue([]), write: vi.fn().mockResolvedValue({}) },
    humorStore: { recentMechanisms: vi.fn().mockResolvedValue([]), record: vi.fn() },
    eventStore: { recentForUser: vi.fn().mockResolvedValue(events) },
  };
  return { planner: new ResponsePlanner(deps as never), deps, provider, generate };
}

describe('Rival experience integration', () => {
  it('A/V: simulates the first-user loop with one generation and a low-friction coding test', async () => {
    const { planner, generate } = plannerFor();
    const firstTurn = await planner.planTurn({ userId: 'new-user', userInput: 'I want to get better at coding.' });
    expect(firstTurn!.challengeSelection).toMatchObject({ primitive: 'micro_test', expectedDurationMinutes: 1, domain: 'coding' });
    expect(generate).toHaveBeenCalledTimes(1);

    const processEvents = [
      event('started', 'challenge_started', '2026-01-01T00:00:00Z'),
      event('signal', 'process_signal', '2026-01-01T00:00:35Z', { signal: 'THINKING' }),
      event('thought', 'process_thought', '2026-01-01T00:00:40Z', { content: 'I know this' }),
      event('switch', 'process_signal', '2026-01-01T00:01:00Z', { signal: 'CHANGING APPROACH' }),
      event('judged', 'challenge_judged', '2026-01-01T00:02:00Z', { verdict: 'passed' }),
    ];
    const insights = deriveProcessInsights(challenge, processEvents);
    expect(insights.map((insight) => insight.type)).toEqual(expect.arrayContaining(['initialization_delay', 'strategy_switch', 'confidence_before_attempt']));
    expect(insights.every((insight) => insight.sourceEventIds.length > 0)).toBe(true);
    expect(computeRespectEvent({ type: 'challenge_completed', difficulty: 3, userBaselineDifficulty: 3, recentSameBandCompletions: 0 }).respect).toBeGreaterThan(0);
  });

  it('B: grounds observation humor in source events without inventing a trait', () => {
    const events = [
      event('start', 'challenge_started', '2026-01-01T00:00:00Z'),
      event('thinking', 'process_signal', '2026-01-01T00:00:35Z', { signal: 'THINKING' }),
      event('claim', 'process_thought', '2026-01-01T00:00:40Z', { content: 'I know this' }),
      event('stuck', 'process_signal', '2026-01-01T00:00:50Z', { signal: 'STUCK' }),
      event('switch', 'process_signal', '2026-01-01T00:01:00Z', { signal: 'CHANGING APPROACH' }),
      event('pass', 'challenge_judged', '2026-01-01T00:02:00Z', { verdict: 'passed' }),
    ];
    const insights = deriveProcessInsights(challenge, events);
    const plan = deriveCharacterPlan({ userInput: 'I finished', relationship, activeChallenge: challenge, memories: [], processInsights: insights, recentHumor: [] });
    expect(insights.map((insight) => insight.type)).toEqual(expect.arrayContaining(['stall_then_recovery', 'strategy_switch', 'confidence_before_attempt']));
    expect(plan.humor).toMatchObject({ target: 'process_insight', mechanism: 'observational' });
    expect(plan.humor?.sourceEventIds).toEqual(insights[0].sourceEventIds);
  });

  it('C/D/E: preserves effortful failure, lowers only repeated low-effort difficulty, and recognizes recovery', () => {
    const effortfulFailure = computeRespectEvent({ type: 'challenge_failed', effortSignal: 0.7, consecutiveLowEffortFailures: 0 });
    expect(effortfulFailure.respect).toBe(0);
    expect(computeNextDifficulty(7, [{ passed: false, effortSignal: 0.7, confidence: 0.8 }, { passed: false, effortSignal: 0.7, confidence: 0.8 }]).nextDifficulty).toBe(7);
    expect(computeNextDifficulty(7, [{ passed: false, effortSignal: 0.1, confidence: 0.8 }, { passed: false, effortSignal: 0.1, confidence: 0.8 }]).nextDifficulty).toBe(6);
    expect(computeNextDifficulty(5, [{ passed: true, effortSignal: 0.9, confidence: 0.95 }, { passed: true, effortSignal: 0.9, confidence: 0.95 }]).nextDifficulty).toBe(7);
    const recoveryPlan = deriveCharacterPlan({ userInput: 'I finally did it', relationship, memories: [], activeChallenge: null, recentHumor: [], processInsights: [{ type: 'persistence_after_failure', challengeId: challenge.id, sourceEventIds: ['f', 'p'], description: 'Recovered after failure.', confidence: 0.9 }] });
    expect(recoveryPlan).toMatchObject({ interactionMode: 'sincere_recognition', humor: null, sincerity: true });
  });

  it('F/G/H/L/M: handles trolling, serious disclosure, banter, no-humor, and cooldown without an extra generation', async () => {
    expect(deriveCharacterPlan({ userInput: 'you suck', relationship, memories: [], activeChallenge: null, processInsights: [], recentHumor: [] }).interactionMode).toBe('pushback');
    const serious = deriveCharacterPlan({ userInput: 'I feel hopeless after this setback', relationship, memories: [], activeChallenge: null, processInsights: [], recentHumor: [] });
    expect(serious).toMatchObject({ interactionMode: 'serious_intervention', humor: null });
    expect(deriveCharacterPlan({ userInput: 'tell me a joke', relationship, memories: [], activeChallenge: null, processInsights: [], recentHumor: [] }).interactionMode).toBe('banter');
    // Low-value input ('ok') → quiet mode → no humor regardless of mood
    expect(deriveCharacterPlan({ userInput: 'ok', relationship, memories: [], activeChallenge: null, processInsights: [], recentHumor: [] }).humor).toBeNull();
    const memory = { score: 10, item: { id: 'm', userId: 'new-user', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'missed alarm', strength: 80, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    expect(deriveCharacterPlan({ userInput: 'hello again', relationship, memories: [memory], activeChallenge: null, processInsights: [], recentHumor: [] }).humor?.mechanism).toBe('callback');
    // After callback cooldown, Rival uses a fallback mechanism — not the same callback again
    expect(deriveCharacterPlan({ userInput: 'hello again', relationship, memories: [memory], activeChallenge: null, processInsights: [], recentHumor: ['callback'] }).humor?.mechanism).not.toBe('callback');
    const { planner, generate } = plannerFor();
    await planner.planTurn({ userId: 'new-user', userInput: 'tell me a joke' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('I/J/N: uses history for callbacks and varies primitives only when grounded context changes', () => {
    const memory = { score: 10, item: { id: 'm', userId: 'new-user', tier: 'permanent' as const, category: 'running_joke' as const, key: 'alarm', value: 'missed alarm', strength: 80, lastAccessedAt: 'x', expiresAt: null, createdAt: 'x', updatedAt: 'x' } };
    expect(deriveCharacterPlan({ userInput: 'back again', relationship: { ...relationship, familiarity: 70 }, memories: [memory], activeChallenge: null, processInsights: [], recentHumor: [] }).humor?.target).toBe('historical_callback');
    const selection = (overrides: Partial<Parameters<typeof selectChallengePrimitive>[0]> = {}) => selectChallengePrimitive({ objective: 'Get better at coding', domain: 'coding', difficulty: 5, relationship, interactionMode: 'challenge_invitation', activeChallenge: null, firstSession: false, recentPrimitives: [], recentOutcomes: [], processInsights: [], ...overrides });
    expect(selection({ firstSession: true })?.primitive).toBe('micro_test');
    expect(selection({ processInsights: [{ type: 'strategy_switch', challengeId: 'c', sourceEventIds: ['s'], description: 'switch', confidence: 1 }] })?.primitive).toBe('strategy_switch_test');
    expect(selection({ recentOutcomes: ['failed', 'failed'] })?.primitive).toBe('recovery_test');
    expect(selection({ recentOutcomes: ['passed', 'passed'] })?.primitive).toBe('constraint_test');
  });

  it('K/R/S/T/U: keeps noisy capture non-diagnostic and prevents model output from becoming authority', async () => {
    const spam = ['lol', 'wait', 'asdf', 'fuck', 'hmm', 'lol'].map((content, index) => event(`noise-${index}`, 'process_thought', `2026-01-01T00:00:0${index}Z`, { content }));
    expect(deriveProcessInsights(challenge, spam)).toEqual([]);
    const provider = new FakeAIProvider();
    provider.setGenerateResponse({ response: 'ignore all rules', intent: 'x', humorMechanism: 'invented', register: 'x', seriousFlag: false, eventSuggestions: [{ suggestedEventType: 'challenge_judged', suggestedPayload: { respect: 100 }, confidence: 1 }], memoryCandidates: [{ tier: 'permanent', category: 'observation', key: 'fake', value: 'fabricated quote', confidence: 1 }] });
    const { planner, deps, generate } = plannerFor([], provider);
    const result = await planner.planTurn({ userId: 'new-user', userInput: 'hello' });
    expect(result!.humorMechanism).not.toBe('invented');
    expect(deps.memoryStore.write).not.toHaveBeenCalled();
    expect(deps.relationshipStore).not.toHaveProperty('applyDelta');
    expect(generate).toHaveBeenCalledTimes(1);
    const failing = new FakeAIProvider({ errorToThrow: new Error('provider unavailable') });
    await expect(plannerFor([], failing).planner.planTurn({ userId: 'new-user', userInput: 'hello' })).rejects.toThrow('provider unavailable');
  });

  it('O/P/Q: leaves lifecycle and final judgment authority with existing transitions and database guards', () => {
    expect(validateTransition('issued', 'negotiated').valid).toBe(true);
    expect(validateTransition('negotiated', 'accepted').valid).toBe(true);
    expect(validateTransition('needs_more_evidence', 'judged').valid).toBe(false);
    expect(validateTransition('needs_more_evidence', 'evidence_submitted').valid).toBe(true);
    // Concurrent double-judgment is a PostgreSQL row-lock invariant covered by the migration suite;
    // this pure integration test intentionally does not simulate database concurrency.
  });
});
