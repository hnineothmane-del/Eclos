// ---------------------------------------------------------------------------
// Rival Memory Selector
//
// Deterministic, conservative selection of which memory (if any) to surface
// on a given turn. Most turns should surface NOTHING.
//
// No AI. No randomness. No Date.now().
// ---------------------------------------------------------------------------

import type { RivalMemory } from './rivalMemory.js';
import type { RelationshipState } from '../types/relationship.js';
import type { Challenge } from '../types/challenge.js';

export interface MemorySelectionInput {
  /** Candidate memories for this turn (already ranked / filtered by caller). */
  memories: readonly RivalMemory[];
  /** The user's message in this turn. */
  userInput: string;
  /** Authoritative relationship state. */
  relationship: RelationshipState;
  /** Active challenge or null. */
  activeChallenge: Challenge | null;
  /** Is this a serious/vulnerable context? Suppresses humor-based callbacks. */
  isSeriousContext: boolean;
  /** Is this challenge-critical? (evidence_submitted, needs_more_evidence) */
  isChallengeCritical: boolean;
  /** Recent humor mechanisms used (to enforce callback cooldown). */
  recentHumor: readonly string[];
  /** Recent memory keys that were surfaced (to prevent repetition). */
  recentlySurfacedKeys: readonly string[];
  /** ISO timestamp — caller provides. */
  nowIso: string;
}

export interface SelectedMemory {
  memory: RivalMemory;
  score: number;
  reason: string;
}

/** Minimum familiarity to surface a callback-type memory (humor/inside jokes). */
const MIN_FAMILIARITY_FOR_CALLBACK = 30;
/** Minimum confidence for a hypothesis to be surfaced. */
const MIN_HYPOTHESIS_CONFIDENCE = 0.60;
/** Cooldown: same key won't be selected twice within this count of turns. */
const SAME_KEY_COOLDOWN_WINDOW = 5; // enforced via recentlySurfacedKeys slice

const COMMITMENT_WORDS = ['tonight', 'finish', "i'll", 'promise', 'this week', 'tomorrow'];
const CONFIDENCE_WORDS = ['i know this', 'i got this', 'easy', 'definitely', 'got it'];
const STRUGGLE_WORDS = ["don't know", "stuck", "confused", "where to start", "help", "hard", "lost", "failing"];
const GOAL_WORDS = ['want to', 'trying to', 'learning', 'get better at', 'improve my', 'working on', 'goal'];

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function hasAny(text: string, terms: string[]): boolean {
  const n = normalize(text);
  return terms.some((t) => n.includes(t));
}

function scoreMemory(
  mem: RivalMemory,
  input: MemorySelectionInput,
  recentlyUsedSet: Set<string>,
): { score: number; reason: string } | null {
  // Hard suppression: serious context blocks humor-driven callbacks
  if (input.isSeriousContext && (mem.type === 'callback' || mem.type === 'hypothesis')) {
    return null;
  }

  // Hard suppression: challenge-critical context — only unresolved/behavioral allowed
  if (input.isChallengeCritical && !['unresolved', 'behavioral'].includes(mem.type)) {
    return null;
  }

  // Hypothesis needs min confidence
  if (mem.epistemicStatus === 'hypothesis' && mem.confidence < MIN_HYPOTHESIS_CONFIDENCE) {
    return null;
  }

  // Superseded or contradicted memories should not be surfaced as callbacks.
  // Contradicted may still be surfaced as relationship observations.
  if (mem.epistemicStatus === 'superseded') return null;
  // A contradicted hypothesis must never return as an active belief (Tweak #12)
  if (mem.type === 'hypothesis' && mem.epistemicStatus === 'contradicted') return null;

  // Cooldown: same key recently surfaced
  if (recentlyUsedSet.has(mem.key)) return null;

  // Cooldown: callback mechanism on cooldown
  if (mem.type === 'callback' && input.recentHumor.includes('callback')) return null;

  // Familiarity gate for callbacks
  if (mem.type === 'callback' && input.relationship.familiarity < MIN_FAMILIARITY_FOR_CALLBACK) {
    return null;
  }

  let score = 0;
  let reason = 'memory candidate';
  let hasContextualRelevance = false;

  // Epistemic quality bonus
  if (mem.epistemicStatus === 'observed') score += 15;
  else if (mem.epistemicStatus === 'reported') score += 10;
  else if (mem.epistemicStatus === 'derived') score += 12;
  else if (mem.epistemicStatus === 'contradicted') score += 8; // contradiction can be interesting
  else if (mem.epistemicStatus === 'hypothesis') score += 5;

  // Strength bonus (reinforcement count)
  score += Math.min(mem.strength * 3, 15);

  // Confidence bonus
  score += mem.confidence * 10;

  // Contextual relevance: commitment phrase in current input matches a commitment memory
  if (mem.type === 'callback' && hasAny(input.userInput, COMMITMENT_WORDS)) {
    score += 20;
    reason = 'user made another commitment matching stored callback';
    hasContextualRelevance = true;
  }

  // Contextual relevance: confidence phrase matches a prior confidence claim
  if (mem.type === 'factual' && mem.epistemicStatus === 'reported' && hasAny(input.userInput, CONFIDENCE_WORDS)) {
    score += 12;
    reason = 'user confidence claim matches prior report';
    hasContextualRelevance = true;
  }

  // Contradicted memories get a bonus when contradiction is contextually relevant
  if (mem.epistemicStatus === 'contradicted' && hasAny(input.userInput, CONFIDENCE_WORDS)) {
    score += 15;
    reason = 'prior confidence claim is contradicted by evidence';
    hasContextualRelevance = true;
  }

  // Contextual relevance: hypotheses become relevant when user expresses struggle or goals
  if (mem.type === 'hypothesis' && (hasAny(input.userInput, STRUGGLE_WORDS) || hasAny(input.userInput, GOAL_WORDS))) {
    score += 15;
    reason = 'user statement relates to behavioral hypothesis';
    hasContextualRelevance = true;
  }

  // Type preference by context
  if (mem.type === 'unresolved') { score += 10; reason = 'unresolved challenge context'; hasContextualRelevance = true; }
  if (mem.type === 'behavioral' && !input.isChallengeCritical) { score += 8; hasContextualRelevance = true; }
  if (mem.type === 'relationship') { score += 6; hasContextualRelevance = true; }
  if (mem.type === 'callback' && input.relationship.familiarity >= 60 && hasContextualRelevance) {
    score += 10;
    reason = 'high familiarity enables callbacks';
  }

  // GATE: callback, factual, and hypothesis types REQUIRE explicit contextual relevance.
  // They must not surface on random unrelated turns just from base scoring.
  if ((mem.type === 'callback' || mem.type === 'factual' || mem.type === 'hypothesis') && !hasContextualRelevance) {
    return null;
  }

  // Low-value threshold: don't surface if score is trivially low
  if (score < 20) return null;

  return { score, reason };
}

/**
 * Deterministically select at most ONE memory to surface on this turn.
 * Returns null when no memory is appropriate (which is most turns).
 */
export function selectRivalMemory(input: MemorySelectionInput): SelectedMemory | null {
  if (input.memories.length === 0) return null;

  const recentlyUsedSet = new Set(input.recentlySurfacedKeys.slice(-SAME_KEY_COOLDOWN_WINDOW));

  const candidates: SelectedMemory[] = [];

  for (const mem of input.memories) {
    const result = scoreMemory(mem, input, recentlyUsedSet);
    if (result) {
      candidates.push({ memory: mem, score: result.score, reason: result.reason });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, then by strength descending
  candidates.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : b.memory.strength - a.memory.strength,
  );

  return candidates[0];
}
