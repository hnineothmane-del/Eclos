import type { AIResponseContract, AIMemoryCandidate } from '../types/aiContract.js';
import type { ModelRouter } from '../ai/router.js';
import { validateAIResponseContract } from '../ai/validation.js';
import type { IRelationshipStateStore, IMemoryStore, IHumorStateStore } from '../store/index.js';
import { buildCharacterPrompt } from '../ai/prompts/promptBuilder.js';
import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RankedMemoryItem } from '../memory/retrieval.js';

const RESPONSE_MODES = ['roast', 'observational_roast', 'challenge', 'judgment', 'grudging_praise', 'serious', 'supportive', 'banter', 'bored', 'curious', 'help', 'meta_rejection'] as const;
const HUMOR_MECHANISMS = ['deadpan', 'mock_formal', 'absurd_escalation', 'observational', 'contextual_roast', 'callback', 'running_joke', 'irony', 'sarcasm', 'wit', 'nonsense', 'anti_climax', 'self_aware', 'self_deprecation', 'unexpected_praise', 'strategic_silence'] as const;
const MEMORY_CATEGORIES = new Set(['goal', 'achievement', 'failure', 'commitment', 'milestone', 'running_joke', 'observation', 'preference']);

export type ResponseMode = typeof RESPONSE_MODES[number];
export type HumorMechanism = typeof HUMOR_MECHANISMS[number];
export interface TurnDecision { mode: ResponseMode; humorMechanism: HumorMechanism | null; target: string; callback: RankedMemoryItem | null; serious: boolean; register: string; intensity: number; }

export interface ProcessCapture {
  captureType: 'process_signal' | 'process_thought';
  signal?: string;
  content?: string;
  timestamp: string;
}

export interface PlanTurnOptions { userId: string; userInput: string; activeChallenge?: Challenge | null; processCaptures?: ProcessCapture[]; }
export interface PlanTurnDependencies { modelRouter: ModelRouter; relationshipStore: IRelationshipStateStore; memoryStore: IMemoryStore; humorStore: IHumorStateStore; eventStore?: import('../store/index.js').IEventStore; }


function hasAny(input: string, terms: readonly string[]): boolean { return terms.some((term) => input.includes(term)); }
function chooseMechanism(preferred: readonly HumorMechanism[], recent: readonly string[]): HumorMechanism | null { return preferred.find((mechanism) => !recent.includes(mechanism)) || null; }

export function selectTurnDecision(userInput: string, relationship: RelationshipState, activeChallenge: Challenge | null | undefined, memories: readonly RankedMemoryItem[], recentHumor: readonly string[]): TurnDecision {
  const normalized = userInput.toLowerCase();
  const severe = hasAny(normalized, ['suicid', 'self harm', 'self-harm', 'want to die', 'grief', 'funeral', 'abuse', 'panic attack']);
  const vulnerable = hasAny(normalized, ['i am scared', "i'm scared", 'i feel hopeless', 'i am struggling', "i'm struggling"]);
  const achievement = hasAny(normalized, ['finished', 'completed', 'passed', 'shipped', 'did it', 'won']);
  const callback = !severe && !vulnerable ? (memories[0] || null) : null;
  const register = relationship.familiarity >= 60 ? 'informal' : 'direct';
  if (severe || vulnerable) return { mode: severe ? 'serious' : 'supportive', humorMechanism: null, target: 'current disclosure', callback: null, serious: true, register, intensity: 1 };
  if (achievement) return { mode: 'grudging_praise', humorMechanism: chooseMechanism(['unexpected_praise', 'deadpan', 'anti_climax'], recentHumor), target: 'current achievement', callback, serious: relationship.respect >= 75, register, intensity: 4 };
  if (activeChallenge?.status === 'evidence_submitted') return { mode: 'judgment', humorMechanism: chooseMechanism(['mock_formal', 'deadpan', 'contextual_roast'], recentHumor), target: 'current challenge evidence', callback, serious: false, register, intensity: 6 };
  if (userInput.trim().endsWith('?')) return { mode: 'help', humorMechanism: chooseMechanism(['wit', 'mock_formal', 'deadpan'], recentHumor), target: 'current decision', callback, serious: false, register, intensity: 4 };
  const target = activeChallenge ? 'current behavior against the active challenge' : callback ? 'repeated behavior pattern from shared history' : 'current behavior';
  const preferred: HumorMechanism[] = callback ? ['callback', 'running_joke', 'contextual_roast', 'observational', 'irony', 'sarcasm'] : activeChallenge ? ['contextual_roast', 'observational', 'mock_formal', 'absurd_escalation', 'irony'] : ['observational', 'sarcasm', 'mock_formal', 'absurd_escalation', 'wit'];
  return { mode: relationship.mode === 'permanent_rival' ? 'roast' : 'observational_roast', humorMechanism: chooseMechanism(preferred, recentHumor), target, callback, serious: false, register, intensity: relationship.mode === 'permanent_rival' ? 8 : 6 };
}

function isGroundedMemory(candidate: AIMemoryCandidate, userInput: string, activeChallenge: Challenge | null | undefined): boolean {
  if (!MEMORY_CATEGORIES.has(candidate.category)) return false;
  if (typeof candidate.value !== 'string' || !candidate.value.trim()) return false;
  const candidateText = candidate.value.toLowerCase();
  const input = userInput.toLowerCase();
  if (input.includes(candidateText)) return true;
  const challengeSource = activeChallenge
    ? `${activeChallenge.objective} ${activeChallenge.constraints.join(' ')}`.toLowerCase()
    : '';
  return challengeSource.includes(candidateText);
}

export class ResponsePlanner {
  constructor(private readonly deps: PlanTurnDependencies) {}
  async planTurn(options: PlanTurnOptions): Promise<AIResponseContract> {
    const { userId, userInput, activeChallenge } = options;
    const relationship = await this.deps.relationshipStore.get(userId);
    if (!relationship) throw new Error('Relationship state not found for user');
    const memories = await this.deps.memoryStore.retrieveRelevant(userId, { tags: [userInput], topK: 3 });
    const recentHumor = await this.deps.humorStore.recentMechanisms(userId);
    const decision = selectTurnDecision(userInput, relationship, activeChallenge, memories, recentHumor);

    // Fetch process captures directly from DB
    let processCaptures = options.processCaptures;
    if (!processCaptures && activeChallenge && this.deps.eventStore) {
      const recentEvents = await this.deps.eventStore.recentForUser(userId, 50);
      processCaptures = recentEvents
        .filter(e => (e.eventType === 'process_signal' || e.eventType === 'process_thought') && (e.payload as any)?.challenge_id === activeChallenge.id)
        .map(e => ({
          captureType: e.eventType as 'process_signal' | 'process_thought',
          signal: (e.payload as any)?.signal,
          content: (e.payload as any)?.content,
          timestamp: e.createdAt,
        }));
    }

    const aiResponse = validateAIResponseContract(await this.deps.modelRouter.forChat().generate(buildCharacterPrompt({ userInput, relationship, activeChallenge, decision, processCaptures })));
    for (const candidate of aiResponse.memoryCandidates || []) {
      if (isGroundedMemory(candidate, userInput, activeChallenge)) await this.deps.memoryStore.write({ userId, tier: candidate.tier, category: candidate.category, key: candidate.key, value: candidate.value, strength: Math.floor(candidate.confidence * 100) });
    }
    if (decision.humorMechanism && HUMOR_MECHANISMS.includes(decision.humorMechanism)) await this.deps.humorStore.record(userId, decision.humorMechanism, decision.target, decision.intensity);
    // Event suggestions are advisory only and deliberately have no generic persistence path.
    return { ...aiResponse, humorMechanism: decision.humorMechanism, register: decision.register, seriousFlag: decision.serious };
  }
}

