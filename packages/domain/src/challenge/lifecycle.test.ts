import { describe, it, expect } from 'vitest';
import { validateTransition, CHALLENGE_TRANSITIONS } from './lifecycle.js';
import type { ChallengeStatus } from '../types/index.js';

describe('validateTransition', () => {
  describe('valid transitions', () => {
    it.each([
      ['issued → negotiated', 'issued', 'negotiated'],
      ['issued → accepted', 'issued', 'accepted'],
      ['negotiated → negotiated (self-loop)', 'negotiated', 'negotiated'],
      ['negotiated → accepted', 'negotiated', 'accepted'],
      ['accepted → started', 'accepted', 'started'],
      ['started → attempted', 'started', 'attempted'],
      ['attempted → evidence_submitted', 'attempted', 'evidence_submitted'],
      ['started → evidence_submitted', 'started', 'evidence_submitted'],
      ['evidence_submitted → needs_more_evidence', 'evidence_submitted', 'needs_more_evidence'],
      ['evidence_submitted → judged', 'evidence_submitted', 'judged'],
      ['needs_more_evidence → evidence_submitted', 'needs_more_evidence', 'evidence_submitted'],
      ['issued → closed', 'issued', 'closed'],
      ['started → closed', 'started', 'closed'],
      ['judged → closed', 'judged', 'closed'],
    ] as [string, ChallengeStatus, ChallengeStatus][])(
      '%s',
      (_label, current, next) => {
        expect(validateTransition(current, next)).toEqual({ valid: true });
      },
    );
  });

  describe('invalid transitions', () => {
    it.each([
      ['issued → started (skips negotiated/accepted)', 'issued', 'started'],
      ['accepted → negotiated (backward)', 'accepted', 'negotiated'],
      ['attempted → judged (skips evidence_submitted)', 'attempted', 'judged'],
      ['evidence_submitted → accepted (backward)', 'evidence_submitted', 'accepted'],
      ['judged → started (backward)', 'judged', 'started'],
      ['closed → issued (terminal)', 'closed', 'issued'],
      ['closed → judged (terminal)', 'closed', 'judged'],
      ['judged → judged (no self-loop except negotiated)', 'judged', 'judged'],
    ] as [string, ChallengeStatus, ChallengeStatus][])(
      'INVALID: %s',
      (_label, current, next) => {
        const result = validateTransition(current, next);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBeTruthy();
        }
      },
    );
  });

  describe('closed is terminal', () => {
    const allStatuses = Object.keys(CHALLENGE_TRANSITIONS) as ChallengeStatus[];
    it.each(allStatuses)('closed → %s is invalid', (next) => {
      const result = validateTransition('closed', next);
      expect(result.valid).toBe(false);
    });
  });

  describe('result shape', () => {
    it('valid result has no reason field', () => {
      const result = validateTransition('issued', 'accepted');
      expect(result.valid).toBe(true);
      expect('reason' in result).toBe(false);
    });

    it('invalid result has a non-empty reason', () => {
      const result = validateTransition('closed', 'issued');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });

    it('does not mutate any input', () => {
      const current: ChallengeStatus = 'issued';
      const next: ChallengeStatus = 'accepted';
      validateTransition(current, next);
      expect(current).toBe('issued');
      expect(next).toBe('accepted');
    });
  });
});
