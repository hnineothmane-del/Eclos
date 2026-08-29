import type { ChallengeStatus } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHALLENGE_TRANSITIONS: Readonly<Record<ChallengeStatus, readonly ChallengeStatus[]>> = {
  issued: ['negotiated', 'accepted'],
  negotiated: ['negotiated', 'accepted'],
  accepted: ['started'],
  started: ['attempted'],
  attempted: ['evidence_submitted'],
  evidence_submitted: ['needs_more_evidence', 'judged'],
  needs_more_evidence: ['evidence_submitted'],
  judged: ['closed'],
  closed: [],
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransitionResult =
  | { valid: true }
  | { valid: false; reason: string };

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

export function validateTransition(
  current: ChallengeStatus,
  next: ChallengeStatus,
): TransitionResult {
  const allowed = CHALLENGE_TRANSITIONS[current];

  if (!allowed) {
    return {
      valid: false,
      reason: `Unknown current status: "${current}"`,
    };
  }

  if ((allowed as readonly ChallengeStatus[]).includes(next)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Cannot transition from "${current}" to "${next}". Allowed: [${allowed.join(', ') || 'none'}]`,
  };
}
