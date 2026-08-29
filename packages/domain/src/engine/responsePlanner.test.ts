import { describe, it, expect, vi } from 'vitest';
import { ResponsePlanner } from './responsePlanner.js';
import type { PlanTurnDependencies } from './responsePlanner.js';
import { FakeAIProvider } from '../ai/fakeProvider.js';
import type { ModelRouter } from '../ai/router.js';
import type { IRelationshipStateStore, IMemoryStore, IHumorStateStore, IEventStore } from '../store/index.js';
import type { RelationshipState } from '../types/relationship.js';

describe('ResponsePlanner', () => {
  it('orchestrates turn correctly', async () => {
    const fakeAI = new FakeAIProvider({
      defaultGenerateResponse: {
        response: 'Test roast',
        intent: 'roast',
        humorMechanism: 'sarcasm',
        register: 'informal',
        seriousFlag: false,
        memoryCandidates: [
          { tier: 'permanent', category: 'observation', key: 'test_key', value: 'test_val', confidence: 0.8 }
        ],
        eventSuggestions: [
          { suggestedEventType: 'chat_message_sent', suggestedPayload: {}, confidence: 0.8 }
        ]
      }
    });

    const mockRouter = {
      forChat: () => fakeAI,
      forEvaluation: () => fakeAI,
      forMultimodal: () => fakeAI,
    } as unknown as ModelRouter;

    const mockRelationship: RelationshipState = {
      userId: 'u1',
      respect: 50,
      warmth: 50,
      trust: 50,
      rivalry: 50,
      familiarity: 50,
      curiosity: 50,
      mode: 'adaptive',
      updatedAt: new Date().toISOString()
    };

    const mockRelStore = {
      get: vi.fn().mockResolvedValue(mockRelationship),
      applyDelta: vi.fn()
    } as unknown as IRelationshipStateStore;

    const mockMemStore = {
      retrieveRelevant: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue({}),
      compact: vi.fn()
    } as unknown as IMemoryStore;

    const mockHumorStore = {
      recentMechanisms: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue({}),
      jokeCooldownStatus: vi.fn()
    } as unknown as IHumorStateStore;

    const mockEventStore = {
      append: vi.fn().mockResolvedValue('event_1'),
      recentForUser: vi.fn()
    } as unknown as IEventStore;

    const planner = new ResponsePlanner({
      modelRouter: mockRouter,
      relationshipStore: mockRelStore,
      memoryStore: mockMemStore,
      humorStore: mockHumorStore,
      eventStore: mockEventStore
    });

    const result = await planner.planTurn({
      userId: 'u1',
      userInput: 'hello'
    });

    expect(result.response).toBe('Test roast');
    
    expect(mockRelStore.get).toHaveBeenCalledWith('u1');
    expect(mockMemStore.retrieveRelevant).toHaveBeenCalledWith('u1', { tags: ['hello'] });
    expect(mockHumorStore.recentMechanisms).toHaveBeenCalledWith('u1');
    
    // Check that memory candidate was persisted
    expect(mockMemStore.write).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'permanent',
      key: 'test_key',
      userId: 'u1'
    }));

    // Check that humor was recorded
    expect(mockHumorStore.record).toHaveBeenCalledWith('u1', 'sarcasm', 'user', 5);

    // Check that event was stored
    expect(mockEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      eventType: 'chat_message_sent',
      payload: {}
    }));
  });

  it('ignores memory candidates and events with low confidence', async () => {
    const fakeAI = new FakeAIProvider({
      defaultGenerateResponse: {
        response: 'Test roast',
        intent: 'roast',
        memoryCandidates: [
          { tier: 'decaying', category: 'observation', key: 'weak', value: 'val', confidence: 0.3 }
        ],
        eventSuggestions: [
          { suggestedEventType: 'chat_message_sent', suggestedPayload: {}, confidence: 0.1 }
        ]
      }
    });

    const mockRouter = {
      forChat: () => fakeAI,
    } as unknown as ModelRouter;

    const mockRelStore = {
      get: vi.fn().mockResolvedValue({ mode: 'adaptive' } as RelationshipState),
    } as unknown as IRelationshipStateStore;

    const mockMemStore = {
      retrieveRelevant: vi.fn().mockResolvedValue([]),
      write: vi.fn()
    } as unknown as IMemoryStore;

    const mockHumorStore = {
      recentMechanisms: vi.fn().mockResolvedValue([]),
      record: vi.fn()
    } as unknown as IHumorStateStore;

    const mockEventStore = {
      append: vi.fn()
    } as unknown as IEventStore;

    const planner = new ResponsePlanner({
      modelRouter: mockRouter,
      relationshipStore: mockRelStore,
      memoryStore: mockMemStore,
      humorStore: mockHumorStore,
      eventStore: mockEventStore
    });

    await planner.planTurn({
      userId: 'u1',
      userInput: 'hello'
    });

    expect(mockMemStore.write).not.toHaveBeenCalled();
    expect(mockEventStore.append).not.toHaveBeenCalled();
  });
});
