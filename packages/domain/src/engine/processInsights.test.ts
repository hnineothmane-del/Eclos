import { describe, expect, it } from 'vitest';
import { deriveProcessInsights } from './processInsights.js';
import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';

describe('Process Insights Engine', () => {
  const baseChallenge: Challenge = {
    id: 'ch1',
    userId: 'u1',
    goalId: 'g1',
    domain: 'general',
    objective: 'Test',
    difficulty: 5,
    constraints: [],
    verificationLevel: 'self_report',
    status: 'accepted',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    evidenceRound: 0,
    expectedDurationMinutes: null,
    hypothesis: null,
  };

  it('generates initialization_delay when delay > 30s', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'challenge_started', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:00:00Z', source: 'system' },
      { id: '2', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'STUCK' }, createdAt: '2026-01-01T00:00:35Z', source: 'user_action' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'initialization_delay' }));
  });

  it('does not generate initialization_delay when delay < 30s', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'challenge_started', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:00:00Z', source: 'system' },
      { id: '2', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'STUCK' }, createdAt: '2026-01-01T00:00:10Z', source: 'user_action' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).not.toContainEqual(expect.objectContaining({ type: 'initialization_delay' }));
  });

  it('generates stall_then_recovery', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'STUCK' }, createdAt: '2026-01-01T00:01:00Z', source: 'user_action' },
      { id: '2', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'CHANGING_APPROACH' }, createdAt: '2026-01-01T00:02:00Z', source: 'user_action' },
      { id: '3', userId: 'u1', eventType: 'challenge_judged', payload: { challenge_id: 'ch1', verdict: 'passed' }, createdAt: '2026-01-01T00:03:00Z', source: 'system' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'stall_then_recovery' }));
    expect(insights).toContainEqual(expect.objectContaining({ type: 'strategy_switch' }));
  });

  it('generates repeated_strategy_switch', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'CHANGING_APPROACH' }, createdAt: '2026-01-01T00:01:00Z', source: 'user_action' },
      { id: '2', userId: 'u1', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'CHANGING_APPROACH' }, createdAt: '2026-01-01T00:02:00Z', source: 'user_action' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'repeated_strategy_switch' }));
    expect(insights).not.toContainEqual(expect.objectContaining({ type: 'strategy_switch' })); // upgraded
  });

  it('generates confidence_before_attempt', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'process_thought', payload: { challenge_id: 'ch1', content: 'i got this' }, createdAt: '2026-01-01T00:01:00Z', source: 'user_action' },
      { id: '2', userId: 'u1', eventType: 'evidence_submitted', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:02:00Z', source: 'user_action' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'confidence_before_attempt' }));
  });

  it('generates confidence_after_failure', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'challenge_judged', payload: { challenge_id: 'ch1', verdict: 'failed' }, createdAt: '2026-01-01T00:01:00Z', source: 'system' },
      { id: '2', userId: 'u1', eventType: 'process_thought', payload: { challenge_id: 'ch1', content: 'i got this' }, createdAt: '2026-01-01T00:02:00Z', source: 'user_action' },
      { id: '3', userId: 'u1', eventType: 'challenge_judged', payload: { challenge_id: 'ch1', verdict: 'failed' }, createdAt: '2026-01-01T00:03:00Z', source: 'system' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'confidence_after_failure' }));
  });

  it('generates persistence_after_failure and rapid_recovery', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'challenge_judged', payload: { challenge_id: 'ch1', verdict: 'failed' }, createdAt: '2026-01-01T00:01:00Z', source: 'system' },
      { id: '2', userId: 'u1', eventType: 'challenge_judged', payload: { challenge_id: 'ch1', verdict: 'passed' }, createdAt: '2026-01-01T00:01:30Z', source: 'system' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'persistence_after_failure' }));
    expect(insights).toContainEqual(expect.objectContaining({ type: 'rapid_recovery' }));
  });

  it('generates early_abandonment', () => {
    const closedChallenge = { ...baseChallenge, status: 'closed' as const };
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'challenge_started', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:00:00Z', source: 'system' },
      { id: '2', userId: 'u1', eventType: 'challenge_closed', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:01:00Z', source: 'system' },
    ];
    const insights = deriveProcessInsights(closedChallenge, events);
    expect(insights).toContainEqual(expect.objectContaining({ type: 'early_abandonment' }));
  });

  it('does not generate insights on single weak thought', () => {
    const events: DomainEvent[] = [
      { id: '1', userId: 'u1', eventType: 'process_thought', payload: { challenge_id: 'ch1', content: 'hmmm' }, createdAt: '2026-01-01T00:01:00Z', source: 'user_action' },
    ];
    const insights = deriveProcessInsights(baseChallenge, events);
    expect(insights.length).toBe(0);
  });
});
