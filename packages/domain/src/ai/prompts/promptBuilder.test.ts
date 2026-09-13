import { describe, it, expect } from 'vitest';
import { buildCharacterPrompt } from './promptBuilder.js';
import type { RelationshipState } from '../../types/relationship.js';
import { deriveRivalRelationshipContext } from '../../engine/rivalRelationshipContext.js';

describe('promptBuilder', () => {
  it('builds a prompt with immutable character rules and relationship state', () => {
    const relationship: RelationshipState = {
      userId: 'u1',
      respect: 40,
      warmth: 10,
      trust: 20,
      rivalry: 80,
      familiarity: 50,
      curiosity: 30,
      mode: 'permanent_rival',
      updatedAt: new Date().toISOString(),
    };

    const options = buildCharacterPrompt({
      userInput: 'I just finished the task',
      relationship,
    });

    // Check system prompt for immutable rules, schema definition, and AI authority boundary
    expect(options.systemPrompt).toContain('PROOF IS A TOOL, NOT AN IDENTITY');
    expect(options.systemPrompt).toContain('DO NOT return authoritative numeric relationship state');
    expect(options.systemPrompt).toContain('"response": "The dialogue spoken to the user as The Rival"');
    expect(options.systemPrompt).toContain('"intent":');
    
    // Check user prompt
    expect(options.prompt).toContain('USER INPUT:\nI just finished the task');
    expect(options.prompt).toContain('Mode: permanent_rival');
    expect(options.prompt).toContain('Respect: 40');
    expect(options.prompt).toContain('Rivalry: 80');
    expect(options.prompt).toContain('DO NOT supply authoritative numeric relationship state');
  });

  it('includes active challenge when present', () => {
    const relationship: RelationshipState = {
      userId: 'u1',
      respect: 40,
      warmth: 10,
      trust: 20,
      rivalry: 80,
      familiarity: 50,
      curiosity: 30,
      mode: 'permanent_rival',
      updatedAt: new Date().toISOString(),
    };

    const options = buildCharacterPrompt({
      userInput: 'Here is my evidence',
      relationship,
      activeChallenge: {
        id: 'c1',
        userId: 'u1',
        goalId: null,
        domain: 'coding',
        objective: 'Write a unit test',
        difficulty: 5,
        constraints: ['no AI help'],
        expectedDurationMinutes: 10,
        verificationLevel: 'artifact',
        hypothesis: null,
        status: 'started',
        evidenceRound: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    expect(options.prompt).toContain('ACTIVE CHALLENGE:');
    expect(options.prompt).toContain('Objective: Write a unit test');
    expect(options.prompt).toContain('Status: started');
    expect(options.prompt).toContain('no AI help');
  });

  it('includes relevant memory and humor ledger constraints', () => {
    const relationship: RelationshipState = {
      userId: 'u1',
      respect: 40,
      warmth: 10,
      trust: 20,
      rivalry: 80,
      familiarity: 50,
      curiosity: 30,
      mode: 'permanent_rival',
      updatedAt: new Date().toISOString(),
    };

    const options = buildCharacterPrompt({
      userInput: 'I failed again',
      relationship,
      memories: [
        {
          item: {
            id: 'm1',
            userId: 'u1',
            tier: 'permanent',
            category: 'failure',
            key: 'lazy_sunday',
            value: 'Failed to wake up before noon',
            strength: 80,
            lastAccessedAt: new Date().toISOString(),
            expiresAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          score: 0.9
        }
      ],
      recentHumor: [
        'sleep'
      ]
    });

    expect(options.prompt).toContain('RELEVANT MEMORIES:');
    expect(options.prompt).toContain('Failed to wake up before noon');
    
    expect(options.prompt).toContain('RECENT HUMOR LEDGER (Avoid repeating these):');
    expect(options.prompt).toContain('sleep');
  });

  it('includes only relevant grounded session continuity and protects casual new context', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 50, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const resumed = buildCharacterPrompt({
      userInput: 'continue', relationship,
      sessionContinuity: {
        continuityType: 'resumed_session', previousSessionAt: '2026-09-01T10:00:00Z', lastMeaningfulEventAt: '2026-09-01T10:00:00Z', elapsedSinceMeaningfulActivityMs: 3_600_000,
        activeThread: { challengeId: 'c1', description: 'Fix the parser', status: 'started', lastMeaningfulEventId: 'e2' }, recentSequence: ['challenge_started', 'strategy_switch'], sourceEventIds: ['e1', 'e2'], renderingDirectives: ['Do not invent history.'],
      },
    });
    expect(resumed.prompt).toContain('RIVAL SESSION CONTINUITY');
    expect(resumed.prompt).toContain('Fix the parser');
    expect(resumed.prompt).toContain('challenge_started → strategy_switch');

    const casual = buildCharacterPrompt({ userInput: 'what movie should I watch?', relationship, sessionContinuity: { continuityType: 'new_context', previousSessionAt: '2026-08-01T00:00:00Z', lastMeaningfulEventAt: '2026-08-01T00:00:00Z', elapsedSinceMeaningfulActivityMs: 1, activeThread: null, recentSequence: [], sourceEventIds: [], renderingDirectives: [] } });
    expect(casual.prompt).not.toContain('RIVAL SESSION CONTINUITY');
  });

  it('renders supplied micro-lore as fictional context without an exposition contract', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 60, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const options = buildCharacterPrompt({ userInput: 'where are you from?', relationship, lore: { fact: { id: 'roasteria_reference', category: 'origin_hint', statement: 'The Rival sometimes references “Roasteria,” then denies it is a place.', minimumFamiliarity: 45 }, revealLevel: 'hint', newlyRevealed: true, sourceEventIds: ['l1'], reason: 'first hint' } });
    expect(options.prompt).toContain('RIVAL MICRO-LORE');
    expect(options.prompt).toContain('roasteria_reference');
    expect(options.prompt).toContain('Do not invent additional persistent lore');
  });

  it('tells the renderer that ambient character life is brief and optional', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 60, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const options = buildCharacterPrompt({ userInput: '', relationship, agencyDecision: { action: 'SELF_AMUSEMENT', reason: 'long quiet spell', priority: 20, sourceEventIds: [], sourceMemoryKeys: [], sourceInsightKeys: [], requestedInteractionMode: 'observation', urgency: 'low', cooldownKey: 'rare_event' } });
    expect(options.prompt).toContain('AMBIENT CHARACTER MOMENT');
    expect(options.prompt).toContain('do not issue a challenge');
  });

  it('renders verified live context with provenance and blocks fabrication', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 60, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const options = buildCharacterPrompt({ userInput: 'what happened today?', relationship, liveContext: {
      id: 'ctx-1', source: 'trusted-feed', retrievedAt: '2026-09-01T12:00:00Z', category: 'news', title: 'A current event', summary: 'A bounded verified summary.', relevance: 'high', confidence: 0.9, expiresAt: '2026-09-01T18:00:00Z', sourceUrl: 'https://example.test',
    } });
    expect(options.prompt).toContain('VERIFIED LIVE CONTEXT');
    expect(options.prompt).toContain('ctx-1');
    expect(options.prompt).toContain('Do not invent additional facts');
  });

  it('explicitly prevents current-event invention without a verified item', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 60, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    expect(buildCharacterPrompt({ userInput: 'what happened today?', relationship }).prompt).toContain('NO VERIFIED LIVE CONTEXT');
  });

  it('renders compact relationship permissions without inventing attachment', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 75, warmth: 65, trust: 80, rivalry: 80, familiarity: 85, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const prompt = buildCharacterPrompt({ userInput: 'I finally did it', relationship, relationshipContext: deriveRivalRelationshipContext(relationship) }).prompt;
    expect(prompt).toContain('RIVAL RELATIONSHIP CONTEXT');
    expect(prompt).toContain('Phase: bonded');
    expect(prompt).toContain('Do not become warmer than earned');
    expect(prompt).toContain('guilt the user for leaving');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tweak #5 — Prompt voice texture
  // ─────────────────────────────────────────────────────────────────────────

  it('Tweak #5: mock_formal mechanism injects delivery directive into the instructions block', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 50, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const options = buildCharacterPrompt({
      userInput: 'hello',
      relationship,
      decision: { mode: 'banter', humorMechanism: 'mock_formal', target: 'user statement', callback: null, serious: false, register: 'direct', intensity: 5 },
    });
    expect(options.prompt).toContain('mock-formal delivery');
    expect(options.prompt).toContain('absurdly serious analysis of a ridiculous conclusion');
  });

  it('Tweak #5: absurd_escalation mechanism injects escalation directive', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 50, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const options = buildCharacterPrompt({
      userInput: 'hello',
      relationship,
      decision: { mode: 'banter', humorMechanism: 'absurd_escalation', target: 'user statement', callback: null, serious: false, register: 'direct', intensity: 5 },
    });
    expect(options.prompt).toContain('absurd escalation');
    expect(options.prompt).toContain('unexpectedly extreme');
  });

  it('Tweak #5: voice-texture line always present for character banter/roast modes', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 50, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const modes = ['banter', 'roast', 'observational_roast', 'curious', 'supportive'] as const;
    for (const mode of modes) {
      const opts = buildCharacterPrompt({
        userInput: 'test',
        relationship,
        decision: { mode, humorMechanism: null, target: 'user statement', callback: null, serious: false, register: 'direct', intensity: 4 },
      });
      expect(opts.prompt).toContain('Voice texture: casual directness, cultural vernacular');
    }
  });

  it('Tweak #5: system prompt contains voice moves section with concrete examples', () => {
    const relationship: RelationshipState = { userId: 'u1', respect: 40, warmth: 10, trust: 20, rivalry: 80, familiarity: 50, curiosity: 30, mode: 'permanent_rival', updatedAt: '2026-09-01T00:00:00Z' };
    const opts = buildCharacterPrompt({ userInput: 'hello', relationship });
    expect(opts.systemPrompt).toContain('# VOICE');
    expect(opts.systemPrompt).toContain('Mock-formal pseudo-analysis');
    expect(opts.systemPrompt).toContain('According to my calculations');
    expect(opts.systemPrompt).toContain('Dark humor');
    expect(opts.systemPrompt).toContain('Profanity');
    expect(opts.systemPrompt).toContain('DO NOT BECOME ONE-NOTE');
  });
});

