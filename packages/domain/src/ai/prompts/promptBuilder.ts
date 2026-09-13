import { CHARACTER_SYSTEM_PROMPT } from './characterSystemPrompt.js';
import type { RelationshipState } from '../../types/relationship.js';
import type { Challenge } from '../../types/challenge.js';
import type { GenerateOptions } from '../provider.js';
import type { TurnDecision, ProcessCapture } from '../../engine/responsePlanner.js';
import type { RankedMemoryItem } from '../../memory/retrieval.js';
import type { ProcessInsight } from '../../engine/processInsights.js';
import type { CharacterPlan } from '../../engine/characterDirector.js';
import type { ChallengeSelection } from '../../challenge/challengeSelector.js';
import type { PresenceDecision } from '../../engine/presenceEngine.js';
import type { SelectedMemory } from '../../engine/rivalMemorySelector.js';
import type { SelectedInsight } from '../../engine/rivalInsightSelector.js';
import type { RivalInitiativeDecision } from '../../engine/rivalAgency.js';
import type { RivalLivingState } from '../../engine/rivalLivingState.js';
import type { InteractionOutcome } from '../../engine/rivalInteraction.js';
import type { RivalSituationalContext } from '../../engine/rivalSituationalContext.js';
import type { RivalSessionContinuity } from '../../engine/rivalSessionContinuity.js';
import type { RivalEasterEggDecision } from '../../engine/rivalEasterEgg.js';
import type { RivalLoreDecision } from '../../engine/rivalLore.js';
import type { VerifiedExternalContext } from '../../engine/liveContext.js';
import type { RivalRelationshipContext } from '../../engine/rivalRelationshipContext.js';

export interface BuildPromptContext { userInput: string; relationship: RelationshipState; activeChallenge?: Challenge | null; decision?: TurnDecision; characterPlan?: CharacterPlan; challengeSelection?: ChallengeSelection | null; presenceDecision?: PresenceDecision | null; memories?: RankedMemoryItem[]; recentHumor?: string[]; processCaptures?: ProcessCapture[]; processInsights?: ProcessInsight[]; selectedRivalMemory?: SelectedMemory | null; selectedInsight?: SelectedInsight | null; agencyDecision?: RivalInitiativeDecision | null; rivalLivingState?: RivalLivingState | null; interactionOutcome?: InteractionOutcome | null; situationalContext?: RivalSituationalContext | null; sessionContinuity?: RivalSessionContinuity | null; easterEgg?: RivalEasterEggDecision | null; lore?: RivalLoreDecision | null; liveContext?: VerifiedExternalContext | null; relationshipContext?: RivalRelationshipContext; }

export function buildCharacterPrompt(context: BuildPromptContext): GenerateOptions {
  const decision = context.decision || { mode: 'banter', humorMechanism: null, target: 'current behavior', callback: null, serious: false, register: 'direct', intensity: 4 } as TurnDecision;
  let prompt = `USER INPUT:\n${context.userInput}\n\n--- CONTEXT ---\nRELATIONSHIP STATE:\n- Mode: ${context.relationship.mode}\n- Respect: ${context.relationship.respect}\n- Warmth: ${context.relationship.warmth}\n- Trust: ${context.relationship.trust}\n- Rivalry: ${context.relationship.rivalry}\n- Familiarity: ${context.relationship.familiarity}\n- Curiosity: ${context.relationship.curiosity}\n\n`;
  if (context.relationshipContext) {
    const relation = context.relationshipContext;
    prompt += `RIVAL RELATIONSHIP CONTEXT (deterministic delivery permissions):\n- Phase: ${relation.phase}\n- Callback depth: ${relation.callbackDepth}/4\n- Teasing warmth: ${relation.teasingWarmth}/10\n- Sincerity permission: ${relation.sincerityPermission}/10\n- Disclosure permission: ${relation.disclosurePermission}/10\n- Challenge respect: ${relation.challengeRespect}/10\n- Roast reciprocity: ${relation.roastReciprocity}/10\n- Nickname eligibility: ${relation.nicknameEligible}\n- Directives: ${relation.directives.join(' ')}\nPreserve the established relationship. Do not become warmer than earned, manufacture attachment, guilt the user for leaving, or alter challenge/relationship state.\n\n`;
  }
  if (context.activeChallenge) {
    prompt += `ACTIVE CHALLENGE:\n- Objective: ${context.activeChallenge.objective}\n- Status: ${context.activeChallenge.status}\n- Difficulty: ${context.activeChallenge.difficulty}\n- Verification Level: ${context.activeChallenge.verificationLevel}\n- Constraints: ${context.activeChallenge.constraints.join(', ')}\n`;
    prompt += `(Note: This challenge is currently pending. You may reference it naturally, but DO NOT demand proof or demand the user work on it unless the selected Mode is 'challenge' or 'judgment'.)\n\n`;
  }
  if (!context.decision && context.memories?.[0]) prompt += `RELEVANT MEMORIES:\n- [${context.memories[0].item.category}] ${context.memories[0].item.key}: ${JSON.stringify(context.memories[0].item.value)}\n\n`;
  if (!context.decision && context.recentHumor?.length) prompt += `RECENT HUMOR LEDGER (Avoid repeating these):\n- ${context.recentHumor.join('\n- ')}\n\n`;
  if (context.processCaptures && context.processCaptures.length > 0) {
    prompt += `RIVAL LENS — PROCESS CAPTURES (user's voluntary signals while working):\n`;
    // Keep the renderer's working set small; the ledger remains authoritative
    // while only the most recent observations are useful for this turn.
    for (const capture of context.processCaptures.slice(-5)) {
      if (capture.captureType === 'process_signal' && capture.signal) {
        prompt += `- [SIGNAL] ${capture.signal} at ${capture.timestamp}\n`;
      } else if (capture.captureType === 'process_thought' && capture.content) {
        prompt += `- [THOUGHT] "${capture.content}" at ${capture.timestamp}\n`;
      }
    }
    prompt += `You MAY use these sparingly as grounded callbacks. Do NOT fabricate quotes or signals not listed. Do NOT comment on every capture.\n\n`;
  }
  if (context.processInsights && context.processInsights.length > 0) {
    prompt += `GROUNDED PROCESS INSIGHTS (Derived deterministically from the user's behavior/events):\n`;
    for (const insight of context.processInsights.slice(0, 3)) {
      prompt += `- ${insight.description}\n`;
    }
    prompt += `These are observations from the challenge record. Do not invent additional facts or infer deep psychological traits from them.\n\n`;
  }
  if (context.selectedRivalMemory) {
    const mem = context.selectedRivalMemory.memory;
    if (mem.epistemicStatus === 'hypothesis') {
      prompt += `CURRENT TENTATIVE RIVAL BELIEF\n`;
      prompt += `This is a hypothesis The Rival currently has about the user.\n`;
      prompt += `It is based on prior evidence but may be wrong.\n`;
      prompt += `Use it to color your response only when relevant.\n`;
      prompt += `Do not present it as established fact.\n`;
      prompt += `Do not invent supporting evidence.\n`;
      prompt += `- [HYPOTHESIS] ${mem.description}\n`;
      prompt += `- Reason selected: ${context.selectedRivalMemory.reason}\n\n`;
    } else {
      prompt += `GROUNDED RIVAL MEMORY (Deterministically selected — authority: ${mem.epistemicStatus}):\n`;
      prompt += `- [${mem.type.toUpperCase()}] ${mem.description}\n`;
      if (mem.verbatimQuote) {
        prompt += `- Verbatim user quote (grounded; do NOT fabricate): "${mem.verbatimQuote}"\n`;
      }
      prompt += `- Reason selected: ${context.selectedRivalMemory.reason}\n`;
      prompt += `You MAY reference this memory naturally. Do NOT force it. Do NOT invent facts beyond what is stated. Do NOT treat this as a character judgment.\n\n`;
    }
  }
  if (context.selectedInsight) {
    const ins = context.selectedInsight.insight;
    prompt += `GROUNDED RIVAL INSIGHT (Deterministically selected — authority: ${ins.epistemicStatus}):\n`;
    prompt += `- [${ins.family.toUpperCase()}] ${ins.description}\n`;
    prompt += `- Evidence count: ${ins.evidenceCount} observations | Confidence: ${Math.round(ins.confidence * 100)}%\n`;
    prompt += `- Temporal pattern: ${ins.temporalPattern} (first observed: ${ins.firstObservedAt.split('T')[0]}, last: ${ins.lastObservedAt.split('T')[0]})\n`;
    prompt += `- Reason selected: ${context.selectedInsight.reason}\n`;
    prompt += `You MAY weave this into the response naturally. Do NOT state it as a diagnosis or psychiatric condition. Do NOT fabricate evidence beyond what is stated. Do NOT treat hypothesis as established fact. Do NOT be overly literal or spammy.\n\n`;
  }
  if (context.characterPlan) {
    const plan = context.characterPlan;
    prompt += `DETERMINISTIC CHARACTER DIRECTION (authoritative for this response):\n- Mood: ${plan.state.mood}\n- Interaction shape: ${plan.interactionMode}\n- Seriousness: ${plan.state.seriousness}/10\n- Sincerity selected: ${plan.sincerity}\n- Humor opportunity: ${plan.humor ? `${plan.humor.mechanism} targeting ${plan.humor.target}; reason: ${plan.humor.reason}` : 'none — do not force a joke'}\n\n`;
  }
  if (context.challengeSelection) {
    const selection = context.challengeSelection;
    prompt += `DETERMINISTIC CHALLENGE SHAPE (authoritative; render its wording, do not replace it):\n- Primitive: ${selection.primitive}\n- Objective: ${selection.objective}\n- Difficulty: ${selection.difficulty}/10\n- Constraints: ${selection.constraints.join(' ')}\n- Expected duration: ${selection.expectedDurationMinutes ?? 'not timed'} minutes\n- Evidence: ${selection.evidenceExpectation}\n\n`;
  }
  if (context.presenceDecision?.action) {
    const presence = context.presenceDecision;
    prompt += `DETERMINISTIC PRESENCE EVENT (render only this already-selected event; do not invent ambient activity):\n- State: ${presence.state}\n- Activity: ${presence.activity}\n- Event: ${presence.action}\n- Reason: ${presence.reason}\n\n`;
  }
  if (context.agencyDecision && context.agencyDecision.action !== 'QUIET') {
    prompt += `DETERMINISTIC RIVAL INITIATIVE (authoritative for this turn):\n- Action: ${context.agencyDecision.action}\n- Reason: ${context.agencyDecision.reason}\n- Urgency: ${context.agencyDecision.urgency}\n\n`;
    if (['RARE_CHARACTER_EVENT', 'FICTIONAL_INTERRUPTION', 'SELF_AMUSEMENT', 'ABORTED_THOUGHT', 'IDLE_REMARK', 'MILD_IMPATIENCE'].includes(context.agencyDecision.action)) {
      prompt += `AMBIENT CHARACTER MOMENT:\nKeep this a brief, optional aside. It is not a productivity intervention: do not issue a challenge, demand a reply, guilt the user, alter work state, or claim real-world activity. The user may ignore it completely.\n\n`;
    }
  }
  if (context.rivalLivingState) {
    const ls = context.rivalLivingState;
    if (ls.internalState !== 'active' || ls.microActivity !== 'watching') {
      // Only inject when state is non-trivial — active/watching is the default
      prompt += `RIVAL INTERNAL STATE (context for authentic voice — do not narrate these facts directly):\n- Was: ${ls.internalState} / ${ls.microActivity}\n- Expression: ${ls.expressionMode}${ls.isTransition ? ' (transition — he was just interrupted or returned)' : ''}\n${ls.authorizedAmbientEvent ? `- Ambient event: ${ls.authorizedAmbientEvent}\n` : ''}\n`;
    }
  }
  if (context.interactionOutcome?.speechAuthorized) {
    const io = context.interactionOutcome;
    prompt += `USER INTERACTION (direct physical interaction — authoritative for this turn):\n- User physically interacted with the Rival\n- Reaction: ${io.reaction}\n- Context: ${io.reason}\nRespond in character as if ${io.reaction === 'startled' ? 'you were just woken up' : io.reaction === 'annoyed' ? 'mildly irritated by the interruption' : io.reaction === 'amused' ? 'you found it a bit amusing' : io.reaction === 'pushback' ? 'fighting back against a roast' : 'you are mildly curious'}. Keep it brief. Do not start a new challenge. Do not alter relationship state.\n\n`;
  }
  if (context.situationalContext) {
    const sit = context.situationalContext;
    prompt += `SITUATIONAL CONTEXT (Task 29 - specific contextual anchor for this turn):\n- Primary context: ${sit.primaryContext}\n`;
    if (sit.supportingContexts.length > 0) prompt += `- Supporting context: ${sit.supportingContexts.join(', ')}\n`;
    if (sit.measurableDetails.length > 0) prompt += `- Measurable details (grounded; do not fabricate): ${sit.measurableDetails.join(' | ')}\n`;
    if (sit.renderingDirectives.length > 0) prompt += `- Directives: ${sit.renderingDirectives.join(' ')}\n`;
    prompt += `You MUST follow the rendering directives. Use the measurable details for specificity instead of being generic. Do not invent facts.\n\n`;
  }
  if (context.sessionContinuity && context.sessionContinuity.continuityType !== 'new_session' && context.sessionContinuity.continuityType !== 'new_context') {
    const continuity = context.sessionContinuity;
    prompt += `RIVAL SESSION CONTINUITY (authoritative, compact history):\n- Continuity: ${continuity.continuityType}\n`;
    if (continuity.activeThread) prompt += `- Unfinished thread: ${continuity.activeThread.description} (${continuity.activeThread.status})\n`;
    if (continuity.elapsedSinceMeaningfulActivityMs !== null) prompt += `- Elapsed since meaningful activity (ms): ${continuity.elapsedSinceMeaningfulActivityMs}\n`;
    if (continuity.recentSequence.length > 0) prompt += `- Recent sequence: ${continuity.recentSequence.join(' → ')}\n`;
    if (continuity.renderingDirectives.length > 0) prompt += `- Directives: ${continuity.renderingDirectives.join(' ')}\n`;
    prompt += `Treat continuity facts as authoritative. Do not invent missing history, exact durations, or user actions. Use this naturally; do not recite the packet or pressure the user because time passed.\n\n`;
  }
  if (context.easterEgg?.authorized) {
    prompt += `HIDDEN CHARACTER EVENT (authoritative):\n- The Rival was caught in a private fictional activity.\n- Tone: playful, slightly embarrassed or defensive, self-aware.\n- Do not reveal unsupported lore, claim real-world facts, create persistent facts, explain the Easter egg, or turn this into a productivity intervention.\n\n`;
  }
  const lore = context.lore;
  const fact = lore?.fact;
  if (lore && fact && lore.revealLevel) {
    prompt += `RIVAL MICRO-LORE (fictional character canon only):\n- Detail: ${fact.id} (${fact.category})\n- Reveal: ${lore.revealLevel}\n- Canon fragment: ${fact.statement}\n- Reason: ${lore.reason}\nTreat this as fictional Rival context only. Do not invent additional persistent lore, confirm ambiguous origin claims as real facts, explain it unnecessarily, or turn it into exposition. Reveal only what fits naturally.\n\n`;
  }
  if (context.liveContext) {
    const live = context.liveContext;
    prompt += `VERIFIED LIVE CONTEXT (bounded external information):\n- Context ID: ${live.id}\n- Source: ${live.source}\n- Retrieved at: ${live.retrievedAt}\n- Category: ${live.category}\n- Topic: ${live.title}\n- Summary: ${live.summary}\n- Expires at: ${live.expiresAt ?? 'not specified'}\n- Source URL: ${live.sourceUrl ?? 'not provided'}\nTreat this as verified external context, not memory or Rival lore. Use it only if relevant. Do not invent additional facts, claim you personally browsed, or force it into an unrelated response.\n\n`;
  } else {
    prompt += `NO VERIFIED LIVE CONTEXT: Do not claim or imply that you checked current events or know what is happening outside the supplied context.\n\n`;
  }
  // For character-expression modes, 'current behavior' as a target anchors the LLM to
  // productivity framing. Remap it to 'user statement' so the Rival engages with what was said.
  const characterModes = new Set(['banter', 'curious', 'roast', 'observational_roast', 'supportive', 'help', 'bored']);
  const effectiveTarget = characterModes.has(decision.mode) && (decision.target === 'current behavior' || decision.target === 'current behavior against the active challenge')
    ? 'user statement'
    : decision.target;
  prompt += `DETERMINISTIC RESPONSE PLAN (follow exactly):\n- Mode: ${decision.mode}\n- Serious: ${decision.serious}\n- Register: ${decision.register}\n- Intensity: ${decision.intensity}\n- Humor mechanism: ${decision.humorMechanism || 'none'}\n- Target concept: ${effectiveTarget}\n`;
  if (decision.callback) prompt += `- Grounded callback (use only if useful): [${decision.callback.item.category}] ${decision.callback.item.key}: ${JSON.stringify(decision.callback.item.value)}\n`;
  prompt += `\n--- INSTRUCTIONS ---\n`;
  if (decision.mode === 'banter' || decision.mode === 'curious' || decision.mode === 'observational_roast' || decision.mode === 'roast' || decision.mode === 'supportive') {
    const humorNote = decision.humorMechanism === 'mock_formal'
      ? 'Use mock-formal delivery: absurdly serious analysis of a ridiculous conclusion. The contrast is the joke.'
      : decision.humorMechanism === 'absurd_escalation'
      ? 'Use absurd escalation: take the premise somewhere unexpectedly extreme, then land it.'
      : decision.humorMechanism === 'deadpan'
      ? 'Use deadpan: deliver the observation with zero affect. Let the content be the joke.'
      : '';
    prompt += `You are The Rival responding to: "${context.userInput}". Engage with what the user actually said — their statement, question, mood, or observation. Express your reaction, opinion, or a joke grounded in this. Do NOT redirect to productivity, work, goals, or proof unless the challengeSelection block is present above. One dominant conversational idea. Keep it sharp and in character. ${humorNote} Voice texture: casual directness, cultural vernacular, and natural profanity are available when they fit — use them as punctuation not performance.\n`;
  } else if (decision.mode === 'challenge') {
    prompt += `Issue the deterministic challenge described above. Voice it as The Rival — skeptical, specific, in character. Do not be generic.\n`;
  } else {
    prompt += `Write the best possible response in the selected mode. Do not change the selected mode, seriousness, mechanism, or target.\n`;
  }
  prompt += `Do not invent memories or historical facts. Do not suggest authoritative events. DO NOT supply authoritative numeric relationship state. Use one dominant conversational idea for this turn; supporting context should remain implicit rather than becoming a list or second speech. Prefer silence/conciseness over stacking callbacks, insights, lore, and live context.\n`;
  return { prompt, systemPrompt: CHARACTER_SYSTEM_PROMPT };
}

