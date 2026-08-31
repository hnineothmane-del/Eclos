// ---------------------------------------------------------------------------
// Rival Insight Selector
//
// Deterministic, conservative selection of which insight (if any) to surface
// on a given turn. Most turns should surface NOTHING.
//
// No AI. No randomness. No Date.now().
// ---------------------------------------------------------------------------

import type { RivalInsight } from './rivalInsights.js';
import type { RelationshipState } from '../types/relationship.js';
import type { Challenge } from '../types/challenge.js';

export interface InsightSelectionInput {
  /** All derived insights for this user (caller provides). */
  insights: readonly RivalInsight[];
  /** The user's message in this turn. */
  userInput: string;
  /** Authoritative relationship state. */
  relationship: RelationshipState;
  /** Active challenge or null. */
  activeChallenge: Challenge | null;
  /** Is this a serious/vulnerable context? Suppresses behavioral insights. */
  isSeriousContext: boolean;
  /** Is this challenge-critical? (evidence_submitted, needs_more_evidence) */
  isChallengeCritical: boolean;
  /** Recent insight keys that were surfaced (cooldown). */
  recentlySurfacedInsightKeys: readonly string[];
  /** ISO timestamp — caller provides. */
  nowIso: string;
}

export interface SelectedInsight {
  insight: RivalInsight;
  score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard minimum evidence count to surface any insight. */
const MIN_EVIDENCE_COUNT = 2;
/** Hard minimum confidence to surface any insight. */
const MIN_CONFIDENCE = 0.6;
/** Cooldown window: same insight won't surface twice within this many recent keys. */
const COOLDOWN_WINDOW = 5;
/** Minimum familiarity to surface pattern insights at all. */
const MIN_FAMILIARITY = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function hasAny(text: string, terms: readonly string[]): boolean {
  const n = normalize(text);
  return terms.some((t) => n.includes(t));
}

/** Days between two ISO timestamps. */
function daysBetween(isoA: string, isoB: string): number {
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / (1000 * 60 * 60 * 24);
}

const ACHIEVEMENT_TERMS = ['finished', 'completed', 'passed', 'shipped', 'done', 'submitted', 'succeeded'];
const FAILURE_TERMS = ['failed', 'gave up', 'quit', 'abandoned', "couldn't", 'did not'];
const CLAIM_TERMS = ['i know this', 'easy', 'simple', 'got it', 'definitely', "i've done this"];
const STRATEGY_TERMS = ['approach', 'strategy', 'method', 'trying differently'];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreInsight(
  ins: RivalInsight,
  input: InsightSelectionInput,
  recentlyUsedSet: Set<string>,
): { score: number; reason: string } | null {
  // ── HARD SUPPRESSION ──────────────────────────────────────────────────────

  // Serious/vulnerable context: suppress all behavioral insights
  if (input.isSeriousContext) return null;

  // Insufficient evidence
  if (ins.evidenceCount < MIN_EVIDENCE_COUNT) return null;

  // Low confidence
  if (ins.confidence < MIN_CONFIDENCE) return null;

  // Cooldown: this insight was surfaced recently
  if (recentlyUsedSet.has(ins.key)) return null;

  // Superseded or hypothesis in challenge-critical context
  if (input.isChallengeCritical && ins.epistemicStatus === 'hypothesis') return null;

  // Hypothesis: must have genuinely high evidence if not a special pattern
  if (ins.epistemicStatus === 'hypothesis' && ins.evidenceCount < 4) return null;

  // Relationship familiarity gate
  if (input.relationship.familiarity < MIN_FAMILIARITY) return null;

  // ── SCORING ───────────────────────────────────────────────────────────────

  let score = 0;
  let reason = 'pattern insight';
  let hasContextualRelevance = false;

  // Evidence count bonus (higher = more reliable pattern)
  score += Math.min(ins.evidenceCount * 4, 20);

  // Epistemic quality
  if (ins.epistemicStatus === 'observed') { score += 10; }
  else if (ins.epistemicStatus === 'derived') { score += 12; }
  else if (ins.epistemicStatus === 'hypothesis') { score += 5; }

  // Temporal pattern bonus
  if (ins.temporalPattern === 'long_standing') { score += 8; }
  else if (ins.temporalPattern === 'recent_change') { score += 10; reason = 'recent behavioral change detected'; }
  else if (ins.temporalPattern === 'recurring') { score += 6; }
  else if (ins.temporalPattern === 'improving') { score += 9; }
  else if (ins.temporalPattern === 'worsening') { score += 9; }

  // Freshness: observed within last 7 days
  const daysSinceLast = daysBetween(ins.lastObservedAt, input.nowIso);
  if (daysSinceLast <= 7) score += 5;

  // Confidence bonus
  score += ins.confidence * 8;

  // ── CONTEXTUAL RELEVANCE ─────────────────────────────────────────────────

  // User is talking about completing something → surface mismatch or success pattern
  if (
    hasAny(input.userInput, ACHIEVEMENT_TERMS) &&
    (ins.family === 'claim_vs_outcome_mismatch' || ins.family === 'consistent_success_domain' || ins.family === 'persistence_pattern')
  ) {
    score += 18;
    reason = 'user reported completion — pattern contextually relevant';
    hasContextualRelevance = true;
  }

  // User is making a claim → surface claim vs outcome mismatch
  if (
    hasAny(input.userInput, CLAIM_TERMS) &&
    ins.family === 'claim_vs_outcome_mismatch'
  ) {
    score += 22;
    reason = 'user making confidence claim matches historical mismatch pattern';
    hasContextualRelevance = true;
  }

  // User is mentioning failure → surface failure patterns
  if (
    hasAny(input.userInput, FAILURE_TERMS) &&
    (ins.family === 'consistent_failure_domain' || ins.family === 'abandonment_pattern')
  ) {
    score += 15;
    reason = 'failure context matches pattern';
    hasContextualRelevance = true;
  }

  // User is mentioning strategy changes → surface strategy pattern
  if (
    hasAny(input.userInput, STRATEGY_TERMS) &&
    ins.family === 'repeated_strategy_switch'
  ) {
    score += 15;
    reason = 'strategy discussion matches pattern';
    hasContextualRelevance = true;
  }

  // Challenge-critical: only directly relevant patterns surface
  if (input.isChallengeCritical) {
    if (!hasContextualRelevance) return null;
    // Apply extra threshold in critical contexts
    if (score < 30) return null;
  }

  // Active challenge domain match: surface domain-specific patterns
  if (input.activeChallenge) {
    const domain = input.activeChallenge.domain;
    if (ins.key.includes(`:${domain}`) || ins.key.includes(`_${domain}`)) {
      score += 15;
      reason = `pattern directly relevant to active ${domain} challenge`;
      hasContextualRelevance = true;
    }
  }

  // ── MINIMUM THRESHOLD ────────────────────────────────────────────────────

  // Patterns that are purely behavioral require meaningful context to surface
  // unless they are extremely strong (score >= 45)
  const requiresContext: RivalInsight['family'][] = [
    'repeated_strategy_switch', 'stall_pattern', 'negotiation_pattern', 'abandonment_pattern', 'claim_vs_outcome_mismatch'
  ];
  if (requiresContext.includes(ins.family) && !hasContextualRelevance && score < 45) {
    return null;
  }

  // Global minimum score
  if (score < 22) return null;

  return { score, reason };
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

/**
 * Deterministically select at most ONE insight to surface on this turn.
 * Returns null when no insight is appropriate (which should be most turns).
 */
export function selectRivalInsight(input: InsightSelectionInput): SelectedInsight | null {
  if (input.insights.length === 0) return null;
  if (input.isSeriousContext) return null;
  if (input.relationship.familiarity < MIN_FAMILIARITY) return null;

  const recentlyUsedSet = new Set(input.recentlySurfacedInsightKeys.slice(-COOLDOWN_WINDOW));
  const candidates: SelectedInsight[] = [];

  for (const ins of input.insights) {
    const result = scoreInsight(ins, input, recentlyUsedSet);
    if (result) {
      candidates.push({ insight: ins, score: result.score, reason: result.reason });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, then by evidence count descending
  candidates.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : b.insight.evidenceCount - a.insight.evidenceCount,
  );

  return candidates[0];
}
