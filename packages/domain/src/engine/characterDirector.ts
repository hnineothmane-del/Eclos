import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RankedMemoryItem } from '../memory/retrieval.js';
import type { ProcessInsight } from './processInsights.js';
import type { PresenceDecision } from './presenceEngine.js';
import { deriveRivalRelationshipContext, type RivalRelationshipContext } from './rivalRelationshipContext.js';

export type RivalMood = 'playful' | 'smug' | 'irritated' | 'curious' | 'serious' | 'amused';
export type InteractionMode =
  | 'banter'
  | 'observation'
  | 'challenge_invitation'
  | 'challenge_response'
  | 'callback'
  | 'sincere_recognition'
  | 'serious_intervention'
  | 'pushback'
  | 'question'
  | 'quiet';

export type DirectorHumorMechanism =
  | 'deadpan'
  | 'mock_formal'
  | 'absurd_escalation'
  | 'observational'
  | 'contextual_roast'
  | 'callback'
  | 'running_joke'
  | 'irony'
  | 'sarcasm'
  | 'wit'
  | 'nonsense'
  | 'anti_climax'
  | 'self_aware'
  | 'self_deprecation'
  | 'unexpected_praise'
  | 'strategic_silence';

export type HumorTarget =
  | 'current_behavior'
  | 'user_statement'
  | 'process_insight'
  | 'historical_callback'
  | 'user_claim'
  | 'challenge'
  | 'rival'
  | 'system';

export interface RivalCharacterState {
  mood: RivalMood;
  intensity: number;
  curiosity: number;
  seriousness: number;
}

export interface HumorOpportunity {
  mechanism: DirectorHumorMechanism;
  target: HumorTarget;
  intensity: number;
  reason: string;
  sourceEventIds: string[];
}

export interface CharacterPlan {
  state: RivalCharacterState;
  interactionMode: InteractionMode;
  humor: HumorOpportunity | null;
  sincerity: boolean;
  target: HumorTarget | null;
}

export interface CharacterDirectorInput {
  userInput: string;
  relationship: RelationshipState;
  activeChallenge?: Challenge | null;
  memories: readonly RankedMemoryItem[];
  processInsights: readonly ProcessInsight[];
  recentHumor: readonly string[];
  /** Produced server-side by the deterministic presence engine, never model output. */
  presenceDecision?: PresenceDecision | null;
  relationshipContext?: RivalRelationshipContext;
}

const clamp = (value: number) => Math.max(0, Math.min(10, value));
const hasAny = (input: string, terms: readonly string[]) => terms.some((term) => input.includes(term));
const seriousTerms = ['suicid', 'self harm', 'self-harm', 'want to die', 'grief', 'funeral', 'abuse', 'panic attack'];
const vulnerableTerms = ['i am scared', "i'm scared", 'i feel hopeless', 'i am struggling', "i'm struggling", 'maybe i should give up'];
const achievementTerms = ['finished', 'completed', 'passed', 'shipped', 'did it', 'won', 'finally done'];
const trollTerms = ['this is bullshit', 'you suck', 'shut up', 'stupid bot', 'useless'];
const metaTerms = ['this app', 'the app', 'you are an ai', 'bot', 'system'];
const lowValueTerms = ['ok', 'okay', 'k', 'lol'];
// Only specific, directional goal statements — not casual "I want" or generic verbs
const goalClaimTerms = [
  'i want to get better at',
  'i want to learn',
  'i want to practice',
  'i want to study',
  'i want to train',
  'i want to build',
  'i want to write',
  'i want to finish',
  'trying to get better at',
  'trying to learn',
  'trying to practice',
  'get in shape',
  'i am training',
  "i'm training",
];

function hasInsight(insights: readonly ProcessInsight[], types: readonly ProcessInsight['type'][]): boolean {
  return insights.some((insight) => types.includes(insight.type));
}

function firstInsight(insights: readonly ProcessInsight[], types: readonly ProcessInsight['type'][]): ProcessInsight | null {
  return insights.find((insight) => types.includes(insight.type)) || null;
}

export function deriveCharacterState(input: CharacterDirectorInput): RivalCharacterState {
  const message = input.userInput.toLowerCase();
  const serious = hasAny(message, seriousTerms) || hasAny(message, vulnerableTerms);
  const sincere = hasInsight(input.processInsights, ['persistence_after_failure', 'rapid_recovery', 'successful_under_time_pressure']);
  const irritated = hasInsight(input.processInsights, ['early_abandonment', 'repeated_strategy_switch']) || (input.activeChallenge?.status === 'needs_more_evidence' && hasAny(message, ['done', 'trust me']));
  const curious = message.endsWith('?') || hasAny(message, ['why', 'how', 'what do you think']) || hasInsight(input.processInsights, ['strategy_switch']);
  const amused = hasAny(message, trollTerms) || (hasAny(message, achievementTerms) && input.relationship.respect >= 70);

  const mood: RivalMood = serious || sincere ? 'serious' : irritated ? 'irritated' : curious ? 'curious' : amused ? 'amused' : input.relationship.rivalry >= 70 ? 'smug' : 'playful';
  const intensityBase = input.relationship.rivalry >= 70 ? 8 : input.relationship.familiarity >= 45 ? 5 : 3;

  return {
    mood,
    intensity: clamp(serious || sincere ? 1 : irritated ? intensityBase + 1 : intensityBase),
    curiosity: clamp(curious ? 8 : input.relationship.curiosity / 15),
    seriousness: clamp(serious ? 9 : sincere ? 8 : 1),
  };
}

function chooseHumor(input: CharacterDirectorInput, state: RivalCharacterState, sincerity: boolean, relationshipContext: RivalRelationshipContext): HumorOpportunity | null {
  if (state.seriousness >= 7 || sincerity || input.relationship.trust < 20) return null;
  const recent = new Set(input.recentHumor);
  const intensity = clamp(Math.min(state.intensity, relationshipContext.teasingWarmth >= 5 ? 8 : 4));
  const process = firstInsight(input.processInsights, ['initialization_delay', 'stall_then_recovery', 'strategy_switch', 'repeated_strategy_switch']);
  const message = input.userInput.toLowerCase().trim();
  // Low-value inputs ('ok', 'k', 'lol') belong to 'quiet' interactionMode — no humor signal.
  if (message.length <= 3 || lowValueTerms.includes(message)) return null;


  if (process && !recent.has('observational')) {
    return { mechanism: 'observational', target: 'process_insight', intensity, reason: 'grounded process observation is relevant', sourceEventIds: [...process.sourceEventIds] };
  }
  if (relationshipContext.callbackDepth >= 2 && input.memories[0] && !recent.has('callback')) {
    return { mechanism: 'callback', target: 'historical_callback', intensity, reason: 'relevant stored callback is available', sourceEventIds: [] };
  }
  if (hasAny(message, metaTerms) && input.relationship.familiarity >= 35 && !recent.has('self_aware')) {
    return { mechanism: 'self_aware', target: 'system', intensity, reason: 'contextual meta reference', sourceEventIds: [] };
  }
  if (hasAny(message, trollTerms) && !recent.has('sarcasm')) {
    return { mechanism: 'sarcasm', target: 'rival', intensity, reason: 'direct status play from user', sourceEventIds: [] };
  }
  if (input.activeChallenge && hasAny(message, achievementTerms) && input.activeChallenge.status !== 'evidence_submitted' && !recent.has('irony')) {
    return { mechanism: 'irony', target: 'user_claim', intensity, reason: 'claim remains unverified against an active challenge', sourceEventIds: [] };
  }

  // ── Fallback: Character-expression humor for casual/playful moods ─────────
  // When no specific condition fired, the Rival still has a natural humor
  // inclination on casual turns. Without this, the LLM receives no humor signal
  // and defaults to productivity framing. Choose the first fresh mechanism.
  if (state.mood === 'playful' || state.mood === 'amused' || state.mood === 'curious' || state.mood === 'smug') {
    const fallbackOptions: DirectorHumorMechanism[] = ['wit', 'mock_formal', 'observational', 'deadpan', 'sarcasm', 'absurd_escalation'];
    const chosen = fallbackOptions.find(m => !recent.has(m));
    if (chosen) {
      return { mechanism: chosen, target: 'user_statement', intensity, reason: 'character default expression for casual interaction', sourceEventIds: [] };
    }
  }

  return null;
}

export function deriveCharacterPlan(input: CharacterDirectorInput): CharacterPlan {
  const state = deriveCharacterState(input);
  const relationshipContext = input.relationshipContext ?? deriveRivalRelationshipContext(input.relationship);
  const message = input.userInput.trim().toLowerCase();
  const sincerity = state.seriousness >= 7
    && relationshipContext.phase !== 'introductory'
    && relationshipContext.sincerityPermission >= 4
    && hasInsight(input.processInsights, ['persistence_after_failure', 'rapid_recovery', 'successful_under_time_pressure']);
  const humor = chooseHumor(input, state, sincerity, relationshipContext);

  let interactionMode: InteractionMode;
  if (state.seriousness >= 7) interactionMode = sincerity ? 'sincere_recognition' : 'serious_intervention';
  else if (input.presenceDecision?.action === 'idle_reaction' || input.presenceDecision?.action === 'ambient_observation') interactionMode = 'observation';
  else if (input.presenceDecision?.action) interactionMode = 'banter';
  else if (input.activeChallenge?.status === 'evidence_submitted') interactionMode = 'challenge_response';
  else if (hasAny(message, trollTerms)) interactionMode = 'pushback';
  else if (message.endsWith('?')) interactionMode = 'question';
  else if (message.length <= 3 || lowValueTerms.includes(message)) interactionMode = 'quiet';
  else if (humor?.target === 'process_insight') interactionMode = 'observation';
  else if (humor?.target === 'historical_callback') interactionMode = 'callback';
  // Character First Hierarchy:
  // If the user is just chatting or reporting achievements, banter is appropriate.
  // We do NOT automatically hijack the turn with challenge_invitation just because a challenge is pending.
  else if (hasAny(message, achievementTerms)) interactionMode = 'banter';
  else if (hasAny(message, goalClaimTerms)) interactionMode = 'challenge_invitation';
  else interactionMode = 'banter';

  return { state, interactionMode, humor, sincerity, target: humor?.target || null };
}
