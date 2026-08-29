import { describe, it, expect } from 'vitest';
import {
  computeRespectEvent,
  deriveEffortSignal,
  RESPECT_CONSTANTS,
} from './respectEngine.js';

const C = RESPECT_CONSTANTS;

// ---------------------------------------------------------------------------
// Respect engine tests
// ---------------------------------------------------------------------------

describe('computeRespectEvent', () => {
  describe('challenge_completed', () => {
    it.each([
      // [label, difficulty, baseline, recentCompletions, expectedRespect]
      ['easy success (diff=2, no repeats)', 2, 5, 0, 2],
      ['moderate success (diff=5, no repeats)', 5, 5, 0, 4],
      // diff=8 >= baseline(5)+2=7 → improvement bonus → 4×1.5+2=8
      ['hard success (diff=8, no repeats)', 8, 5, 0, 8],
      // diff=9 >= baseline(5)+2=7 → improvement bonus → 4×2.0+2=10
      ['very_hard success (diff=9, no repeats)', 9, 5, 0, 10],
      ['baseline improvement (diff=7, baseline=4)', 7, 4, 0, 8],
      // diff=3 >= baseline(1)+2=3 → improvement bonus → 4×0.5+2=4
      ['easy improvement (diff=3, baseline=1)', 3, 1, 0, 4],
      ['repeat damping: 1 recent same-band completion (diff=5)', 5, 5, 1, 3],
      ['repeat damping: 4+ completions (diff=5, should hit floor)', 5, 5, 10, 2],
    ] as const)('%s', (_label, difficulty, baseline, repeats, expected) => {
      const result = computeRespectEvent({
        type: 'challenge_completed',
        difficulty,
        userBaselineDifficulty: baseline,
        recentSameBandCompletions: repeats,
      });
      expect(result.respect).toBe(expected);
    });

    it('hard success with baseline improvement gives +8 before damping', () => {
      const result = computeRespectEvent({
        type: 'challenge_completed',
        difficulty: 7,
        userBaselineDifficulty: 4,
        recentSameBandCompletions: 0,
      });
      // base = 4 × 1.5 = 6, +2 improvement = 8, no damping → 8
      expect(result.respect).toBe(8);
    });

    it('caps at MAX_SINGLE_EVENT_DELTA', () => {
      const result = computeRespectEvent({
        type: 'challenge_completed',
        difficulty: 10,
        userBaselineDifficulty: 1,
        recentSameBandCompletions: 0,
      });
      expect(result.respect).toBeLessThanOrEqual(C.MAX_SINGLE_EVENT_DELTA);
    });

    it('applies secondary deltas: trust+1, rivalry+1, familiarity+1', () => {
      const result = computeRespectEvent({
        type: 'challenge_completed',
        difficulty: 5,
        userBaselineDifficulty: 5,
        recentSameBandCompletions: 0,
      });
      expect(result.trust).toBe(1);
      expect(result.rivalry).toBe(1);
      expect(result.familiarity).toBe(1);
      expect(result.warmth).toBe(0);
    });
  });

  describe('challenge_failed', () => {
    it('effortful failure → 0 Respect', () => {
      const result = computeRespectEvent({
        type: 'challenge_failed',
        effortSignal: 0.8,
        consecutiveLowEffortFailures: 1,
      });
      expect(result.respect).toBe(0);
    });

    it('low-effort failure below consecutive threshold → 0', () => {
      const result = computeRespectEvent({
        type: 'challenge_failed',
        effortSignal: 0.1,
        consecutiveLowEffortFailures: 2,
      });
      expect(result.respect).toBe(0);
    });

    it('3rd consecutive low-effort failure → -3', () => {
      const result = computeRespectEvent({
        type: 'challenge_failed',
        effortSignal: 0.1,
        consecutiveLowEffortFailures: 3,
      });
      expect(result.respect).toBe(-3);
    });

    it('applies secondary delta: rivalry+1, familiarity+1', () => {
      const result = computeRespectEvent({
        type: 'challenge_failed',
        effortSignal: 0.8,
        consecutiveLowEffortFailures: 0,
      });
      expect(result.rivalry).toBe(1);
      expect(result.familiarity).toBe(1);
    });
  });

  describe('recovery', () => {
    it('recovery without prior failure confirmed → 0', () => {
      const result = computeRespectEvent({
        type: 'recovery',
        priorFailureConfirmed: false,
        effortSignal: 0.9,
      });
      expect(result.respect).toBe(0);
    });

    it('recovery with prior failure (low effort) → +5', () => {
      const result = computeRespectEvent({
        type: 'recovery',
        priorFailureConfirmed: true,
        effortSignal: 0.5,
      });
      expect(result.respect).toBe(5);
    });

    it('high-effort recovery → +7', () => {
      const result = computeRespectEvent({
        type: 'recovery',
        priorFailureConfirmed: true,
        effortSignal: 0.8,
      });
      expect(result.respect).toBe(7);
    });

    it('applies secondary delta: trust+2, warmth+1, rivalry+2, familiarity+1', () => {
      const result = computeRespectEvent({
        type: 'recovery',
        priorFailureConfirmed: true,
        effortSignal: 0.5,
      });
      expect(result.trust).toBe(2);
      expect(result.warmth).toBe(1);
      expect(result.rivalry).toBe(2);
      expect(result.familiarity).toBe(1);
    });
  });

  describe('disclosure', () => {
    it('ordinary disclosure → 0 Respect', () => {
      const result = computeRespectEvent({
        type: 'disclosure',
        selfCorrected: false,
      });
      expect(result.respect).toBe(0);
    });

    it('self-correcting disclosure → +3 Respect', () => {
      const result = computeRespectEvent({
        type: 'disclosure',
        selfCorrected: true,
      });
      expect(result.respect).toBe(3);
    });

    it('applies secondary delta: trust+3, warmth+3, curiosity+1, familiarity+1', () => {
      const result = computeRespectEvent({
        type: 'disclosure',
        selfCorrected: false,
      });
      expect(result.trust).toBe(3);
      expect(result.warmth).toBe(3);
      expect(result.curiosity).toBe(1);
      expect(result.familiarity).toBe(1);
    });
  });

  describe('lie_detected', () => {
    it('first lie → -10', () => {
      const result = computeRespectEvent({
        type: 'lie_detected',
        priorRecentLies: 0,
      });
      expect(result.respect).toBe(-10);
    });

    it('second lie → -12', () => {
      const result = computeRespectEvent({
        type: 'lie_detected',
        priorRecentLies: 1,
      });
      expect(result.respect).toBe(-12);
    });

    it('third lie → -14', () => {
      const result = computeRespectEvent({
        type: 'lie_detected',
        priorRecentLies: 2,
      });
      expect(result.respect).toBe(-14);
    });

    it('maximum penalty capped at -16 (3+ prior lies)', () => {
      const result = computeRespectEvent({
        type: 'lie_detected',
        priorRecentLies: 10,
      });
      expect(result.respect).toBe(-16);
    });

    it('never exceeds MIN_SINGLE_EVENT_DELTA', () => {
      const result = computeRespectEvent({
        type: 'lie_detected',
        priorRecentLies: 999,
      });
      expect(result.respect).toBeGreaterThanOrEqual(C.MIN_SINGLE_EVENT_DELTA);
    });

    it('applies secondary delta: trust-8, warmth-2, rivalry-1', () => {
      const result = computeRespectEvent({ type: 'lie_detected', priorRecentLies: 0 });
      expect(result.trust).toBe(-8);
      expect(result.warmth).toBe(-2);
      expect(result.rivalry).toBe(-1);
      expect(result.familiarity).toBe(0);
    });
  });

  describe('milestone', () => {
    it('milestone → +3 Respect', () => {
      const result = computeRespectEvent({ type: 'milestone' });
      expect(result.respect).toBe(3);
    });

    it('applies secondary delta: warmth+2, curiosity+1, familiarity+1', () => {
      const result = computeRespectEvent({ type: 'milestone' });
      expect(result.warmth).toBe(2);
      expect(result.curiosity).toBe(1);
      expect(result.familiarity).toBe(1);
    });
  });

  describe('claim', () => {
    it('claim → 0 Respect (unverified self-report never increases respect)', () => {
      const result = computeRespectEvent({ type: 'claim' });
      expect(result.respect).toBe(0);
    });

    it('claim applies familiarity+1', () => {
      const result = computeRespectEvent({ type: 'claim' });
      expect(result.familiarity).toBe(1);
    });
  });

  describe('invariants', () => {
    it('never produces NaN', () => {
      const result = computeRespectEvent({
        type: 'challenge_completed',
        difficulty: NaN,
        userBaselineDifficulty: 5,
        recentSameBandCompletions: 0,
      });
      expect(Number.isFinite(result.respect)).toBe(true);
    });

    it('result values are always finite integers for respect', () => {
      const events = [
        { type: 'milestone' as const },
        { type: 'claim' as const },
        { type: 'lie_detected' as const, priorRecentLies: 0 },
      ];
      for (const evt of events) {
        const r = computeRespectEvent(evt);
        expect(Number.isFinite(r.respect)).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Effort signal tests
// ---------------------------------------------------------------------------

describe('deriveEffortSignal', () => {
  it('no evidence → 0', () => {
    expect(deriveEffortSignal({ attempted: false })).toBe(0);
  });

  it('only attempted → 0.2', () => {
    expect(deriveEffortSignal({ attempted: true })).toBeCloseTo(0.2);
  });

  it('increasing elapsedFraction adds proportionally', () => {
    const low = deriveEffortSignal({ attempted: true, elapsedFraction: 0.25 });
    const high = deriveEffortSignal({ attempted: true, elapsedFraction: 0.75 });
    expect(high).toBeGreaterThan(low);
  });

  it('full elapsedFraction (1.0) adds 0.20', () => {
    const base = deriveEffortSignal({ attempted: true });
    const full = deriveEffortSignal({ attempted: true, elapsedFraction: 1.0 });
    expect(full - base).toBeCloseTo(0.2);
  });

  it('multiple attempts up to cap', () => {
    const low = deriveEffortSignal({ attempted: true, attemptCount: 1 });
    const high = deriveEffortSignal({ attempted: true, attemptCount: 5 });
    expect(high).toBeGreaterThan(low);
  });

  it('revisions contribute proportionally', () => {
    const low = deriveEffortSignal({ attempted: true, revisionCount: 0 });
    const high = deriveEffortSignal({ attempted: true, revisionCount: 5 });
    expect(high - low).toBeCloseTo(0.15);
  });

  it('helpRequested adds 0.10', () => {
    const without = deriveEffortSignal({ attempted: true });
    const with_ = deriveEffortSignal({ attempted: true, helpRequested: true });
    expect(with_ - without).toBeCloseTo(0.1);
  });

  it('meaningfulSubmission adds 0.20', () => {
    const without = deriveEffortSignal({ attempted: true });
    const with_ = deriveEffortSignal({ attempted: true, meaningfulSubmission: true });
    expect(with_ - without).toBeCloseTo(0.2);
  });

  it('maximum score clamps to 1', () => {
    const result = deriveEffortSignal({
      attempted: true,
      elapsedFraction: 1,
      attemptCount: 100,
      revisionCount: 100,
      helpRequested: true,
      meaningfulSubmission: true,
    });
    expect(result).toBe(1);
  });

  it('impossible negatives clamp to 0', () => {
    const result = deriveEffortSignal({ attempted: false, elapsedFraction: -5 });
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
