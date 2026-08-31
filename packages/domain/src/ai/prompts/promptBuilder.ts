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

export interface BuildPromptContext { userInput: string; relationship: RelationshipState; activeChallenge?: Challenge | null; decision?: TurnDecision; characterPlan?: CharacterPlan; challengeSelection?: ChallengeSelection | null; presenceDecision?: PresenceDecision | null; memories?: RankedMemoryItem[]; recentHumor?: string[]; processCaptures?: ProcessCapture[]; processInsights?: ProcessInsight[]; selectedRivalMemory?: SelectedMemory | null; selectedInsight?: SelectedInsight | null; }

export function buildCharacterPrompt(context: BuildPromptContext): GenerateOptions {
  const decision = context.decision || { mode: 'banter', humorMechanism: null, target: 'current behavior', callback: null, serious: false, register: 'direct', intensity: 4 } as TurnDecision;
  let prompt = `USER INPUT:\n${context.userInput}\n\n--- CONTEXT ---\nRELATIONSHIP STATE:\n- Mode: ${context.relationship.mode}\n- Respect: ${context.relationship.respect}\n- Warmth: ${context.relationship.warmth}\n- Trust: ${context.relationship.trust}\n- Rivalry: ${context.relationship.rivalry}\n- Familiarity: ${context.relationship.familiarity}\n- Curiosity: ${context.relationship.curiosity}\n\n`;
  if (context.activeChallenge) prompt += `ACTIVE CHALLENGE:\n- Objective: ${context.activeChallenge.objective}\n- Status: ${context.activeChallenge.status}\n- Difficulty: ${context.activeChallenge.difficulty}\n- Verification Level: ${context.activeChallenge.verificationLevel}\n- Constraints: ${context.activeChallenge.constraints.join(', ')}\n\n`;
  if (!context.decision && context.memories?.[0]) prompt += `RELEVANT MEMORIES:\n- [${context.memories[0].item.category}] ${context.memories[0].item.key}: ${JSON.stringify(context.memories[0].item.value)}\n\n`;
  if (!context.decision && context.recentHumor?.length) prompt += `RECENT HUMOR LEDGER (Avoid repeating these):\n- ${context.recentHumor.join('\n- ')}\n\n`;
  if (context.processCaptures && context.processCaptures.length > 0) {
    prompt += `RIVAL LENS — PROCESS CAPTURES (user's voluntary signals while working):\n`;
    for (const capture of context.processCaptures) {
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
    for (const insight of context.processInsights) {
      prompt += `- ${insight.description}\n`;
    }
    prompt += `These are observations from the challenge record. Do not invent additional facts or infer deep psychological traits from them.\n\n`;
  }
  if (context.selectedRivalMemory) {
    const mem = context.selectedRivalMemory.memory;
    prompt += `GROUNDED RIVAL MEMORY (Deterministically selected — authority: ${mem.epistemicStatus}):\n`;
    prompt += `- [${mem.type.toUpperCase()}] ${mem.description}\n`;
    if (mem.verbatimQuote) {
      prompt += `- Verbatim user quote (grounded; do NOT fabricate): "${mem.verbatimQuote}"\n`;
    }
    prompt += `- Reason selected: ${context.selectedRivalMemory.reason}\n`;
    prompt += `You MAY reference this memory naturally. Do NOT force it. Do NOT invent facts beyond what is stated. Do NOT treat ${mem.epistemicStatus === 'hypothesis' ? 'this hypothesis as an established fact' : 'this as a character judgment'}.\n\n`;
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
  prompt += `DETERMINISTIC RESPONSE PLAN (follow exactly):\n- Mode: ${decision.mode}\n- Serious: ${decision.serious}\n- Register: ${decision.register}\n- Intensity: ${decision.intensity}\n- Humor mechanism: ${decision.humorMechanism || 'none'}\n- Target concept: ${decision.target}\n`;
  if (decision.callback) prompt += `- Grounded callback (use only if useful): [${decision.callback.item.category}] ${decision.callback.item.key}: ${JSON.stringify(decision.callback.item.value)}\n`;
  prompt += `\n--- INSTRUCTIONS ---\nWrite the best possible response in the selected style. Do not change the selected mode, seriousness, mechanism, or target. Do not invent memories or historical facts. Do not suggest authoritative events. DO NOT supply authoritative numeric relationship state.\n`;
  return { prompt, systemPrompt: CHARACTER_SYSTEM_PROMPT };
}

