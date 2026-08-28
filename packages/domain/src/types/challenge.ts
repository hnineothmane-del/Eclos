export type ChallengeStatus =
  | 'issued'
  | 'negotiated'
  | 'accepted'
  | 'started'
  | 'attempted'
  | 'evidence_submitted'
  | 'needs_more_evidence'
  | 'judged'
  | 'closed';

export type VerificationLevel =
  | 'self_report'
  | 'artifact'
  | 'image'
  | 'interactive';

export interface Challenge {
  id: string;
  userId: string;
  goalId: string | null;
  domain: string;
  objective: string;
  difficulty: number;
  constraints: string[];
  expectedDurationMinutes: number | null;
  verificationLevel: VerificationLevel;
  hypothesis: string | null;
  status: ChallengeStatus;
  evidenceRound: number;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceKind =
  | 'text'
  | 'image'
  | 'file'
  | 'self_report'
  | 'link'
  | 'code';

export interface EvidenceSubmission {
  id: string;
  challengeId: string;
  userId: string;
  round: number;
  kind: EvidenceKind;
  content: string;
  metadata?: Record<string, unknown>;
  submittedAt: string;
}

export type JudgmentOutcome = 'completed' | 'passed' | 'failed' | 'needs_more_evidence';

export interface Judgment {
  id: string;
  challengeId: string;
  evidenceSubmissionId: string;
  outcome: JudgmentOutcome;
  confidence: number;
  reasoning: string | null;
  respectDelta: number;
  trustDelta: number;
  createdAt: string;
}
