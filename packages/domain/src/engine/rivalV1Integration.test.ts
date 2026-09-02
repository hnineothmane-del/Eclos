import { describe, expect, it } from 'vitest';
import { buildCharacterPrompt } from '../ai/prompts/promptBuilder.js';
import { deriveAgencyDecision } from './rivalAgency.js';
import { deriveRivalRelationshipContext } from './rivalRelationshipContext.js';
import type { AgencyInput } from './rivalAgency.js';
import type { CharacterPlan } from './characterDirector.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { RelationshipState } from '../types/relationship.js';
import type { Challenge } from '../types/challenge.js';
import type { RivalSituationalContext } from './rivalSituationalContext.js';

const NOW = '2026-02-01T00:00:00.000Z';
const relationship: RelationshipState = {
  userId: 'u1', respect: 70, warmth: 65, trust: 70, rivalry: 75,
  familiarity: 80, curiosity: 60, mode: 'adaptive', updatedAt: NOW,
};
const presence: PresenceDecision = {
  state: 'active', activity: 'watching', attention: 'ignore', action: null,
  reason: 'no_worthy_event', sourceEventIds: [], generatedAt: NOW,
};
const plan: CharacterPlan = {
  state: { mood: 'amused', seriousness: 2, intensity: 6, curiosity: 5 },
  interactionMode: 'observation', sincerity: false, target: 'process_insight', humor: null,
};

function agencyInput(overrides: Partial<AgencyInput> = {}): AgencyInput {
  return {
    allEvents: [], userInput: '', activeChallenge: null, presence, relationship,
    characterPlan: plan, selectedMemory: null, selectedInsight: null,
    processInsights: [], recentInitiatives: [], nowIso: NOW, ...overrides,
  };
}

describe('Rival V1 cross-system coherence', () => {
  it('keeps serious context above return, callback, and ambient life', () => {
    const decision = deriveAgencyDecision(agencyInput({
      userInput: 'I feel hopeless',
      characterPlan: { ...plan, state: { ...plan.state, seriousness: 9 } },
      presence: { ...presence, action: 'return_greeting' },
    }));
    expect(decision.action).toBe('QUIET');
    expect(decision.requestedInteractionMode).toBe('serious_intervention');
  });

  it('keeps challenge-critical work above unrelated roast or ambient initiative', () => {
    const decision = deriveAgencyDecision(agencyInput({
      userInput: 'you are a stupid bot',
      activeChallenge: ({ id: 'c1', status: 'evidence_submitted' } as unknown) as Challenge,
      presence: { ...presence, action: 'rare_character_event' },
    }));
    expect(decision.action).toBe('QUIET');
    expect(decision.requestedInteractionMode).toBe('challenge_response');
  });

  it('lets deliberate user interaction beat a passive return greeting', () => {
    const decision = deriveAgencyDecision(agencyInput({
      userInput: 'you are a stupid bot',
      presence: { ...presence, action: 'return_greeting' },
    }));
    expect(decision.action).toBe('USER_ROAST_RESPONSE');
  });

  it('preserves one dominant idea while allowing supporting context to stay implicit', () => {
    const relationshipContext = deriveRivalRelationshipContext(relationship);
    const prompt = buildCharacterPrompt({
      userInput: 'I am back', relationship, relationshipContext, presenceDecision: presence,
      characterPlan: plan, situationalContext: {
        primaryContext: 'process_observation', supportingContexts: ['callback'],
        reasoning: 'grounded process context dominates',
        measurableDetails: ['35 seconds'], renderingDirectives: ['Use one grounded observation.'],
        sourceEventIds: ['insight-1'],
      } as RivalSituationalContext,
      processInsights: [{ type: 'initialization_delay', challengeId: 'c1', sourceEventIds: ['insight-1'], description: 'delayed start', confidence: 0.9 }],
    });
    expect(prompt.prompt).toContain('Use one dominant conversational idea');
    expect(prompt.prompt).toContain('process_observation');
  });

  it('keeps ambient life optional and deterministic when the Rival is bored', () => {
    const bored = { ...presence, state: 'bored' as const, activity: 'waiting' as const, action: 'rare_character_event' as const };
    const first = deriveAgencyDecision(agencyInput({ presence: bored }));
    const second = deriveAgencyDecision(agencyInput({ presence: bored }));
    expect(first).toEqual(second);
    expect(['SELF_AMUSEMENT', 'ABORTED_THOUGHT']).toContain(first.action);
  });

});
