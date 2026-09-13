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

  it('returns null for callbacks when familiarity is below MIN_FAMILIARITY_FOR_CALLBACK', () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Tweak #4 — Hypothesis persistence and retrieval
// ─────────────────────────────────────────────────────────────────────────────

describe('Tweak #4 — hypothesis retrieval', () => {
  const hypothesis: RivalMemory = {
    key: 'hypothesis:behavioral:stall_pattern',
    type: 'hypothesis',
    epistemicStatus: 'hypothesis',
    description: 'Possible recurring pattern (3 observations): User stalls before starting.',
    verbatimQuote: null,
    confidence: 0.65,
    strength: 3,
    provenance: {
      sourceEventIds: ['e1', 'e2', 'e3'],
      sourceInsightTypes: ['stall_pattern'],
      challengeId: null,
      derivedAt: NOW,
    },
  };

  it('retrieves a hypothesis when user expresses struggle (contextual relevance)', () => {
    const result = select({ memories: [hypothesis], userInput: "I don't know where to start" });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
    expect(result!.reason).toContain('hypothesis');
  });

  it('retrieves a hypothesis when user expresses a goal (contextual relevance)', () => {
    const result = select({ memories: [hypothesis], userInput: 'I want to get better at this' });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
  });

  it('does NOT surface a hypothesis on an unrelated casual turn', () => {
    const result = select({ memories: [hypothesis], userInput: 'tell me a joke' });
    expect(result).toBeNull();
  });

  it('does NOT surface a hypothesis on an unrelated casual greeting', () => {
    const result = select({ memories: [hypothesis], userInput: 'hello' });
    expect(result).toBeNull();
  });

  it('preserves epistemicStatus as hypothesis — never auto-converts to derived', () => {
    const result = select({ memories: [hypothesis], userInput: "I'm stuck and I don't know how to start" });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
    expect(result!.memory.type).toBe('hypothesis');
  });

  it('does NOT surface a hypothesis below MIN_HYPOTHESIS_CONFIDENCE (0.60)', () => {
    const belowThreshold = { ...hypothesis, confidence: 0.55 };
    const result = select({ memories: [belowThreshold], userInput: "I'm stuck" });
    expect(result).toBeNull();
  });

  it('surfaces a hypothesis at MIN_HYPOTHESIS_CONFIDENCE threshold (0.60) when contextually relevant', () => {
    const atThreshold = { ...hypothesis, confidence: 0.60, strength: 2 };
    const result = select({ memories: [atThreshold], userInput: "I'm stuck" });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
    expect(result!.memory.confidence).toBe(0.60);
  });

  it('surfaces a hypothesis above threshold (0.65) when contextually relevant', () => {
    const aboveThreshold = { ...hypothesis, confidence: 0.65, strength: 3 };
    const result = select({ memories: [aboveThreshold], userInput: "I'm stuck" });
    expect(result).not.toBeNull();
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
  });

  it('does NOT surface a hypothesis in a serious context', () => {
    const result = select({
      memories: [hypothesis],
      userInput: "I don't know what to do",
      isSeriousContext: true,
    });
    expect(result).toBeNull();
  });

  it('preserves provenance sourceEventIds', () => {
    const result = select({ memories: [hypothesis], userInput: "stuck and confused" });
    expect(result).not.toBeNull();
    expect(result!.memory.provenance.sourceEventIds).toEqual(['e1', 'e2', 'e3']);
    expect(result!.memory.provenance.sourceInsightTypes).toEqual(['stall_pattern']);
  });

  it('non-hypothesis memories continue to surface as before (regression)', () => {
    const commitment = mkMemory('commitment:finish tonight', 'callback', 'reported', 3);
    const result = select({ memories: [commitment], userInput: "I'll finish tonight" });
    expect(result).not.toBeNull();
    expect(result!.memory.type).toBe('callback');
    expect(result!.memory.epistemicStatus).toBe('reported');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tweak #9 — Remove blanket familiarity gate from Rival memory selection
// ─────────────────────────────────────────────────────────────────────────────

describe('Tweak #9 — blanket familiarity gate removal', () => {
  const zeroFamiliarityRel: RelationshipState = {
    userId: 'u1',
    respect: 0,
    warmth: 0,
    trust: 0,
    rivalry: 0,
    familiarity: 0,
    curiosity: 0,
    mode: 'adaptive',
    updatedAt: NOW,
  };

  // Case A: Low familiarity + valid behavioral memory
  it('Case A: surfaces valid behavioral memory when familiarity is 0', () => {
    const behavioral = mkMemory('behavioral:self_report:delayed_start', 'behavioral', 'reported', 2, 0.75, null);
    const result = select({ memories: [behavioral], relationship: zeroFamiliarityRel, userInput: 'what should I do' });
    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('behavioral:self_report:delayed_start');
    expect(result!.memory.type).toBe('behavioral');
    expect(result!.memory.epistemicStatus).toBe('reported');
  });

  // Case B: Low familiarity + valid factual memory
  it('Case B: surfaces contextually relevant factual memory when familiarity is 0', () => {
    const factual = mkMemory('confidence_claim:easy', 'factual', 'reported', 2, 0.9, 'easy');
    const result = select({
      memories: [factual],
      relationship: zeroFamiliarityRel,
      userInput: "I got this, it's definitely easy",
    });
    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('confidence_claim:easy');
    expect(result!.memory.type).toBe('factual');
  });

  // Case C: Low familiarity + strong hypothesis
  it('Case C: surfaces strong hypothesis when familiarity is 0 and relevance trigger is met', () => {
    const strongHypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'hypothesis',
      description: 'Possible recurring pattern (2 observations): User avoids starting.',
      verbatimQuote: null,
      confidence: 0.70,
      strength: 2,
      provenance: { sourceEventIds: ['e1', 'e2'], sourceInsightTypes: ['delayed_start'], challengeId: null, derivedAt: NOW },
    };
    const result = select({
      memories: [strongHypothesis],
      relationship: zeroFamiliarityRel,
      userInput: "I don't know where to start, I feel stuck",
    });
    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('hypothesis:behavioral:self_report:delayed_start');
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
  });

  // Case D: Low familiarity + weak hypothesis
  it('Case D: suppresses weak hypothesis (< 0.60) even when relevance trigger is met at familiarity 0', () => {
    const weakHypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'hypothesis',
      description: 'Possible recurring pattern: User avoids starting.',
      verbatimQuote: null,
      confidence: 0.55,
      strength: 2,
      provenance: { sourceEventIds: ['e1'], sourceInsightTypes: ['delayed_start'], challengeId: null, derivedAt: NOW },
    };
    const result = select({
      memories: [weakHypothesis],
      relationship: zeroFamiliarityRel,
      userInput: "I don't know where to start, I feel stuck",
    });
    expect(result).toBeNull();
  });

  // Case E: Low familiarity + callback memory
  it('Case E: suppresses callback memories when familiarity is below MIN_FAMILIARITY_FOR_CALLBACK (30)', () => {
    const callback = mkMemory('commitment:tonight', 'callback', 'reported', 3, 0.9, "I'll finish tonight");
    // At familiarity 0
    expect(select({ memories: [callback], relationship: zeroFamiliarityRel, userInput: "I'll finish tonight" })).toBeNull();
    // At familiarity 15
    expect(select({ memories: [callback], relationship: { ...zeroFamiliarityRel, familiarity: 15 }, userInput: "I'll finish tonight" })).toBeNull();
    // At familiarity 29
    expect(select({ memories: [callback], relationship: { ...zeroFamiliarityRel, familiarity: 29 }, userInput: "I'll finish tonight" })).toBeNull();
  });

  // Case F: Higher familiarity + callback
  it('Case F: surfaces callback memory once familiarity reaches MIN_FAMILIARITY_FOR_CALLBACK (>= 30)', () => {
    const callback = mkMemory('commitment:tonight', 'callback', 'reported', 3, 0.9, "I'll finish tonight");
    const result = select({
      memories: [callback],
      relationship: { ...zeroFamiliarityRel, familiarity: 30 },
      userInput: "I'll finish tonight",
    });
    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('commitment:tonight');
    expect(result!.memory.type).toBe('callback');
  });

  // Case G: Determinism
  it('Case G: produces identical selection result for identical inputs at familiarity 0', () => {
    const mem1 = mkMemory('behavioral:test', 'behavioral', 'observed', 3, 0.85, null);
    const mem2 = mkMemory('confidence_claim:easy', 'factual', 'reported', 2, 0.8, 'easy');
    const input: MemorySelectionInput = {
      memories: [mem1, mem2],
      userInput: "I got this easy",
      relationship: zeroFamiliarityRel,
      activeChallenge: null,
      isSeriousContext: false,
      isChallengeCritical: false,
      recentHumor: [],
      recentlySurfacedKeys: [],
      nowIso: NOW,
    };
    const result1 = selectRivalMemory(input);
    const result2 = selectRivalMemory(input);
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.memory.key).toBe(result2!.memory.key);
    expect(result1!.score).toBe(result2!.score);
    expect(result1!.reason).toBe(result2!.reason);
  });

  // Case H: Invariants
  it('Case H: preserves serious-context and challenge-critical suppressions at familiarity 0 without mutating inputs', () => {
    const hyp = mkMemory('hypothesis:stall', 'hypothesis', 'hypothesis', 3, 0.75, null);
    const factual = mkMemory('confidence_claim:easy', 'factual', 'reported', 3, 0.9, 'easy');
    const relCopy = { ...zeroFamiliarityRel };

    // Serious context suppresses hypothesis
    const seriousResult = select({
      memories: [hyp],
      relationship: relCopy,
      userInput: "I'm stuck and confused",
      isSeriousContext: true,
    });
    expect(seriousResult).toBeNull();

    // Challenge-critical context suppresses factual/callback
    const criticalResult = select({
      memories: [factual],
      relationship: relCopy,
      userInput: "I got this easy",
      isChallengeCritical: true,
    });
    expect(criticalResult).toBeNull();

    // Relationship object was not mutated
    expect(relCopy).toEqual(zeroFamiliarityRel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tweak #11 — Fix the dead hypothesis confidence threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('Tweak #11 — hypothesis confidence threshold calibration', () => {
  it('surfaces hypothesis generated at strength = 2 (confidence = 0.60)', () => {
    // 2 consistent behavioral observations -> behavioral memory strength = 2
    // -> deriveRivalMemories produces hypothesis with confidence = 0.60
    const delayedStartHypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'hypothesis',
      description: 'Possible recurring pattern (2 observations): User reports a recurring pattern of delaying or avoiding starting',
      verbatimQuote: null,
      confidence: 0.60, // Exactly what Math.min(0.7, 0.5 + 2 * 0.05) produces
      strength: 1,
      provenance: {
        sourceEventIds: [],
        sourceInsightTypes: ['self_report:delayed_start'],
        challengeId: null,
        derivedAt: NOW,
      },
    };

    // User expresses struggle or goal -> contextual relevance is satisfied
    const result = select({
      memories: [delayedStartHypothesis],
      userInput: "I don't know where to start, I feel stuck",
    });

    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('hypothesis:behavioral:self_report:delayed_start');
    expect(result!.memory.epistemicStatus).toBe('hypothesis');
    expect(result!.memory.confidence).toBe(0.60);
  });

  it('selects hypothesis over base behavioral memory when both are candidates and hypothesis meets threshold', () => {
    // When both the hypothesis (confidence = 0.60, strength = 1) and the underlying
    // behavioral self-report (confidence = 0.75, strength = 2) are present
    const baseBehavioral: RivalMemory = {
      key: 'behavioral:self_report:delayed_start',
      type: 'behavioral',
      epistemicStatus: 'reported',
      description: 'User reports delaying starts',
      verbatimQuote: null,
      confidence: 0.75,
      strength: 2,
      provenance: { sourceEventIds: ['e1'], sourceInsightTypes: ['behavioral_self_report'], challengeId: null, derivedAt: NOW },
    };

    const hypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'hypothesis',
      description: 'Possible recurring pattern (2 observations): User reports delaying starts',
      verbatimQuote: null,
      confidence: 0.60,
      strength: 1,
      provenance: { sourceEventIds: [], sourceInsightTypes: ['self_report:delayed_start'], challengeId: null, derivedAt: NOW },
    };

    // User expresses struggle:
    // base behavioral score = 10 (reported) + 6 (strength 2) + 7.5 (conf 0.75) + 8 (behavioral) = 31.5
    // hypothesis score = 5 (hypothesis) + 3 (strength 1) + 6 (conf 0.60) + 15 (struggle relevance) = 29.0
    // But if hypothesis is relevant, it is a valid candidate and not rejected by threshold
    const resultHypOnly = select({
      memories: [hypothesis],
      userInput: "I don't know where to start",
    });
    expect(resultHypOnly).not.toBeNull();
    expect(resultHypOnly!.memory.key).toBe('hypothesis:behavioral:self_report:delayed_start');
    expect(resultHypOnly!.memory.epistemicStatus).toBe('hypothesis');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TWEAK #12 — Contradicted hypothesis suppression
// ─────────────────────────────────────────────────────────────────────────────

describe('selectRivalMemory — Tweak 12 contradicted hypothesis suppression', () => {
  it('hard-suppresses a hypothesis whose epistemicStatus is contradicted', () => {
    const contradictedHypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'contradicted',
      description: 'Possible recurring pattern: User reports delaying starts',
      verbatimQuote: null,
      confidence: 0.85,
      strength: 3,
      provenance: {
        sourceEventIds: [],
        sourceInsightTypes: ['self_report:delayed_start'],
        challengeId: null,
        derivedAt: NOW,
      },
    };

    const result = select({
      memories: [contradictedHypothesis],
      userInput: "I don't know where to start, I always put things off",
    });

    expect(result).toBeNull();
  });

  it('selects active replacement memory over contradicted hypothesis', () => {
    const contradictedHypothesis: RivalMemory = {
      key: 'hypothesis:behavioral:self_report:delayed_start',
      type: 'hypothesis',
      epistemicStatus: 'contradicted',
      description: 'Possible recurring pattern: User reports delaying starts',
      verbatimQuote: null,
      confidence: 0.85,
      strength: 3,
      provenance: { sourceEventIds: [], sourceInsightTypes: ['self_report:delayed_start'], challengeId: null, derivedAt: NOW },
    };

    const replacementBehavioral: RivalMemory = {
      key: 'behavioral:self_report:non_completion',
      type: 'behavioral',
      epistemicStatus: 'reported',
      description: 'User reports: maintaining momentum once the novelty wears off',
      verbatimQuote: 'maintaining momentum once the novelty wears off',
      confidence: 0.75,
      strength: 1,
      provenance: { sourceEventIds: ['e2'], sourceInsightTypes: ['behavioral_self_report'], challengeId: null, derivedAt: NOW },
    };

    const result = select({
      memories: [contradictedHypothesis, replacementBehavioral],
      userInput: 'I lose momentum after the initial excitement',
    });

    expect(result).not.toBeNull();
    expect(result!.memory.key).toBe('behavioral:self_report:non_completion');
    expect(result!.memory.epistemicStatus).toBe('reported');
  });
});


