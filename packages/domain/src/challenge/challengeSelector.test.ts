import { describe, expect, it } from 'vitest';
import { inferChallengeDomain, selectChallengePrimitive, type ChallengeSelectionContext } from './challengeSelector.js';

const relationship = { userId: 'u', respect: 50, warmth: 50, trust: 60, rivalry: 60, familiarity: 45, curiosity: 50, mode: 'adaptive' as const, updatedAt: 'x' };
const base: ChallengeSelectionContext = { objective: 'Learn coding', domain: 'coding', difficulty: 3, relationship, interactionMode: 'challenge_invitation', activeChallenge: null, firstSession: false, recentPrimitives: [], recentOutcomes: [], processInsights: [] };

describe('challenge selector', () => {
  it.each([
    ['coding', 'I want to code better', 'coding'], ['study', 'Study math', 'study_learning'], ['writing', 'Write a story', 'writing_creative'], ['physical', 'Get in shape', 'physical_task'], ['general', 'Organize my desk', 'general'],
  ])('infers %s domain deterministically', (_name, objective, domain) => expect(inferChallengeDomain(objective)).toBe(domain));

  it('prioritizes a short, executable first-session test', () => {
    const selection = selectChallengePrimitive({ ...base, firstSession: true });
    expect(selection).toMatchObject({ primitive: 'micro_test', expectedDurationMinutes: 1, difficulty: 3 });
  });

  it('selects recovery, strategy, and contradiction tests only from grounded context', () => {
    expect(selectChallengePrimitive({ ...base, recentOutcomes: ['failed', 'failed'] })?.primitive).toBe('recovery_test');
    expect(selectChallengePrimitive({ ...base, processInsights: [{ type: 'strategy_switch', challengeId: 'c', sourceEventIds: ['e'], description: 'switch', confidence: 0.9 }] })?.primitive).toBe('strategy_switch_test');
    expect(selectChallengePrimitive({ ...base, groundedContradiction: true })?.primitive).toBe('contradiction_test');
  });

  it('penalizes recent primitive repetition but remains deterministic', () => {
    const input = { ...base, domain: 'general' as const, recentPrimitives: ['micro_test' as const] };
    expect(selectChallengePrimitive(input)?.primitive).not.toBe('micro_test');
    expect(selectChallengePrimitive(input)).toEqual(selectChallengePrimitive(input));
  });

  it('permits appropriate reuse when the domain has only one safe fit and raises structure after success', () => {
    expect(selectChallengePrimitive({ ...base, domain: 'physical_task', recentPrimitives: ['real_world_action'], recentOutcomes: ['passed'] })?.primitive).toBe('real_world_action');
    const successful = selectChallengePrimitive({ ...base, domain: 'general', recentOutcomes: ['passed', 'passed'] });
    expect(successful?.primitive).toBe('constraint_test');
  });

  it('does not issue during banter or beside an existing challenge, and never mutates difficulty', () => {
    expect(selectChallengePrimitive({ ...base, interactionMode: 'banter' })).toBeNull();
    expect(selectChallengePrimitive({ ...base, activeChallenge: { id: 'c' } as any })).toBeNull();
    expect(selectChallengePrimitive(base)?.difficulty).toBe(3);
  });
});
