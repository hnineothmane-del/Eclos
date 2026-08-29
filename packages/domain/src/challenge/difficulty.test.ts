import { describe, it, expect } from 'vitest';
import { computeNextDifficulty, DIFFICULTY_CONSTANTS } from './difficulty.js';
import type { ChallengeOutcomeRecord } from './difficulty.js';

const D = DIFFICULTY_CONSTANTS;

const pass = (confidence = 0.7, effortSignal = 0.8): ChallengeOutcomeRecord => ({
  passed: true,
  effortSignal,
  confidence,
});
const fail = (effortSignal = 0.8, confidence = 0.5): ChallengeOutcomeRecord => ({
  passed: false,
  effortSignal,
  confidence,
});
const lowEffortFail = (): ChallengeOutcomeRecord => ({
  passed: false,
  effortSignal: 0.1,
  confidence: 0.3,
});
const exceptionalPass = (): ChallengeOutcomeRecord => ({
  passed: true,
  effortSignal: 0.95,
  confidence: 0.95,
});

describe('computeNextDifficulty', () => {
  describe('no history → hold', () => {
    it('returns current difficulty unchanged', () => {
      const r = computeNextDifficulty(5, []);
      expect(r.nextDifficulty).toBe(5);
    });
  });

  describe('one result → hold', () => {
    it('single success → hold', () => {
      const r = computeNextDifficulty(5, [pass()]);
      expect(r.nextDifficulty).toBe(5);
    });

    it('single failure → hold', () => {
      const r = computeNextDifficulty(5, [fail()]);
      expect(r.nextDifficulty).toBe(5);
    });
  });

  describe('2+ consecutive successes → +1', () => {
    it('2 normal successes → +1', () => {
      const r = computeNextDifficulty(5, [pass(0.7), pass(0.7)]);
      expect(r.nextDifficulty).toBe(6);
    });

    it('3 normal successes → +1 (not exceptional)', () => {
      const r = computeNextDifficulty(5, [pass(0.7), pass(0.7), pass(0.7)]);
      expect(r.nextDifficulty).toBe(6);
    });
  });

  describe('2+ consecutive exceptional successes → +2', () => {
    it('2 exceptional successes → +2', () => {
      const r = computeNextDifficulty(5, [exceptionalPass(), exceptionalPass()]);
      expect(r.nextDifficulty).toBe(7);
    });

    it('3 exceptional successes → +2 (capped per event)', () => {
      const r = computeNextDifficulty(5, [exceptionalPass(), exceptionalPass(), exceptionalPass()]);
      expect(r.nextDifficulty).toBe(7);
    });
  });

  describe('1 failure → hold', () => {
    it('single failure → hold', () => {
      const r = computeNextDifficulty(5, [pass(), fail()]);
      expect(r.nextDifficulty).toBe(5);
    });
  });

  describe('2 consecutive low-effort failures → -1', () => {
    it('2 low-effort failures → -1', () => {
      const r = computeNextDifficulty(5, [lowEffortFail(), lowEffortFail()]);
      expect(r.nextDifficulty).toBe(4);
    });
  });

  describe('2 effortful failures → hold', () => {
    it('2 effortful failures → hold', () => {
      const r = computeNextDifficulty(5, [fail(), fail()]);
      expect(r.nextDifficulty).toBe(5);
    });
  });

  describe('3 consecutive effortful failures → -1', () => {
    it('3 effortful failures → -1', () => {
      const r = computeNextDifficulty(5, [fail(), fail(), fail()]);
      expect(r.nextDifficulty).toBe(4);
    });
  });

  describe('clamping', () => {
    it('does not exceed MAX (10)', () => {
      const r = computeNextDifficulty(10, [exceptionalPass(), exceptionalPass()]);
      expect(r.nextDifficulty).toBeLessThanOrEqual(D.MAX);
    });

    it('does not go below MIN (1)', () => {
      const r = computeNextDifficulty(1, [lowEffortFail(), lowEffortFail()]);
      expect(r.nextDifficulty).toBeGreaterThanOrEqual(D.MIN);
    });
  });

  describe('mixed history', () => {
    it('success then failure → hold (no qualifying streak)', () => {
      const r = computeNextDifficulty(5, [pass(), fail()]);
      expect(r.nextDifficulty).toBe(5);
    });

    it('failure then success → no decrease', () => {
      const r = computeNextDifficulty(5, [fail(), pass()]);
      expect(r.nextDifficulty).toBe(5);
    });
  });

  describe('result always includes reason', () => {
    it('reason is a non-empty string', () => {
      const r = computeNextDifficulty(5, []);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    });
  });

  describe('never oscillates more than step', () => {
    it('max increase per call is 2', () => {
      const before = 5;
      const r = computeNextDifficulty(before, [exceptionalPass(), exceptionalPass()]);
      expect(r.nextDifficulty - before).toBeLessThanOrEqual(2);
    });

    it('max decrease per call is 1', () => {
      const before = 5;
      const r = computeNextDifficulty(before, [fail(), fail(), fail()]);
      expect(before - r.nextDifficulty).toBeLessThanOrEqual(1);
    });
  });
});
