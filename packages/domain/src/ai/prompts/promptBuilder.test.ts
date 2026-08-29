import { describe, it, expect } from 'vitest';
import { buildCharacterPrompt } from './promptBuilder.js';
import type { RelationshipState } from '../../types/relationship.js';

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

    // Check system prompt for immutable rules and AI authority boundary
    expect(options.systemPrompt).toContain('PROOF OVER PROMISES');
    expect(options.systemPrompt).toContain('DO NOT return authoritative numeric relationship state');
    
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
});
