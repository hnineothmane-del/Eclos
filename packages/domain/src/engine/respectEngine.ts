import { clamp } from '../util/clamp.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DIFFICULTY_BANDS = [
  { min: 1, max: 3, multiplier: 0.5, label: 'easy' },
  { min: 4, max: 6, multiplier: 1.0, label: 'moderate' },
  { min: 7, max: 8, multiplier: 1.5, label: 'hard' },
  { min: 9, max: 10, multiplier: 2.0, label: 'very_hard' },
] as const;

export const RESPECT_CONSTANTS = {
  COMPLETION_BASE: 4,
  IMPROVEMENT_BONUS: 2,
  IMPROVEMENT_BASELINE_GAP: 2,

  REPEAT_DAMPING_STEP: 0.15,
  REPEAT_DAMPING_FLOOR: 0.4,

  RECOVERY_BASE: 5,
  RECOVERY_HIGH_EFFORT_BONUS: 2,
  EFFORT_HIGH_THRESHOLD: 0.7,

  DISCLOSURE_BASE: 0,
  DISCLOSURE_SELF_CORRECTION_BONUS: 3,

  LIE_PENALTY_BASE: -10,
  LIE_ESCALATION_STEP: -2,
  LIE_ESCALATION_CAP: -6,

  LOW_EFFORT_THRESHOLD: 0.2,
  REPEATED_NO_EFFORT_THRESHOLD: 3,
  LOW_EFFORT_STREAK_PENALTY: -3,

  MILESTONE_BONUS: 3,

  MAX_SINGLE_EVENT_DELTA: 10,
  MIN_SINGLE_EVENT_DELTA: -16,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RespectEventType =
  | 'challenge_completed'
  | 'challenge_failed'
  | 'recovery'
  | 'disclosure'
  | 'lie_detected'
  | 'milestone'
  | 'claim'
  | 'evidence_submitted';

export interface RespectEventBase {
  type: RespectEventType;
}

export interface ChallengeCompletedEvent extends RespectEventBase {
  type: 'challenge_completed';
  difficulty: number;
  userBaselineDifficulty: number;
  recentSameBandCompletions: number;
}

export interface ChallengeFailedEvent extends RespectEventBase {
  type: 'challenge_failed';
  effortSignal: number;
  consecutiveLowEffortFailures: number;
}

export interface RecoveryEvent extends RespectEventBase {
  type: 'recovery';
  priorFailureConfirmed: boolean;
  effortSignal: number;
}

export interface DisclosureEvent extends RespectEventBase {
  type: 'disclosure';
  selfCorrected: boolean;
}

export interface LieDetectedEvent extends RespectEventBase {
  type: 'lie_detected';
  priorRecentLies: number; // count of lies before this one (0 = first lie)
}

export interface MilestoneEvent extends RespectEventBase {
  type: 'milestone';
}

export interface ClaimEvent extends RespectEventBase {
  type: 'claim';
}

export interface EvidenceSubmittedEvent extends RespectEventBase {
  type: 'evidence_submitted';
}

export type RespectEvent =
  | ChallengeCompletedEvent
  | ChallengeFailedEvent
  | RecoveryEvent
  | DisclosureEvent
  | LieDetectedEvent
  | MilestoneEvent
  | ClaimEvent
  | EvidenceSubmittedEvent;

export interface RespectDelta {
  respect: number;
  trust: number;
  warmth: number;
  rivalry: number;
  familiarity: number;
  curiosity: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDifficultyBandMultiplier(difficulty: number): number {
  for (const band of DIFFICULTY_BANDS) {
    if (difficulty >= band.min && difficulty <= band.max) {
      return band.multiplier;
    }
  }
  // Default to moderate if out of range (shouldn't happen with validated data)
  return 1.0;
}

// ---------------------------------------------------------------------------
// Effort evidence & signal
// ---------------------------------------------------------------------------

export interface EffortEvidence {
  attempted: boolean;
  elapsedFraction?: number; // 0-1, fraction of expected duration actually engaged
  attemptCount?: number;
  revisionCount?: number;
  helpRequested?: boolean;
  meaningfulSubmission?: boolean;
}

export function deriveEffortSignal(input: EffortEvidence): number {
  let score = 0;

  if (input.attempted) {
    score += 0.2;
  }

  if (input.elapsedFraction !== undefined) {
    score += 0.2 * clamp(input.elapsedFraction, 0, 1);
  }

  if (input.attemptCount !== undefined) {
    // Cap normalization at 5 attempts = full contribution
    const cappedAttempts = Math.min(input.attemptCount, 5) / 5;
    score += 0.15 * cappedAttempts;
  }

  if (input.revisionCount !== undefined) {
    // Cap normalization at 5 revisions = full contribution
    const cappedRevisions = Math.min(input.revisionCount, 5) / 5;
    score += 0.15 * cappedRevisions;
  }

  if (input.helpRequested) {
    score += 0.1;
  }

  if (input.meaningfulSubmission) {
    score += 0.2;
  }

  return clamp(score, 0, 1);
}

// ---------------------------------------------------------------------------
// Secondary relationship deltas
// ---------------------------------------------------------------------------

const SECONDARY_DELTAS: Record<RespectEventType, Partial<Omit<RespectDelta, 'respect'>>> = {
  challenge_completed: { trust: 1, rivalry: 1 },
  challenge_failed: { rivalry: 1 },
  recovery: { trust: 2, warmth: 1, rivalry: 2 },
  disclosure: { trust: 3, warmth: 3, curiosity: 1 },
  lie_detected: { trust: -8, warmth: -2, rivalry: -1 },
  milestone: { warmth: 2, curiosity: 1 },
  claim: {},
  evidence_submitted: {},
};

const FAMILIARITY_EVENTS = new Set<RespectEventType>([
  'challenge_completed',
  'challenge_failed',
  'recovery',
  'disclosure',
  'milestone',
  'evidence_submitted',
  'claim',
]);

// ---------------------------------------------------------------------------
// Core respect calculation
// ---------------------------------------------------------------------------

function computeRespectDelta(event: RespectEvent): number {
  const C = RESPECT_CONSTANTS;

  switch (event.type) {
    case 'challenge_completed': {
      const multiplier = getDifficultyBandMultiplier(event.difficulty);
      let base = C.COMPLETION_BASE * multiplier;
      if (event.difficulty >= event.userBaselineDifficulty + C.IMPROVEMENT_BASELINE_GAP) {
        base += C.IMPROVEMENT_BONUS;
      }
      const dampingFactor = Math.max(
        C.REPEAT_DAMPING_FLOOR,
        1 - C.REPEAT_DAMPING_STEP * event.recentSameBandCompletions,
      );
      return Math.round(base * dampingFactor);
    }

    case 'challenge_failed': {
      if (
        event.effortSignal < C.LOW_EFFORT_THRESHOLD &&
        event.consecutiveLowEffortFailures >= C.REPEATED_NO_EFFORT_THRESHOLD
      ) {
        return C.LOW_EFFORT_STREAK_PENALTY;
      }
      return 0;
    }

    case 'recovery': {
      if (!event.priorFailureConfirmed) return 0;
      let delta = C.RECOVERY_BASE;
      if (event.effortSignal >= C.EFFORT_HIGH_THRESHOLD) {
        delta += C.RECOVERY_HIGH_EFFORT_BONUS;
      }
      return delta;
    }

    case 'disclosure': {
      if (event.selfCorrected) return C.DISCLOSURE_SELF_CORRECTION_BONUS;
      return C.DISCLOSURE_BASE;
    }

    case 'lie_detected': {
      const escalation = clamp(
        C.LIE_ESCALATION_STEP * event.priorRecentLies,
        C.LIE_ESCALATION_CAP,
        0,
      );
      return C.LIE_PENALTY_BASE + escalation;
    }

    case 'milestone':
      return C.MILESTONE_BONUS;

    case 'claim':
    case 'evidence_submitted':
      return 0;

    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function computeRespectEvent(event: RespectEvent): RespectDelta {
  const C = RESPECT_CONSTANTS;
  const rawRespect = computeRespectDelta(event);
  const respect = clamp(rawRespect, C.MIN_SINGLE_EVENT_DELTA, C.MAX_SINGLE_EVENT_DELTA);

  const secondary = SECONDARY_DELTAS[event.type] ?? {};
  const familiarity = FAMILIARITY_EVENTS.has(event.type) ? 1 : 0;

  return {
    respect,
    trust: secondary.trust ?? 0,
    warmth: secondary.warmth ?? 0,
    rivalry: secondary.rivalry ?? 0,
    familiarity,
    curiosity: secondary.curiosity ?? 0,
  };
}
