import { describe, it, expect } from 'vitest';
import {
  ENGINE_MODULE,
  CHALLENGE_MODULE,
  MEMORY_MODULE,
  AI_MODULE,
  BILLING_MODULE,
  AppInfo,
  RelationshipState,
  Goal,
  Challenge,
  EvidenceSubmission,
  Judgment,
  MemoryItem,
  HumorLedgerItem,
  CapabilityObservation,
  DomainEvent,
  ChatMessage,
  Subscription,
  WebhookEvent,
  UsageCounter,
  AIResponseContract,
} from '../index.js';

describe('domain package exports and types', () => {
  it('exports placeholder module constants', () => {
    expect(ENGINE_MODULE).toBe('engine');
    expect(CHALLENGE_MODULE).toBe('challenge');
    expect(MEMORY_MODULE).toBe('memory');
    expect(AI_MODULE).toBe('ai');
    expect(BILLING_MODULE).toBe('billing');
  });

  it('instantiates core domain types correctly', () => {
    const appInfo: AppInfo = {
      name: 'AI Rival',
      version: '0.1.0',
      status: 'ready',
    };
    expect(appInfo.name).toBe('AI Rival');

    const relationship: RelationshipState = {
      userId: '11111111-1111-1111-1111-111111111111',
      respect: 75,
      warmth: 40,
      trust: 60,
      rivalry: 80,
      familiarity: 30,
      curiosity: 50,
      mode: 'adaptive',
      updatedAt: new Date().toISOString(),
    };
    expect(relationship.respect).toBe(75);

    const goal: Goal = {
      id: 'g-1',
      userId: relationship.userId,
      title: 'Master TypeScript',
      description: 'Complete full domain types',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(goal.status).toBe('active');

    const challenge: Challenge = {
      id: 'c-1',
      userId: relationship.userId,
      goalId: goal.id,
      domain: 'coding',
      objective: 'Write 100 lines of type-safe code',
      difficulty: 3,
      constraints: ['No any', 'Strict mode'],
      expectedDurationMinutes: 30,
      verificationLevel: 'artifact',
      hypothesis: 'User will finish early',
      status: 'issued',
      evidenceRound: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(challenge.status).toBe('issued');

    const evidence: EvidenceSubmission = {
      id: 'e-1',
      challengeId: challenge.id,
      userId: relationship.userId,
      round: 1,
      kind: 'code',
      content: 'const x: number = 42;',
      submittedAt: new Date().toISOString(),
    };
    expect(evidence.round).toBe(1);

    const judgment: Judgment = {
      id: 'j-1',
      challengeId: challenge.id,
      evidenceSubmissionId: evidence.id,
      outcome: 'passed',
      confidence: 0.95,
      reasoning: 'Clean implementation',
      respectDelta: 5,
      trustDelta: 3,
      createdAt: new Date().toISOString(),
    };
    expect(judgment.outcome).toBe('passed');

    const memory: MemoryItem = {
      id: 'm-1',
      userId: relationship.userId,
      tier: 'permanent',
      category: 'achievement',
      key: 'first_challenge_won',
      value: { score: 100 },
      strength: 100,
      lastAccessedAt: new Date().toISOString(),
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(memory.tier).toBe('permanent');

    const humor: HumorLedgerItem = {
      id: 'h-1',
      userId: relationship.userId,
      theme: 'procrastination',
      target: 'deadline',
      intensity: 6,
      usageCount: 1,
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    expect(humor.intensity).toBe(6);

    const observation: CapabilityObservation = {
      id: 'o-1',
      userId: relationship.userId,
      category: 'persistence',
      observation: 'Pushed through difficult challenge without giving up',
      valence: 'positive',
      evidence: { challengeId: challenge.id },
      createdAt: new Date().toISOString(),
    };
    expect(observation.category).toBe('persistence');

    const event: DomainEvent = {
      id: 'ev-1',
      userId: relationship.userId,
      eventType: 'challenge_judged',
      source: 'system',
      payload: { judgmentId: judgment.id },
      createdAt: new Date().toISOString(),
    };
    expect(event.source).toBe('system');

    const chat: ChatMessage = {
      id: 'msg-1',
      userId: relationship.userId,
      challengeId: challenge.id,
      role: 'assistant',
      content: 'Let us see what you got.',
      metadata: {},
      createdAt: new Date().toISOString(),
    };
    expect(chat.role).toBe('assistant');

    const subscription: Subscription = {
      id: 'sub-1',
      userId: relationship.userId,
      lemonSqueezyId: 'ls_sub_123',
      customerId: 'ls_cus_456',
      status: 'active',
      variantId: 'var_789',
      currentPeriodEndsAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(subscription.status).toBe('active');

    const webhook: WebhookEvent = {
      id: 'wh-1',
      eventId: 'evt_ls_999',
      eventName: 'subscription_created',
      payload: {},
      status: 'processed',
      processedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    expect(webhook.status).toBe('processed');

    const usage: UsageCounter = {
      id: 'u-1',
      userId: relationship.userId,
      period: '2026-08-29',
      interactionCount: 5,
      challengeCount: 1,
      tokenCount: 1500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(usage.interactionCount).toBe(5);

    const aiResponse: AIResponseContract = {
      response: 'Impressive code.',
      intent: 'acknowledge_progress',
      seriousFlag: true,
      eventSuggestions: [
        {
          suggestedEventType: 'observation_recorded',
          suggestedPayload: { note: 'Good syntax' },
          confidence: 0.9,
        },
      ],
    };
    expect(aiResponse.intent).toBe('acknowledge_progress');
  });
});
