import { describe, expect, it } from 'vitest';
import {
  deriveInteractionOutcome,
  extractInteractionRecords,
  type InteractionInput,
  type InteractionRecord,
} from './rivalInteraction.js';
import type { RivalLivingState } from './rivalLivingState.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { RelationshipState } from '../types/relationship.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW    = '2026-02-01T00:00:00Z';
const RECENT = '2026-01-31T23:59:00Z';  // 1 minute ago — clearly within 3-min speech cooldown
const STALE  = '2026-01-31T23:00:00Z';  // 1 hour ago — outside all cooldowns

function mkRelationship(overrides: Partial<RelationshipState> = {}): RelationshipState {
  return {
    userId: 'u1',
    respect: 50,
    warmth: 60,
    trust: 50,
    rivalry: 50,
    familiarity: 60,
    curiosity: 50,
    mode: 'adaptive',
    updatedAt: NOW,
    ...overrides,
  };
}

function mkPresence(overrides: Partial<PresenceDecision> = {}): PresenceDecision {
  return {
    state: 'active',
    activity: 'watching',
    attention: 'ignore',
    action: null,
    reason: 'no_worthy_event',
    sourceEventIds: [],
    generatedAt: NOW,
    ...overrides,
  };
}

function mkLivingState(overrides: Partial<RivalLivingState> = {}): RivalLivingState {
  return {
    internalState: 'active',
    microActivity: 'watching',
    expressionMode: 'silent',
    authorizedAmbientEvent: null,
    canInteract: true,
    isTransition: false,
    reason: 'test',
    derivedAt: NOW,
    pendingInteractionHook: null,
    ...overrides,
  };
}

function mkInput(overrides: Partial<InteractionInput> = {}): InteractionInput {
  return {
    interaction: 'poke',
    livingState: mkLivingState(),
    presence: mkPresence(),
    relationship: mkRelationship(),
    activeChallenge: null,
    recentInteractions: [],
    nowIso: NOW,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────────────

describe('Suppression gates', () => {
  it('suppresses any interaction during challenge-critical state (evidence_submitted)', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      activeChallenge: { id: 'c1', status: 'evidence_submitted' } as any,
    }));
    expect(outcome.reaction).toBe('ignores');
    expect(outcome.speechAuthorized).toBe(false);
    expect(outcome.visualOnly).toBe(true);
    expect(outcome.reason).toContain('challenge_critical');
  });

  it('suppresses any interaction during challenge-critical state (needs_more_evidence)', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      activeChallenge: { id: 'c1', status: 'needs_more_evidence' } as any,
    }));
    expect(outcome.visualOnly).toBe(true);
    expect(outcome.reason).toContain('challenge_critical');
  });

  it('suppresses comedic interaction in serious context', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      presence: mkPresence({ state: 'serious' }),
    }));
    expect(outcome.visualOnly).toBe(true);
    expect(outcome.reason).toContain('serious_context');
  });

  it('suppresses interaction when Rival is occupied', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      livingState: mkLivingState({ internalState: 'occupied', canInteract: false }),
    }));
    expect(outcome.visualOnly).toBe(true);
    expect(outcome.reason).toContain('rival_occupied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poke / Tap
// ─────────────────────────────────────────────────────────────────────────────

describe('Poke / Tap', () => {
  it('produces a valid reaction with speech when no cooldown', () => {
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'poke' }));
    expect(['amused', 'annoyed', 'curious', 'pushback']).toContain(outcome.reaction);
    expect(outcome.speechAuthorized).toBe(true);
    expect(outcome.visualOnly).toBe(false);
  });

  it('ignores poke when reaction cooldown is active', () => {
    const recent: InteractionRecord[] = [{ interactionType: 'tap_poke', occurredAt: RECENT }];
    // 3 minutes ago is within REACTION_COOLDOWN_MS (30s)? No — RECENT is 3 min ago.
    // Let's make it genuinely recent (10 seconds ago)
    const tenSecondsAgo = new Date(new Date(NOW).getTime() - 10_000).toISOString();
    const recentInteractions: InteractionRecord[] = [{ interactionType: 'tap_poke', occurredAt: tenSecondsAgo }];
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'poke', recentInteractions }));
    expect(outcome.reaction).toBe('ignores');
    expect(outcome.speechAuthorized).toBe(false);
    expect(outcome.visualOnly).toBe(true);
  });

  it('visual-only reaction when speech cooldown is active but reaction cooldown is not', () => {
    const recentInteractions: InteractionRecord[] = [{ interactionType: 'tap_poke', occurredAt: RECENT }];
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'poke', recentInteractions }));
    // RECENT is 3 minutes ago — within SPEECH_COOLDOWN (3 min) but outside REACTION_COOLDOWN (30s)
    expect(outcome.speechAuthorized).toBe(false);
    expect(outcome.visualOnly).toBe(true);
    expect(['annoyed', 'curious', 'ignores']).toContain(outcome.reaction);
  });

  it('ignores poke when familiarity is too low', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'poke',
      relationship: mkRelationship({ familiarity: 20 }),
    }));
    expect(outcome.reaction).toBe('ignores');
    expect(outcome.visualOnly).toBe(true);
  });

  it('produces annoyed reaction for permanent_rival mode', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'poke',
      relationship: mkRelationship({ mode: 'permanent_rival' }),
    }));
    expect(outcome.reaction).toBe('annoyed');
    expect(outcome.speechAuthorized).toBe(true);
  });

  it('routes tap to same resolution as poke', () => {
    const poke = deriveInteractionOutcome(mkInput({ interaction: 'poke' }));
    const tap  = deriveInteractionOutcome(mkInput({ interaction: 'tap' }));
    expect(poke.reaction).toBe(tap.reaction);
    expect(poke.speechAuthorized).toBe(tap.speechAuthorized);
  });

  it('redirects poke-while-sleeping to wake path (startled)', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'poke',
      livingState: mkLivingState({ internalState: 'sleeping' }),
    }));
    expect(outcome.reaction).toBe('startled');
    expect(outcome.speechAuthorized).toBe(true);
  });

  it('does not create a new challenge (self-development invariant)', () => {
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'poke' }));
    // Outcome has no fields that could start a challenge
    expect((outcome as any).challengeSelection).toBeUndefined();
    expect((outcome as any).newChallenge).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wake
// ─────────────────────────────────────────────────────────────────────────────

describe('Wake', () => {
  it('startled reaction when Rival is sleeping', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'sleeping' }),
    }));
    expect(outcome.reaction).toBe('startled');
    expect(outcome.speechAuthorized).toBe(true);
    expect(outcome.visualOnly).toBe(false);
  });

  it('annoyed reaction when Rival is resting', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'resting' }),
    }));
    expect(outcome.reaction).toBe('annoyed');
    expect(outcome.speechAuthorized).toBe(true);
  });

  it('produces curious/dry reaction when Rival is already awake', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'active' }),
    }));
    expect(outcome.reaction).toBe('curious');
  });

  it('ignores repeated wake during cooldown', () => {
    const tenSecondsAgo = new Date(new Date(NOW).getTime() - 10_000).toISOString();
    const recentInteractions: InteractionRecord[] = [{ interactionType: 'wake', occurredAt: tenSecondsAgo }];
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'sleeping' }),
      recentInteractions,
    }));
    expect(outcome.reaction).toBe('ignores');
    expect(outcome.visualOnly).toBe(true);
  });

  it('does not interfere with active challenges', () => {
    const outcome = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'sleeping' }),
      activeChallenge: { id: 'c1', status: 'active' } as any,
    }));
    // Non-critical challenge: wake is still allowed
    expect(outcome.reaction).toBe('startled');
    // But challenge-critical suppresses
    const critical = deriveInteractionOutcome(mkInput({
      interaction: 'wake',
      livingState: mkLivingState({ internalState: 'sleeping' }),
      activeChallenge: { id: 'c1', status: 'evidence_submitted' } as any,
    }));
    expect(critical.visualOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// User Roast
// ─────────────────────────────────────────────────────────────────────────────

describe('User Roast', () => {
  it('authorizes pushback when no cooldown', () => {
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'user_roast' }));
    expect(outcome.reaction).toBe('pushback');
    expect(outcome.speechAuthorized).toBe(true);
    expect(outcome.visualOnly).toBe(false);
  });

  it('visual-only pushback when speech cooldown is active', () => {
    const recentInteractions: InteractionRecord[] = [{ interactionType: 'user_roast', occurredAt: RECENT }];
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'user_roast', recentInteractions }));
    expect(outcome.reaction).toBe('pushback');
    expect(outcome.speechAuthorized).toBe(false);
    expect(outcome.visualOnly).toBe(true);
  });

  it('routes through existing planner — no new challenge created', () => {
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'user_roast' }));
    expect((outcome as any).newChallenge).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hidden condition hook
// ─────────────────────────────────────────────────────────────────────────────

describe('Hidden mechanic seam', () => {
  it('hiddenConditionMet is always false in Task 28', () => {
    const interactions: Array<typeof mkInput extends (...args: any[]) => any ? Parameters<typeof mkInput>[0] : never> = [
      { interaction: 'poke' as const },
      { interaction: 'wake' as const, livingState: mkLivingState({ internalState: 'sleeping' }) },
      { interaction: 'user_roast' as const },
      { interaction: 'tap' as const },
    ];
    for (const opts of interactions) {
      const outcome = deriveInteractionOutcome(mkInput(opts));
      expect(outcome.hiddenConditionMet).toBe(false);
    }
  });

  it('outcome object has hiddenConditionMet field (seam exists)', () => {
    const outcome = deriveInteractionOutcome(mkInput({ interaction: 'poke' }));
    expect('hiddenConditionMet' in outcome).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('Determinism', () => {
  it('same inputs produce same output', () => {
    const input = mkInput({ interaction: 'poke' });
    const a = deriveInteractionOutcome(input);
    const b = deriveInteractionOutcome(input);
    expect(a).toEqual(b);
  });

  it('different timestamps with same state produce same routing decision', () => {
    const a = deriveInteractionOutcome(mkInput({ interaction: 'poke', nowIso: '2026-02-01T00:00:00Z' }));
    const b = deriveInteractionOutcome(mkInput({ interaction: 'poke', nowIso: '2026-02-02T00:00:00Z' }));
    // Routing (speech authorized or not) should match
    expect(a.speechAuthorized).toBe(b.speechAuthorized);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractInteractionRecords
// ─────────────────────────────────────────────────────────────────────────────

describe('extractInteractionRecords', () => {
  it('extracts rival_interaction events only', () => {
    const events: any[] = [
      { id: 'e1', userId: 'u1', eventType: 'rival_interaction', source: 'system', payload: { interactionType: 'poke' }, createdAt: NOW },
      { id: 'e2', userId: 'u1', eventType: 'challenge_issued', source: 'system', payload: {}, createdAt: NOW },
    ];
    const records = extractInteractionRecords(events);
    expect(records).toHaveLength(1);
    expect(records[0].interactionType).toBe('poke');
  });

  it('returns empty array when no interaction events exist', () => {
    expect(extractInteractionRecords([])).toHaveLength(0);
  });
});
