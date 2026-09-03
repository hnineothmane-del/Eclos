import { describe, expect, it } from 'vitest';
import { deriveRivalRelationshipContext } from './rivalRelationshipContext.js';

const state = (overrides: Partial<{ familiarity: number; trust: number; respect: number; warmth: number; rivalry: number; curiosity: number }> = {}) => ({
  userId: 'u', familiarity: 10, trust: 10, respect: 10, warmth: 10, rivalry: 50, curiosity: 30, mode: 'adaptive' as const, updatedAt: '2026-01-01T00:00:00Z', ...overrides,
});

describe('rival relationship interpretation', () => {
  it.each([
    ['introductory', state(), 'introductory'],
    ['familiar', state({ familiarity: 40, trust: 35, warmth: 30 }), 'familiar'],
    ['trusted', state({ familiarity: 60, trust: 65, respect: 55, warmth: 35 }), 'trusted'],
    ['bonded', state({ familiarity: 80, trust: 80, respect: 75, warmth: 65, rivalry: 80 }), 'bonded'],
  ])('derives %s deterministically', (_name, relationship, phase) => {
    expect(deriveRivalRelationshipContext(relationship).phase).toBe(phase);
    expect(deriveRivalRelationshipContext(relationship)).toEqual(deriveRivalRelationshipContext(relationship));
  });

  it('preserves multidimensional differences instead of treating familiarity as friendship', () => {
    const skeptical = deriveRivalRelationshipContext(state({ familiarity: 75, trust: 25, respect: 65, warmth: 20 }));
    const respectful = deriveRivalRelationshipContext(state({ familiarity: 35, trust: 40, respect: 85, warmth: 15, rivalry: 80 }));
    expect(skeptical.phase).toBe('familiar');
    expect(skeptical.directives.join(' ')).toContain('skeptical');
    expect(respectful.phase).toBe('familiar');
    expect(respectful.challengeRespect).toBeGreaterThan(respectful.teasingWarmth);
  });

  it('permits the deepest callbacks and nickname consideration only for a strong bond', () => {
    const trusted = deriveRivalRelationshipContext(state({ familiarity: 70, trust: 70, respect: 70, warmth: 40 }));
    const bonded = deriveRivalRelationshipContext(state({ familiarity: 85, trust: 85, respect: 75, warmth: 70 }));
    expect(trusted).toMatchObject({ callbackDepth: 3, nicknameEligible: false });
    expect(bonded).toMatchObject({ callbackDepth: 4, nicknameEligible: true });
  });
});
