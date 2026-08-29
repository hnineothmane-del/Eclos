import type { AIResponseContract } from '../types/aiContract.js';
import type { GenerateOptions, AIProvider } from '../ai/provider.js';
import type { ModelRouter } from '../ai/router.js';
import { validateAIResponseContract } from '../ai/validation.js';
import type { 
  IEventStore, 
  IRelationshipStateStore, 
  IMemoryStore, 
  IHumorStateStore 
} from '../store/index.js';
import { buildCharacterPrompt } from '../ai/prompts/promptBuilder.js';
import type { Challenge } from '../types/challenge.js';

export interface PlanTurnOptions {
  userId: string;
  userInput: string;
  activeChallenge?: Challenge | null;
}

export interface PlanTurnDependencies {
  modelRouter: ModelRouter;
  relationshipStore: IRelationshipStateStore;
  memoryStore: IMemoryStore;
  humorStore: IHumorStateStore;
  eventStore: IEventStore;
}

export class ResponsePlanner {
  constructor(private readonly deps: PlanTurnDependencies) {}

  async planTurn(options: PlanTurnOptions): Promise<AIResponseContract> {
    const { userId, userInput, activeChallenge } = options;

    // 1. Retrieve relationship
    const relationship = await this.deps.relationshipStore.get(userId);
    if (!relationship) {
      throw new Error('Relationship state not found for user');
    }

    // 2. Retrieve context/memory
    const memories = await this.deps.memoryStore.retrieveRelevant(userId, { tags: [userInput] });
    
    // 3. Retrieve humor state
    const recentHumor = await this.deps.humorStore.recentMechanisms(userId);

    // 4. Build prompt
    const generateOptions = buildCharacterPrompt({
      userInput,
      relationship,
      activeChallenge,
      memories,
      recentHumor
    });

    // 5. Generate response using chat model
    const aiProvider = this.deps.modelRouter.forChat();
    const aiResponse = await aiProvider.generate(generateOptions);

    // 6. Validate response contract
    validateAIResponseContract(aiResponse);

    // 7. Persist valid memory candidates
    if (aiResponse.memoryCandidates && aiResponse.memoryCandidates.length > 0) {
      for (const candidate of aiResponse.memoryCandidates) {
        // Simple heuristic for persistence (e.g. confidence > 0.7)
        if (candidate.confidence > 0.7) {
          await this.deps.memoryStore.write({
            userId,
            tier: candidate.tier,
            category: candidate.category,
            key: candidate.key,
            value: candidate.value as string | Record<string, unknown>,
            strength: Math.floor(candidate.confidence * 100)
          });
        }
      }
    }

    // 8. Persist humor usage if any
    if (aiResponse.humorMechanism) {
      await this.deps.humorStore.record(userId, aiResponse.humorMechanism, 'user', 5);
    }

    // 9. Persist events if any
    if (aiResponse.eventSuggestions && aiResponse.eventSuggestions.length > 0) {
      for (const event of aiResponse.eventSuggestions) {
        if (event.confidence > 0.7) {
          await this.deps.eventStore.append({
            userId,
            eventType: event.suggestedEventType,
            payload: event.suggestedPayload,
            source: 'ai_suggested'
          });
        }
      }
    }

    return aiResponse;
  }
}
