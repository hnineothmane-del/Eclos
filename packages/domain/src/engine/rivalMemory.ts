// ---------------------------------------------------------------------------
// Rival Memory — Structured persistent relationship intelligence
//
// ARCHITECTURE:
//   RAW EVENTS → PROCESS INSIGHTS → RIVAL MEMORIES → MEMORY SELECTOR → PROMPT
//
// Memory records what is worth carrying forward across time.
// They are NEVER authored by the model — only by deterministic derivation
// from authoritative domain events and process insights.
// ---------------------------------------------------------------------------

import type { DomainEvent } from '../types/events.js';
import type { ProcessInsight } from './processInsights.js';
import type { Challenge } from '../types/challenge.js';
import type { MemoryItem } from '../types/memory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Broad semantic category of the memory. */
export type RivalMemoryType =
  | 'factual'        // User explicitly stated something
  | 'behavioral'     // Repeatedly evidenced behavior
  | 'relationship'   // Something meaningful about the relationship
  | 'callback'       // Memorable interaction / shared joke
  | 'unresolved'     // Intentionally left open (owe, promise, pending)
  | 'hypothesis';    // Possible long-term interpretation — NOT a fact

/** Epistemic status — how authoritative is this record? */
export type EpistemicStatus =
  | 'reported'       // User stated it; not yet observed as true/false
  | 'observed'       // Directly evidenced from authoritative events
  | 'derived'        // Inferred from multiple observations — still evidence-grounded
  | 'hypothesis'     // Speculative interpretation — must never be promoted silently
  | 'superseded'     // Replaced by newer evidence, kept for provenance
  | 'contradicted';  // New authoritative evidence conflicts with this

export interface RivalMemoryProvenance {
  sourceEventIds: string[];
  sourceInsightTypes: string[];
  challengeId: string | null;
  derivedAt: string;           // ISO timestamp — caller provides (no Date.now())
}

export interface RivalMemory {
  /** Stable key — same key means "same observable fact". Used for merge/reinforce. */
  key: string;
  type: RivalMemoryType;
  epistemicStatus: EpistemicStatus;
  /** Short human-readable description — the Rival can paraphrase but must not fabricate. */
  description: string;
  /** Optional verbatim user quote for callback use. Never invent. */
  verbatimQuote: string | null;
  /** Confidence in the observation (0–1). NOT confidence in a psychological conclusion. */
  confidence: number;
  /** How many times this pattern has been evidenced. 1 = single observation. */
  strength: number;
  provenance: RivalMemoryProvenance;
}

// ---------------------------------------------------------------------------
// Derivation constants
// ---------------------------------------------------------------------------

const CONFIDENCE_PHRASES = [
  'i know this', 'i got this', "i've got this", 'easy', 'simple', 'no problem',
  'piece of cake', 'got it', 'definitely',
];

const COMMITMENT_PHRASES = [
  'will finish', "i'll finish", "i'll do", 'going to do', 'promise', 'tonight',
  'by tomorrow', 'this week', "i'll have it", "i'll get it done",
];

const GOAL_PHRASES = [
  'want to', 'trying to', 'learning', 'get better at', 'improve my', 'working on',
  'building', 'studying', 'training for', 'get in shape',
];

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const n = normalize(text);
  return phrases.some((p) => n.includes(p));
}

function extractVerbatimQuote(text: string, maxLength = 120): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Pure derivation function
// ---------------------------------------------------------------------------

export interface DeriveRivalMemoriesInput {
  /** The user's message in this turn. */
  userInput: string;
  /** Authoritative challenge context (null on open conversations). */
  activeChallenge: Challenge | null;
  /** Process insights already derived for this turn. */
  processInsights: readonly ProcessInsight[];
  /** Recent raw domain events (already fetched by caller — no DB access here). */
  recentEvents: readonly DomainEvent[];
  /** Existing stored memory items (for merge/reinforce/contradiction detection). */
  existingMemories: readonly MemoryItem[];
  /** ISO timestamp — caller provides; never call Date.now() inside this function. */
  nowIso: string;
  userId: string;
}

export interface RivalMemoryDerivationResult {
  newMemories: RivalMemory[];
  reinforcedKeys: string[];     // Keys whose strength should be incremented
  contradictedKeys: string[];   // Keys that are now contradicted by new evidence
}

/**
 * PURE DETERMINISTIC function.
 * No network. No database. No AI. No Date.now().
 * Accepts all required data from the caller.
 */
export function deriveRivalMemories(input: DeriveRivalMemoriesInput): RivalMemoryDerivationResult {
  const result: RivalMemoryDerivationResult = {
    newMemories: [],
    reinforcedKeys: [],
    contradictedKeys: [],
  };

  if (!input.userInput && !input.activeChallenge && input.processInsights.length === 0 && input.recentEvents.length === 0) {
    return result;
  }

  const existingKeys = new Set(input.existingMemories.map((m) => m.key));
  const existingValues = new Map(input.existingMemories.map((m) => [m.key, String(m.value)]));

  const provenance = (
    sourceEventIds: string[],
    insightTypes: string[] = [],
  ): RivalMemoryProvenance => ({
    sourceEventIds,
    sourceInsightTypes: insightTypes,
    challengeId: input.activeChallenge?.id ?? null,
    derivedAt: input.nowIso,
  });

  const pushMemory = (mem: RivalMemory) => {
    const existing = input.existingMemories.find((m) => m.key === mem.key);
    if (existing) {
      result.reinforcedKeys.push(mem.key);
    } else {
      result.newMemories.push(mem);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // 1. FACTUAL — user-stated goal claims
  // ─────────────────────────────────────────────────────────────────────
  if (input.userInput && hasPhrase(input.userInput, GOAL_PHRASES)) {
    const key = `goal_claim:${normalize(input.userInput).slice(0, 60)}`;
    if (!existingKeys.has(key)) {
      pushMemory({
        key,
        type: 'factual',
        epistemicStatus: 'reported',
        description: `User stated a goal: "${extractVerbatimQuote(input.userInput, 80) ?? input.userInput.slice(0, 80)}"`,
        verbatimQuote: extractVerbatimQuote(input.userInput),
        confidence: 0.9,
        strength: 1,
        provenance: provenance([], []),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. CALLBACK — commitment phrases ("I'll finish tonight")
  // ─────────────────────────────────────────────────────────────────────
  if (input.userInput && hasPhrase(input.userInput, COMMITMENT_PHRASES)) {
    const key = `commitment:${normalize(input.userInput).slice(0, 60)}`;
    pushMemory({
      key,
      type: 'callback',
      epistemicStatus: 'reported',
      description: `User made a commitment: "${extractVerbatimQuote(input.userInput, 80) ?? input.userInput.slice(0, 80)}"`,
      verbatimQuote: extractVerbatimQuote(input.userInput),
      confidence: 0.92,
      strength: 1,
      provenance: provenance([], []),
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. FACTUAL — confidence claims before attempt
  // ─────────────────────────────────────────────────────────────────────
  if (input.userInput && hasPhrase(input.userInput, CONFIDENCE_PHRASES)) {
    const key = `confidence_claim:${normalize(input.userInput).slice(0, 60)}`;
    if (!existingKeys.has(key)) {
      pushMemory({
        key,
        type: 'factual',
        epistemicStatus: 'reported',
        description: `User expressed confidence: "${extractVerbatimQuote(input.userInput, 80) ?? input.userInput.slice(0, 80)}"`,
        verbatimQuote: extractVerbatimQuote(input.userInput),
        confidence: 0.8,
        strength: 1,
        provenance: provenance([], []),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. BEHAVIORAL — from process insights
  // ─────────────────────────────────────────────────────────────────────
  for (const insight of input.processInsights) {
    const key = `behavioral:${insight.type}`;
    const description = `Behavioral observation: ${insight.description}`;

    if (existingKeys.has(key)) {
      result.reinforcedKeys.push(key);
    } else {
      result.newMemories.push({
        key,
        type: 'behavioral',
        epistemicStatus: 'observed',
        description,
        verbatimQuote: null,
        confidence: insight.confidence,
        strength: 1,
        provenance: provenance(insight.sourceEventIds, [insight.type]),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. RELATIONSHIP — from challenge outcomes
  // ─────────────────────────────────────────────────────────────────────
  const judgedEvents = input.recentEvents.filter(
    (e) => e.eventType === 'challenge_judged' &&
      (input.activeChallenge ? (e.payload as any)?.challenge_id === input.activeChallenge.id : true),
  );

  for (const event of judgedEvents) {
    const verdict = (event.payload as any)?.verdict;
    if (verdict === 'passed' || verdict === 'completed') {
      const key = `relationship:first_success`;
      if (!existingKeys.has(key)) {
        pushMemory({
          key,
          type: 'relationship',
          epistemicStatus: 'observed',
          description: `User successfully completed a challenge.`,
          verbatimQuote: null,
          confidence: 0.99,
          strength: 1,
          provenance: provenance([event.id], []),
        });
      } else {
        result.reinforcedKeys.push('relationship:first_success');
      }
    } else if (verdict === 'failed') {
      const key = `relationship:first_failure`;
      if (!existingKeys.has(key)) {
        pushMemory({
          key,
          type: 'relationship',
          epistemicStatus: 'observed',
          description: `User failed a challenge.`,
          verbatimQuote: null,
          confidence: 0.99,
          strength: 1,
          provenance: provenance([event.id], []),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. UNRESOLVED — open challenge not yet completed
  // ─────────────────────────────────────────────────────────────────────
  if (
    input.activeChallenge &&
    ['accepted', 'started', 'attempted', 'needs_more_evidence'].includes(input.activeChallenge.status)
  ) {
    const key = `unresolved:challenge:${input.activeChallenge.id}`;
    if (!existingKeys.has(key)) {
      pushMemory({
        key,
        type: 'unresolved',
        epistemicStatus: 'observed',
        description: `User has an active challenge: "${input.activeChallenge.objective}" (status: ${input.activeChallenge.status}).`,
        verbatimQuote: null,
        confidence: 1.0,
        strength: 1,
        provenance: provenance([], []),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 7. CONTRADICTION detection — confidence claim vs. actual failure
  // ─────────────────────────────────────────────────────────────────────
  const hasFailed = judgedEvents.some((e) => (e.payload as any)?.verdict === 'failed');
  if (hasFailed) {
    for (const [key, value] of existingValues.entries()) {
      if (key.startsWith('confidence_claim:') && !result.contradictedKeys.includes(key)) {
        result.contradictedKeys.push(key);
        // We do NOT delete the original. The contradiction is the signal.
      }
    }

    // Also check "I work best under pressure"-type claims against time-pressure failures
    for (const [key, value] of existingValues.entries()) {
      if (
        key.startsWith('factual:pressure') ||
        (value && normalize(String(value)).includes('under pressure'))
      ) {
        if (!result.contradictedKeys.includes(key)) {
          result.contradictedKeys.push(key);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 8. HYPOTHESIS — repeated behavioral patterns suggest a pattern
  //    Only emit if the same behavioral key has been reinforced 2+ times.
  // ─────────────────────────────────────────────────────────────────────
  const repeatedBehavioral = input.existingMemories
    .filter((m) => m.key.startsWith('behavioral:') && m.strength >= 2);

  for (const mem of repeatedBehavioral) {
    const hypothesisKey = `hypothesis:${mem.key}`;
    if (!existingKeys.has(hypothesisKey)) {
      result.newMemories.push({
        key: hypothesisKey,
        type: 'hypothesis',
        epistemicStatus: 'hypothesis',
        description: `Possible recurring pattern (${mem.strength} observations): ${String(mem.value)}`,
        verbatimQuote: null,
        confidence: Math.min(0.7, 0.5 + mem.strength * 0.05),
        strength: 1,
        provenance: {
          sourceEventIds: [],
          sourceInsightTypes: [mem.key.replace('behavioral:', '')],
          challengeId: null,
          derivedAt: input.nowIso,
        },
      });
    }
  }

  return result;
}
