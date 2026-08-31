import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { DomainEvent } from '../types/events.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { CharacterPlan } from './characterDirector.js';
import type { SelectedMemory } from './rivalMemorySelector.js';
import type { SelectedInsight } from './rivalInsightSelector.js';
import type { ProcessInsight } from './processInsights.js';

export type InitiativeCategory =
  | 'RETURN_GREETING'
  | 'WAKE'
  | 'IDLE_OBSERVATION'
  | 'BORED_REACTION'
  | 'UNRESOLVED_FOLLOWUP'
  | 'CALLBACK_INTERRUPTION'
  | 'CHALLENGE_PROVOCATION'
  | 'USER_ROAST_RESPONSE'
  | 'USER_INTERACTION_REACTION'
  | 'RARE_CHARACTER_EVENT'
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
  nowIso: string;
}

export const AGENCY_PRIORITIES = {
  SERIOUS_INTERVENTION: 100,
  CHALLENGE_CRITICAL: 90,
  RETURN_WAKE: 80,
  USER_INTERACTION: 70,
  UNRESOLVED_FOLLOWUP: 60,
  HIGH_VALUE_CALLBACK: 50,
  MEANINGFUL_OBSERVATION: 40,
  BOREDOM_IDLE: 30,
  RARE_EVENT: 20,
  QUIET: 0,
} as const;

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
  if (isChallengeCritical && !input.userInput) {
    // If the user hasn't said anything, wait for them. Don't interrupt while they are submitting evidence.
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
      action: 'RETURN_GREETING',
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
      action: 'WAKE',
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
  // We assume this might come through a future event type, but for now we look at presence.action === 'idle_reaction' combined with interaction?
  // Let's rely on userInput to determine explicit touches in the future, or specific presence states.

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
    } else if (input.selectedMemory && input.selectedMemory.score > 70 && input.selectedMemory.memory.type !== 'unresolved') {
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
      action: 'IDLE_OBSERVATION',
      priority: AGENCY_PRIORITIES.MEANINGFUL_OBSERVATION,
      reason: 'User has been idle or stalled for a while.',
      sourceEventIds: input.presence.sourceEventIds,
      sourceMemoryKeys: [],
      sourceInsightKeys: [],
      requestedInteractionMode: 'question',
      urgency: 'low',
      cooldownKey: 'idle_observation',
    });
  }

  // 7. BOREDOM / IDLE
  if (!input.userInput && input.presence.state === 'bored') {
    if (getRecentInitiatives(input, 'BORED_REACTION', 60 * 60 * 1000) === 0) {
      candidates.push({
        action: 'BORED_REACTION',
        priority: AGENCY_PRIORITIES.BOREDOM_IDLE,
        reason: 'Rival is bored.',
        sourceEventIds: [],
        sourceMemoryKeys: [],
        sourceInsightKeys: [],
        requestedInteractionMode: 'observation',
        urgency: 'low',
        cooldownKey: 'boredom',
      });
    }
  }

  // 8. RARE CHARACTER EVENT
  if (!input.userInput && input.presence.action === 'rare_character_event') {
    if (getRecentInitiatives(input, 'RARE_CHARACTER_EVENT', 4 * 60 * 60 * 1000) === 0) {
      candidates.push({
        action: 'RARE_CHARACTER_EVENT',
        priority: AGENCY_PRIORITIES.RARE_EVENT,
        reason: 'A low-frequency character quirk or lore event.',
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
