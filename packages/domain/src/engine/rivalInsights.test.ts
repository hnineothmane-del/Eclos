import { describe, expect, it } from 'vitest';
import { deriveRivalInsights, type RivalInsight } from './rivalInsights.js';
import type { DomainEvent } from '../types/events.js';
import type { RivalMemory } from './rivalMemory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-02-01T00:00:00Z';
const USER_ID = 'u1';

let _eventCounter = 0;
function mkEvent(
  type: string,
  createdAt: string,
  payload: Record<string, unknown> = {},
  id?: string,
): DomainEvent {
  return {
    id: id ?? `e${++_eventCounter}`,
    userId: USER_ID,
    eventType: type as DomainEvent['eventType'],
    source: 'system',
    payload,
    createdAt,
  };
}

/** Build a minimal judged challenge sequence (started + judged). */
function judgmentEvents(
  challengeId: string,
  verdict: 'passed' | 'failed',
  startAt: string,
  judgeAt: string,
  extra: Record<string, unknown> = {},
): DomainEvent[] {
  return [
    mkEvent('challenge_started', startAt, { challenge_id: challengeId }),
    mkEvent('challenge_judged', judgeAt, { challenge_id: challengeId, verdict, ...extra }),
  ];
}

/** Sequence with a STUCK + CHANGING APPROACH in the middle. */
function strategyEvents(challengeId: string, baseAt: string): DomainEvent[] {
  const t = (offset: number) => new Date(new Date(baseAt).getTime() + offset * 1000).toISOString();
  return [
    mkEvent('challenge_started', t(0), { challenge_id: challengeId }),
    mkEvent('process_signal', t(30), { challenge_id: challengeId, signal: 'THINKING' }),
    mkEvent('process_signal', t(60), { challenge_id: challengeId, signal: 'STUCK' }),
    mkEvent('process_signal', t(90), { challenge_id: challengeId, signal: 'CHANGING APPROACH' }),
  ];
}

/** Sequence with failure then rapid recovery (< 60s). */
function rapidRecoveryEvents(challengeId: string, baseAt: string): DomainEvent[] {
  const t = (offset: number) => new Date(new Date(baseAt).getTime() + offset * 1000).toISOString();
  return [
    mkEvent('challenge_started', t(0), { challenge_id: challengeId }),
    mkEvent('challenge_judged', t(30), { challenge_id: challengeId, verdict: 'failed' }),
    mkEvent('challenge_judged', t(80), { challenge_id: challengeId, verdict: 'passed' }), // 50s later = rapid
  ];
}

/** Sequence with failure then slow recovery (> 60s). */
function persistenceEvents(challengeId: string, baseAt: string): DomainEvent[] {
  const t = (offset: number) => new Date(new Date(baseAt).getTime() + offset * 1000).toISOString();
  return [
    mkEvent('challenge_started', t(0), { challenge_id: challengeId }),
    mkEvent('challenge_judged', t(30), { challenge_id: challengeId, verdict: 'failed' }),
    mkEvent('challenge_judged', t(200), { challenge_id: challengeId, verdict: 'passed' }), // 170s later = not rapid but persistent
  ];
}

function mkRivalMemory(
  key: string,
  description: string,
  verbatimQuote: string | null = null,
  derivedAt: string = '2026-01-01T00:00:00Z',
): RivalMemory {
  return {
    key,
    type: 'factual',
    epistemicStatus: 'reported',
    description,
    verbatimQuote,
    confidence: 0.9,
    strength: 1,
    provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt },
  };
}

function derive(events: DomainEvent[], memories: RivalMemory[] = []) {
  return deriveRivalInsights({
    allEvents: events,
    rivalMemories: memories,
    processInsights: [],
    nowIso: NOW,
    userId: USER_ID,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INSUFFICIENT EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — insufficient evidence', () => {
  it('returns no insights from empty events', () => {
    expect(derive([])).toEqual([]);
  });

  it('does not emit repeated_strategy_switch from fewer than 3 challenges', () => {
    // Only 2 challenges with strategy switch
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
    ];
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'repeated_strategy_switch')).toBeUndefined();
  });

  it('does not emit persistence_pattern from fewer than 2 challenges', () => {
    const events = persistenceEvents('c1', '2026-01-01T00:00:00Z');
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'persistence_pattern')).toBeUndefined();
  });

  it('does not emit stall_pattern from fewer than 3 challenges', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-03T00:00:00Z'),
    ];
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'stall_pattern')).toBeUndefined();
  });

  it('does not emit rapid_recovery_pattern from 1 challenge', () => {
    const events = rapidRecoveryEvents('c1', '2026-01-01T00:00:00Z');
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'rapid_recovery_pattern')).toBeUndefined();
  });

  it('does not emit improvement_over_time from fewer than 4 judged challenges', () => {
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z'),
      ...judgmentEvents('c2', 'passed', '2026-01-03T00:00:00Z', '2026-01-03T00:05:00Z'),
      ...judgmentEvents('c3', 'passed', '2026-01-05T00:00:00Z', '2026-01-05T00:05:00Z'),
    ];
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'improvement_over_time')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPEATED PATTERN DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — repeated pattern detection', () => {
  it('emits repeated_strategy_switch from 3 distinct challenges', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(3);
    expect(ins!.epistemicStatus).toBe('derived');
    expect(ins!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('emits stall_pattern from 3 challenges with STUCK + CHANGING APPROACH', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'stall_pattern');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(3);
  });

  it('emits persistence_pattern from 2 challenges with failure then success', () => {
    const events = [
      ...persistenceEvents('c1', '2026-01-01T00:00:00Z'),
      ...persistenceEvents('c2', '2026-01-07T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'persistence_pattern');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(2);
    expect(ins!.epistemicStatus).toBe('derived');
  });

  it('emits rapid_recovery_pattern from 2 challenges', () => {
    const events = [
      ...rapidRecoveryEvents('c1', '2026-01-01T00:00:00Z'),
      ...rapidRecoveryEvents('c2', '2026-01-08T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'rapid_recovery_pattern');
    expect(ins).toBeDefined();
    expect(ins!.epistemicStatus).toBe('observed');
  });

  it('emits abandonment_pattern from 2 abandoned challenges', () => {
    const base = '2026-01-01T00:00:00Z';
    const base2 = '2026-01-08T00:00:00Z';
    const events = [
      mkEvent('challenge_started', base, { challenge_id: 'c1' }),
      mkEvent('challenge_closed', new Date(new Date(base).getTime() + 30000).toISOString(), { challenge_id: 'c1' }),
      mkEvent('challenge_started', base2, { challenge_id: 'c2' }),
      mkEvent('challenge_closed', new Date(new Date(base2).getTime() + 30000).toISOString(), { challenge_id: 'c2' }),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'abandonment_pattern');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(2);
  });

  it('emits negotiation_pattern from 2 distinct challenges that were negotiated', () => {
    const events = [
      mkEvent('challenge_negotiated', '2026-01-02T00:00:00Z', { challenge_id: 'c1' }),
      mkEvent('challenge_negotiated', '2026-01-09T00:00:00Z', { challenge_id: 'c2' }),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'negotiation_pattern');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(2);
  });

  it('emits consistent_success_domain from 3+ passes in same domain', () => {
    const dom = 'coding';
    const events = [
      ...judgmentEvents('c1', 'passed', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', { domain: dom }),
      ...judgmentEvents('c2', 'passed', '2026-01-05T00:00:00Z', '2026-01-05T00:05:00Z', { domain: dom }),
      ...judgmentEvents('c3', 'passed', '2026-01-10T00:00:00Z', '2026-01-10T00:05:00Z', { domain: dom }),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'consistent_success_domain');
    expect(ins).toBeDefined();
    expect(ins!.key).toContain('coding');
    expect(ins!.evidenceCount).toBe(3);
  });

  it('emits consistent_failure_domain from 2+ fails with no passes in same domain', () => {
    const dom = 'physical_task';
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', { domain: dom }),
      ...judgmentEvents('c2', 'failed', '2026-01-06T00:00:00Z', '2026-01-06T00:05:00Z', { domain: dom }),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'consistent_failure_domain');
    expect(ins).toBeDefined();
    expect(ins!.key).toContain('physical_task');
  });

  it('does NOT emit consistent_failure_domain when there is at least one pass in that domain', () => {
    const dom = 'coding';
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', { domain: dom }),
      ...judgmentEvents('c2', 'failed', '2026-01-05T00:00:00Z', '2026-01-05T00:05:00Z', { domain: dom }),
      ...judgmentEvents('c3', 'passed', '2026-01-10T00:00:00Z', '2026-01-10T00:05:00Z', { domain: dom }),
    ];
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'consistent_failure_domain')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-SESSION RECURRENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — cross-session recurrence', () => {
  it('counts strategy switches across distinct challenge IDs (not the same challenge)', () => {
    // All must have DIFFERENT challenge IDs
    const events = [
      ...strategyEvents('session-a-c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('session-b-c1', '2026-01-07T00:00:00Z'),
      ...strategyEvents('session-c-c1', '2026-01-14T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins).toBeDefined();
    expect(ins!.evidenceCount).toBe(3);
  });

  it('does NOT inflate count from multiple CHANGING APPROACH events in the same challenge', () => {
    // All in the same challenge ID — should only count as ONE cross-session observation
    const t = (offset: number) => new Date(new Date('2026-01-01T00:00:00Z').getTime() + offset * 1000).toISOString();
    const events = [
      mkEvent('challenge_started', t(0), { challenge_id: 'single-challenge' }),
      mkEvent('process_signal', t(30), { challenge_id: 'single-challenge', signal: 'CHANGING APPROACH' }),
      mkEvent('process_signal', t(60), { challenge_id: 'single-challenge', signal: 'CHANGING APPROACH' }), // same challenge
      mkEvent('process_signal', t(90), { challenge_id: 'single-challenge', signal: 'CHANGING APPROACH' }), // same challenge
    ];
    const insights = derive(events);
    // Only 1 distinct challenge with strategy switch — below the threshold of 3
    expect(insights.find((i) => i.family === 'repeated_strategy_switch')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPROVEMENT / WORSENING OVER TIME
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — improvement / worsening over time', () => {
  it('emits improvement_over_time when recent pass rate is significantly higher than older', () => {
    const events = [
      // Older half: 0/2 passed
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
      ...judgmentEvents('c2', 'failed', '2026-01-03T00:00:00Z', '2026-01-03T01:00:00Z'),
      // Newer half: 2/2 passed
      ...judgmentEvents('c3', 'passed', '2026-01-20T00:00:00Z', '2026-01-20T01:00:00Z'),
      ...judgmentEvents('c4', 'passed', '2026-01-25T00:00:00Z', '2026-01-25T01:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'improvement_over_time');
    expect(ins).toBeDefined();
    expect(ins!.epistemicStatus).toBe('hypothesis'); // trajectory is always hypothesis-level
    expect(ins!.temporalPattern).toBe('improving');
    expect(ins!.evidenceCount).toBe(4);
  });

  it('emits worsening_over_time when recent pass rate is significantly lower than older', () => {
    const events = [
      // Older half: 2/2 passed
      ...judgmentEvents('c1', 'passed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
      ...judgmentEvents('c2', 'passed', '2026-01-03T00:00:00Z', '2026-01-03T01:00:00Z'),
      // Newer half: 0/2 passed
      ...judgmentEvents('c3', 'failed', '2026-01-20T00:00:00Z', '2026-01-20T01:00:00Z'),
      ...judgmentEvents('c4', 'failed', '2026-01-25T00:00:00Z', '2026-01-25T01:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'worsening_over_time');
    expect(ins).toBeDefined();
    expect(ins!.epistemicStatus).toBe('hypothesis');
    expect(ins!.temporalPattern).toBe('worsening');
  });

  it('does NOT emit trajectory when delta is not significant enough (< 0.3)', () => {
    // Old: 1/2 = 0.5, New: 2/2 = 1.0 — delta = 0.5 — actually this WOULD fire
    // Let's use: Old: 1/2 = 0.5, New: 3/4 = 0.75 — delta = 0.25 < 0.3
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
      ...judgmentEvents('c2', 'passed', '2026-01-03T00:00:00Z', '2026-01-03T01:00:00Z'),
      ...judgmentEvents('c3', 'passed', '2026-01-20T00:00:00Z', '2026-01-20T01:00:00Z'),
      ...judgmentEvents('c4', 'passed', '2026-01-22T00:00:00Z', '2026-01-22T01:00:00Z'),
      // 5th and 6th to make the newer set bigger
      ...judgmentEvents('c5', 'passed', '2026-01-24T00:00:00Z', '2026-01-24T01:00:00Z'),
      ...judgmentEvents('c6', 'failed', '2026-01-26T00:00:00Z', '2026-01-26T01:00:00Z'),
    ];
    // With 6 events: older 3 = [failed, passed, passed] = 0.667, newer 3 = [passed, passed, failed] = 0.667
    // delta = 0 → no trajectory
    const insights = derive(events);
    expect(insights.find((i) => i.family === 'improvement_over_time')).toBeUndefined();
    expect(insights.find((i) => i.family === 'worsening_over_time')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRADICTION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — contradictory self-report vs outcome', () => {
  it('emits claim_vs_outcome_mismatch when confidence claim precedes a failure', () => {
    const claimMemory = mkRivalMemory(
      'confidence_claim:easy',
      'User expressed confidence',
      'easy',
      '2026-01-05T00:00:00Z',
    );
    // Failure AFTER the claim
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-06T00:00:00Z', '2026-01-06T01:00:00Z'),
    ];
    const insights = derive(events, [claimMemory]);
    const ins = insights.find((i) => i.family === 'claim_vs_outcome_mismatch');
    expect(ins).toBeDefined();
    expect(ins!.epistemicStatus).toBe('derived');
    expect(ins!.evidenceCount).toBeGreaterThanOrEqual(1);
    // Should include the verbatim quote in the description
    expect(ins!.description).toContain('"easy"');
  });

  it('does NOT emit claim_vs_outcome_mismatch when failure precedes the claim', () => {
    const claimMemory = mkRivalMemory(
      'confidence_claim:easy',
      'User expressed confidence',
      'easy',
      '2026-01-10T00:00:00Z', // claim AFTER failure
    );
    // Failure BEFORE the claim
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-06T00:00:00Z', '2026-01-06T01:00:00Z'),
    ];
    const insights = derive(events, [claimMemory]);
    expect(insights.find((i) => i.family === 'claim_vs_outcome_mismatch')).toBeUndefined();
  });

  it('emits pressure_preference_mismatch when user claims pressure preference but fails timed challenges', () => {
    const pressureMemory = mkRivalMemory(
      'goal_claim:i work best under pressure',
      'User stated goal: "I work best under pressure"',
      'I work best under pressure',
      '2026-01-01T00:00:00Z',
    );
    const events = [
      // Timed challenge failure (expectedDurationMinutes in challenge_issued payload)
      mkEvent('challenge_issued', '2026-01-05T00:00:00Z', { challenge_id: 'c1', expectedDurationMinutes: 5 }),
      mkEvent('challenge_started', '2026-01-05T00:01:00Z', { challenge_id: 'c1' }),
      mkEvent('challenge_judged', '2026-01-05T00:10:00Z', { challenge_id: 'c1', verdict: 'failed' }),
    ];
    const insights = derive(events, [pressureMemory]);
    const ins = insights.find((i) => i.family === 'pressure_preference_mismatch');
    expect(ins).toBeDefined();
    expect(ins!.epistemicStatus).toBe('derived');
    expect(ins!.description).toContain('pressure');
  });

  it('does NOT emit pressure_preference_mismatch without a stated pressure preference', () => {
    const events = [
      mkEvent('challenge_issued', '2026-01-05T00:00:00Z', { challenge_id: 'c1', expectedDurationMinutes: 5 }),
      mkEvent('challenge_judged', '2026-01-05T00:10:00Z', { challenge_id: 'c1', verdict: 'failed' }),
    ];
    const insights = derive(events, []); // no memories at all
    expect(insights.find((i) => i.family === 'pressure_preference_mismatch')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — provenance', () => {
  it('retains source event IDs in provenance', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins!.provenance.sourceEventIds.length).toBeGreaterThan(0);
    // All source event IDs should appear in the input events
    const inputIds = new Set(events.map((e) => e.id));
    for (const id of ins!.provenance.sourceEventIds) {
      expect(inputIds.has(id)).toBe(true);
    }
  });

  it('retains correct derivedAt timestamp from caller (no Date.now())', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins!.provenance.derivedAt).toBe(NOW);
  });

  it('retains firstObservedAt and lastObservedAt timestamps', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-10T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-20T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins!.firstObservedAt).toBeTruthy();
    expect(ins!.lastObservedAt).toBeTruthy();
    // firstObservedAt should be chronologically before lastObservedAt
    expect(new Date(ins!.firstObservedAt) <= new Date(ins!.lastObservedAt)).toBe(true);
  });

  it('retains source insight types in provenance', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins!.provenance.sourceInsightTypes).toContain('strategy_switch');
  });

  it('sets evidenceCount correctly for multi-challenge patterns', () => {
    const events = [
      ...rapidRecoveryEvents('c1', '2026-01-01T00:00:00Z'),
      ...rapidRecoveryEvents('c2', '2026-01-10T00:00:00Z'),
      ...rapidRecoveryEvents('c3', '2026-01-20T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'rapid_recovery_pattern');
    expect(ins!.evidenceCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EPISTEMIC STATUS
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — epistemic status', () => {
  it('marks improvement/worsening as hypothesis (not derived fact)', () => {
    const events = [
      ...judgmentEvents('c1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
      ...judgmentEvents('c2', 'failed', '2026-01-03T00:00:00Z', '2026-01-03T01:00:00Z'),
      ...judgmentEvents('c3', 'passed', '2026-01-20T00:00:00Z', '2026-01-20T01:00:00Z'),
      ...judgmentEvents('c4', 'passed', '2026-01-25T00:00:00Z', '2026-01-25T01:00:00Z'),
    ];
    const insights = derive(events);
    const trajectory = insights.find(
      (i) => i.family === 'improvement_over_time' || i.family === 'worsening_over_time',
    );
    if (trajectory) {
      expect(trajectory.epistemicStatus).toBe('hypothesis');
    }
  });

  it('marks behavioral pattern insights as derived', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'repeated_strategy_switch');
    expect(ins!.epistemicStatus).toBe('derived');
  });

  it('marks rapid_recovery_pattern as observed (directly evidenced)', () => {
    const events = [
      ...rapidRecoveryEvents('c1', '2026-01-01T00:00:00Z'),
      ...rapidRecoveryEvents('c2', '2026-01-10T00:00:00Z'),
    ];
    const insights = derive(events);
    const ins = insights.find((i) => i.family === 'rapid_recovery_pattern');
    expect(ins!.epistemicStatus).toBe('observed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — confidence thresholds', () => {
  it('emits higher confidence for patterns with more evidence', () => {
    const events3 = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const events5 = [
      ...events3,
      ...strategyEvents('c4', '2026-01-15T00:00:00Z'),
      ...strategyEvents('c5', '2026-01-20T00:00:00Z'),
    ];
    const ins3 = derive(events3).find((i) => i.family === 'repeated_strategy_switch')!;
    const ins5 = derive(events5).find((i) => i.family === 'repeated_strategy_switch')!;
    expect(ins5.confidence).toBeGreaterThan(ins3.confidence);
  });

  it('all emitted insights have confidence in [0, 1]', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
      ...persistenceEvents('c4', '2026-01-12T00:00:00Z'),
      ...persistenceEvents('c5', '2026-01-15T00:00:00Z'),
    ];
    const insights = derive(events);
    for (const ins of insights) {
      expect(ins.confidence).toBeGreaterThanOrEqual(0);
      expect(ins.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO PSYCHIATRIC LABELS
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — no psychiatric/trait labels', () => {
  it('does not produce personality/disorder labels in descriptions', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
      ...persistenceEvents('c4', '2026-01-12T00:00:00Z'),
      ...persistenceEvents('c5', '2026-01-15T00:00:00Z'),
    ];
    const insights = derive(events);
    const forbidden = ['adhd', 'anxiety', 'disorder', 'diagnosis', 'avoidant', 'neurotic', 'impulsive', 'personality'];
    for (const ins of insights) {
      const text = ins.description.toLowerCase();
      for (const label of forbidden) {
        expect(text, `"${label}" found in: "${ins.description}"`).not.toContain(label);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISM
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalInsights — determinism', () => {
  it('produces identical output for identical input', () => {
    const events = [
      ...strategyEvents('c1', '2026-01-01T00:00:00Z'),
      ...strategyEvents('c2', '2026-01-05T00:00:00Z'),
      ...strategyEvents('c3', '2026-01-10T00:00:00Z'),
    ];
    const result1 = derive(events);
    const result2 = derive(events);
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('is a pure synchronous function (no AI call mechanism)', () => {
    const events = strategyEvents('c1', '2026-01-01T00:00:00Z');
    const result = deriveRivalInsights({
      allEvents: events,
      rivalMemories: [],
      processInsights: [],
      nowIso: NOW,
      userId: USER_ID,
    });
    // Must not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result)).toBe(true);
  });
});
