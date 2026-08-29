import { CHARACTER_SYSTEM_PROMPT } from './characterSystemPrompt.js';
import type { RelationshipState } from '../../types/relationship.js';
import type { Challenge } from '../../types/challenge.js';
import type { RankedMemoryItem } from '../../memory/retrieval.js';
import type { HumorLedgerItem } from '../../types/memory.js';
import type { GenerateOptions } from '../provider.js';

export interface BuildPromptContext {
  userInput: string;
  relationship: RelationshipState;
  activeChallenge?: Challenge | null;
  memories?: RankedMemoryItem[];
  recentHumor?: string[];
}

export function buildCharacterPrompt(context: BuildPromptContext): GenerateOptions {
  let prompt = `USER INPUT:\n${context.userInput}\n\n`;

  prompt += `--- CONTEXT ---\n`;
  prompt += `RELATIONSHIP STATE:\n`;
  prompt += `- Mode: ${context.relationship.mode}\n`;
  prompt += `- Respect: ${context.relationship.respect}\n`;
  prompt += `- Warmth: ${context.relationship.warmth}\n`;
  prompt += `- Trust: ${context.relationship.trust}\n`;
  prompt += `- Rivalry: ${context.relationship.rivalry}\n`;
  prompt += `- Familiarity: ${context.relationship.familiarity}\n`;
  prompt += `- Curiosity: ${context.relationship.curiosity}\n\n`;

  if (context.activeChallenge) {
    prompt += `ACTIVE CHALLENGE:\n`;
    prompt += `- Objective: ${context.activeChallenge.objective}\n`;
    prompt += `- Status: ${context.activeChallenge.status}\n`;
    prompt += `- Difficulty: ${context.activeChallenge.difficulty}\n`;
    prompt += `- Verification Level: ${context.activeChallenge.verificationLevel}\n`;
    prompt += `- Constraints: ${context.activeChallenge.constraints.join(', ')}\n\n`;
  }

  if (context.memories && context.memories.length > 0) {
    prompt += `RELEVANT MEMORIES:\n`;
    for (const mem of context.memories) {
      prompt += `- [${mem.item.category}] ${mem.item.key}: ${JSON.stringify(mem.item.value)}\n`;
    }
    prompt += `\n`;
  }

  if (context.recentHumor && context.recentHumor.length > 0) {
    prompt += `RECENT HUMOR LEDGER (Avoid repeating these):\n`;
    for (const humor of context.recentHumor) {
      prompt += `- ${humor}\n`;
    }
    prompt += `\n`;
  }

  prompt += `--- INSTRUCTIONS ---\n`;
  prompt += `1. Classify the user intent.\n`;
  prompt += `2. If humorous, choose a humor mechanism (do not repeat recent humor).\n`;
  prompt += `3. Choose a response mode.\n`;
  prompt += `4. Generate the response according to the mode structure.\n`;
  prompt += `5. Suggest new memories or events if appropriate.\n`;
  prompt += `6. DO NOT supply authoritative numeric relationship state (respect, trust, etc. deltas are handled by backend).\n`;

  return {
    prompt,
    systemPrompt: CHARACTER_SYSTEM_PROMPT,
  };
}
