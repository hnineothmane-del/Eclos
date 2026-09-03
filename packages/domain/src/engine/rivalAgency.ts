import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { DomainEvent } from '../types/events.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { CharacterPlan } from './characterDirector.js';
import type { SelectedMemory } from './rivalMemorySelector.js';
import type { SelectedInsight } from './rivalInsightSelector.js';
import type { ProcessInsight } from './processInsights.js';
import type { RivalRelationshipContext } from './rivalRelationshipContext.js';

export type InitiativeCategory =
  | 'RETURN_REMARK'
  | 'WAKE_REMARK'
  | 'UNRESOLVED_FOLLOWUP'
  | 'CALLBACK_INTERRUPTION'
  | 'CHALLENGE_PROVOCATION'
  | 'USER_ROAST_RESPONSE'
  | 'USER_INTERACTION_REACTION'
  | 'RARE_CHARACTER_EVENT'
  | 'FICTIONAL_INTERRUPTION'
  | 'IDLE_REMARK'
  | 'SELF_AMUSEMENT'
  | 'MILD_IMPATIENCE'
  | 'ABORTED_THOUGHT'
  | 'OBSERVATIONAL_INTERRUPTION'
  | 'QUIET';

export interface RivalInitiativeDecision {
  action: InitiativeCategory;
  priority: number;
  reason: string;
  sourceEventIds: string[];
  sourceMemoryKeys: string[];
  sourceInsightKeys: string[];
  requestedInteractionMode: CharacterPlan['interactionMode'] | null;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  cooldownKey: string | null;
}

import type { RivalInteractionHook } from './rivalLivingState.js';

export interface AgencyInput {
  allEvents: readonly DomainEvent[];
  userInput: string;
  activeChallenge: Challenge | null;
  presence: PresenceDecision;
  relationship: RelationshipState;
  characterPlan: CharacterPlan;
  selectedMemory: SelectedMemory | null;
  selectedInsight: SelectedInsight | null;
  processInsights: readonly ProcessInsight[];
  recentInitiatives: readonly DomainEvent[]; // events where we executed an initiative
  interactionHook?: RivalInteractionHook | null;
  nowIso: string;
  relationshipContext?: RivalRelationshipContext;
}

export const AGENCY_PRIORITIES = {
  SERIOUS_INTERVENTION: 100,
  CHALLENGE_CRITICAL: 90,
  RETURN_WAKE: 80,
  // A deliberate user interaction is more important than a passive
  // return/wake opportunity; continuity can be rendered on the next turn.
  USER_INTERACTION: 85,
  UNRESOLVED_FOLLOWUP: 60,
  HIGH_VALUE_CALLBACK: 50,
  MEANINGFUL_OBSERVATION: 40,
  BOREDOM_IDLE: 30,
  RARE_EVENT: 20,
  QUIET: 0,
} as const;

const AMBIENT_LIFE_ACTIONS: readonly InitiativeCategory[] = [
  'RARE_CHARACTER_EVENT',
  'FICTIONAL_INTERRUPTION',
  'SELF_AMUSEMENT',
  'ABORTED_THOUGHT',
  'IDLE_REMARK',
  'MILD_IMPATIENCE',
];
const AMBIENT_LIFE_COOLDOWN_MS = 25 * 60 * 1000;
const SAME_AMBIENT_CATEGORY_COOLDOWN_MS = 4 * 60 * 60 * 1000;

function isRoast(userInput: string): boolean {
  const normalized = userInput.toLowerCase();
  const roastWords = ['idiot', 'stupid', 'dumb', 'useless', 'shut up', 'bot', 'trash', 'slow', 'weak', 'pathetic', 'roast', 'loser'];
  return roastWords.some(w => normalized.includes(w));
}

function getRecentInitiatives(input: AgencyInput, category: InitiativeCategory, timeWindowMs: number): number {
  const now = new Date(input.nowIso).getTime();
  return input.recentInitiatives.filter(e => 
    e.eventType === 'agency_initiative' && 
    (e.payload as any)?.category === category &&
    (now - new Date(e.createdAt).getTime()) <= timeWindowMs
  ).length;
}

function hasRecentAmbientLife(input: AgencyInput, categories: readonly InitiativeCategory[], timeWindowMs: number): boolean {
  const now = new Date(input.nowIso).getTime();
  return input.recentInitiatives.some((event) =>
    event.eventType === 'agency_initiative'
    && categories.includes((event.payload as { category?: InitiativeCategory }).category as InitiativeCategory)
    && now - new Date(event.createdAt).getTime() <= timeWindowMs,
  );
}

function hasKnownLore(input: AgencyInput): boolean {
  return input.allEvents.some((event) => event.eventType === 'rival_lore_revealed');
}

function selectRareLifeAction(input: AgencyInput): InitiativeCategory {
  // The selection is intentionally driven by real state/history—not chance.
  if (input.presence.activity === 'occupied' || hasKnownLore(input)) return 'FICTIONAL_INTERRUPTION';
  if (input.presence.state === 'bored') return 'SELF_AMUSEMENT';
  if (input.presence.state === 'resting' || input.presence.state === 'sleeping') return 'IDLE_REMARK';
  return 'ABORTED_THOUGHT';
}

export function deriveAgencyDecision(input: AgencyInput): RivalInitiativeDecision {
  const isSerious = input.characterPlan.state.seriousness >= 7;
  const isChallengeCritical = input.activeChallenge?.status === 'evidence_submitted' || input.activeChallenge?.status === 'needs_more_evidence';

  // SERIOUS CONTEXT SUPPRESSION
  // In a serious context, the Rival doesn't act autonomously with typical initiative,
  // but may still respond quietly or provide serious support. We suppress most proactive behavior.
  if (isSerious) {
    return {
      action: 'QUIET',
      priority: AGENCY_PRIORITIES.SERIOUS_INTERVENTION,
      reason: 'User is in a serious context. Suppressing normal agency.',
      sourceEventIds: [],
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'serious_intervention',
      urgency: 'critical',
      cooldownKey: null,
    };
  }

  // CHALLENGE CRITICAL SUPPRESSION
  if (isChallengeCritical) {
    // Critical challenge work owns the turn. A direct message can still be
    // rendered by the normal challenge-response path, but initiative must not
    // replace it with a roast, callback, or ambient interruption.
    return {
      action: 'QUIET',
      priority: AGENCY_PRIORITIES.CHALLENGE_CRITICAL,
      reason: 'Challenge is in critical state (evidence submitted). Suppressing ambient interruptions.',
      sourceEventIds: [],
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'challenge_response',
      urgency: 'high',
      cooldownKey: null,
    };
  }

  // Candidates for initiative
  const candidates: RivalInitiativeDecision[] = [];

  // 1. PRESENCE-DRIVEN: RETURN / WAKE
  if (input.presence.action === 'return_greeting') {
    candidates.push({
      action: 'RETURN_REMARK',
      priority: AGENCY_PRIORITIES.RETURN_WAKE,
      reason: 'User returned after meaningful absence.',
      sourceEventIds: input.presence.sourceEventIds,
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'banter',
      urgency: 'medium',
      cooldownKey: 'return_greeting',
    });
  } else if (input.presence.action === 'sleep_end' || input.presence.action === 'unexpected_wake') {
    candidates.push({
      action: 'WAKE_REMARK',
      priority: AGENCY_PRIORITIES.RETURN_WAKE,
      reason: 'Rival woke up.',
      sourceEventIds: input.presence.sourceEventIds,
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'banter',
      urgency: 'medium',
      cooldownKey: 'wake',
    });
  }

  // 2. USER-DIRECTED: ROAST RESPONSE
  if (input.userInput && isRoast(input.userInput)) {
    candidates.push({
      action: 'USER_ROAST_RESPONSE',
      priority: AGENCY_PRIORITIES.USER_INTERACTION,
      reason: 'User intentionally roasted the Rival.',
      sourceEventIds: [],
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'pushback',
      urgency: 'high',
      cooldownKey: 'user_roast',
    });
  }

  // 3. USER-DIRECTED: INTERACTION HOOK (tap, poke, etc. mapped via presence opportunity/action)
  if (input.interactionHook) {
    let urgency: RivalInitiativeDecision['urgency'] = 'medium';
    let interactionMode: CharacterPlan['interactionMode'] = 'banter';
    if (input.interactionHook === 'poke' || input.interactionHook === 'interrupt') {
      interactionMode = 'pushback';
    } else if (input.interactionHook === 'wake') {
      interactionMode = 'observation';
    }
    
    candidates.push({
      action: 'USER_INTERACTION_REACTION',
      priority: AGENCY_PRIORITIES.USER_INTERACTION,
      reason: `User explicitly interacted via ${input.interactionHook}.`,
      sourceEventIds: [],
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: interactionMode,
      urgency,
      cooldownKey: null, // explicit interaction always works
    });
  }

  // 4. UNRESOLVED FOLLOWUP (e.g. unresolved memory exists, and we are not doing anything else)
  if (input.selectedMemory && input.selectedMemory.memory.type === 'unresolved' && !input.activeChallenge && !input.userInput) {
    if (getRecentInitiatives(input, 'UNRESOLVED_FOLLOWUP', 60 * 60 * 1000) === 0) {
      candidates.push({
        action: 'UNRESOLVED_FOLLOWUP',
        priority: AGENCY_PRIORITIES.UNRESOLVED_FOLLOWUP,
        reason: 'Bringing up unfinished business.',
        sourceEventIds: input.selectedMemory.memory.provenance.sourceEventIds,
        sourceMemoryKeys: [input.selectedMemory.memory.key],
        sourceInsightKeys: [],
        requestedInteractionMode: 'banter',
        urgency: 'medium',
        cooldownKey: 'unresolved_followup',
      });
    }
  }

  // 5. HIGH-VALUE CALLBACK / INSIGHT
  if (!input.userInput) {
    if (input.selectedInsight && input.selectedInsight.score > 35) {
      if (getRecentInitiatives(input, 'CALLBACK_INTERRUPTION', 30 * 60 * 1000) === 0) {
        candidates.push({
          action: 'CALLBACK_INTERRUPTION',
          priority: AGENCY_PRIORITIES.HIGH_VALUE_CALLBACK,
          reason: 'Strong behavioral pattern observed and selected.',
          sourceEventIds: input.selectedInsight.insight.provenance.sourceEventIds,
          sourceMemoryKeys: [],
          sourceInsightKeys: [input.selectedInsight.insight.key],
          requestedInteractionMode: 'observation',
          urgency: 'medium',
          cooldownKey: 'callback_insight',
        });
      }
    } else if ((input.relationshipContext?.callbackDepth ?? 2) >= 2 && input.selectedMemory && input.selectedMemory.score > 70 && input.selectedMemory.memory.type !== 'unresolved') {
      if (getRecentInitiatives(input, 'CALLBACK_INTERRUPTION', 30 * 60 * 1000) === 0) {
        candidates.push({
          action: 'CALLBACK_INTERRUPTION',
          priority: AGENCY_PRIORITIES.HIGH_VALUE_CALLBACK,
          reason: 'Strong memory context makes it worth bringing up.',
          sourceEventIds: input.selectedMemory.memory.provenance.sourceEventIds,
          sourceMemoryKeys: [input.selectedMemory.memory.key],
          sourceInsightKeys: [],
          requestedInteractionMode: 'callback',
          urgency: 'medium',
          cooldownKey: 'callback_memory',
        });
      }
    }
  }

  // 6. MEANINGFUL OBSERVATION (Idle Observation)
  if (!input.userInput && input.presence.action === 'idle_reaction') {
    candidates.push({
      action: 'OBSERVATIONAL_INTERRUPTION',
      priority: AGENCY_PRIORITIES.MEANINGFUL_OBSERVATION,
      reason: 'User has been idle or stalled for a while.',
      sourceEventIds: input.presence.sourceEventIds,
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'question',
      urgency: 'low',
      cooldownKey: 'observational_interruption',
    });
  }

  // 7. BOREDOM / IDLE
  if (!input.userInput && input.presence.state === 'bored' && input.presence.action !== 'rare_character_event') {
    if (!hasRecentAmbientLife(input, AMBIENT_LIFE_ACTIONS, AMBIENT_LIFE_COOLDOWN_MS)) {
      const action: InitiativeCategory = hasKnownLore(input) ? 'FICTIONAL_INTERRUPTION' : 'MILD_IMPATIENCE';
      candidates.push({
        action,
        priority: AGENCY_PRIORITIES.BOREDOM_IDLE,
        reason: `Rival is bored. Selected ${action}.`,
        sourceEventIds: [],
        sourceMemoryKeys: [],
        sourceInsightKeys: [],
        requestedInteractionMode: 'observation',
        urgency: 'low',
        cooldownKey: action.toLowerCase(),
      });
    }
  }

  // 8. RARE CHARACTER EVENT
  if (!input.userInput && input.presence.action === 'rare_character_event') {
    const action = selectRareLifeAction(input);
    if (!hasRecentAmbientLife(input, AMBIENT_LIFE_ACTIONS, AMBIENT_LIFE_COOLDOWN_MS)
      && !hasRecentAmbientLife(input, [action], SAME_AMBIENT_CATEGORY_COOLDOWN_MS)) {
      candidates.push({
        action,
        priority: AGENCY_PRIORITIES.RARE_EVENT,
        reason: 'A low-frequency character-life opportunity is contextually warranted.',
        sourceEventIds: input.presence.sourceEventIds,
        sourceMemoryKeys: [],
        sourceInsightKeys: [],
        requestedInteractionMode: 'observation',
        urgency: 'low',
        cooldownKey: 'rare_event',
      });
    }
  }

  // 9. CHALLENGE PROVOCATION
  if (!input.userInput && !input.activeChallenge && input.presence.state === 'active') {
    if (getRecentInitiatives(input, 'CHALLENGE_PROVOCATION', 2 * 60 * 60 * 1000) === 0 && input.characterPlan.interactionMode === 'challenge_invitation') {
      candidates.push({
        action: 'CHALLENGE_PROVOCATION',
        priority: AGENCY_PRIORITIES.MEANINGFUL_OBSERVATION,
        reason: 'Rival decides to initiate a challenge.',
        sourceEventIds: [],
        sourceMemoryKeys: [],
        sourceInsightKeys: [],
        requestedInteractionMode: 'challenge_invitation',
        urgency: 'medium',
        cooldownKey: 'challenge_provocation',
      });
    }
  }

  // Sort candidates by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  if (candidates.length > 0) {
    return candidates[0];
  }

  // SILENCE
  return {
    action: 'QUIET',
    priority: AGENCY_PRIORITIES.QUIET,
    reason: 'No worthy initiative. Silence is a valid agency decision.',
    sourceEventIds: [],
    sourceMemoryKeys: [],
    sourceInsightKeys: [],
    requestedInteractionMode: null,
    urgency: 'low',
    cooldownKey: null,
  };
}
