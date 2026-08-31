import { describe, expect, it } from 'vitest';
import { selectRivalMemory, type MemorySelectionInput } from './rivalMemorySelector.js';
import type { RivalMemory } from './rivalMemory.js';
import type { RelationshipState } from '../types/relationship.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-01-11T00:00:00Z';

const relationship: RelationshipState = {
  userId: 'u1', respect: 50, warmth: 50, trust: 50, rivalry: 60,
  familiarity: 60, curiosity: 50, mode: 'permanent_rival', updatedAt: NOW,
};

const mkMemory = (
  key: string,
  type: RivalMemory['type'] = 'callback',
  status: RivalMemory['epistemicStatus'] = 'reported',
  strength = 2,
  confidence = 0.9,
  quote: string | null = "I'll finish tonight",
): RivalMemory => ({
  key,
  type,
  epistemicStatus: status,
  description: `Memory: ${key}`,
  verbatimQuote: quote,
  confidence,
  strength,
  provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: NOW },
});

function select(input: Partial<MemorySelectionInput> & { memories: RivalMemory[] }): ReturnType<typeof selectRivalMemory> {
  return selectRivalMemory({
    memories: input.memories,
    userInput: input.userInput ?? 'something',
    relationship: input.relationship ?? relationship,
    activeChallenge: input.activeChallenge ?? null,
    isSeriousContext: input.isSeriousContext ?? false,
    isChallengeCritical: input.isChallengeCritical ?? false,
    recentHumor: input.recentHumor ?? [],
    recentlySurfacedKeys: input.recentlySurfacedKeys ?? [],
    nowIso: NOW,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVAL — basic selection
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — basic selection', () => {
  it('returns null when no memories', () => {
    expect(select({ memories: [] })).toBeNull();
  });

  it('returns null when familiarity is too low (< 20)', () => {
    const lowRel = { ...relationship, familiarity: 15 };
    const mem = mkMemory('commit:1');
    expect(select({ memories: [mem], relationship: lowRel })).toBeNull();
  });

  it('selects a relevant commitment callback when user makes another commitment', () => {
    const mem = mkMemory('commitment:old', 'callback', 'reported', 3, 0.9, "I'll finish this tonight");
    const result = select({ memories: [mem], userInput: "I'll finish this one tonight too" });
    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('commitment:old');
  });

  it('selects the highest-scoring memory', () => {
    const weak = mkMemory('weak:1', 'behavioral', 'observed', 1, 0.6, null);
    const strong = mkMemory('commitment:strong', 'callback', 'reported', 5, 0.95);
    const result = select({ memories: [weak, strong], userInput: "I'll definitely finish tonight" });
    expect(result?.memory.key).toBe('commitment:strong');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPRESSION — serious context
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — serious context suppression', () => {
  it('suppresses callback memories in serious context', () => {
    const callback = mkMemory('commitment:1', 'callback', 'reported', 5);
    expect(select({ memories: [callback], isSeriousContext: true })).toBeNull();
  });

  it('suppresses hypothesis memories in serious context', () => {
    const hyp = mkMemory('hypothesis:stall', 'hypothesis', 'hypothesis', 3, 0.68, null);
    expect(select({ memories: [hyp], isSeriousContext: true })).toBeNull();
  });

  it('does NOT suppress behavioral memory in serious context', () => {
    const behavioral = mkMemory('behavioral:persistence', 'behavioral', 'observed', 3, 0.9, null);
    const result = select({ memories: [behavioral], isSeriousContext: true, isChallengeCritical: false });
    // Behavioral is not suppressed by seriousness — it may still be contextually relevant
    // (but depends on scoring threshold)
    // It won't be null necessarily, unless score < 20
    // strength=3 gives 9, observed gives 15, confidence 0.9 gives 9 = 33 > 20. Should pass.
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COOLDOWN — callback mechanism cooldown
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — cooldown', () => {
  it('suppresses callback-type memories when callback mechanism is in recent humor', () => {
    const mem = mkMemory('commitment:1', 'callback', 'reported', 5);
    expect(select({ memories: [mem], recentHumor: ['callback'] })).toBeNull();
  });

  it('suppresses a recently surfaced key', () => {
    const mem = mkMemory('commitment:recent', 'callback', 'reported', 5);
    expect(select({ memories: [mem], recentlySurfacedKeys: ['commitment:recent'] })).toBeNull();
  });

  it('does not suppress a different key', () => {
    const mem = mkMemory('commitment:different', 'callback', 'reported', 5);
    const result = select({ memories: [mem], recentlySurfacedKeys: ['commitment:old'], userInput: "I'll finish tonight" });
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRADICTION surfacing
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — contradiction relevance', () => {
  it('surfaces a contradicted confidence claim when user expresses new confidence', () => {
    const contradicted = mkMemory('confidence_claim:easy', 'factual', 'contradicted', 3, 0.9, 'easy');
    const result = select({ memories: [contradicted], userInput: "I got this, easy" });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('contradicted');
  });

  it('does NOT surface a superseded memory', () => {
    const superseded = mkMemory('old:claim', 'factual', 'superseded', 5, 0.9);
    expect(select({ memories: [superseded] })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — relationship context', () => {
  it('does not surface callbacks when familiarity < 30 (callback gate)', () => {
    const lowFam = { ...relationship, familiarity: 25 };
    const mem = mkMemory('commitment:1', 'callback', 'reported', 5);
    // callback type requires familiarity >= 30
    expect(select({ memories: [mem], relationship: lowFam })).toBeNull();
  });

  it('surfaces behavioral memories even at low familiarity (no familiarity gate)', () => {
    const lowFam = { ...relationship, familiarity: 25 };
    const behavioral = mkMemory('behavioral:stall', 'behavioral', 'observed', 3, 0.9, null);
    // behavioral doesn't have familiarity gate
    const result = select({ memories: [behavioral], relationship: lowFam });
    // familiarity >= 20 to enter function, lowFam=25 passes that
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — historical commitment callback
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration Scenario A — commitment callback', () => {
  it('Day 2 commitment is surfaced on Day 11 when user makes another commitment', () => {
    // Day 2: stored as a callback memory
    const day2Memory: RivalMemory = {
      key: 'commitment:ill finish this tonight', type: 'callback', epistemicStatus: 'reported',
      description: 'User made a commitment: "I\'ll finish this tonight"',
      verbatimQuote: "I'll finish this tonight",
      confidence: 0.92, strength: 2,
      provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: '2026-01-02T00:00:00Z' },
    };
    // Day 11: user says something similar
    const result = selectRivalMemory({
      memories: [day2Memory],
      userInput: "I'll finish this one tonight",
      relationship: { ...relationship, familiarity: 45 },
      activeChallenge: null,
      isSeriousContext: false, isChallengeCritical: false,
      recentHumor: [],
      recentlySurfacedKeys: [],
      nowIso: '2026-01-11T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.memory.verbatimQuote).toContain('tonight');
    expect(result!.reason).toContain('commitment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — no forced callback
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration Scenario D — no forced callback', () => {
  it('returns null when interaction is unrelated to stored memories', () => {
    const mem = mkMemory('commitment:finish tonight', 'callback', 'reported', 3);
    // Completely unrelated topic
    const result = select({
      memories: [mem],
      userInput: 'what time is it',
    });
    // Low score — no commitment phrase, no matching context
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario F — repeated callback protection
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration Scenario F — repeated callback protection', () => {
  it('does not surface the same memory again after recent use', () => {
    const mem = mkMemory('commitment:1', 'callback', 'reported', 5);
    expect(select({
      memories: [mem],
      userInput: "I'll finish tonight",
      recentlySurfacedKeys: ['commitment:1'],
    })).toBeNull();
  });
});
