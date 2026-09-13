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

/**
 * Behavioral self-report patterns.
 *
 * Each entry requires patterns that INCLUDE first-person self-report framing
 * (e.g. "i keep ___", "i procrastinat___") so a bare keyword in a non-report
 * context cannot trigger storage.
 *
 * Key rules:
 * - Patterns must be specific enough that they can't fire on incidental use.
 * - One behavioral self-report memory per turn (break on first match).
 * - EpistemicStatus is always 'reported' — the user stated it; we did not observe it.
 * - Descriptions use "User reports…" framing only — no psychological labels.
 */
interface BehavioralSelfReportPattern {
  /** Stable fragment used in the memory key. Must be unique across all patterns. */
  type: string;
  /**
   * Returns true if the (already normalizeForBehavioral'd) text matches this pattern.
   * Must require first-person self-report framing so it cannot fire on
   * incidental keyword use (e.g. bare "procrastination" in a third-person context).
   */
  matches: (normalizedText: string) => boolean;
  /** Returns a neutral observable description. Never includes trait labels. */
  describe: (quote: string) => string;
}

// ---------------------------------------------------------------------------
// Tweak #10 — Structured deterministic pattern families
//
// Architecture:
//   normalizeForBehavioral()  — lowercase, collapse whitespace, normalize
//                               curly apostrophes and Unicode dashes.
//   Each pattern family has:
//     positive RegExp[] — must include first-person framing
//     negation RegExp[] — reject the match if any fires first
//
// Optional adverb slots (always|usually|often|tend to|keep|still|…) allow
// "I always procrastinate" and "I still find a reason…" to resolve to the
// same memory key without a combinatorial phrase explosion.
// ---------------------------------------------------------------------------

/** Normalize text for behavioral matching: lowercase, collapse whitespace, normalize curly quotes/dashes. */
function normalizeForBehavioral(text: string): string {
  return text
    .toLowerCase()
    .replace(/['\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── delayed_start ────────────────────────────────────────────────────────────
// Covers: procrastination, put-things-off, avoid/delay starting,
//         initiation difficulty ("hard for me to begin"),
//         displacement ("I still find a reason to keep researching before I start").

const _DELAYED_START_POSITIVES: RegExp[] = [
  // A1: Procrastination (any inflection)
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?procrastinat/i,
  // A2: Put things off
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?put(?:ting)?\s+(?:things|it|everything|stuff|tasks|work|\w+\s+)?off/i,
  // A3: Delay / avoid / postpone starting
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?(?:delay(?:ing)?|avoid(?:ing)?|postpon(?:ing)?)\s+(?:actually\s+|even\s+)?(?:start(?:ing)?|begin(?:ning)?|working on)/i,
  // B1: "hard / difficult / tough for me to start"
  /(?:hard|difficult|tough|a struggle)\s+for\s+me\s+to\s+(?:actually\s+)?(?:start|begin|get\s+started)/i,
  // B2: "I struggle to start / get started"
  /(?:\bi\b|i'm|i am)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?struggle\s+(?:to\s+(?:actually\s+)?(?:start|begin|get\s+started)|with\s+(?:start(?:ing)?|getting\s+started|begin(?:ning)?))/i,
  // B3: "getting myself to start"
  /(?:getting|bringing)\s+myself\s+to\s+(?:actually\s+)?(?:start|begin)/i,
  // B4: "starting is the hardest part for me"
  /start(?:ing)?\s+is\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?(?:hard|difficult|the\s+hardest\s+part)\s+for\s+me/i,
  // C: Displacement — research / prep before / instead of starting
  // Matches: "I still find a reason to keep researching before I start"
  //          "I usually end up doing research or something else instead of starting"
  //          "I tend to keep researching before I begin"
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,4}(?:find\s+(?:a\s+reason|reasons)\s+to\s+keep|keep|still|end\s+up|tend\s+to|usually)\s+(?:\w+\s+){0,3}(?:research(?:ing)?|prepar(?:ing)?|overthink(?:ing)?|look(?:ing)?\s+things\s+up|doing\s+research|doing\s+something\s+else).{0,40}(?:before\s+(?:i\s+)?(?:actually\s+)?(?:start|begin)|instead\s+of\s+(?:actually\s+)?(?:start(?:ing)?|begin(?:ning)?))/i,
];

const _DELAYED_START_NEGATION: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}(?:don't|do\s+not|didn't|never|rarely|seldom|hardly\s+ever)\s+(?:\w+\s+){0,2}(?:procrastinat|put.{0,5}off|delay.{0,5}start|avoid.{0,5}start|struggle.{0,5}start)/i,
  /(?:not|never)\s+(?:hard|difficult|tough)\s+for\s+me\s+to\s+(?:start|begin)/i,
];

// ── research_over_action ─────────────────────────────────────────────────────
// Pure overthinking / overanalysis / analysis paralysis, without start-delay context.

const _RESEARCH_OVER_ACTION_POSITIVES: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?over-?think/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?over-?analyz/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?(?:get|am|fall\s+into|fall)\s+(?:stuck\s+in\s+)?analysis\s+paralysis/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?research(?:ing)?\s+(?:instead\s+of|rather\s+than)\s+(?:of\s+)?(?:build(?:ing)?|do(?:ing)?|act(?:ing)?)/i,
];

const _RESEARCH_OVER_ACTION_NEGATION: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}(?:don't|do\s+not|didn't|never|rarely|seldom|hardly\s+ever)\s+(?:\w+\s+){0,2}(?:over-?think|over-?analyz)/i,
];

// ── non_completion ────────────────────────────────────────────────────────────

const _NON_COMPLETION_POSITIVES: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}(?:never|rarely|hardly\s+ever)\s+(?:finish|complete)(?:\s+\w+){0,3}/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?(?:leave|leave\s+things)\s+(?:un-?finished|incomplete)/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}start\s+things\s+(?:and|but)\s+never\s+finish/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?abandon(?:ing)?/i,
  /(?:hard|difficult|a struggle)\s+for\s+me\s+to\s+(?:finish|complete|see\s+things\s+through)/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?struggle\s+to\s+(?:finish|complete|follow\s+through)/i,
  // Losing momentum after starting / struggle maintaining momentum (Tweak #12)
  /(?:\bi\b|i'm|i am|i've|what\s+i)\s+(?:(?:\w+)\s+){0,3}(?:struggle\s+(?:with\s+|to\s+)?maintain(?:ing)?|lose|losing|drop|dropping)\s+momentum/i,
  /(?:lose|losing)\s+momentum\s+(?:after|once)\s+(?:i\s+)?(?:start|begin)/i,
  // Novelty wearing off / excitement fading (Tweak #12)
  /(?:once|when|after)\s+(?:the\s+)?novelty\s+(?:wears?\s+off|fades?)/i,
  /(?:once|when|after)\s+(?:the\s+)?(?:initial\s+)?excitement\s+(?:wears?\s+off|fades?)/i,
  // Follow through after beginning (Tweak #12)
  /(?:struggle|hard|difficult)\s+(?:with\s+|to\s+)?follow(?:ing)?\s+through\s+(?:after|once)\s+(?:i\s+)?(?:start|begin)/i,
];

const _NON_COMPLETION_NEGATION: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:always|usually)\s+(?:finish|complete)/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}(?:don't|do\s+not|never)\s+abandon/i,
];

// ── scope_creep ───────────────────────────────────────────────────────────────

const _SCOPE_CREEP_POSITIVES: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?(?:add(?:ing)?\s+(?:to\s+the\s+scope|more\s+features|features)|expand(?:ing)?\s+(?:the\s+scope|the\s+project|scope)|chang(?:ing)?\s+the\s+scope)/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|often|tend to|keep|still|sometimes|frequently|literally|just|really|actually|typically|definitely)\s+)?scope-?creep/i,
];

const _SCOPE_CREEP_NEGATION: RegExp[] = [
  /(?:\bi\b|i'm|i am|i've)\s+(?:\w+\s+){0,2}(?:don't|do\s+not|didn't|never)\s+(?:add|expand|change)\s+(?:the\s+)?scope/i,
];

function _matchesPatterns(norm: string, positives: RegExp[], negations: RegExp[]): boolean {
  if (negations.some((rx) => rx.test(norm))) return false;
  return positives.some((rx) => rx.test(norm));
}

const BEHAVIORAL_SELF_REPORT_PATTERNS: BehavioralSelfReportPattern[] = [
  // ── Procrastination / delayed start ───────────────────────────────────────
  // Checked before research_over_action so displacement (research-before-start)
  // maps to delayed_start rather than research_over_action.
  {
    type: 'delayed_start',
    matches: (norm) => _matchesPatterns(norm, _DELAYED_START_POSITIVES, _DELAYED_START_NEGATION),
    describe: (q) =>
      `User reports a recurring pattern of delaying or avoiding starting: "${q}"`,
  },
  // ── Research / overthinking instead of doing ──────────────────────────────
  {
    type: 'research_over_action',
    matches: (norm) => _matchesPatterns(norm, _RESEARCH_OVER_ACTION_POSITIVES, _RESEARCH_OVER_ACTION_NEGATION),
    describe: (q) =>
      `User reports a recurring tendency to over-research or overthink rather than act: "${q}"`,
  },
  // ── Non-completion / abandonment ──────────────────────────────────────────
  {
    type: 'non_completion',
    matches: (norm) => _matchesPatterns(norm, _NON_COMPLETION_POSITIVES, _NON_COMPLETION_NEGATION),
    describe: (q) =>
      `User reports a pattern of not completing things they start: "${q}"`,
  },
  // ── Scope creep ───────────────────────────────────────────────────────────
  {
    type: 'scope_creep',
    matches: (norm) => _matchesPatterns(norm, _SCOPE_CREEP_POSITIVES, _SCOPE_CREEP_NEGATION),
    describe: (q) =>
      `User reports a tendency to expand scope before completing work: "${q}"`,
  },
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
  // 3b. BEHAVIORAL SELF-REPORT — user describes their own behavioral patterns
  // ─────────────────────────────────────────────────────────────────────
  if (input.userInput) {
    const nInput = normalizeForBehavioral(input.userInput);
    for (const pattern of BEHAVIORAL_SELF_REPORT_PATTERNS) {
      if (pattern.matches(nInput)) {
        const key = `behavioral:self_report:${pattern.type}`;
        const quote = extractVerbatimQuote(input.userInput) ?? input.userInput.slice(0, 80);
        
        // Find the event ID for this chat message if it was passed in recentEvents
        // The edge function will append the chat_message_sent event *before* derivation,
        // or we just leave sourceEventIds empty if it's not available yet.
        const chatEvent = input.recentEvents.find(
          (e) => e.eventType === 'chat_message_sent' && e.createdAt === input.nowIso
        );
        const sourceEventIds = chatEvent ? [chatEvent.id] : [];

        pushMemory({
          key,
          type: 'behavioral',
          epistemicStatus: 'reported',
          description: pattern.describe(quote),
          verbatimQuote: extractVerbatimQuote(input.userInput),
          confidence: 0.75, // reported, not observed
          strength: 1,
          provenance: provenance(sourceEventIds, ['behavioral_self_report']),
        });
        break; // Only capture one behavioral self-report per turn to avoid spam
      }
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

// ─────────────────────────────────────────────────────────────────────────────
// Conversational Disconfirmation Patterns (Tweak #12)
// ─────────────────────────────────────────────────────────────────────────────

/** Guard against uncertainty and weak/contextual counterexamples. */
const _DISCONFIRMATION_UNCERTAINTY: RegExp[] = [
  /\b(?:maybe|perhaps|possibly|might|could\s+be)\b/i,
  /\b(?:i'm|i\s+am)\s+(?:not\s+sure|uncertain)\b/i,
  /\bi\s+don't\s+know\b/i,
  /\b(?:sometimes|occasionally)\s+(?:\w+\s+){0,2}start/i,
  /start\s+(?:\w+\s+){0,3}(?:when\s+i\s+have\s+to|if\s+i\s+have\s+to)/i,
];

/** High-confidence direct disconfirmation of delayed_start hypothesis. */
const _DELAYED_START_DISCONFIRMATION: RegExp[] = [
  // Direct capability: "I can start important things quickly", "I usually start immediately", "I have no trouble starting", "Starting is easy for me"
  /(?:\bi\b|i'm|i am|i've)\s+(?:(?:always|usually|typically|definitely|actually|generally)\s+)?(?:can\s+start|start)\s+(?:\w+\s+){0,3}(?:quickly|fast|immediately|right\s+away|easily|without\s+(?:any\s+)?(?:trouble|issue|delay|hesitation|problem))/i,
  /(?:\bi\b|i'm|i am|i've)\s+(?:have\s+)?no\s+(?:trouble|problem|issue|difficulty)\s+start(?:ing)?/i,
  /start(?:ing)?\s+is\s+(?:easy|not\s+(?:an?\s+)?(?:issue|problem|struggle))\s+for\s+me/i,
  // Explicit negation: "I don't struggle with starting", "I don't have a problem starting", "Starting isn't my problem", "The problem isn't starting"
  /(?:\bi\b|i'm|i am)\s+(?:don't|do\s+not)\s+(?:struggle\s+with|have\s+(?:a\s+)?problem\s+(?:with\s+)?)\s*start(?:ing)?/i,
  /start(?:ing)?\s+(?:is\s+not|isn't)\s+(?:actually\s+|really\s+)?(?:my|the|an?)\s+(?:problem|issue|struggle)/i,
  /(?:the\s+)?(?:real\s+)?(?:problem|issue)\s+(?:is\s+not|isn't)\s+(?:actually\s+|really\s+)?start(?:ing)?/i,
  // Explicit correction: "starting isn't actually the issue", "that's not my problem" when starting is explicitly mentioned
  /(?:that's|that\s+is)\s+not\s+(?:actually\s+)?my\s+problem.{0,30}\bstart/i,
];

  // ─────────────────────────────────────────────────────────────────────
  // 7. CONTRADICTION detection
  // ─────────────────────────────────────────────────────────────────────
  // 7a. Confidence claim vs. actual failure on challenges
  const hasFailed = judgedEvents.some((e) => (e.payload as any)?.verdict === 'failed');
  if (hasFailed) {
    for (const [key] of existingValues.entries()) {
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

  // 7b. Conversational hypothesis disconfirmation (Tweak #12)
  // When an active hypothesis exists and the user explicitly negates/contradicts
  // the core behavioral interpretation with high confidence.
  if (input.userInput) {
    const nInput = normalizeForBehavioral(input.userInput);

    // delayed_start hypothesis disconfirmation
    const delayedStartHypothesisKey = 'hypothesis:behavioral:self_report:delayed_start';
    if (existingKeys.has(delayedStartHypothesisKey)) {
      const isUncertain = _DISCONFIRMATION_UNCERTAINTY.some((rx) => rx.test(nInput));
      if (!isUncertain) {
        const isDisconfirmed = _DELAYED_START_DISCONFIRMATION.some((rx) => rx.test(nInput));
        if (isDisconfirmed && !result.contradictedKeys.includes(delayedStartHypothesisKey)) {
          result.contradictedKeys.push(delayedStartHypothesisKey);
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
        description: `Possible recurring pattern (${mem.strength} observations): ${extractMemoryDescription(mem.value)}`,
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

const VALID_EPISTEMIC_STATUSES = new Set<EpistemicStatus>([
  'reported',
  'observed',
  'derived',
  'hypothesis',
  'superseded',
  'contradicted',
]);

const VALID_MEMORY_TYPES = new Set<RivalMemoryType>([
  'factual',
  'behavioral',
  'relationship',
  'callback',
  'unresolved',
  'hypothesis',
]);

export function extractMemoryDescription(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && typeof parsed.description === 'string' && parsed.description.trim()) {
        return parsed.description;
      }
    } catch {
      // plain string
    }
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as any).description === 'string' && (value as any).description.trim()) {
    return (value as any).description;
  }
  return String(value);
}

/**
 * Reconstructs a full RivalMemory from a stored MemoryItem without losing epistemic status.
 *
 * Guaranteed invariants:
 * - 'reported' remains 'reported'
 * - 'observed' remains 'observed'
 * - 'derived' remains 'derived'
 * - 'hypothesis' remains 'hypothesis'
 * - 'superseded' remains 'superseded'
 * - 'contradicted' remains 'contradicted'
 *
 * Never silently downgrades to 'reported' or coerces type to 'callback'.
 */
export function memoryItemToRivalMemory(item: MemoryItem): RivalMemory {
  let parsed: Record<string, unknown> | null = null;
  if (typeof item.value === 'string') {
    try {
      const p = JSON.parse(item.value);
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        parsed = p as Record<string, unknown>;
      }
    } catch {
      // Plain string, not JSON
    }
  } else if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
    parsed = item.value as Record<string, unknown>;
  }

  // 1. Epistemic status — strictly preserved from parsed data, or inferred from key for legacy records
  let epistemicStatus: EpistemicStatus;
  if (
    parsed &&
    typeof parsed.epistemicStatus === 'string' &&
    VALID_EPISTEMIC_STATUSES.has(parsed.epistemicStatus as EpistemicStatus)
  ) {
    epistemicStatus = parsed.epistemicStatus as EpistemicStatus;
  } else if (item.key.startsWith('hypothesis:')) {
    epistemicStatus = 'hypothesis';
  } else if (item.key.startsWith('relationship:') || item.key.startsWith('unresolved:')) {
    epistemicStatus = 'observed';
  } else if (item.key.startsWith('behavioral:') && !item.key.startsWith('behavioral:self_report:')) {
    epistemicStatus = 'observed';
  } else {
    epistemicStatus = 'reported';
  }

  // 2. Memory type — preserved from parsed data, or inferred from key / category
  let type: RivalMemoryType;
  if (
    parsed &&
    typeof parsed.type === 'string' &&
    VALID_MEMORY_TYPES.has(parsed.type as RivalMemoryType)
  ) {
    type = parsed.type as RivalMemoryType;
  } else if (item.key.startsWith('hypothesis:')) {
    type = 'hypothesis';
  } else if (item.key.startsWith('behavioral:')) {
    type = 'behavioral';
  } else if (item.key.startsWith('relationship:')) {
    type = 'relationship';
  } else if (item.key.startsWith('unresolved:')) {
    type = 'unresolved';
  } else if (item.key.startsWith('goal_claim:') || item.key.startsWith('confidence_claim:')) {
    type = 'factual';
  } else if (item.key.startsWith('commitment:')) {
    type = 'callback';
  } else if (item.category === 'observation') {
    type = 'behavioral';
  } else if (item.category === 'running_joke') {
    type = 'callback';
  } else if (item.category === 'milestone') {
    type = 'relationship';
  } else {
    type = 'callback';
  }

  // 3. Description
  const description = extractMemoryDescription(item.value);

  // 4. Verbatim quote
  let verbatimQuote: string | null = null;
  if (parsed && 'verbatimQuote' in parsed) {
    verbatimQuote = typeof parsed.verbatimQuote === 'string' ? parsed.verbatimQuote : null;
  } else if (typeof item.value === 'string' && !parsed) {
    verbatimQuote = item.value.length <= 120 ? item.value : null;
  }

  // 5. Provenance
  let provenance: RivalMemoryProvenance;
  if (parsed && parsed.provenance && typeof parsed.provenance === 'object') {
    const prov = parsed.provenance as Record<string, unknown>;
    provenance = {
      sourceEventIds: Array.isArray(prov.sourceEventIds)
        ? prov.sourceEventIds.filter((id): id is string => typeof id === 'string')
        : [],
      sourceInsightTypes: Array.isArray(prov.sourceInsightTypes)
        ? prov.sourceInsightTypes.filter((t): t is string => typeof t === 'string')
        : [],
      challengeId: typeof prov.challengeId === 'string' ? prov.challengeId : null,
      derivedAt: typeof prov.derivedAt === 'string' ? prov.derivedAt : item.createdAt,
    };
  } else {
    provenance = {
      sourceEventIds: [],
      sourceInsightTypes: [],
      challengeId: null,
      derivedAt: item.createdAt,
    };
  }

  return {
    key: item.key,
    type,
    epistemicStatus,
    description,
    verbatimQuote,
    confidence: typeof parsed?.confidence === 'number'
      ? parsed.confidence
      : item.strength > 10 ? item.strength / 100 : 0.75,
    strength: item.strength,
    provenance,
  };
}
