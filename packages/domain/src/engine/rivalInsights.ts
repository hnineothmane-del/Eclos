// ---------------------------------------------------------------------------
// Rival Insight Engine
//
// ARCHITECTURE:
//   EVENTS + MEMORIES + PROCESS INSIGHTS → RIVAL INSIGHTS → INSIGHT SELECTOR → PROMPT
//
// Insights detect grounded recurring patterns across sessions.
// They are NEVER authored by the model.
// They are derived deterministically from authoritative events + memories.
//
// KEY PRINCIPLE: Sound like someone who's been paying attention, not a therapist.
//   Bad:  "You display avoidant behavior."
//   Good: "You've bailed on three tasks right when the first approach stopped working."
// ---------------------------------------------------------------------------

import type { DomainEvent } from '../types/events.js';
import type { ProcessInsight } from './processInsights.js';
import type { EpistemicStatus, RivalMemory, RivalMemoryProvenance } from './rivalMemory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightFamily =
  | 'repeated_strategy_switch'     // keeps changing approach mid-task
  | 'stall_pattern'                // repeatedly stalls before starting
  | 'persistence_pattern'          // repeatedly persists after failure
  | 'rapid_recovery_pattern'       // repeatedly recovers quickly after failure
  | 'claim_vs_outcome_mismatch'    // said it was easy, then failed
  | 'pressure_preference_mismatch' // claims to work best under pressure; data says otherwise
  | 'consistent_success_domain'    // reliably succeeds in a specific domain
  | 'consistent_failure_domain'    // repeatedly fails in a specific domain
  | 'negotiation_pattern'          // habitually negotiates before attempting
  | 'abandonment_pattern'          // repeatedly abandons challenges early
  | 'improvement_over_time'        // recent outcomes better than past
  | 'worsening_over_time';         // recent outcomes worse than past

export type TemporalPattern =
  | 'one_off'        // single observation
  | 'recurring'      // 2–3 observations
  | 'long_standing'  // 4+ observations over time
  | 'recent_change'  // pattern only visible in recent window
  | 'improving'      // measurably getting better
  | 'worsening';     // measurably getting worse

export interface RivalInsight {
  /** Stable key for dedup/cooldown tracking. */
  key: string;
  family: InsightFamily;
  /** Uses Task 23 EpistemicStatus ontology. */
  epistemicStatus: EpistemicStatus;
  /**
   * Short factual description — NO trait labels, NO diagnoses.
   * The Rival can paraphrase this but must not fabricate facts beyond it.
   */
  description: string;
  /** Number of independent challenge/session observations backing this. */
  evidenceCount: number;
  /** Confidence in the pattern (0–1). NOT confidence in a psychological interpretation. */
  confidence: number;
  temporalPattern: TemporalPattern;
  /** ISO — earliest source event timestamp. Caller-derived; no Date.now(). */
  firstObservedAt: string;
  /** ISO — latest source event timestamp. Caller-derived; no Date.now(). */
  lastObservedAt: string;
  /** Same provenance structure as Task 23 RivalMemory. */
  provenance: RivalMemoryProvenance;
}

// ---------------------------------------------------------------------------
// Derivation input
// ---------------------------------------------------------------------------

export interface DeriveRivalInsightsInput {
  /** Full available event history for the user (caller fetches; no DB access here). */
  allEvents: readonly DomainEvent[];
  /** Current rival memory state (from Task 23). */
  rivalMemories: readonly RivalMemory[];
  /** Process insights for the current turn (from Task 12). */
  processInsights: readonly ProcessInsight[];
  /** ISO timestamp — caller provides; never call Date.now() inside this function. */
  nowIso: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Group events by challenge_id (authoritative payload field). */
function eventsByChallengeId(events: readonly DomainEvent[]): Map<string, DomainEvent[]> {
  const map = new Map<string, DomainEvent[]>();
  for (const e of events) {
    const cid: unknown = (e.payload as Record<string, unknown>)?.challenge_id;
    if (typeof cid === 'string' && cid) {
      const arr = map.get(cid) ?? [];
      arr.push(e);
      map.set(cid, arr);
    }
  }
  return map;
}

/** Return all judged challenges with their verdict and domain. */
interface JudgedChallenge {
  challengeId: string;
  verdict: 'passed' | 'failed' | 'needs_more_evidence';
  domain: string | null;
  at: string; // ISO timestamp of judgment event
  eventId: string;
}

function extractJudgedChallenges(events: readonly DomainEvent[]): JudgedChallenge[] {
  return events
    .filter((e) => e.eventType === 'challenge_judged')
    .map((e) => {
      const p = e.payload as Record<string, unknown>;
      const verdict = p.verdict as string;
      if (verdict !== 'passed' && verdict !== 'failed' && verdict !== 'needs_more_evidence') return null;
      return {
        challengeId: typeof p.challenge_id === 'string' ? p.challenge_id : '',
        verdict: verdict as JudgedChallenge['verdict'],
        domain: typeof p.domain === 'string' ? p.domain : null,
        at: e.createdAt,
        eventId: e.id,
      };
    })
    .filter((x): x is JudgedChallenge => x !== null && x.challengeId !== '');
}

/** Which process insight types occurred in events for a given challenge. */
function insightTypesForChallenge(
  challengeEvents: DomainEvent[],
  challenge: { id: string; expectedDurationMinutes?: number | null },
): Set<ProcessInsight['type']> {
  // Re-use the same signals as processInsights.ts but without re-running the full engine.
  // We look directly at signal/thought events in the event log.
  const types = new Set<ProcessInsight['type']>();

  const signals = challengeEvents.filter((e) => e.eventType === 'process_signal');
  const thoughts = challengeEvents.filter((e) => e.eventType === 'process_thought');
  const judgments = challengeEvents.filter((e) => e.eventType === 'challenge_judged');
  const startEvent = challengeEvents.find((e) => e.eventType === 'challenge_started');

  const strategies = signals.filter((s) => {
    const sig = String((s.payload as Record<string, unknown>)?.signal ?? '');
    return sig.includes('CHANGING APPROACH') || sig.includes('CHANGING_APPROACH');
  });
  const stucks = signals.filter((s) =>
    String((s.payload as Record<string, unknown>)?.signal ?? '').includes('STUCK'),
  );
  const helpSigs = signals.filter((s) => {
    const sig = String((s.payload as Record<string, unknown>)?.signal ?? '');
    return sig.includes('NEED A HINT') || sig.includes('NEED_HINT');
  });

  const passed = judgments.find((j) => (j.payload as Record<string, unknown>)?.verdict === 'passed');
  const failed = judgments.find((j) => {
    const v = (j.payload as Record<string, unknown>)?.verdict;
    return v === 'failed' || v === 'needs_more_evidence';
  });

  if (startEvent && strategies.length > 0) types.add('strategy_switch');
  if (strategies.length >= 2) types.add('repeated_strategy_switch');
  if (stucks.length > 0 && strategies.length > 0) types.add('stall_then_recovery');
  if (helpSigs.length > 0) types.add('help_seeking');
  if (failed && passed && new Date(passed.createdAt) > new Date(failed.createdAt)) {
    types.add('persistence_after_failure');
    const msDiff = new Date(passed.createdAt).getTime() - new Date(failed.createdAt).getTime();
    if (msDiff < 60000) types.add('rapid_recovery');
  }

  // initialization delay > 30s
  const firstAction = challengeEvents.find(
    (e) =>
      e.eventType === 'process_signal' ||
      e.eventType === 'process_thought' ||
      e.eventType === 'challenge_attempted' ||
      e.eventType === 'evidence_submitted',
  );
  if (startEvent && firstAction && startEvent.id !== firstAction.id) {
    const delayMs = new Date(firstAction.createdAt).getTime() - new Date(startEvent.createdAt).getTime();
    if (delayMs > 30000) types.add('initialization_delay');
  }

  // Abandonment: challenge_closed without a passed verdict
  const closed = challengeEvents.find((e) => e.eventType === 'challenge_closed');
  if (closed && !passed) types.add('early_abandonment');

  // Confidence before attempt
  const CONFIDENCE_WORDS = ['i know this', 'i got this', 'easy', 'simple', 'no problem', "i've got this"];
  const confidenceThoughts = thoughts.filter((t) => {
    const text = String((t.payload as Record<string, unknown>)?.content ?? '').toLowerCase();
    return CONFIDENCE_WORDS.some((w) => text.includes(w));
  });
  if (confidenceThoughts.length > 0) types.add('confidence_before_attempt');

  return types;
}

/** Compute temporal pattern label from evidence count and time spread. */
function temporalPattern(count: number, firstAt: string, lastAt: string, nowIso: string): TemporalPattern {
  if (count === 1) return 'one_off';
  const spanDays = (new Date(lastAt).getTime() - new Date(firstAt).getTime()) / (1000 * 60 * 60 * 24);
  const daysSinceLast = (new Date(nowIso).getTime() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24);
  if (count >= 4) {
    if (daysSinceLast <= 7) return 'long_standing'; // active long pattern
    return 'long_standing';
  }
  if (spanDays <= 3) return 'recent_change'; // all observations are recent
  return 'recurring';
}

/** Clamp confidence to [0, 1]. */
function clampConf(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Min ISO timestamp from a list of strings. */
function minIso(dates: string[]): string {
  return dates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
}

/** Max ISO timestamp from a list of strings. */
function maxIso(dates: string[]): string {
  return dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
}

// ---------------------------------------------------------------------------
// Main pure derivation function
// ---------------------------------------------------------------------------

/**
 * PURE DETERMINISTIC function.
 * No network. No database. No AI. No Date.now().
 * Accepts all required data from the caller.
 */
export function deriveRivalInsights(input: DeriveRivalInsightsInput): RivalInsight[] {
  const insights: RivalInsight[] = [];
  const { allEvents, rivalMemories, nowIso } = input;

  if (allEvents.length === 0) return insights;

  const byChallengeId = eventsByChallengeId(allEvents);
  const judged = extractJudgedChallenges(allEvents);

  // Map challengeId → insight types for that challenge
  const challengeInsightTypes = new Map<string, Set<ProcessInsight['type']>>();
  for (const [cid, evts] of byChallengeId.entries()) {
    challengeInsightTypes.set(cid, insightTypesForChallenge(evts, { id: cid }));
  }

  // Collect all challenge IDs that had a particular insight type
  function challengesWithInsight(type: ProcessInsight['type']): string[] {
    const result: string[] = [];
    for (const [cid, types] of challengeInsightTypes.entries()) {
      if (types.has(type)) result.push(cid);
    }
    return result;
  }

  // Helper: events for specific challenge IDs
  function eventsForChallenges(cids: string[]): DomainEvent[] {
    return cids.flatMap((cid) => byChallengeId.get(cid) ?? []);
  }

  const prov = (eventIds: string[], insightTypes: string[] = []): RivalMemoryProvenance => ({
    sourceEventIds: eventIds,
    sourceInsightTypes: insightTypes,
    challengeId: null,
    derivedAt: nowIso,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. REPEATED STRATEGY SWITCH — changed approach in 3+ distinct challenges
  // ─────────────────────────────────────────────────────────────────────────
  {
    const cids = challengesWithInsight('strategy_switch');
    if (cids.length >= 3) {
      const sourceEvents = eventsForChallenges(cids).filter(
        (e) => e.eventType === 'process_signal' &&
          (String((e.payload as Record<string, unknown>)?.signal ?? '').includes('CHANGING')),
      );
      const eventIds = sourceEvents.map((e) => e.id);
      const timestamps = sourceEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:repeated_strategy_switch',
        family: 'repeated_strategy_switch',
        epistemicStatus: 'derived',
        description: `In ${cids.length} of the last challenges, you changed approach mid-task.`,
        evidenceCount: cids.length,
        confidence: clampConf(0.6 + (cids.length - 3) * 0.05),
        temporalPattern: temporalPattern(cids.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, ['strategy_switch']),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. STALL PATTERN — stalled then recovered in 3+ distinct challenges
  // ─────────────────────────────────────────────────────────────────────────
  {
    const cids = challengesWithInsight('stall_then_recovery');
    if (cids.length >= 3) {
      const sourceEvents = eventsForChallenges(cids).filter(
        (e) => e.eventType === 'process_signal' &&
          String((e.payload as Record<string, unknown>)?.signal ?? '').includes('STUCK'),
      );
      const eventIds = sourceEvents.map((e) => e.id);
      const timestamps = sourceEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:stall_pattern',
        family: 'stall_pattern',
        epistemicStatus: 'derived',
        description: `In ${cids.length} challenges you hit a wall, then found your way through.`,
        evidenceCount: cids.length,
        confidence: clampConf(0.65 + (cids.length - 3) * 0.05),
        temporalPattern: temporalPattern(cids.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, ['stall_then_recovery']),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. PERSISTENCE PATTERN — continued after failure in 2+ challenges
  // ─────────────────────────────────────────────────────────────────────────
  {
    const cids = challengesWithInsight('persistence_after_failure');
    if (cids.length >= 2) {
      const sourceEvents = eventsForChallenges(cids).filter(
        (e) => e.eventType === 'challenge_judged',
      );
      const eventIds = sourceEvents.map((e) => e.id);
      const timestamps = sourceEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:persistence_pattern',
        family: 'persistence_pattern',
        epistemicStatus: 'derived',
        description: `${cids.length} times you failed first and still came back for another attempt.`,
        evidenceCount: cids.length,
        confidence: clampConf(0.70 + (cids.length - 2) * 0.05),
        temporalPattern: temporalPattern(cids.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, ['persistence_after_failure']),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. RAPID RECOVERY PATTERN — rapid recovery in 2+ challenges
  // ─────────────────────────────────────────────────────────────────────────
  {
    const cids = challengesWithInsight('rapid_recovery');
    if (cids.length >= 2) {
      const sourceEvents = eventsForChallenges(cids).filter(
        (e) => e.eventType === 'challenge_judged',
      );
      const eventIds = sourceEvents.map((e) => e.id);
      const timestamps = sourceEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:rapid_recovery_pattern',
        family: 'rapid_recovery_pattern',
        epistemicStatus: 'observed',
        description: `${cids.length} times you bounced back quickly after a setback (under 60 seconds).`,
        evidenceCount: cids.length,
        confidence: clampConf(0.75 + (cids.length - 2) * 0.05),
        temporalPattern: temporalPattern(cids.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, ['rapid_recovery']),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. CLAIM VS OUTCOME MISMATCH — said it was easy, then failed
  // ─────────────────────────────────────────────────────────────────────────
  {
    const confidenceMemories = rivalMemories.filter(
      (m) => m.key.startsWith('confidence_claim:') && m.epistemicStatus !== 'superseded',
    );
    const failedJudgments = judged.filter((j) => j.verdict === 'failed');

    // Only fire if there's at least one confidence claim and one subsequent failure
    if (confidenceMemories.length > 0 && failedJudgments.length > 0) {
      const matchingFailures = failedJudgments.filter((fj) => {
        // The failure must post-date at least one confidence claim
        return confidenceMemories.some(
          (m) => new Date(fj.at) > new Date(m.provenance.derivedAt),
        );
      });

      if (matchingFailures.length >= 1) {
        const eventIds = matchingFailures.map((f) => f.eventId);
        const timestamps = matchingFailures.map((f) => f.at);
        const first = minIso([...timestamps, ...confidenceMemories.map((m) => m.provenance.derivedAt)]);
        const last = maxIso(timestamps);
        const quote = confidenceMemories[0].verbatimQuote;
        insights.push({
          key: 'insight:claim_vs_outcome_mismatch',
          family: 'claim_vs_outcome_mismatch',
          epistemicStatus: 'derived',
          description: quote
            ? `You said "${quote}" — then didn't complete the task. That's happened ${matchingFailures.length} time${matchingFailures.length > 1 ? 's' : ''}.`
            : `You expressed confidence before ${matchingFailures.length} challenge${matchingFailures.length > 1 ? 's' : ''} that you didn't complete.`,
          evidenceCount: matchingFailures.length,
          confidence: clampConf(0.65 + matchingFailures.length * 0.1),
          temporalPattern: matchingFailures.length >= 3 ? 'long_standing' : matchingFailures.length >= 2 ? 'recurring' : 'one_off',
          firstObservedAt: first,
          lastObservedAt: last,
          provenance: prov(eventIds, ['confidence_before_attempt']),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. PRESSURE PREFERENCE MISMATCH — "works best under pressure" + timed failures
  // ─────────────────────────────────────────────────────────────────────────
  {
    const pressureClaims = rivalMemories.filter(
      (m) =>
        (m.key.startsWith('factual:') || m.key.startsWith('goal_claim:')) &&
        (m.description + (m.verbatimQuote ?? '')).toLowerCase().includes('under pressure'),
    );
    // Look for failed challenges that had a time constraint (expectedDurationMinutes present in payload)
    const timedFailures = judged.filter((j) => {
      if (j.verdict !== 'failed') return false;
      const cEvents = byChallengeId.get(j.challengeId) ?? [];
      const issuedEvent = cEvents.find((e) => e.eventType === 'challenge_issued');
      const p = (issuedEvent?.payload ?? {}) as Record<string, unknown>;
      return typeof p.expectedDurationMinutes === 'number' && p.expectedDurationMinutes > 0;
    });

    if (pressureClaims.length > 0 && timedFailures.length >= 1) {
      const eventIds = timedFailures.map((f) => f.eventId);
      const timestamps = timedFailures.map((f) => f.at);
      const first = minIso([...timestamps, ...pressureClaims.map((m) => m.provenance.derivedAt)]);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:pressure_preference_mismatch',
        family: 'pressure_preference_mismatch',
        epistemicStatus: 'derived',
        description: `You've said you work best under pressure, but you didn't complete ${timedFailures.length} timed challenge${timedFailures.length > 1 ? 's' : ''}.`,
        evidenceCount: timedFailures.length,
        confidence: clampConf(0.60 + timedFailures.length * 0.08),
        temporalPattern: timedFailures.length >= 3 ? 'recurring' : 'one_off',
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, []),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. CONSISTENT SUCCESS DOMAIN — 3+ completions in same domain
  // ─────────────────────────────────────────────────────────────────────────
  {
    const domainSuccesses = new Map<string, JudgedChallenge[]>();
    for (const j of judged) {
      if (j.verdict !== 'passed') continue;
      const domain = j.domain ?? 'general';
      const arr = domainSuccesses.get(domain) ?? [];
      arr.push(j);
      domainSuccesses.set(domain, arr);
    }
    for (const [domain, passes] of domainSuccesses.entries()) {
      if (passes.length >= 3) {
        const eventIds = passes.map((p) => p.eventId);
        const timestamps = passes.map((p) => p.at);
        const first = minIso(timestamps);
        const last = maxIso(timestamps);
        insights.push({
          key: `insight:consistent_success:${domain}`,
          family: 'consistent_success_domain',
          epistemicStatus: 'derived',
          description: `You've completed ${passes.length} ${domain} challenges. That's a real track record.`,
          evidenceCount: passes.length,
          confidence: clampConf(0.70 + (passes.length - 3) * 0.05),
          temporalPattern: temporalPattern(passes.length, first, last, nowIso),
          firstObservedAt: first,
          lastObservedAt: last,
          provenance: prov(eventIds, []),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. CONSISTENT FAILURE DOMAIN — 2+ failures in same domain, no successes
  // ─────────────────────────────────────────────────────────────────────────
  {
    const domainOutcomes = new Map<string, { passes: number; fails: JudgedChallenge[] }>();
    for (const j of judged) {
      const domain = j.domain ?? 'general';
      const entry = domainOutcomes.get(domain) ?? { passes: 0, fails: [] };
      if (j.verdict === 'passed') entry.passes++;
      else entry.fails.push(j);
      domainOutcomes.set(domain, entry);
    }
    for (const [domain, { passes, fails }] of domainOutcomes.entries()) {
      if (fails.length >= 2 && passes === 0) {
        const eventIds = fails.map((f) => f.eventId);
        const timestamps = fails.map((f) => f.at);
        const first = minIso(timestamps);
        const last = maxIso(timestamps);
        insights.push({
          key: `insight:consistent_failure:${domain}`,
          family: 'consistent_failure_domain',
          epistemicStatus: 'derived',
          description: `You've failed ${fails.length} ${domain} challenges in a row without a pass yet.`,
          evidenceCount: fails.length,
          confidence: clampConf(0.65 + (fails.length - 2) * 0.05),
          temporalPattern: temporalPattern(fails.length, first, last, nowIso),
          firstObservedAt: first,
          lastObservedAt: last,
          provenance: prov(eventIds, []),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. NEGOTIATION PATTERN — negotiated challenge parameters 2+ times
  // ─────────────────────────────────────────────────────────────────────────
  {
    const negotiationEvents = allEvents.filter((e) => e.eventType === 'challenge_negotiated');
    // Group by challenge to avoid counting multiple negotiations on the same challenge
    const challengeIdsNegotiated = new Set(
      negotiationEvents.map((e) => String((e.payload as Record<string, unknown>)?.challenge_id ?? '')),
    );
    const uniqueNegotiations = [...challengeIdsNegotiated].filter((id) => id !== '');

    if (uniqueNegotiations.length >= 2) {
      const eventIds = negotiationEvents.map((e) => e.id);
      const timestamps = negotiationEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:negotiation_pattern',
        family: 'negotiation_pattern',
        epistemicStatus: 'derived',
        description: `You've pushed back on challenge terms ${uniqueNegotiations.length} times before starting.`,
        evidenceCount: uniqueNegotiations.length,
        confidence: clampConf(0.65 + (uniqueNegotiations.length - 2) * 0.05),
        temporalPattern: temporalPattern(uniqueNegotiations.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, []),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. ABANDONMENT PATTERN — early abandonment in 2+ challenges
  // ─────────────────────────────────────────────────────────────────────────
  {
    const cids = challengesWithInsight('early_abandonment');
    if (cids.length >= 2) {
      const sourceEvents = eventsForChallenges(cids).filter(
        (e) => e.eventType === 'challenge_closed',
      );
      const eventIds = sourceEvents.map((e) => e.id);
      const timestamps = sourceEvents.map((e) => e.createdAt);
      const first = minIso(timestamps);
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:abandonment_pattern',
        family: 'abandonment_pattern',
        epistemicStatus: 'derived',
        description: `You've walked away from ${cids.length} challenges without attempting them.`,
        evidenceCount: cids.length,
        confidence: clampConf(0.65 + (cids.length - 2) * 0.05),
        temporalPattern: temporalPattern(cids.length, first, last, nowIso),
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(eventIds, ['early_abandonment']),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11 & 12. IMPROVEMENT / WORSENING OVER TIME
  // Requires ≥ 4 judged challenges to reason about a trajectory.
  // Split into two halves (oldest 50% vs newest 50%) and compare pass rates.
  // ─────────────────────────────────────────────────────────────────────────
  if (judged.length >= 4) {
    const sorted = [...judged].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    const mid = Math.floor(sorted.length / 2);
    const older = sorted.slice(0, mid);
    const newer = sorted.slice(mid);

    const passRate = (set: JudgedChallenge[]) =>
      set.filter((j) => j.verdict === 'passed').length / set.length;

    const olderRate = passRate(older);
    const newerRate = passRate(newer);
    const delta = newerRate - olderRate;

    if (delta >= 0.3 && newerRate > 0) {
      const timestamps = newer.map((j) => j.at);
      const first = sorted[0].at;
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:improvement_over_time',
        family: 'improvement_over_time',
        epistemicStatus: 'hypothesis',
        description: `Your completion rate has gone up recently. ${Math.round(newerRate * 100)}% of recent challenges passed vs ${Math.round(olderRate * 100)}% before.`,
        evidenceCount: sorted.length,
        confidence: clampConf(0.55 + delta * 0.5),
        temporalPattern: 'improving',
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(sorted.map((j) => j.eventId), []),
      });
    } else if (delta <= -0.3 && olderRate > 0) {
      const timestamps = newer.map((j) => j.at);
      const first = sorted[0].at;
      const last = maxIso(timestamps);
      insights.push({
        key: 'insight:worsening_over_time',
        family: 'worsening_over_time',
        epistemicStatus: 'hypothesis',
        description: `Your completion rate has dropped recently. ${Math.round(newerRate * 100)}% of recent challenges passed vs ${Math.round(olderRate * 100)}% before.`,
        evidenceCount: sorted.length,
        confidence: clampConf(0.50 + Math.abs(delta) * 0.4),
        temporalPattern: 'worsening',
        firstObservedAt: first,
        lastObservedAt: last,
        provenance: prov(sorted.map((j) => j.eventId), []),
      });
    }
  }

  return insights;
}
