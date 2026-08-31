import { describe, expect, it } from 'vitest';
import { deriveRivalMemories, type RivalMemory, type EpistemicStatus } from './rivalMemory.js';
import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';
import type { ProcessInsight } from './processInsights.js';
import type { MemoryItem } from '../types/memory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-01-11T00:00:00Z';
const USER_ID = 'u1';

const BASE_CHALLENGE: Challenge = {
  id: 'ch1', userId: USER_ID, goalId: null, domain: 'general', objective: 'Test objective',
  difficulty: 5, constraints: [], expectedDurationMinutes: null, verificationLevel: 'self_report',
  hypothesis: null, status: 'accepted', evidenceRound: 0,
  createdAt: '2026-01-10T00:00:00Z', updatedAt: '2026-01-10T00:00:00Z',
};

const mkEvent = (id: string, type: string, payload: Record<string, unknown> = {}): DomainEvent =>
  ({ id, userId: USER_ID, eventType: type as any, source: 'system', payload, createdAt: NOW });

const mkInsight = (type: ProcessInsight['type'], eventIds: string[] = []): ProcessInsight =>
  ({ type, challengeId: 'ch1', sourceEventIds: eventIds, description: `Insight: ${type}`, confidence: 0.9 });

const mkMemory = (key: string, value: string, strength = 1): MemoryItem =>
  ({ id: key, userId: USER_ID, tier: 'permanent', category: 'observation', key, value, strength, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW });

function derive(
  userInput: string,
  opts: {
    challenge?: Challenge | null;
    insights?: ProcessInsight[];
    events?: DomainEvent[];
    existing?: MemoryItem[];
  } = {},
) {
  return deriveRivalMemories({
    userInput,
    activeChallenge: opts.challenge ?? null,
    processInsights: opts.insights ?? [],
    recentEvents: opts.events ?? [],
    existingMemories: opts.existing ?? [],
    nowIso: NOW,
    userId: USER_ID,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY CREATION
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — creation', () => {
  it('creates a factual goal memory from goal-phrase input', () => {
    const { newMemories } = derive("I want to learn Python this month");
    expect(newMemories.some(m => m.type === 'factual' && m.key.startsWith('goal_claim:'))).toBe(true);
    const mem = newMemories.find(m => m.type === 'factual')!;
    expect(mem.epistemicStatus).toBe('reported');
    expect(mem.verbatimQuote).toContain('learn Python');
    expect(mem.provenance.derivedAt).toBe(NOW);
  });

  it('creates a callback memory from commitment-phrase input', () => {
    const { newMemories } = derive("I'll finish this tonight, I promise");
    expect(newMemories.some(m => m.type === 'callback' && m.key.startsWith('commitment:'))).toBe(true);
    const mem = newMemories.find(m => m.type === 'callback')!;
    expect(mem.verbatimQuote).toBeTruthy();
    expect(mem.confidence).toBeGreaterThan(0.8);
  });

  it('creates a behavioral memory from a process insight', () => {
    const insight = mkInsight('stall_then_recovery', ['e1', 'e2']);
    const { newMemories } = derive('', { insights: [insight] });
    const mem = newMemories.find(m => m.type === 'behavioral' && m.key === 'behavioral:stall_then_recovery');
    expect(mem).toBeDefined();
    expect(mem!.epistemicStatus).toBe('observed');
    expect(mem!.provenance.sourceEventIds).toEqual(['e1', 'e2']);
    expect(mem!.provenance.sourceInsightTypes).toContain('stall_then_recovery');
  });

  it('creates a relationship memory from a passed judgment', () => {
    const judgeEvent = mkEvent('e1', 'challenge_judged', { challenge_id: 'ch1', verdict: 'passed' });
    const { newMemories } = derive('', { challenge: BASE_CHALLENGE, events: [judgeEvent] });
    const mem = newMemories.find(m => m.key === 'relationship:first_success');
    expect(mem).toBeDefined();
    expect(mem!.epistemicStatus).toBe('observed');
    expect(mem!.provenance.sourceEventIds).toContain('e1');
  });

  it('creates an unresolved memory for an active challenge', () => {
    const { newMemories } = derive('', { challenge: BASE_CHALLENGE });
    expect(newMemories.some(m => m.type === 'unresolved' && m.key.includes('ch1'))).toBe(true);
  });

  it('does NOT create a memory from a trivial single thought', () => {
    const { newMemories, reinforcedKeys } = derive('lol ok');
    expect(newMemories.length).toBe(0);
    expect(reinforcedKeys.length).toBe(0);
  });

  it('does NOT create memory from ambiguous single word', () => {
    const { newMemories } = derive('done');
    expect(newMemories.filter(m => m.type === 'factual').length).toBe(0);
  });

  it('creates a confidence memory from a confidence phrase', () => {
    const { newMemories } = derive("I know this, I got this");
    expect(newMemories.some(m => m.key.startsWith('confidence_claim:'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REINFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — reinforcement', () => {
  it('reinforces rather than duplicates an existing behavioral memory', () => {
    const existing = mkMemory('behavioral:stall_then_recovery', 'User recovered after stall', 1);
    const insight = mkInsight('stall_then_recovery');
    const { newMemories, reinforcedKeys } = derive('', { insights: [insight], existing: [existing] });
    expect(newMemories.filter(m => m.key === 'behavioral:stall_then_recovery').length).toBe(0);
    expect(reinforcedKeys).toContain('behavioral:stall_then_recovery');
  });

  it('reinforces rather than duplicates a repeated success', () => {
    const existing = mkMemory('relationship:first_success', 'User completed a challenge.', 3);
    const judgeEvent = mkEvent('e2', 'challenge_judged', { challenge_id: 'ch1', verdict: 'passed' });
    const { newMemories, reinforcedKeys } = derive('', { challenge: BASE_CHALLENGE, events: [judgeEvent], existing: [existing] });
    expect(newMemories.filter(m => m.key === 'relationship:first_success').length).toBe(0);
    expect(reinforcedKeys).toContain('relationship:first_success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRADICTION
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — contradiction', () => {
  it('marks a confidence_claim as contradicted when a failure occurs', () => {
    const existing = mkMemory('confidence_claim:i know this i got this', 'i know this, i got this');
    const judgeEvent = mkEvent('e1', 'challenge_judged', { challenge_id: 'ch1', verdict: 'failed' });
    const { contradictedKeys } = derive('', { challenge: BASE_CHALLENGE, events: [judgeEvent], existing: [existing] });
    expect(contradictedKeys).toContain('confidence_claim:i know this i got this');
  });

  it('preserves the original confidence_claim as a new memory (not deleted)', () => {
    // The existing memory is preserved — we only OUTPUT contradictedKeys as a signal
    // The caller is responsible for updating epistemic status on the existing record.
    const existing = mkMemory('confidence_claim:easy', 'easy');
    const judgeEvent = mkEvent('e1', 'challenge_judged', { challenge_id: 'ch1', verdict: 'failed' });
    const { newMemories, contradictedKeys } = derive('', {
      challenge: BASE_CHALLENGE, events: [judgeEvent], existing: [existing],
    });
    expect(contradictedKeys).toContain('confidence_claim:easy');
    // The contradicted key is NOT re-created in newMemories
    expect(newMemories.filter(m => m.key === 'confidence_claim:easy').length).toBe(0);
  });

  it('does not silently overwrite a hypothesis — hypothesis remains hypothesis', () => {
    const insight = mkInsight('stall_then_recovery');
    const { newMemories } = derive('', { insights: [insight] });
    const behavioral = newMemories.find(m => m.key === 'behavioral:stall_then_recovery');
    // behavioral observations are observed, not hypothesis
    expect(behavioral?.epistemicStatus).toBe('observed');
    // hypothesis not auto-created from a single observation
    expect(newMemories.filter(m => m.type === 'hypothesis').length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HYPOTHESIS — only from repeated patterns
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — hypothesis', () => {
  it('generates a hypothesis only when behavioral key has been reinforced 2+ times', () => {
    // strength >= 2 triggers hypothesis
    const existing = mkMemory('behavioral:stall_then_recovery', 'Behavioral observation: User recovered after changing approach.', 2);
    const { newMemories } = derive('hello', { existing: [existing] });
    const hyp = newMemories.find(m => m.type === 'hypothesis');
    expect(hyp).toBeDefined();
    expect(hyp!.epistemicStatus).toBe('hypothesis');
    expect(hyp!.confidence).toBeLessThan(0.75); // hypotheses don't get high confidence
  });

  it('does NOT generate hypothesis from a single observation', () => {
    const existing = mkMemory('behavioral:stall_then_recovery', 'obs', 1);
    const { newMemories } = derive('hello', { existing: [existing] });
    expect(newMemories.filter(m => m.type === 'hypothesis').length).toBe(0);
  });

  it('hypothesis key is distinct from behavioral key', () => {
    const existing = mkMemory('behavioral:strategy_switch', 'obs', 3);
    const { newMemories } = derive('hello', { existing: [existing] });
    const hyp = newMemories.find(m => m.type === 'hypothesis');
    expect(hyp?.key).toBe('hypothesis:behavioral:strategy_switch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — provenance', () => {
  it('retains exact source event IDs from process insights', () => {
    const insight = mkInsight('rapid_recovery', ['evt-a', 'evt-b']);
    const { newMemories } = derive('', { insights: [insight] });
    const mem = newMemories.find(m => m.key === 'behavioral:rapid_recovery');
    expect(mem!.provenance.sourceEventIds).toEqual(['evt-a', 'evt-b']);
  });

  it('retains source insight types', () => {
    const insight = mkInsight('confidence_before_attempt', ['e1']);
    const { newMemories } = derive('', { insights: [insight] });
    const mem = newMemories.find(m => m.key === 'behavioral:confidence_before_attempt');
    expect(mem!.provenance.sourceInsightTypes).toContain('confidence_before_attempt');
  });

  it('retains challengeId in provenance', () => {
    const insight = mkInsight('stall_then_recovery');
    const { newMemories } = derive('', { challenge: BASE_CHALLENGE, insights: [insight] });
    const mem = newMemories.find(m => m.key === 'behavioral:stall_then_recovery');
    expect(mem!.provenance.challengeId).toBe('ch1');
  });

  it('retains derivedAt timestamp from caller', () => {
    const insight = mkInsight('help_seeking');
    const { newMemories } = derive('', { insights: [insight] });
    const mem = newMemories.find(m => m.key === 'behavioral:help_seeking');
    expect(mem!.provenance.derivedAt).toBe(NOW);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOUNDARY: no psychological labels
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — no psych labels', () => {
  it('does not produce personality-disorder labels', () => {
    const insight = mkInsight('repeated_strategy_switch');
    const { newMemories } = derive('I always change my mind', { insights: [insight] });
    for (const mem of newMemories) {
      const text = (mem.description + ' ' + (mem.verbatimQuote ?? '')).toLowerCase();
      for (const label of ['adhd', 'ocd', 'anxiety disorder', 'executive dysfunction', 'disorder', 'diagnosis', 'mentally']) {
        expect(text).not.toContain(label);
      }
    }
  });

  it('does not convert behavioral observation to trait label', () => {
    const insight = mkInsight('stall_then_recovery');
    const { newMemories } = derive('', { insights: [insight] });
    const mem = newMemories.find(m => m.key === 'behavioral:stall_then_recovery');
    // description should be observable, not a trait judgment
    expect(mem!.description).not.toContain('adaptable');
    expect(mem!.description).not.toContain('resilient');
    expect(mem!.description).not.toContain('cowardly');
    expect(mem!.description).not.toContain('stupid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI BUDGET — zero AI calls
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalMemories — AI budget', () => {
  it('is a pure synchronous function (no AI call mechanism)', () => {
    // If this function called AI, it would return a Promise. It returns a plain object.
    const insight = mkInsight('initialization_delay');
    const result = deriveRivalMemories({
      userInput: "I'll finish tonight",
      activeChallenge: BASE_CHALLENGE,
      processInsights: [insight],
      recentEvents: [],
      existingMemories: [],
      nowIso: NOW,
      userId: USER_ID,
    });
    // Must be a plain object, not a Promise
    expect(typeof result).toBe('object');
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result.newMemories)).toBe(true);
  });
});
