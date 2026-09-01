import { describe, expect, it } from 'vitest';
import { deriveSituationalContext, type SituationalContextInput } from './rivalSituationalContext.js';
import type { CharacterPlan } from './characterDirector.js';

const NOW = '2026-02-01T00:00:00Z';

function mkCharacterPlan(overrides: Partial<CharacterPlan> = {}): CharacterPlan {
  return {
    state: { mood: 'amused', seriousness: 3, intensity: 5, curiosity: 5 },
    interactionMode: 'banter',
    sincerity: false,
    target: 'current_behavior',
    humor: null,
    ...overrides,
  };
}

function mkInput(overrides: Partial<SituationalContextInput> = {}): SituationalContextInput {
  return {
    userInput: '',
    activeChallenge: null,
    processInsights: [],
    selectedInsight: null,
    selectedMemory: null,
    agencyDecision: null,
    interactionOutcome: null,
    characterPlan: mkCharacterPlan(),
    nowIso: NOW,
    ...overrides,
  };
}

describe('Rival Situational Context', () => {
  it('defaults to general when no context is present', () => {
    const ctx = deriveSituationalContext(mkInput());
    expect(ctx.primaryContext).toBe('general');
  });

  describe('Suppression', () => {
    it('suppresses humor in serious context', () => {
      const plan = mkCharacterPlan({ state: { mood: 'serious', seriousness: 8, intensity: 5, curiosity: 5 } });
      const ctx = deriveSituationalContext(mkInput({ characterPlan: plan, userInput: 'idiot' })); // roast would normally trigger
      expect(ctx.primaryContext).toBe('general');
      expect(ctx.reasoning).toContain('Serious context suppresses');
    });

    it('suppresses unrelated humor in challenge-critical state', () => {
      const ctx = deriveSituationalContext(mkInput({ activeChallenge: { id: 'c1', status: 'evidence_submitted' } as any }));
      expect(ctx.primaryContext).toBe('general');
      expect(ctx.reasoning).toContain('Challenge critical state');
    });
  });

  describe('Specificity & Proportionality', () => {
    it('detects recovery with strategy change', () => {
      const ctx = deriveSituationalContext(mkInput({
        processInsights: [
          { type: 'stall_then_recovery', challengeId: 'c1', sourceEventIds: ['e1'], description: 'Recovered', confidence: 0.9 },
          { type: 'strategy_switch', challengeId: 'c1', sourceEventIds: ['e2'], description: 'Switched', confidence: 0.9 }
        ]
      }));
      expect(ctx.primaryContext).toBe('recovery');
      expect(ctx.supportingContexts).toContain('strategy_change');
      expect(ctx.sourceEventIds).toContain('e1');
      expect(ctx.sourceEventIds).toContain('e2');
    });

    it('detects fast completion', () => {
      const ctx = deriveSituationalContext(mkInput({
        processInsights: [
          { type: 'successful_under_time_pressure', challengeId: 'c1', sourceEventIds: ['e1'], description: 'Fast', confidence: 0.9 }
        ]
      }));
      expect(ctx.primaryContext).toBe('fast_completion');
    });
  });

  describe('Cross-Signal Synthesis', () => {
    it('synthesizes contradiction with claim vs outcome mismatch', () => {
      const ctx = deriveSituationalContext(mkInput({
        selectedInsight: {
          insight: { family: 'claim_vs_outcome_mismatch', description: 'Said easy, failed', provenance: { sourceEventIds: ['e1'] } } as any,
          score: 80,
          reason: ''
        }
      }));
      expect(ctx.primaryContext).toBe('contradiction');
      expect(ctx.measurableDetails).toContain('Said easy, failed');
    });
  });

  describe('Social Exchange', () => {
    it('detects casual social input', () => {
      const ctx = deriveSituationalContext(mkInput({ userInput: 'hello how are you' }));
      expect(ctx.primaryContext).toBe('social_exchange');
    });

    it('detects user roast', () => {
      const ctx = deriveSituationalContext(mkInput({ userInput: 'you are a stupid bot' }));
      expect(ctx.primaryContext).toBe('user_roast');
    });
  });

  describe('Ambient and Flavor', () => {
    it('detects fictional interruption from agency', () => {
      const ctx = deriveSituationalContext(mkInput({
        agencyDecision: { action: 'FICTIONAL_INTERRUPTION', sourceEventIds: ['e1'] } as any
      }));
      expect(ctx.primaryContext).toBe('fictional_interruption');
      expect(ctx.renderingDirectives).toContain('Authorized contextual absurdity. Invent a character-consistent fictional distraction.');
    });
  });
});
