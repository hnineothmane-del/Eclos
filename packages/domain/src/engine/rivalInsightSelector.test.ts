import { describe, expect, it } from 'vitest';
import { selectRivalInsight, type InsightSelectionInput } from './rivalInsightSelector.js';
import type { RivalInsight } from './rivalInsights.js';
import type { RelationshipState } from '../types/relationship.js';
import type { Challenge } from '../types/challenge.js';

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
  familiarity: 50, // above MIN_FAMILIARITY (25)
  curiosity: 50,
  mode: 'adaptive',
  updatedAt: NOW,
};

function mkInsight(
  key: string,
  family: RivalInsight['family'],
  evidenceCount = 3,
  confidence = 0.7,
  temporalPattern: RivalInsight['temporalPattern'] = 'recurring',
  epistemicStatus: RivalInsight['epistemicStatus'] = 'derived',
): RivalInsight {
  return {
    key,
    family,
    epistemicStatus,
    description: `Pattern: ${family}`,
    evidenceCount,
    confidence,
    temporalPattern,
    firstObservedAt: '2026-01-01T00:00:00Z',
    lastObservedAt: '2026-01-20T00:00:00Z', // 12 days ago relative to NOW
    provenance: { sourceEventIds: ['e1'], sourceInsightTypes: [], challengeId: null, derivedAt: NOW },
  };
}

const baseInput: InsightSelectionInput = {
  insights: [],
  userInput: '',
  relationship: baseRelationship,
  activeChallenge: null,
  isSeriousContext: false,
  isChallengeCritical: false,
  recentlySurfacedInsightKeys: [],
  nowIso: NOW,
};

function select(overrides: Partial<InsightSelectionInput>) {
  return selectRivalInsight({ ...baseInput, ...overrides });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard Suppression
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalInsight — hard suppression', () => {
  it('returns null if there are no insights', () => {
    expect(select({ insights: [] })).toBeNull();
  });

  it('suppresses all behavioral insights in serious context', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 5, 0.9);
    // Normally this would score high
    expect(select({ insights: [ins], userInput: 'approach' })).not.toBeNull();
    // But in serious context, it is suppressed
    expect(select({ insights: [ins], userInput: 'approach', isSeriousContext: true })).toBeNull();
  });

  it('suppresses insights with < 2 evidenceCount', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 1, 0.9);
    expect(select({ insights: [ins], userInput: 'approach' })).toBeNull();
  });

  it('suppresses insights with < 0.6 confidence', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 3, 0.5);
    expect(select({ insights: [ins], userInput: 'approach' })).toBeNull();
  });

  it('suppresses insights that were surfaced recently (cooldown)', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 3, 0.9);
    expect(select({ insights: [ins], userInput: 'approach' })).not.toBeNull();
    expect(select({ insights: [ins], userInput: 'approach', recentlySurfacedInsightKeys: ['i1'] })).toBeNull();
  });

  it('suppresses hypothesis insights in challenge-critical context', () => {
    const ins = mkInsight('i1', 'improvement_over_time', 5, 0.8, 'improving', 'hypothesis');
    expect(select({ insights: [ins], userInput: 'passed' })).not.toBeNull(); // passes normally
    expect(select({ insights: [ins], userInput: 'passed', isChallengeCritical: true })).toBeNull(); // suppressed
  });

  it('suppresses hypothesis insights with low evidence count', () => {
    const ins = mkInsight('i1', 'improvement_over_time', 3, 0.8, 'improving', 'hypothesis');
    expect(select({ insights: [ins], userInput: 'passed' })).toBeNull();
  });

  it('suppresses insights if relationship familiarity is too low', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 3, 0.9);
    const lowFam = { ...baseRelationship, familiarity: 10 };
    expect(select({ insights: [ins], userInput: 'approach', relationship: lowFam })).toBeNull();
  });

  it('returns null synchronously (no AI call)', () => {
    const result = select({ insights: [] });
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contextual Selection
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalInsight — contextual selection', () => {
  it('surfaces claim_vs_outcome_mismatch when user makes a confidence claim', () => {
    // Base score: evidence(2)*4 + derived(12) + recurring(6) + conf(0.6)*8 = 8+12+6+4.8 = 30.8
    // We want it to fail `requiresContext` threshold (let's say 40) if we add it, OR we just lower stats so it's under 22.
    // Let's use lower stats so base score is < 22:
    // evidence(2)*4=8 + observed(10) + one_off(0) + conf(0.6)*8=4.8 = 22.8.
    const ins = mkInsight('i1', 'claim_vs_outcome_mismatch', 2, 0.6, 'one_off', 'observed');
    expect(select({ insights: [ins], userInput: 'hello' })).toBeNull();
    const result = select({ insights: [ins], userInput: 'easy' });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('user making confidence claim');
  });

  it('surfaces failure patterns when user mentions failure', () => {
    const ins = mkInsight('i1', 'abandonment_pattern', 2, 0.6, 'one_off', 'observed');
    expect(select({ insights: [ins], userInput: 'hello' })).toBeNull();
    const result = select({ insights: [ins], userInput: 'i gave up' });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('failure context matches pattern');
  });

  it('surfaces strategy pattern when user mentions strategy', () => {
    const ins = mkInsight('i1', 'repeated_strategy_switch', 2, 0.6, 'one_off', 'observed');
    expect(select({ insights: [ins], userInput: 'hello' })).toBeNull();
    const result = select({ insights: [ins], userInput: 'i am trying a new approach' });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('strategy discussion matches pattern');
  });

  it('surfaces active challenge domain patterns', () => {
    const ins = mkInsight('insight:consistent_success:coding', 'consistent_success_domain', 4, 0.8);
    const activeChallenge = { id: 'c1', domain: 'coding' } as Challenge;
    const result = select({ insights: [ins], activeChallenge });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('pattern directly relevant to active coding challenge');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Challenge Critical Gating
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalInsight — challenge critical gating', () => {
  it('requires direct relevance and high score in challenge critical context', () => {
    const ins = mkInsight('insight:repeated_strategy_switch', 'repeated_strategy_switch', 3, 0.7);
    const activeChallenge = { id: 'c1', domain: 'coding' } as Challenge;
    
    // Normal context, some relevance (strategy discussion)
    const normal = select({ insights: [ins], activeChallenge, userInput: 'approach' });
    expect(normal).not.toBeNull();

    // Critical context, same relevance, but score might not be high enough
    // evidence(12) + derived(12) + recurring(6) + confidence(5.6) + relevance(15) = 50.6 >= 30
    const critical = select({ insights: [ins], activeChallenge, userInput: 'approach', isChallengeCritical: true });
    expect(critical).not.toBeNull();
    
    // Critical context, NO relevance -> suppressed
    const criticalNoRelevance = select({ insights: [ins], activeChallenge, userInput: 'hello', isChallengeCritical: true });
    expect(criticalNoRelevance).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism and Ranking
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalInsight — determinism and ranking', () => {
  it('is a pure synchronous function', () => {
    const ins = mkInsight('i1', 'claim_vs_outcome_mismatch', 3, 0.8);
    const result = select({ insights: [ins], userInput: 'easy' });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('ranks by score descending, then evidence count', () => {
    const ins1 = mkInsight('i1', 'claim_vs_outcome_mismatch', 3, 0.8); // 3 evidence
    const ins2 = mkInsight('i2', 'claim_vs_outcome_mismatch', 5, 0.8); // 5 evidence, same base score logic
    const result = select({ insights: [ins1, ins2], userInput: 'easy' });
    // Both are relevant, ins2 has higher evidence count -> higher score
    expect(result?.insight.key).toBe('i2');
  });
});
