import { clamp } from '../util/clamp.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DIFFICULTY_CONSTANTS = {
  MIN: 1,
  MAX: 10,
  STREAK_THRESHOLD: 2,
  HIGH_EFFORT_FAILURE_STREAK_THRESHOLD: 3,
  EXCEPTIONAL_CONFIDENCE_THRESHOLD: 0.9,
  INCREASE_STEP_NORMAL: 1,
  INCREASE_STEP_EXCEPTIONAL: 2,
  DECREASE_STEP: 1,
  LOW_EFFORT_THRESHOLD: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChallengeOutcomeRecord {
  /** true = passed, false = failed */
  passed: boolean;
  effortSignal: number;  // 0-1
  confidence: number;    // 0-1
}

export type NextDifficultyResult = {
  nextDifficulty: number;
  reason: string;
};

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

export function computeNextDifficulty(
  currentDifficulty: number,
  history: readonly ChallengeOutcomeRecord[],
): NextDifficultyResult {
  const D = DIFFICULTY_CONSTANTS;

  if (history.length === 0) {
    return {
      nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
      reason: 'No history — hold current difficulty',
    };
  }

  if (history.length === 1) {
    return {
      nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
      reason: 'Only one result — hold current difficulty',
    };
  }

  // Trailing consecutive outcomes
  const recent = [...history].reverse();

  // Count consecutive successes from the end
  let consecutiveSuccesses = 0;
  for (const r of recent) {
    if (r.passed) consecutiveSuccesses++;
    else break;
  }

  // Count consecutive failures from the end
  let consecutiveFailures = 0;
  for (const r of recent) {
    if (!r.passed) consecutiveFailures++;
    else break;
  }

  // 2+ consecutive exceptional successes (confidence >= 0.9)
  if (consecutiveSuccesses >= D.STREAK_THRESHOLD) {
    const consecutiveExceptional = recent
      .slice(0, consecutiveSuccesses)
      .every((r) => r.confidence >= D.EXCEPTIONAL_CONFIDENCE_THRESHOLD);

    if (consecutiveExceptional) {
      return {
        nextDifficulty: clamp(currentDifficulty + D.INCREASE_STEP_EXCEPTIONAL, D.MIN, D.MAX),
        reason: `${consecutiveSuccesses} consecutive exceptional successes — increase by 2`,
      };
    }

    return {
      nextDifficulty: clamp(currentDifficulty + D.INCREASE_STEP_NORMAL, D.MIN, D.MAX),
      reason: `${consecutiveSuccesses} consecutive successes — increase by 1`,
    };
  }

  if (consecutiveFailures === 0) {
    // Mixed or insufficient streak
    return {
      nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
      reason: 'No qualifying streak — hold current difficulty',
    };
  }

  if (consecutiveFailures === 1) {
    return {
      nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
      reason: '1 failure — hold current difficulty',
    };
  }

  // 2 consecutive low-effort failures → -1
  const recentTwoFailures = recent.slice(0, consecutiveFailures);
  const lowEffortFailures = recentTwoFailures.filter(
    (r) => r.effortSignal < D.LOW_EFFORT_THRESHOLD,
  );

  if (consecutiveFailures >= D.STREAK_THRESHOLD && lowEffortFailures.length >= D.STREAK_THRESHOLD) {
    return {
      nextDifficulty: clamp(currentDifficulty - D.DECREASE_STEP, D.MIN, D.MAX),
      reason: `${lowEffortFailures.length} consecutive low-effort failures — decrease by 1`,
    };
  }

  // 2 effortful failures → hold
  if (
    consecutiveFailures >= D.STREAK_THRESHOLD &&
    consecutiveFailures < D.HIGH_EFFORT_FAILURE_STREAK_THRESHOLD
  ) {
    return {
      nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
      reason: '2 effortful failures — hold current difficulty',
    };
  }

  // 3+ consecutive effortful failures → -1
  if (consecutiveFailures >= D.HIGH_EFFORT_FAILURE_STREAK_THRESHOLD) {
    return {
      nextDifficulty: clamp(currentDifficulty - D.DECREASE_STEP, D.MIN, D.MAX),
      reason: `${consecutiveFailures} consecutive effortful failures — decrease by 1`,
    };
  }

  return {
    nextDifficulty: clamp(currentDifficulty, D.MIN, D.MAX),
    reason: 'No qualifying pattern — hold current difficulty',
  };
}
