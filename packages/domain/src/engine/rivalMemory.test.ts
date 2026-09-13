import { describe, expect, it } from 'vitest';
import { deriveRivalMemories, memoryItemToRivalMemory, type RivalMemory, type EpistemicStatus } from './rivalMemory.js';
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

  describe('behavioral self-reports', () => {
    it('creates behavioral/reported memory from explicit self-report of delay', () => {
      const { newMemories } = derive("I keep putting things off until the last minute");
      const mem = newMemories.find(m => m.key === 'behavioral:self_report:delayed_start');
      expect(mem).toBeDefined();
      expect(mem!.type).toBe('behavioral');
      expect(mem!.epistemicStatus).toBe('reported');
      expect(mem!.provenance.sourceInsightTypes).toContain('behavioral_self_report');
    });

    it('creates behavioral/reported memory from explicit self-report of overthinking', () => {
      const { newMemories } = derive("I keep researching instead of building");
      const mem = newMemories.find(m => m.key === 'behavioral:self_report:research_over_action');
      expect(mem).toBeDefined();
      expect(mem!.epistemicStatus).toBe('reported');
    });

    it('resolves equivalent phrasings to the same stable key', () => {
      const mem1 = derive("I procrastinate on starting things").newMemories.find(m => m.type === 'behavioral');
      const mem2 = derive("I tend to put things off").newMemories.find(m => m.type === 'behavioral');
      expect(mem1!.key).toBe('behavioral:self_report:delayed_start');
      expect(mem2!.key).toBe('behavioral:self_report:delayed_start');
    });

    it('ignores mere keywords without self-report framing (no false positive)', () => {
      const { newMemories } = derive("I studied procrastination in psychology");
      expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      
      const { newMemories: nm2 } = derive("This project requires building a research system");
      expect(nm2.filter(m => m.type === 'behavioral').length).toBe(0);
      
      const { newMemories: nm3 } = derive("The app keeps starting slowly");
      expect(nm3.filter(m => m.type === 'behavioral').length).toBe(0);
    });

    it('incorporates chat event ID into provenance if provided', () => {
      const chatEvent = mkEvent('evt-chat-1', 'chat_message_sent', { content: "I always overthink the first step" });
      chatEvent.createdAt = NOW; // Ensure it matches input.nowIso
      const { newMemories } = derive("I always overthink the first step", { events: [chatEvent] });
      const mem = newMemories.find(m => m.key === 'behavioral:self_report:research_over_action');
      expect(mem!.provenance.sourceEventIds).toContain('evt-chat-1');
    });

    // ── Tweak #10 — Structured pattern family tests ───────────────────────
    describe('Tweak #10 — adverb tolerance and displacement', () => {
      // Core live-test phrases from the V1 inference verification
      it('matches "I still find a reason to keep researching before I start" → delayed_start', () => {
        const { newMemories } = derive("And the stupid part is that I actually know I'm doing it. I still find a reason to keep researching before I start.");
        const mem = newMemories.find(m => m.key === 'behavioral:self_report:delayed_start');
        expect(mem).toBeDefined();
        expect(mem!.epistemicStatus).toBe('reported');
      });

      it('matches "I usually end up doing research instead of starting" → delayed_start', () => {
        const { newMemories } = derive("I usually end up doing research instead of starting.");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I always procrastinate when it matters" → delayed_start', () => {
        const { newMemories } = derive("I always procrastinate when it matters.");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I\'m always procrastinating on big tasks" → delayed_start', () => {
        const { newMemories } = derive("I'm always procrastinating on big tasks");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I delay actually starting the hard parts" → delayed_start', () => {
        const { newMemories } = derive("I delay actually starting the hard parts");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "hard for me to begin when it matters" → delayed_start', () => {
        const { newMemories } = derive("Hard for me to begin when it's important.");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "getting myself to start is always tough" → delayed_start', () => {
        const { newMemories } = derive("Getting myself to start is always tough");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "starting is always the hardest part for me" → delayed_start', () => {
        const { newMemories } = derive("starting is always the hardest part for me");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I struggle to get started" → delayed_start', () => {
        const { newMemories } = derive("I struggle to get started.");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I tend to keep researching before I begin" → delayed_start', () => {
        const { newMemories } = derive("I tend to keep researching before I begin");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
      });

      it('matches "I still overthink every decision" → research_over_action', () => {
        const { newMemories } = derive("I still overthink every decision");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeDefined();
      });

      it('matches "I fall into analysis paralysis" → research_over_action', () => {
        const { newMemories } = derive("I fall into analysis paralysis constantly");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeDefined();
      });

      it('matches "I tend to overthink simple decisions" → research_over_action', () => {
        const { newMemories } = derive("I tend to overthink simple decisions");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeDefined();
      });

      it('matches "I struggle to follow through" → non_completion', () => {
        const { newMemories } = derive("I struggle to follow through on things");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:non_completion')).toBeDefined();
      });

      it('matches "I always expand the scope" → scope_creep', () => {
        const { newMemories } = derive("I always expand the scope before I launch");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:scope_creep')).toBeDefined();
      });
    });

    describe('Tweak #10 — negation guards', () => {
      it('does NOT match "I don\'t procrastinate" → null', () => {
        const { newMemories } = derive("I don't procrastinate");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "I never put things off" → null', () => {
        const { newMemories } = derive("I never put things off");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "I don\'t overthink things" → null', () => {
        const { newMemories } = derive("I don't overthink things");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "It is not hard for me to start" → null', () => {
        const { newMemories } = derive("It is not hard for me to start");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "I always finish what I start" → null', () => {
        const { newMemories } = derive("I always finish what I start");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });
    });

    describe('Tweak #10 — third-person and false-positive guards', () => {
      it('does NOT match "My coworker keeps putting things off"', () => {
        const { newMemories } = derive("My coworker keeps putting things off");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "The project was delayed starting"', () => {
        const { newMemories } = derive("The project was delayed starting");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "He overthinks everything"', () => {
        const { newMemories } = derive("He overthinks everything");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match "The scope keeps expanding"', () => {
        const { newMemories } = derive("The scope keeps expanding");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });

      it('does NOT match plain research mention without habitual/displacement framing', () => {
        // "I researched the topic before starting" — one-off action, no habitual marker
        const { newMemories } = derive("I researched the topic before starting the project");
        expect(newMemories.filter(m => m.type === 'behavioral').length).toBe(0);
      });
    });

    describe('Tweak #10 — routing: displacement goes to delayed_start not research_over_action', () => {
      it('"I still find a reason to keep researching before I start" → delayed_start (not research_over_action)', () => {
        const { newMemories } = derive("I still find a reason to keep researching before I start");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeUndefined();
      });

      it('"I always end up doing something else instead of starting" → delayed_start (not research_over_action)', () => {
        const { newMemories } = derive("I always end up doing something else instead of starting");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeDefined();
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeUndefined();
      });

      it('"I overthink everything" → research_over_action (not delayed_start)', () => {
        const { newMemories } = derive("I overthink everything before deciding anything");
        expect(newMemories.find(m => m.key === 'behavioral:self_report:research_over_action')).toBeDefined();
        expect(newMemories.find(m => m.key === 'behavioral:self_report:delayed_start')).toBeUndefined();
      });
    });
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

  // ── Tweak #12 — Conversational hypothesis disconfirmation & replacement ───
  describe('Tweak #12 — conversational disconfirmation & replacement behavior', () => {
    const delayedStartHypothesis = mkMemory(
      'hypothesis:behavioral:self_report:delayed_start',
      JSON.stringify({
        description: 'Possible recurring pattern: User avoids starting.',
        epistemicStatus: 'hypothesis',
        type: 'hypothesis',
        confidence: 0.60,
      }),
      1,
    );

    const delayedStartReport = mkMemory(
      'behavioral:self_report:delayed_start',
      JSON.stringify({
        description: 'User reports a recurring pattern of delaying or avoiding starting',
        epistemicStatus: 'reported',
        type: 'behavioral',
        confidence: 0.75,
      }),
      2,
    );

    // A. Direct contradiction
    it('A. contradicts hypothesis on direct contradiction ("I can start important things quickly. Starting isn\'t my problem.")', () => {
      const { contradictedKeys } = derive(
        "I can start important things quickly. Starting isn't my problem.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).toContain('hypothesis:behavioral:self_report:delayed_start');
      expect(contradictedKeys).not.toContain('behavioral:self_report:delayed_start');
    });

    // B. Explicit negation
    it('B. contradicts hypothesis on explicit negation ("I don\'t struggle with starting.")', () => {
      const { contradictedKeys } = derive(
        "I don't struggle with starting.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).toContain('hypothesis:behavioral:self_report:delayed_start');
      expect(contradictedKeys).not.toContain('behavioral:self_report:delayed_start');
    });

    // C. Capability statement
    it('C. contradicts hypothesis on capability statement ("I usually start immediately when something matters.")', () => {
      const { contradictedKeys } = derive(
        "I usually start immediately when something matters.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).toContain('hypothesis:behavioral:self_report:delayed_start');
      expect(contradictedKeys).not.toContain('behavioral:self_report:delayed_start');
    });

    // D. Ambiguous qualification
    it('D. does NOT contradict hypothesis on ambiguous qualification ("I was describing a different situation earlier.")', () => {
      const { contradictedKeys } = derive(
        "I was describing a different situation earlier.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).not.toContain('hypothesis:behavioral:self_report:delayed_start');
    });

    // E. Uncertainty
    it('E. does NOT contradict hypothesis on uncertainty ("Maybe starting isn\'t the problem.")', () => {
      const { contradictedKeys } = derive(
        "Maybe starting isn't the problem.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).not.toContain('hypothesis:behavioral:self_report:delayed_start');

      const { contradictedKeys: ck2 } = derive(
        "I'm not sure starting is the issue.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(ck2).not.toContain('hypothesis:behavioral:self_report:delayed_start');

      const { contradictedKeys: ck3 } = derive(
        "I don't know if starting is really it.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(ck3).not.toContain('hypothesis:behavioral:self_report:delayed_start');
    });

    // F. Weak/contextual counterexample
    it('F. does NOT contradict hypothesis on weak/contextual counterexample ("Sometimes I start quickly.")', () => {
      const { contradictedKeys } = derive(
        "Sometimes I start quickly.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).not.toContain('hypothesis:behavioral:self_report:delayed_start');

      const { contradictedKeys: ck2 } = derive(
        "I can start quickly when I have to.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(ck2).not.toContain('hypothesis:behavioral:self_report:delayed_start');
    });

    // G. Replacement behavior
    it('G. creates behavioral:self_report:non_completion from "what I struggle with is maintaining momentum once the novelty wears off."', () => {
      const { newMemories } = derive(
        "What I struggle with is maintaining momentum once the novelty wears off.",
      );
      const nonCompletion = newMemories.find(m => m.key === 'behavioral:self_report:non_completion');
      expect(nonCompletion).toBeDefined();
      expect(nonCompletion!.type).toBe('behavioral');
      expect(nonCompletion!.epistemicStatus).toBe('reported');
    });

    // H. Memory preservation
    it('H. preserves historical reported behavioral memory when hypothesis is contradicted', () => {
      const { contradictedKeys } = derive(
        "Starting isn't my problem. I have no trouble starting.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      expect(contradictedKeys).toContain('hypothesis:behavioral:self_report:delayed_start');
      expect(contradictedKeys).not.toContain('behavioral:self_report:delayed_start');
    });

    // L. Combined correction
    it('L. handles combined disconfirmation and replacement in a single turn', () => {
      const { contradictedKeys, newMemories } = derive(
        "I can start important things quickly; what I struggle with is maintaining momentum once the novelty wears off.",
        { existing: [delayedStartHypothesis, delayedStartReport] },
      );
      // Hypothesis is contradicted
      expect(contradictedKeys).toContain('hypothesis:behavioral:self_report:delayed_start');
      // Base behavioral memory is preserved (not contradicted)
      expect(contradictedKeys).not.toContain('behavioral:self_report:delayed_start');
      // Replacement behavior is recorded as non_completion
      const nonCompletion = newMemories.find(m => m.key === 'behavioral:self_report:non_completion');
      expect(nonCompletion).toBeDefined();
      expect(nonCompletion!.type).toBe('behavioral');
      expect(nonCompletion!.epistemicStatus).toBe('reported');
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Tweak #7 — Epistemic status preservation (memoryItemToRivalMemory)
// ─────────────────────────────────────────────────────────────────────────────

describe('memoryItemToRivalMemory — epistemic status preservation', () => {
  it('preserves reported status for reported memories', () => {
    const item: MemoryItem = {
      id: 'm1', userId: 'u1', tier: 'permanent', category: 'commitment',
      key: 'commitment:tonight',
      value: JSON.stringify({
        description: 'User promised to finish tonight',
        verbatimQuote: 'tonight',
        epistemicStatus: 'reported',
        type: 'callback',
      }),
      strength: 90, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('reported');
    expect(rival.type).toBe('callback');
    expect(rival.description).toBe('User promised to finish tonight');
    expect(rival.verbatimQuote).toBe('tonight');
    expect(rival.strength).toBe(90);
    expect(rival.confidence).toBe(0.9);
  });

  it('preserves observed status for observed memories (does not downgrade to reported)', () => {
    const item: MemoryItem = {
      id: 'm2', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'behavioral:stall_then_recovery',
      value: JSON.stringify({
        description: 'User recovered after stall',
        verbatimQuote: null,
        epistemicStatus: 'observed',
        type: 'behavioral',
        provenance: { sourceEventIds: ['e1'], sourceInsightTypes: ['stall_then_recovery'], challengeId: 'ch1', derivedAt: NOW },
      }),
      strength: 85, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('observed');
    expect(rival.type).toBe('behavioral');
    expect(rival.description).toBe('User recovered after stall');
    expect(rival.provenance.sourceEventIds).toEqual(['e1']);
    expect(rival.provenance.sourceInsightTypes).toEqual(['stall_then_recovery']);
    expect(rival.provenance.challengeId).toBe('ch1');
  });

  it('preserves derived status for derived memories', () => {
    const item: MemoryItem = {
      id: 'm3', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'behavioral:multi_session_pattern',
      value: JSON.stringify({
        description: 'Pattern derived from multi-session event sequence',
        epistemicStatus: 'derived',
        type: 'behavioral',
      }),
      strength: 80, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('derived');
    expect(rival.type).toBe('behavioral');
  });

  it('preserves hypothesis status for persisted hypotheses (does not downgrade to reported)', () => {
    const item: MemoryItem = {
      id: 'm4', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'hypothesis:behavioral:research_over_action',
      value: JSON.stringify({
        description: 'Possible recurring pattern: user researches instead of acting',
        verbatimQuote: null,
        epistemicStatus: 'hypothesis',
        type: 'hypothesis',
      }),
      strength: 65, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('hypothesis');
    expect(rival.type).toBe('hypothesis');
    expect(rival.description).toBe('Possible recurring pattern: user researches instead of acting');
  });

  it('preserves contradicted status for contradicted memories', () => {
    const item: MemoryItem = {
      id: 'm5', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'confidence_claim:easy',
      value: JSON.stringify({
        description: 'User claimed easy but failed challenge',
        epistemicStatus: 'contradicted',
        type: 'factual',
      }),
      strength: 70, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('contradicted');
    expect(rival.type).toBe('factual');
  });

  it('preserves superseded status for superseded memories', () => {
    const item: MemoryItem = {
      id: 'm6', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'goal_claim:python',
      value: JSON.stringify({
        description: 'Replaced by newer goal claim',
        epistemicStatus: 'superseded',
        type: 'factual',
      }),
      strength: 50, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('superseded');
    expect(rival.type).toBe('factual');
  });

  it('preserves behavioral + reported for behavioral self-report memories', () => {
    const item: MemoryItem = {
      id: 'm7', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'behavioral:self_report:delayed_start',
      value: JSON.stringify({
        description: 'User reports difficulty beginning tasks: "I procrastinate on starting things"',
        verbatimQuote: 'I procrastinate on starting things',
        epistemicStatus: 'reported',
        type: 'behavioral',
      }),
      strength: 75, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.epistemicStatus).toBe('reported');
    expect(rival.type).toBe('behavioral');
    expect(rival.description).toContain('User reports difficulty beginning tasks');
    expect(rival.verbatimQuote).toBe('I procrastinate on starting things');
  });

  it('infers correct status from key prefix for legacy plain-string memories', () => {
    const legacyHypothesis: MemoryItem = {
      id: 'leg1', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'hypothesis:behavioral:stall_pattern',
      value: 'User stalls before start',
      strength: 65, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const hypRival = memoryItemToRivalMemory(legacyHypothesis);
    expect(hypRival.epistemicStatus).toBe('hypothesis');
    expect(hypRival.type).toBe('hypothesis');
    expect(hypRival.description).toBe('User stalls before start');

    const legacyRelationship: MemoryItem = {
      id: 'leg2', userId: 'u1', tier: 'permanent', category: 'milestone',
      key: 'relationship:first_success',
      value: 'User completed challenge',
      strength: 100, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const relRival = memoryItemToRivalMemory(legacyRelationship);
    expect(relRival.epistemicStatus).toBe('observed');
    expect(relRival.type).toBe('relationship');

    const legacyBehavioral: MemoryItem = {
      id: 'leg3', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'behavioral:stall_then_recovery',
      value: 'Observed stall recovery',
      strength: 80, lastAccessedAt: NOW, expiresAt: null, createdAt: NOW, updatedAt: NOW,
    };
    const behRival = memoryItemToRivalMemory(legacyBehavioral);
    expect(behRival.epistemicStatus).toBe('observed');
    expect(behRival.type).toBe('behavioral');
  });

  it('preserves all core fields intact without corruption', () => {
    const item: MemoryItem = {
      id: 'm-all', userId: 'u1', tier: 'permanent', category: 'observation',
      key: 'behavioral:test_key',
      value: JSON.stringify({
        description: 'Complete description',
        verbatimQuote: 'Exact quote',
        epistemicStatus: 'observed',
        type: 'behavioral',
        provenance: {
          sourceEventIds: ['evt-1', 'evt-2'],
          sourceInsightTypes: ['insight-a'],
          challengeId: 'ch-xyz',
          derivedAt: '2026-01-01T00:00:00Z',
        },
      }),
      strength: 95, lastAccessedAt: NOW, expiresAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: NOW,
    };
    const rival = memoryItemToRivalMemory(item);
    expect(rival.key).toBe('behavioral:test_key');
    expect(rival.type).toBe('behavioral');
    expect(rival.epistemicStatus).toBe('observed');
    expect(rival.description).toBe('Complete description');
    expect(rival.verbatimQuote).toBe('Exact quote');
    expect(rival.strength).toBe(95);
    expect(rival.confidence).toBe(0.95);
    expect(rival.provenance.sourceEventIds).toEqual(['evt-1', 'evt-2']);
    expect(rival.provenance.sourceInsightTypes).toEqual(['insight-a']);
    expect(rival.provenance.challengeId).toBe('ch-xyz');
    expect(rival.provenance.derivedAt).toBe('2026-01-01T00:00:00Z');
  });
});

