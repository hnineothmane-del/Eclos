import type {
  Challenge,
  ChallengeStatus,
  VerificationLevel,
  EvidenceKind,
  EvidenceSubmission,
  Judgment,
  JudgmentOutcome,
} from '../types/challenge.js';
import type { SupabaseClientLike } from '../store/client.js';
import type { ModelRouter } from '../ai/router.js';
import type { AIProvider } from '../ai/provider.js';
import { validateTransition } from './lifecycle.js';
import {
  computeNextDifficulty,
  type ChallengeOutcomeRecord,
  type NextDifficultyResult,
} from './difficulty.js';
import {
  computeRespectEvent,
  deriveEffortSignal,
  type RespectDelta,
} from '../engine/respectEngine.js';
import { clamp } from '../util/clamp.js';
import {
  StoreError,
  StoreValidationError,
  NotFoundError,
  DatabaseError,
} from '../store/errors.js';

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class ChallengeNotFoundError extends NotFoundError {
  constructor(challengeId: string) {
    super('Challenge', challengeId);
  }
}

export class UnauthorizedChallengeError extends StoreError {
  constructor(challengeId: string, userId: string) {
    super(
      `User "${userId}" is not authorized to access or modify challenge "${challengeId}".`,
      'UNAUTHORIZED_CHALLENGE',
      403,
    );
  }
}

export class InvalidChallengeTransitionError extends StoreError {
  constructor(currentStatus: ChallengeStatus, targetStatus: ChallengeStatus, reason?: string) {
    super(
      reason || `Cannot transition challenge from "${currentStatus}" to "${targetStatus}".`,
      'INVALID_CHALLENGE_TRANSITION',
      400,
    );
  }
}

export class MissingEvidenceError extends StoreError {
  constructor(challengeId: string) {
    super(
      `No evidence submission found for challenge "${challengeId}" in state evidence_submitted.`,
      'MISSING_EVIDENCE',
      400,
    );
  }
}

export class InvalidEvaluationError extends StoreError {
  constructor(message: string) {
    super(message, 'INVALID_EVALUATION', 422);
  }
}

// ---------------------------------------------------------------------------
// Input Parameter Interfaces
// ---------------------------------------------------------------------------

export interface IssueChallengeParams {
  userId: string;
  domain: string;
  objective: string;
  difficulty: number; // 1-10
  constraints?: string[];
  expectedDurationMinutes?: number | null;
  verificationLevel?: VerificationLevel;
  goalId?: string | null;
  hypothesis?: string | null;
}

export interface NegotiateChallengeChanges {
  objective?: string;
  difficulty?: number;
  constraints?: string[];
  expectedDurationMinutes?: number | null;
  verificationLevel?: VerificationLevel;
  hypothesis?: string | null;
}

export interface SubmitEvidenceParams {
  userId: string;
  kind?: EvidenceKind;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface JudgeOptions {
  userId: string;
  observationCategory?: string;
  observationText?: string;
  observationValence?: 'positive' | 'neutral' | 'negative';
}

export interface ChallengeEngineDependencies {
  client: SupabaseClientLike;
  /** Verified server/Edge identity. Never populate this from request input. */
  authenticatedUserId: string;
  router?: ModelRouter;
  evaluator?: AIProvider;
}

// ---------------------------------------------------------------------------
// Database Row Interfaces & Helpers
// ---------------------------------------------------------------------------

interface ChallengeRow {
  id: string;
  user_id: string;
  goal_id: string | null;
  title: string;
  description: string;
  difficulty: string;
  status: string;
  parameters: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EvidenceSubmissionRow {
  id: string;
  challenge_id: string;
  user_id: string;
  round: number;
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface JudgmentHistoryRow {
  challenge_id: string;
  verdict: 'passed' | 'failed' | 'needs_more_evidence';
}

interface EvidenceSubmissionResult {
  submission_id: string;
  evidence_round: number;
}

function difficultyNumberToBand(num: number): string {
  if (num <= 2) return 'trivial';
  if (num <= 4) return 'easy';
  if (num <= 6) return 'medium';
  if (num <= 8) return 'hard';
  return 'brutal';
}

function bandToDifficultyNumber(band: string): number {
  switch (band) {
    case 'trivial':
      return 1;
    case 'easy':
      return 3;
    case 'medium':
      return 5;
    case 'hard':
      return 7;
    case 'brutal':
      return 9;
    default:
      return 5;
  }
}

function mapRowToChallenge(row: ChallengeRow): Challenge {
  const params = row.parameters || {};
  const diffNum = typeof params.difficulty_number === 'number'
    ? params.difficulty_number
    : bandToDifficultyNumber(row.difficulty);

  return {
    id: row.id,
    userId: row.user_id,
    goalId: row.goal_id,
    domain: (params.domain as string) || row.description || 'general',
    objective: row.title,
    difficulty: clamp(diffNum, 1, 10),
    constraints: Array.isArray(params.constraints) ? (params.constraints as string[]) : [],
    expectedDurationMinutes: typeof params.expected_duration_minutes === 'number'
      ? params.expected_duration_minutes
      : null,
    verificationLevel: (params.verification_level as VerificationLevel) || 'self_report',
    hypothesis: (params.hypothesis as string) || null,
    status: row.status as ChallengeStatus,
    evidenceRound: typeof params.evidence_round === 'number' ? params.evidence_round : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToEvidenceSubmission(row: EvidenceSubmissionRow): EvidenceSubmission {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    userId: row.user_id,
    round: row.round,
    kind: row.kind as EvidenceKind,
    content: row.content,
    metadata: row.metadata,
    submittedAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// ChallengeEngine Implementation
// ---------------------------------------------------------------------------

export class ChallengeEngine {
  private readonly client: SupabaseClientLike;
  private readonly authenticatedUserId: string;
  private readonly router?: ModelRouter;
  private readonly explicitEvaluator?: AIProvider;

  constructor(deps: ChallengeEngineDependencies) {
    this.client = deps.client;
    if (!deps.authenticatedUserId) {
      throw new StoreValidationError('ChallengeEngine requires a verified authenticated user ID.');
    }
    this.authenticatedUserId = deps.authenticatedUserId;
    this.router = deps.router;
    this.explicitEvaluator = deps.evaluator;
  }

  private getEvaluator(): AIProvider {
    if (this.explicitEvaluator) return this.explicitEvaluator;
    if (this.router) return this.router.forEvaluation();
    throw new StoreError('No evaluator AI provider configured in ChallengeEngine.');
  }

  private assertAuthenticatedIdentity(userId: string, challengeId = 'requested resource'): void {
    if (userId !== this.authenticatedUserId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }
  }

  private async getJudgmentContext(userId: string, currentChallenge: Challenge): Promise<{
    priorFailureConfirmed: boolean;
    baselineDifficulty: number;
    recentSameBandCompletions: number;
    consecutiveLowEffortFailures: number;
  }> {
    const [{ data: history, error: historyError }, { data: challenges, error: challengesError }] = await Promise.all([
      this.client.from<JudgmentHistoryRow>('judgments').select('challenge_id, verdict').eq('user_id', userId),
      this.client.from<ChallengeRow>('challenges').select('*').eq('user_id', userId),
    ]);
    if (historyError || challengesError) {
      throw new DatabaseError('Failed to derive judgment context from stored history.', historyError?.code || challengesError?.code);
    }
    const priorHistory = (history || []).filter((item) => item.challenge_id !== currentChallenge.id);
    const challengeById = new Map((challenges || []).map((row) => [row.id, mapRowToChallenge(row)]));
    const historicalDifficulties = priorHistory
      .map((item) => challengeById.get(item.challenge_id)?.difficulty)
      .filter((difficulty): difficulty is number => difficulty !== undefined);
    const baselineDifficulty = historicalDifficulties.length
      ? Math.round(historicalDifficulties.reduce((sum, difficulty) => sum + difficulty, 0) / historicalDifficulties.length)
      : 5;
    let consecutiveLowEffortFailures = 0;
    for (const item of priorHistory) {
      if (item.verdict !== 'failed') break;
      consecutiveLowEffortFailures += 1;
    }
    return {
      priorFailureConfirmed: priorHistory.some((item) => item.verdict === 'failed'),
      baselineDifficulty: clamp(baselineDifficulty, 1, 10),
      recentSameBandCompletions: priorHistory.filter((item) =>
        item.verdict === 'passed' && challengeById.get(item.challenge_id)?.difficulty === currentChallenge.difficulty,
      ).length,
      consecutiveLowEffortFailures,
    };
  }

  /**
   * Loads a challenge by ID, ensuring existence.
   */
  async getChallenge(challengeId: string): Promise<Challenge> {
    if (!challengeId) {
      throw new StoreValidationError('challengeId is required.');
    }

    const { data, error } = await this.client
      .from<ChallengeRow>('challenges')
      .select('*')
      .eq('id', challengeId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        `Failed to load challenge "${challengeId}": ${error.message}`,
        error.code,
      );
    }

    if (!data) {
      throw new ChallengeNotFoundError(challengeId);
    }

    return mapRowToChallenge(data);
  }

  /**
   * 1. ISSUE
   * Creates a new challenge with status = 'issued'.
   */
  async issue(userId: string, params: IssueChallengeParams): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId);
    if (params.userId !== userId) {
      throw new UnauthorizedChallengeError('new challenge', params.userId);
    }
    if (!userId) {
      throw new StoreValidationError('userId is required to issue a challenge.');
    }
    if (!params.objective || !params.objective.trim()) {
      throw new StoreValidationError('objective is required to issue a challenge.');
    }
    if (!params.domain || !params.domain.trim()) {
      throw new StoreValidationError('domain is required to issue a challenge.');
    }

    const difficultyClamped = clamp(params.difficulty, 1, 10);
    const difficultyBand = difficultyNumberToBand(difficultyClamped);
    const verificationLevel = params.verificationLevel || 'self_report';
    const constraints = params.constraints || [];
    const expectedDuration = params.expectedDurationMinutes ?? null;
    const hypothesis = params.hypothesis ?? null;
    const goalId = params.goalId ?? null;

    const parametersPayload: Record<string, unknown> = {
      domain: params.domain,
      difficulty_number: difficultyClamped,
      constraints,
      expected_duration_minutes: expectedDuration,
      verification_level: verificationLevel,
      hypothesis,
      evidence_round: 0,
    };

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      goal_id: goalId,
      title: params.objective,
      description: params.domain,
      difficulty: difficultyBand,
      status: 'issued',
      parameters: parametersPayload,
    };

    const { data, error } = await this.client
      .from<ChallengeRow>('challenges')
      .insert(insertPayload)
      .select()
      .single();

    if (error || !data) {
      throw new DatabaseError(
        `Failed to issue challenge: ${error?.message || 'Unknown database error'}`,
        error?.code,
      );
    }

    // Log challenge_issued event
    await this.client.from('events').insert({
      user_id: userId,
      event_type: 'challenge_issued',
      payload: {
        challenge_id: data.id,
        objective: params.objective,
        difficulty: difficultyClamped,
        domain: params.domain,
      },
    });

    return mapRowToChallenge(data);
  }

  /**
   * 2. NEGOTIATE
   * Validates and applies negotiation modifications (status -> 'negotiated' or 'accepted').
   */
  async negotiate(
    challengeId: string,
    userId: string,
    changes: NegotiateChallengeChanges,
  ): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== userId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }

    const transitionCheck = validateTransition(challenge.status, 'negotiated');
    if (!transitionCheck.valid) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'negotiated',
        transitionCheck.reason,
      );
    }

    const updatedObjective = changes.objective?.trim() || challenge.objective;
    const updatedDifficulty = changes.difficulty !== undefined
      ? clamp(changes.difficulty, 1, 10)
      : challenge.difficulty;
    const updatedConstraints = changes.constraints !== undefined
      ? changes.constraints
      : challenge.constraints;
    const updatedDuration = changes.expectedDurationMinutes !== undefined
      ? changes.expectedDurationMinutes
      : challenge.expectedDurationMinutes;
    if (changes.verificationLevel !== undefined || changes.hypothesis !== undefined) {
      throw new StoreValidationError('Only objective, difficulty, constraints, and expected duration may change during negotiation.');
    }
    const { data, error } = await this.client.rpc<ChallengeRow>('transition_challenge_negotiation', {
      p_challenge_id: challengeId,
      p_user_id: userId,
      p_objective: updatedObjective,
      p_difficulty: difficultyNumberToBand(updatedDifficulty),
      p_difficulty_number: updatedDifficulty,
      p_constraints: updatedConstraints,
      p_expected_duration_minutes: updatedDuration,
    });

    if (error || !data) {
      throw new DatabaseError(
        `Failed to negotiate challenge "${challengeId}": ${error?.message || 'Unknown error'}`,
        error?.code,
      );
    }

    return mapRowToChallenge(data);
  }

  /**
   * 3. ACCEPT
   * Moves challenge to 'accepted' using authoritative transition RPC.
   */
  async accept(challengeId: string, userId: string): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== userId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }

    const transitionCheck = validateTransition(challenge.status, 'accepted');
    if (!transitionCheck.valid) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'accepted',
        transitionCheck.reason,
      );
    }

    const { data, error } = await this.client.rpc<Record<string, unknown>>(
      'transition_challenge_status',
      {
        p_challenge_id: challengeId,
        p_new_status: 'accepted',
        p_user_id: userId,
        p_metadata: {},
      },
    );

    if (error) {
      throw new DatabaseError(
        `Failed to accept challenge "${challengeId}": ${error.message}`,
        error.code,
      );
    }

    return this.getChallenge(challengeId);
  }

  /**
   * 4. START
   * Moves challenge from 'accepted' -> 'started'.
   */
  async start(challengeId: string, userId: string): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== userId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }

    const transitionCheck = validateTransition(challenge.status, 'started');
    if (!transitionCheck.valid) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'started',
        transitionCheck.reason,
      );
    }

    const { error } = await this.client.rpc<Record<string, unknown>>(
      'transition_challenge_status',
      {
        p_challenge_id: challengeId,
        p_new_status: 'started',
        p_user_id: userId,
        p_metadata: {},
      },
    );

    if (error) {
      throw new DatabaseError(
        `Failed to start challenge "${challengeId}": ${error.message}`,
        error.code,
      );
    }

    return this.getChallenge(challengeId);
  }

  /**
   * 5. ATTEMPT
   * Moves challenge from 'started' -> 'attempted'.
   */
  async attempt(challengeId: string, userId: string): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== userId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }

    const transitionCheck = validateTransition(challenge.status, 'attempted');
    if (!transitionCheck.valid) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'attempted',
        transitionCheck.reason,
      );
    }

    const { error } = await this.client.rpc<Record<string, unknown>>(
      'transition_challenge_status',
      {
        p_challenge_id: challengeId,
        p_new_status: 'attempted',
        p_user_id: userId,
        p_metadata: {},
      },
    );

    if (error) {
      throw new DatabaseError(
        `Failed to record attempt on challenge "${challengeId}": ${error.message}`,
        error.code,
      );
    }

    return this.getChallenge(challengeId);
  }

  /**
   * 6. SUBMIT EVIDENCE
   * Invokes the authoritative record_evidence_submission Postgres RPC.
   */
  async submitEvidence(
    challengeId: string,
    params: SubmitEvidenceParams,
  ): Promise<{ submissionId: string; challenge: Challenge }> {
    this.assertAuthenticatedIdentity(params.userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== params.userId) {
      throw new UnauthorizedChallengeError(challengeId, params.userId);
    }

    if (!params.content || !params.content.trim()) {
      throw new StoreValidationError('Evidence content cannot be empty.');
    }

    const submittableStatuses: ChallengeStatus[] = [
      'started',
      'attempted',
      'evidence_submitted',
      'needs_more_evidence',
    ];

    if (!submittableStatuses.includes(challenge.status)) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'evidence_submitted',
        `Challenge in status "${challenge.status}" cannot accept evidence.`,
      );
    }

    const kind = params.kind || 'text';
    const metadata = params.metadata || {};

    const { data: submission, error } = await this.client.rpc<EvidenceSubmissionResult>(
      'record_evidence_submission',
      {
        p_challenge_id: challengeId,
        p_user_id: params.userId,
        p_content: params.content,
        p_kind: kind,
        p_metadata: metadata,
      },
    );

    if (error || !submission) {
      throw new DatabaseError(
        `Failed to submit evidence for challenge "${challengeId}": ${error?.message || 'Unknown error'}`,
        error?.code,
      );
    }

    const updatedChallenge = await this.getChallenge(challengeId);

    return {
      submissionId: submission.submission_id,
      challenge: { ...updatedChallenge, evidenceRound: submission.evidence_round },
    };
  }

  /**
   * 7. JUDGE
   * Orchestrates evaluation, effort derivation, deterministic respect calculation,
   * and invokes the authoritative judge_challenge Postgres RPC.
   */
  async judge(challengeId: string, options: JudgeOptions): Promise<Judgment> {
    this.assertAuthenticatedIdentity(options.userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== options.userId) {
      throw new UnauthorizedChallengeError(challengeId, options.userId);
    }

    if (challenge.status !== 'evidence_submitted') {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'judged',
        `Challenge must be in "evidence_submitted" state to be judged (currently "${challenge.status}").`,
      );
    }

    // Load latest evidence submission
    const { data: evidenceRows, error: evError } = await this.client
      .from<EvidenceSubmissionRow>('evidence_submissions')
      .select('*')
      .eq('challenge_id', challengeId)
      .order('round', { ascending: false })
      .limit(1);

    if (evError) {
      throw new DatabaseError(
        `Failed to query evidence submissions for challenge "${challengeId}": ${evError.message}`,
        evError.code,
      );
    }

    if (!evidenceRows || evidenceRows.length === 0) {
      throw new MissingEvidenceError(challengeId);
    }

    const latestEvidence = mapRowToEvidenceSubmission(evidenceRows[0]);
    if (latestEvidence.challengeId !== challengeId || latestEvidence.userId !== options.userId) {
      throw new MissingEvidenceError(challengeId);
    }

    // Call evaluator AI provider (advisory)
    const evaluator = this.getEvaluator();
    const evaluation = await evaluator.evaluate({
      challengeObjective: challenge.objective,
      constraints: challenge.constraints,
      evidenceKind: latestEvidence.kind,
      evidenceContent: latestEvidence.content,
      metadata: latestEvidence.metadata,
    });

    if (!evaluation || !['completed', 'failed', 'needs_more_evidence'].includes(evaluation.outcome)
      || !Number.isFinite(evaluation.confidence) || evaluation.confidence < 0 || evaluation.confidence > 1
      || typeof evaluation.reasoning !== 'string') {
      throw new InvalidEvaluationError(
        `Invalid evaluator outcome received: "${String(evaluation?.outcome)}"`,
      );
    }

    // Derive effort signal deterministically from observable data
    const effortEvidence = {
      attempted: true,
      meaningfulSubmission: latestEvidence.content.trim().length > 10,
      attemptCount: latestEvidence.round,
    };
    const effortSignal = deriveEffortSignal(effortEvidence);
    const context = await this.getJudgmentContext(options.userId, challenge);

    // Compute deterministic respect and relationship deltas
    let respectDelta: RespectDelta = {
      respect: 0,
      trust: 0,
      warmth: 0,
      rivalry: 0,
      familiarity: 0,
      curiosity: 0,
    };

    if (evaluation.outcome === 'completed') {
      if (context.priorFailureConfirmed) {
        respectDelta = computeRespectEvent({
          type: 'recovery',
          priorFailureConfirmed: context.priorFailureConfirmed,
          effortSignal,
        });
      } else {
        respectDelta = computeRespectEvent({
          type: 'challenge_completed',
          difficulty: challenge.difficulty,
          userBaselineDifficulty: context.baselineDifficulty,
          recentSameBandCompletions: context.recentSameBandCompletions,
        });
      }
    } else if (evaluation.outcome === 'failed') {
      respectDelta = computeRespectEvent({
        type: 'challenge_failed',
        effortSignal,
        consecutiveLowEffortFailures: context.consecutiveLowEffortFailures,
      });
    }

    // Map evaluation outcome to PostgreSQL verdict
    const verdictParam = evaluation.outcome === 'completed' ? 'passed' : evaluation.outcome;
    const scoreParam = Math.round(clamp(evaluation.confidence, 0, 1) * 100);

    // Execute authoritative judge_challenge Postgres RPC
    const { data: judgeResult, error: judgeError } = await this.client.rpc<Record<string, unknown>>(
      'judge_challenge',
      {
        p_challenge_id: challengeId,
        p_evidence_submission_id: latestEvidence.id,
        p_user_id: options.userId,
        p_verdict: verdictParam,
        p_feedback: evaluation.reasoning || 'Evaluation completed.',
        p_score: scoreParam,
        p_respect_delta: respectDelta.respect,
        p_warmth_delta: respectDelta.warmth,
        p_trust_delta: respectDelta.trust,
        p_rivalry_delta: respectDelta.rivalry,
        p_familiarity_delta: respectDelta.familiarity,
        p_curiosity_delta: respectDelta.curiosity,
        p_observation_category: options.observationCategory || null,
        p_observation_text: options.observationText || null,
        p_observation_valence: options.observationValence || 'neutral',
        p_metadata: {
          confidence: evaluation.confidence,
          effortSignal,
        },
      },
    );

    if (judgeError || !judgeResult) {
      throw new DatabaseError(
        `Failed to execute judge_challenge RPC: ${judgeError?.message || 'Unknown database error'}`,
        judgeError?.code,
      );
    }

    const judgmentId = (judgeResult.judgment_id as string) || 'judgment-' + Date.now();

    return {
      id: judgmentId,
      challengeId,
      evidenceSubmissionId: latestEvidence.id,
      outcome: evaluation.outcome as JudgmentOutcome,
      confidence: evaluation.confidence,
      reasoning: evaluation.reasoning,
      respectDelta: respectDelta.respect,
      trustDelta: respectDelta.trust,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 8. CLOSE
   * Moves challenge to 'closed' status.
   */
  async close(challengeId: string, userId: string): Promise<Challenge> {
    this.assertAuthenticatedIdentity(userId, challengeId);
    const challenge = await this.getChallenge(challengeId);

    if (challenge.userId !== userId) {
      throw new UnauthorizedChallengeError(challengeId, userId);
    }

    const transitionCheck = validateTransition(challenge.status, 'closed');
    if (!transitionCheck.valid) {
      throw new InvalidChallengeTransitionError(
        challenge.status,
        'closed',
        transitionCheck.reason,
      );
    }

    const { error } = await this.client.rpc<Record<string, unknown>>(
      'transition_challenge_status',
      {
        p_challenge_id: challengeId,
        p_new_status: 'closed',
        p_user_id: userId,
        p_metadata: {},
      },
    );

    if (error) {
      throw new DatabaseError(
        `Failed to close challenge "${challengeId}": ${error.message}`,
        error.code,
      );
    }

    return this.getChallenge(challengeId);
  }

  /**
   * 9. SUGGEST NEXT DIFFICULTY
   * Pure difficulty algorithm delegate.
   */
  suggestNextDifficulty(
    history: readonly ChallengeOutcomeRecord[],
    currentDifficulty = 5,
  ): NextDifficultyResult {
    return computeNextDifficulty(currentDifficulty, history);
  }
}
