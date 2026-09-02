/**
 * rivalSituationalContext.ts — Rival Situational Humor & Contextual Reaction Engine (Task 29)
 *
 * Deterministically classifies the current turn into reaction opportunities.
 * Reuses existing ProcessInsights, Longitudinal Insights, Memory, and Agency decisions
 * to produce a single, unified "Context Packet" for the LLM renderer.
 *
 * Guarantees:
 * - Specificity over intensity.
 * - One primary context + optional supporting context.
 * - Pure and deterministic. Zero AI calls.
 * - Protects self-development (serious/challenge-critical suppressions).
 */

import type { Challenge } from '../types/challenge.js';
import type { ProcessInsight } from './processInsights.js';
import type { SelectedInsight } from './rivalInsightSelector.js';
import type { SelectedMemory } from './rivalMemorySelector.js';
import type { RivalInitiativeDecision } from './rivalAgency.js';
import type { InteractionOutcome } from './rivalInteraction.js';
import type { CharacterPlan } from './characterDirector.js';
import type { RivalSessionContinuity } from './rivalSessionContinuity.js';

export type ContextCategory =
  // Challenge / Work specific
  | 'successful_completion'
  | 'failed_attempt'
  | 'recovery'
  | 'strategy_change'
  | 'contradiction'
  | 'prolonged_inactivity'
  | 'fast_completion'
  | 'slow_completion'
  | 'process_observation'
  // Social / Interaction
  | 'user_roast'
  | 'direct_interaction'
  | 'return_after_absence'
  | 'first_interaction'
  | 'social_exchange' // Playful or conversational input
  // Flavor
  | 'callback'
  | 'longitudinal_pattern'
  | 'fictional_interruption'
  | 'ambient_flavor'
  | 'general';

export interface RivalSituationalContext {
  primaryContext: ContextCategory;
  supportingContexts: ContextCategory[];
  /** Explains *why* this context was chosen (for testing/debugging and prompt grounding) */
  reasoning: string;
  sourceEventIds: string[];
  /** Specific measurable details (e.g. "completed in 94 seconds", "failed 3 times") */
  measurableDetails: string[];
  /** Explicit instructions for the renderer */
  renderingDirectives: string[];
}

export interface SituationalContextInput {
  userInput: string;
  activeChallenge: Challenge | null;
  processInsights: readonly ProcessInsight[];
  selectedInsight: SelectedInsight | null;
  selectedMemory: SelectedMemory | null;
  agencyDecision: RivalInitiativeDecision | null;
  interactionOutcome: InteractionOutcome | null;
  characterPlan: CharacterPlan;
  nowIso: string;
  continuity?: RivalSessionContinuity | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation Logic
// ─────────────────────────────────────────────────────────────────────────────

function isSocialInput(input: string): boolean {
  const normalized = input.toLowerCase();
  const socialPhrases = ['hello', 'hi', 'hey', 'what do you think', 'how are you', 'joke', 'tell me'];
  return socialPhrases.some((phrase) => normalized.includes(phrase));
}

function isRoast(input: string): boolean {
  const normalized = input.toLowerCase();
  const roastWords = ['idiot', 'stupid', 'dumb', 'useless', 'shut up', 'bot', 'trash', 'slow', 'weak', 'pathetic', 'roast', 'loser'];
  return roastWords.some((w) => normalized.includes(w));
}

export function deriveSituationalContext(input: SituationalContextInput): RivalSituationalContext {
  const {
    userInput,
    activeChallenge,
    processInsights,
    selectedInsight,
    selectedMemory,
    agencyDecision,
    interactionOutcome,
    characterPlan,
    continuity,
  } = input;

  const isSerious = characterPlan.state.seriousness >= 7;
  const isChallengeCritical = activeChallenge?.status === 'evidence_submitted' || activeChallenge?.status === 'needs_more_evidence';

  const sourceEventIds = new Set<string>();
  const measurableDetails: string[] = [];
  const renderingDirectives: string[] = [];

  // 1. SERIOUS / CRITICAL SUPPRESSION
  if (isSerious) {
    renderingDirectives.push('SERIOUS CONTEXT: No comedic escalation. Be direct and supportive or factual.');
    return {
      primaryContext: 'general',
      supportingContexts: [],
      reasoning: 'Serious context suppresses all other humor contexts.',
      sourceEventIds: [],
      measurableDetails: [],
      renderingDirectives,
    };
  }

  if (isChallengeCritical) {
    renderingDirectives.push('CHALLENGE CRITICAL: Do not interrupt the judgment flow. Focus entirely on the submitted evidence.');
    return {
      primaryContext: 'general',
      supportingContexts: [],
      reasoning: 'Challenge critical state suppresses unrelated humor.',
      sourceEventIds: [],
      measurableDetails: [],
      renderingDirectives,
    };
  }

  // 2. USER INTERACTION (Highest priority because it's a direct physical action)
  if (interactionOutcome && interactionOutcome.speechAuthorized) {
    renderingDirectives.push(`Direct physical interaction received: ${interactionOutcome.reaction}`);
    return {
      primaryContext: interactionOutcome.cooldownKey === 'user_roast' ? 'user_roast' : 'direct_interaction',
      supportingContexts: [],
      reasoning: `User explicitly interacted. Reaction: ${interactionOutcome.reaction}`,
      sourceEventIds: [],
      measurableDetails: [],
      renderingDirectives,
    };
  }

  if (userInput && isRoast(userInput)) {
    return {
      primaryContext: 'user_roast',
      supportingContexts: [],
      reasoning: 'User input classified as a roast.',
      sourceEventIds: [],
      measurableDetails: [],
      renderingDirectives: ['Respond to the user\'s roast. Push back.'],
    };
  }

  // 3. CROSS-SIGNAL SYNTHESIS & WORK-SPECIFIC EVENTS
  let primaryContext: ContextCategory | null = null;
  const supportingContexts: ContextCategory[] = [];

  // Helper to extract process insights
  const hasInsight = (type: ProcessInsight['type']) => processInsights.find((pi) => pi.type === type);

  const recovery = hasInsight('stall_then_recovery') || hasInsight('rapid_recovery') || hasInsight('persistence_after_failure');
  const failure = hasInsight('early_abandonment');
  const strategyChange = hasInsight('strategy_switch') || hasInsight('repeated_strategy_switch');
  const timePressure = hasInsight('successful_under_time_pressure');
  const delay = hasInsight('initialization_delay');

  // Add source event IDs for any matched process insights
  for (const pi of processInsights) {
    for (const id of pi.sourceEventIds) sourceEventIds.add(id);
    measurableDetails.push(pi.description);
  }

  if (recovery) {
    primaryContext = 'recovery';
    if (strategyChange) supportingContexts.push('strategy_change');
    renderingDirectives.push('Acknowledge the struggle and the successful recovery. Specificity > Intensity.');
  } else if (timePressure) {
    primaryContext = 'fast_completion';
    renderingDirectives.push('Acknowledge the speed or efficiency of completion.');
  } else if (failure) {
    primaryContext = 'failed_attempt';
    renderingDirectives.push('Acknowledge the failure or abandonment without being overly generic.');
  } else if (strategyChange) {
    primaryContext = 'strategy_change';
    renderingDirectives.push('Note the shift in approach.');
  } else if (delay) {
    primaryContext = 'prolonged_inactivity';
    renderingDirectives.push('Note the delay in taking action.');
  }

  // Synthesis: Claim vs Outcome Contradiction
  if (selectedInsight && selectedInsight.insight.family === 'claim_vs_outcome_mismatch') {
    if (!primaryContext) primaryContext = 'contradiction';
    else supportingContexts.push('contradiction');
    for (const id of selectedInsight.insight.provenance.sourceEventIds) sourceEventIds.add(id);
    measurableDetails.push(selectedInsight.insight.description);
    renderingDirectives.push('Highlight the mismatch between the user\'s prior claim and their actual behavior.');
  }

  // Synthesis: Longitudinal Patterns (e.g. repeated strategy switch)
  if (selectedInsight && selectedInsight.insight.family !== 'claim_vs_outcome_mismatch') {
    if (!primaryContext) primaryContext = 'longitudinal_pattern';
    else supportingContexts.push('longitudinal_pattern');
    for (const id of selectedInsight.insight.provenance.sourceEventIds) sourceEventIds.add(id);
    measurableDetails.push(selectedInsight.insight.description);
    renderingDirectives.push('Ground the response in the observed longitudinal pattern.');
  }

  // 4. CALLBACKS
  if (selectedMemory) {
    if (!primaryContext) primaryContext = 'callback';
    else supportingContexts.push('callback');
    for (const id of selectedMemory.memory.provenance.sourceEventIds) sourceEventIds.add(id);
    if (selectedMemory.memory.verbatimQuote) {
      measurableDetails.push(`User previously said: "${selectedMemory.memory.verbatimQuote}"`);
    }
    measurableDetails.push(`Memory context: ${selectedMemory.memory.description}`);
    renderingDirectives.push('Integrate the callback naturally if it fits the current situation.');
  }

  // 5. AGENCY DECISIONS (Ambient events, returns, etc.)
  if (agencyDecision && agencyDecision.action !== 'QUIET') {
    for (const id of agencyDecision.sourceEventIds) sourceEventIds.add(id);
    if (agencyDecision.action === 'RETURN_REMARK') {
      if (!primaryContext) primaryContext = 'return_after_absence';
    } else if (agencyDecision.action === 'FICTIONAL_INTERRUPTION') {
      if (!primaryContext) primaryContext = 'fictional_interruption';
      renderingDirectives.push('Authorized contextual absurdity. Invent a character-consistent fictional distraction.');
    } else if (agencyDecision.action === 'OBSERVATIONAL_INTERRUPTION' || agencyDecision.action === 'IDLE_REMARK' || agencyDecision.action === 'MILD_IMPATIENCE') {
      if (!primaryContext) primaryContext = 'prolonged_inactivity';
    } else if (agencyDecision.action === 'RARE_CHARACTER_EVENT') {
      if (!primaryContext) primaryContext = 'ambient_flavor';
    }
  }

  // 6. SOCIAL EXCHANGE
  if (!primaryContext && userInput && isSocialInput(userInput) && !activeChallenge) {
    primaryContext = 'social_exchange';
    renderingDirectives.push('User is engaging in casual conversation. Respond in character without forcing a challenge.');
  }

  // Continuity is supporting context only: it must never turn casual return
  // into a productivity intervention or override stronger current evidence.
  if (continuity && continuity.continuityType !== 'new_session' && continuity.continuityType !== 'new_context') {
    for (const id of continuity.sourceEventIds) sourceEventIds.add(id);
    if (!primaryContext && continuity.continuityType === 'returned_after_absence') primaryContext = 'return_after_absence';
    if (continuity.activeThread && !isSocialInput(userInput)) {
      renderingDirectives.push('An unfinished thread is available as continuity context; mention it only if natural for the current turn.');
    }
  }

  // Fallback
  if (!primaryContext) {
    return {
      primaryContext: 'general',
      supportingContexts,
      reasoning: 'No specific situational context matched.',
      sourceEventIds: Array.from(sourceEventIds),
      measurableDetails,
      renderingDirectives,
    };
  }

  return {
    primaryContext,
    // Keep only 1 supporting context to avoid overwhelming the LLM
    supportingContexts: supportingContexts.slice(0, 1),
    reasoning: `Derived from state, events, and insights.`,
    sourceEventIds: Array.from(sourceEventIds),
    measurableDetails,
    renderingDirectives,
  };
}
