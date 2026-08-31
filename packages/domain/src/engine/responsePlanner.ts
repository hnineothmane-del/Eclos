import type { AIResponseContract, AIMemoryCandidate } from '../types/aiContract.js';
import type { ModelRouter } from '../ai/router.js';
import { validateAIResponseContract } from '../ai/validation.js';
import type { IRelationshipStateStore, IMemoryStore, IHumorStateStore } from '../store/index.js';
import { buildCharacterPrompt } from '../ai/prompts/promptBuilder.js';
import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RankedMemoryItem } from '../memory/retrieval.js';
import { deriveCharacterPlan, type CharacterPlan, type DirectorHumorMechanism } from './characterDirector.js';
import { deriveProcessInsights, type ProcessInsight } from './processInsights.js';
import type { PresenceDecision } from './presenceEngine.js';
import { inferChallengeDomain, selectChallengePrimitive, type ChallengeOutcome, type ChallengePrimitive, type ChallengeSelection } from '../challenge/challengeSelector.js';
import { deriveRivalMemories, type RivalMemory } from './rivalMemory.js';
import { selectRivalMemory, type SelectedMemory } from './rivalMemorySelector.js';
import { deriveRivalInsights, type RivalInsight } from './rivalInsights.js';
import { selectRivalInsight, type SelectedInsight } from './rivalInsightSelector.js';

const RESPONSE_MODES = ['roast', 'observational_roast', 'challenge', 'judgment', 'grudging_praise', 'serious', 'supportive', 'banter', 'bored', 'curious', 'help', 'meta_rejection'] as const;
const HUMOR_MECHANISMS = ['deadpan', 'mock_formal', 'absurd_escalation', 'observational', 'contextual_roast', 'callback', 'running_joke', 'irony', 'sarcasm', 'wit', 'nonsense', 'anti_climax', 'self_aware', 'self_deprecation', 'unexpected_praise', 'strategic_silence'] as const;
const MEMORY_CATEGORIES = new Set(['goal', 'achievement', 'failure', 'commitment', 'milestone', 'running_joke', 'observation', 'preference']);

export type ResponseMode = typeof RESPONSE_MODES[number];
export type HumorMechanism = DirectorHumorMechanism;
export interface TurnDecision { mode: ResponseMode; humorMechanism: HumorMechanism | null; target: string; callback: RankedMemoryItem | null; serious: boolean; register: string; intensity: number; }

export interface ProcessCapture {
  captureType: 'process_signal' | 'process_thought';
  signal?: string;
  content?: string;
  timestamp: string;
}

export interface PlanTurnOptions { userId: string; userInput: string; activeChallenge?: Challenge | null; presenceDecision?: PresenceDecision | null; }
export interface AmbientTurnOptions { userId: string; presenceDecision: PresenceDecision; activeChallenge?: Challenge | null; }
export interface PlanTurnDependencies { modelRouter: ModelRouter; relationshipStore: IRelationshipStateStore; memoryStore: IMemoryStore; humorStore: IHumorStateStore; eventStore?: import('../store/index.js').IEventStore; }
export interface PlannedResponse extends AIResponseContract { challengeSelection?: ChallengeSelection | null; }


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
  /** Renders a concrete deterministic ambient event only; silence costs zero AI calls. */
  async planAmbientTurn(options: AmbientTurnOptions): Promise<PlannedResponse | null> {
    if (!options.presenceDecision.action) return null;
    return this.planTurn({ userId: options.userId, userInput: '', activeChallenge: options.activeChallenge, presenceDecision: options.presenceDecision });
  }
  async planTurn(options: PlanTurnOptions): Promise<PlannedResponse> {
    const { userId, userInput, activeChallenge, presenceDecision } = options;
    const relationship = await this.deps.relationshipStore.get(userId);
    if (!relationship) throw new Error('Relationship state not found for user');
    const memories = await this.deps.memoryStore.retrieveRelevant(userId, { tags: [userInput], topK: 3 });
    const recentHumor = await this.deps.humorStore.recentMechanisms(userId);

    // Process captures are loaded only from the immutable event ledger. They are
    // voluntary user observations, not verified challenge facts.
    let processCaptures: ProcessCapture[] | undefined;
    let processInsights: ProcessInsight[] | undefined;
    if (activeChallenge && this.deps.eventStore) {
      const recentEvents = await this.deps.eventStore.recentForUser(userId, 50);
      processCaptures = recentEvents
        .filter(e => ((e.eventType as string) === 'process_signal' || (e.eventType as string) === 'process_thought') && (e.payload as any)?.challenge_id === activeChallenge.id)
        .map(e => ({
          captureType: e.eventType as 'process_signal' | 'process_thought',
          signal: (e.payload as any)?.signal ? `USER-PROVIDED, UNVERIFIED: ${(e.payload as any).signal}` : undefined,
          content: (e.payload as any)?.content ? `USER-PROVIDED, UNVERIFIED: ${(e.payload as any).content}` : undefined,
          timestamp: e.createdAt,
        }));
      
      processInsights = deriveProcessInsights(activeChallenge, recentEvents);
    }

    const characterPlan = deriveCharacterPlan({
      userInput,
      relationship,
      activeChallenge,
      memories,
      processInsights: processInsights || [],
      recentHumor,
      presenceDecision,
    });

    // ── Rival Memory derivation (pure, deterministic, zero AI calls) ──────────
    let rivalMemories: RivalMemory[] = [];
    let selectedRivalMemory: SelectedMemory | null = null;
    {
      const allEvents = (activeChallenge && this.deps.eventStore)
        ? await this.deps.eventStore.recentForUser(userId, 100)
        : [];
      const existingMemoryItems = memories.map(r => r.item);
      const normalizedChallenge: Challenge | null = activeChallenge ?? null;
      const memDerivation = deriveRivalMemories({
        userInput,
        activeChallenge: normalizedChallenge,
        processInsights: processInsights || [],
        recentEvents: allEvents,
        existingMemories: existingMemoryItems,
        nowIso: new Date().toISOString(),
        userId,
      });
      rivalMemories = memDerivation.newMemories;

      // Persist new rival memories via existing memoryStore (category = observation / commitment / etc.)
      for (const mem of memDerivation.newMemories) {
        if (mem.epistemicStatus !== 'hypothesis') {
          await this.deps.memoryStore.write({
            userId,
            tier: mem.type === 'behavioral' || mem.type === 'relationship' ? 'permanent' : 'decaying',
            category: mem.type === 'callback' ? 'running_joke' : mem.type === 'factual' ? 'commitment' : mem.type === 'behavioral' ? 'observation' : mem.type === 'relationship' ? 'milestone' : 'observation',
            key: mem.key,
            value: JSON.stringify({ description: mem.description, verbatimQuote: mem.verbatimQuote, epistemicStatus: mem.epistemicStatus, provenance: mem.provenance }),
            strength: Math.round(mem.confidence * 100),
            expiresAt: mem.type === 'unresolved' ? null : mem.type === 'factual' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
          }).catch(() => { /* non-blocking */ });
        }
      }

      // Determine isSeriousContext / isChallengeCritical for selector
      const isSeriousContext = characterPlan.state.seriousness >= 7;
      const isChallengeCritical = activeChallenge?.status === 'evidence_submitted' || activeChallenge?.status === 'needs_more_evidence';

      // Build RivalMemory candidates from existing stored memories too
      const storedAsRivalMemories: RivalMemory[] = memories.map(r => ({
        key: r.item.key,
        type: 'callback' as const,
        epistemicStatus: 'reported' as const,
        description: `${r.item.category}: ${String(r.item.value)}`,
        verbatimQuote: typeof r.item.value === 'string' ? r.item.value : null,
        confidence: r.item.strength / 100,
        strength: r.item.strength,
        provenance: { sourceEventIds: [], sourceInsightTypes: [], challengeId: null, derivedAt: r.item.createdAt },
      }));

      const allRivalMemories = [...storedAsRivalMemories, ...memDerivation.newMemories];

      selectedRivalMemory = selectRivalMemory({
        memories: allRivalMemories,
        userInput,
        relationship,
        activeChallenge: normalizedChallenge,
        isSeriousContext,
        isChallengeCritical,
        recentHumor,
        recentlySurfacedKeys: [],
        nowIso: new Date().toISOString(),
      });
    }

    // ── Rival Insight derivation (pure, deterministic, zero AI calls) ──────────
    let selectedInsight: SelectedInsight | null = null;
    {
      const allEvents = (this.deps.eventStore)
        ? await this.deps.eventStore.recentForUser(userId, 200) // need a longer history for insights
        : [];
      
      const derivedInsights = deriveRivalInsights({
        allEvents,
        rivalMemories,
        processInsights: processInsights || [],
        nowIso: new Date().toISOString(),
        userId,
      });

      const isSeriousContext = characterPlan.state.seriousness >= 7;
      const isChallengeCritical = activeChallenge?.status === 'evidence_submitted' || activeChallenge?.status === 'needs_more_evidence';
      const normalizedChallenge: Challenge | null = activeChallenge ?? null;

      selectedInsight = selectRivalInsight({
        insights: derivedInsights,
        userInput,
        relationship,
        activeChallenge: normalizedChallenge,
        isSeriousContext,
        isChallengeCritical,
        recentlySurfacedInsightKeys: [],
        nowIso: new Date().toISOString(),
      });
    }

    let recentPrimitives: ChallengePrimitive[] = [];
    let recentOutcomes: ChallengeOutcome[] = [];
    let firstSession = !activeChallenge;
    if (characterPlan.interactionMode === 'challenge_invitation' && !activeChallenge && this.deps.eventStore) {
      const history = await this.deps.eventStore.recentForUser(userId, 50);
      firstSession = !history.some((event) => event.eventType === 'challenge_issued');
      recentPrimitives = history
        .filter((event) => event.eventType === 'challenge_issued')
        .map((event) => (event.payload as { primitive?: unknown }).primitive)
        .filter((primitive): primitive is ChallengePrimitive => typeof primitive === 'string' && isChallengePrimitive(primitive));
      recentOutcomes = history
        .filter((event) => event.eventType === 'challenge_judged')
        .map((event) => (event.payload as { verdict?: unknown }).verdict)
        .filter((outcome): outcome is ChallengeOutcome => outcome === 'passed' || outcome === 'failed' || outcome === 'needs_more_evidence');
    }
    const challengeSelection = characterPlan.interactionMode === 'challenge_invitation'
      ? selectChallengePrimitive({
          objective: userInput,
          domain: inferChallengeDomain(userInput),
          difficulty: 3,
          relationship,
          interactionMode: characterPlan.interactionMode,
          activeChallenge,
          firstSession,
          recentPrimitives,
          recentOutcomes,
          processInsights: processInsights || [],
        })
      : null;
    const decision = decisionFromCharacterPlan(characterPlan, relationship, memories);

    const aiResponse = validateAIResponseContract(await this.deps.modelRouter.forChat().generate(buildCharacterPrompt({ userInput, relationship, activeChallenge, decision, characterPlan, challengeSelection, presenceDecision, processCaptures, processInsights, selectedRivalMemory, selectedInsight })));
    for (const candidate of aiResponse.memoryCandidates || []) {
      if (isGroundedMemory(candidate, userInput, activeChallenge)) await this.deps.memoryStore.write({ userId, tier: candidate.tier, category: candidate.category, key: candidate.key, value: candidate.value, strength: Math.floor(candidate.confidence * 100) });
    }
    if (decision.humorMechanism && HUMOR_MECHANISMS.includes(decision.humorMechanism)) await this.deps.humorStore.record(userId, decision.humorMechanism, decision.target, decision.intensity);
    // Event suggestions are advisory only and deliberately have no generic persistence path.
    return { ...aiResponse, humorMechanism: decision.humorMechanism, register: decision.register, seriousFlag: decision.serious, challengeSelection };
  }
}

function isChallengePrimitive(value: string): value is ChallengePrimitive {
  return ['micro_test', 'timed_execution', 'proof_of_work', 'constraint_test', 'knowledge_demonstration', 'recovery_test', 'strategy_switch_test', 'contradiction_test', 'creative_test', 'real_world_action'].includes(value);
}

function decisionFromCharacterPlan(plan: CharacterPlan, relationship: RelationshipState, memories: readonly RankedMemoryItem[]): TurnDecision {
  const modeByInteraction: Record<CharacterPlan['interactionMode'], ResponseMode> = {
    banter: 'banter', observation: 'observational_roast', challenge_invitation: 'challenge', challenge_response: 'judgment',
    callback: 'roast', sincere_recognition: 'grudging_praise', serious_intervention: 'serious', pushback: 'roast', question: 'curious', quiet: 'bored',
  };
  const callback = plan.humor?.target === 'historical_callback' ? memories[0] || null : null;
  return {
    mode: modeByInteraction[plan.interactionMode],
    humorMechanism: plan.humor?.mechanism || null,
    target: plan.target || 'current behavior',
    callback,
    serious: plan.state.seriousness >= 7,
    register: relationship.familiarity >= 60 ? 'informal' : 'direct',
    intensity: plan.humor?.intensity || plan.state.intensity,
  };
}
