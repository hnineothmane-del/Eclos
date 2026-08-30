import { CHARACTER_SYSTEM_PROMPT } from './characterSystemPrompt.js';
import type { RelationshipState } from '../../types/relationship.js';
import type { Challenge } from '../../types/challenge.js';
import type { GenerateOptions } from '../provider.js';
import type { TurnDecision, ProcessCapture } from '../../engine/responsePlanner.js';
import type { RankedMemoryItem } from '../../memory/retrieval.js';
import type { ProcessInsight } from '../../engine/processInsights.js';

export interface BuildPromptContext { userInput: string; relationship: RelationshipState; activeChallenge?: Challenge | null; decision?: TurnDecision; memories?: RankedMemoryItem[]; recentHumor?: string[]; processCaptures?: ProcessCapture[]; processInsights?: ProcessInsight[]; }

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
  prompt += `DETERMINISTIC RESPONSE PLAN (follow exactly):\n- Mode: ${decision.mode}\n- Serious: ${decision.serious}\n- Register: ${decision.register}\n- Intensity: ${decision.intensity}\n- Humor mechanism: ${decision.humorMechanism || 'none'}\n- Target concept: ${decision.target}\n`;
  if (decision.callback) prompt += `- Grounded callback (use only if useful): [${decision.callback.item.category}] ${decision.callback.item.key}: ${JSON.stringify(decision.callback.item.value)}\n`;
  prompt += `\n--- INSTRUCTIONS ---\nWrite the best possible response in the selected style. Do not change the selected mode, seriousness, mechanism, or target. Do not invent memories or historical facts. Do not suggest authoritative events. DO NOT supply authoritative numeric relationship state.\n`;
  return { prompt, systemPrompt: CHARACTER_SYSTEM_PROMPT };
}
