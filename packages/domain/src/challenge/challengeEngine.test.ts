import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChallengeEngine,
  ChallengeNotFoundError,
  UnauthorizedChallengeError,
  InvalidChallengeTransitionError,
  MissingEvidenceError,
  InvalidEvaluationError,
} from './challengeEngine.js';
import { FakeAIProvider } from '../ai/fakeProvider.js';
import type { SupabaseClientLike } from '../store/client.js';

describe('ChallengeEngine', () => {
  let mockClient: SupabaseClientLike;
  let fakeEvaluator: FakeAIProvider;
  let engine: ChallengeEngine;
  let challengesTable: Record<string, any>;
  let evidenceTable: Record<string, any[]>;
  let eventsTable: any[];
  let judgmentCount: number;

  beforeEach(() => {
    challengesTable = {};
    evidenceTable = {};
    eventsTable = [];
    judgmentCount = 0;

    fakeEvaluator = new FakeAIProvider({
      defaultEvaluationResult: {
        outcome: 'completed',
        confidence: 0.95,
        reasoning: 'Met all constraints flawlessly.',
      },
    });

    const mockQueryBuilder = (table: string): any => {
      let currentTable = table;
      const filters: Record<string, any> = {};
      let orderCol: string | null = null;
      let orderAsc: boolean = true;
      let limitVal: number = 100;
      let insertData: any = null;
      let updateData: any = null;

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((col, val) => {
          filters[col] = val;
          return builder;
        }),
        order: vi.fn((col, opts) => {
          orderCol = col;
          orderAsc = opts?.ascending ?? true;
          return builder;
        }),
        limit: vi.fn((l) => {
          limitVal = l;
          return builder;
        }),
        insert: vi.fn((data) => {
          insertData = data;
          return builder;
        }),
        update: vi.fn((data) => {
          updateData = data;
          return builder;
        }),
        single: vi.fn(async () => {
          if (insertData) {
            const id = insertData.id || 'ch-' + (Object.keys(challengesTable).length + 1);
            const row = {
              id,
              created_at: '2026-08-29T00:00:00.000Z',
              updated_at: '2026-08-29T00:00:00.000Z',
              ...insertData,
            };
            if (currentTable === 'challenges') {
              challengesTable[id] = row;
            } else if (currentTable === 'events') {
              eventsTable.push(row);
            }
            return { data: row, error: null };
          }
          if (updateData && filters.id) {
            const id = filters.id;
            if (challengesTable[id]) {
              challengesTable[id] = {
                ...challengesTable[id],
                ...updateData,
              };
              return { data: challengesTable[id], error: null };
            }
          }
          return { data: null, error: null };
        }),
        maybeSingle: vi.fn(async () => {
          if (currentTable === 'challenges' && filters.id) {
            const row = challengesTable[filters.id] || null;
            return { data: row, error: null };
          }
          return { data: null, error: null };
        }),
        then: (resolve: any) => {
          if (insertData) {
            eventsTable.push(insertData);
            return Promise.resolve({ data: insertData, error: null }).then(resolve);
          }
          if (currentTable === 'evidence_submissions' && filters.challenge_id) {
            const list = evidenceTable[filters.challenge_id] || [];
            const sorted = [...list].sort((a, b) => (orderAsc ? a.round - b.round : b.round - a.round));
            return Promise.resolve({ data: sorted.slice(0, limitVal), error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    };

    mockClient = {
      from: vi.fn((table: string) => mockQueryBuilder(table)),
      rpc: vi.fn(async (fn: string, params: any) => {
        if (fn === 'transition_challenge_status') {
          const ch = challengesTable[params.p_challenge_id];
          if (ch) {
            ch.status = params.p_new_status;
            return { data: ch, error: null };
          }
          return { data: null, error: { message: 'Challenge not found' } };
        }
        if (fn === 'transition_challenge_negotiation') {
          const ch = challengesTable[params.p_challenge_id];
          if (ch) {
            ch.title = params.p_objective;
            ch.difficulty = params.p_difficulty;
            ch.status = 'negotiated';
            ch.parameters = {
              ...ch.parameters,
              difficulty_number: params.p_difficulty_number,
              constraints: params.p_constraints,
              expected_duration_minutes: params.p_expected_duration_minutes,
            };
            return { data: ch, error: null };
          }
        }
        if (fn === 'record_evidence_submission') {
          const ch = challengesTable[params.p_challenge_id];
          if (ch) {
            const subId = 'sub-' + Date.now();
            const list = evidenceTable[params.p_challenge_id] || [];
            const round = list.length + 1;
            const subRow = {
              id: subId,
              challenge_id: params.p_challenge_id,
              user_id: params.p_user_id,
              round,
              kind: params.p_kind || 'text',
              content: params.p_content,
              metadata: params.p_metadata,
              created_at: '2026-08-29T00:00:00.000Z',
            };
            list.push(subRow);
            evidenceTable[params.p_challenge_id] = list;
            ch.status = 'evidence_submitted';
            ch.parameters = { ...ch.parameters, evidence_round: round };
            return { data: { submission_id: subId, evidence_round: round }, error: null };
          }
        }
        if (fn === 'judge_challenge') {
          const ch = challengesTable[params.p_challenge_id];
          if (ch) {
            if (ch.status !== 'evidence_submitted') {
              return { data: null, error: { message: 'Challenge must be in evidence_submitted state to be judged' } };
            }
            ch.status = params.p_verdict === 'needs_more_evidence' ? 'needs_more_evidence' : 'judged';
            judgmentCount += 1;
            return {
              data: {
                judgment_id: 'judg-101',
                challenge_id: params.p_challenge_id,
                evidence_submission_id: params.p_evidence_submission_id,
                relationship_state: { respect: 50 + params.p_respect_delta },
              },
              error: null,
            };
          }
        }
        return { data: null, error: null };
      }),
    };

    engine = new ChallengeEngine({
      client: mockClient,
      authenticatedUserId: 'user-1',
      evaluator: fakeEvaluator,
    });
  });

  describe('1. Issue Challenge', () => {
    it('creates a challenge with default parameters and clamps difficulty 1-10', async () => {
      const challenge = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: '50 pushups',
        difficulty: 15, // should clamp to 10
      });

      expect(challenge.id).toBeDefined();
      expect(challenge.userId).toBe('user-1');
      expect(challenge.objective).toBe('50 pushups');
      expect(challenge.difficulty).toBe(10);
      expect(challenge.status).toBe('issued');
      expect(challenge.verificationLevel).toBe('self_report');
      expect(challenge.constraints).toEqual([]);
    });

    it('rejects invalid inputs on issue', async () => {
      await expect(
        engine.issue('', {
          userId: '',
          domain: 'fitness',
          objective: '50 pushups',
          difficulty: 5,
        }),
      ).rejects.toThrow();

      await expect(
        engine.issue('user-1', {
          userId: 'user-1',
          domain: '',
          objective: '50 pushups',
          difficulty: 5,
        }),
      ).rejects.toThrow();
    });
  });

  describe('2. Negotiate Challenge', () => {
    it('negotiates challenge and transitions status from issued -> negotiated', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'coding',
        objective: 'Write 100 lines of rust',
        difficulty: 7,
      });

      const updated = await engine.negotiate(ch.id, 'user-1', {
        objective: 'Write 50 lines of rust',
        difficulty: 5,
      });

      expect(updated.status).toBe('negotiated');
      expect(updated.objective).toBe('Write 50 lines of rust');
      expect(updated.difficulty).toBe(5);
    });

    it('prevents negotiation from unauthorized user', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'coding',
        objective: 'Write 100 lines',
        difficulty: 5,
      });

      await expect(
        engine.negotiate(ch.id, 'intruder-99', { objective: 'Hacked' }),
      ).rejects.toThrow(UnauthorizedChallengeError);
    });

    it('rejects negotiation when challenge is in non-negotiable state', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'coding',
        objective: 'Write 100 lines',
        difficulty: 5,
      });

      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');

      await expect(
        engine.negotiate(ch.id, 'user-1', { objective: 'Change after start' }),
      ).rejects.toThrow(InvalidChallengeTransitionError);
    });
  });

  describe('3. Accept and Start Challenge', () => {
    it('allows legal transitions: issued -> accepted -> started -> attempted', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'reading',
        objective: 'Read 20 pages',
        difficulty: 4,
      });

      const accepted = await engine.accept(ch.id, 'user-1');
      expect(accepted.status).toBe('accepted');

      const started = await engine.start(ch.id, 'user-1');
      expect(started.status).toBe('started');

      const attempted = await engine.attempt(ch.id, 'user-1');
      expect(attempted.status).toBe('attempted');
    });

    it('rejects invalid jump transitions (e.g. issued -> started)', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'reading',
        objective: 'Read 20 pages',
        difficulty: 4,
      });

      await expect(engine.start(ch.id, 'user-1')).rejects.toThrow(
        InvalidChallengeTransitionError,
      );
    });
  });

  describe('4. Submit Evidence', () => {
    it('records evidence and transitions challenge status to evidence_submitted', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run 5km',
        difficulty: 6,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');

      const { submissionId, challenge } = await engine.submitEvidence(ch.id, {
        userId: 'user-1',
        kind: 'image',
        content: 'strava_5km_screenshot.png',
      });

      expect(submissionId).toBeDefined();
      expect(challenge.status).toBe('evidence_submitted');
      expect(challenge.evidenceRound).toBe(1);
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'record_evidence_submission',
        expect.objectContaining({
          p_challenge_id: ch.id,
          p_user_id: 'user-1',
          p_content: 'strava_5km_screenshot.png',
          p_kind: 'image',
        }),
      );
    });

    it('rejects evidence submission from unauthorized user', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run 5km',
        difficulty: 6,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');

      await expect(
        engine.submitEvidence(ch.id, {
          userId: 'user-2',
          content: 'fake proof',
        }),
      ).rejects.toThrow(UnauthorizedChallengeError);
    });

    it('rejects evidence submission when challenge is in issued state', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run 5km',
        difficulty: 6,
      });

      await expect(
        engine.submitEvidence(ch.id, {
          userId: 'user-1',
          content: 'early proof',
        }),
      ).rejects.toThrow(InvalidChallengeTransitionError);
    });
  });

  describe('5. Judgment Orchestration & Authority', () => {
    it('judges completed challenge: calculates deterministic Respect and calls judge_challenge RPC', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run 5km under 25min',
        difficulty: 8, // hard band (multiplier 1.5)
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, {
        userId: 'user-1',
        kind: 'text',
        content: 'Finished in 24:30. Strava link verified.',
      });

      fakeEvaluator.setEvaluationResult({
        outcome: 'completed',
        confidence: 0.98,
        reasoning: 'Finished well under time limit.',
      });

      const judgment = await engine.judge(ch.id, {
        userId: 'user-1',
      });

      expect(judgment.outcome).toBe('completed');
      expect(judgment.respectDelta).toBe(8); // base 4*1.5 + 2 baseline improvement = 8
      expect(judgment.trustDelta).toBe(1);

      expect(mockClient.rpc).toHaveBeenCalledWith(
        'judge_challenge',
        expect.objectContaining({
          p_challenge_id: ch.id,
          p_user_id: 'user-1',
          p_verdict: 'passed',
          p_respect_delta: 8,
          p_trust_delta: 1,
        }),
      );
    });

    it('judges failed challenge and derives effort signal without arbitrary LLM respect', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run 10km',
        difficulty: 8,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, {
        userId: 'user-1',
        kind: 'text',
        content: 'I stopped after 2km because I felt tired.',
      });

      fakeEvaluator.setEvaluationResult({
        outcome: 'failed',
        confidence: 0.9,
        reasoning: 'Did not complete required distance.',
      });

      const judgment = await engine.judge(ch.id, {
        userId: 'user-1',
      });

      expect(judgment.outcome).toBe('failed');
      expect(judgment.respectDelta).toBe(0); // non-streak failure = 0
    });

    it('does not allow a caller to fabricate recovery state', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'coding',
        objective: 'Fix the bug',
        difficulty: 5,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, {
        userId: 'user-1',
        kind: 'text',
        content: 'Patched and unit tests all passing now.',
      });

      fakeEvaluator.setEvaluationResult({
        outcome: 'completed',
        confidence: 0.95,
        reasoning: 'Bug completely resolved.',
      });

      const judgment = await engine.judge(ch.id, { userId: 'user-1' });

      expect(judgment.respectDelta).toBe(4);
      expect(judgment.trustDelta).toBe(1);
    });

    it('rejects judging challenge not in evidence_submitted state (prevents double judgment)', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'coding',
        objective: 'Test challenge',
        difficulty: 5,
      });

      await expect(
        engine.judge(ch.id, { userId: 'user-1' }),
      ).rejects.toThrow(InvalidChallengeTransitionError);
    });

    it('rejects a second judgment after a completed judgment', async () => {
      const ch = await engine.issue('user-1', { userId: 'user-1', domain: 'coding', objective: 'Test', difficulty: 5 });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Completed with proof.' });
      await engine.judge(ch.id, { userId: 'user-1' });

      await expect(engine.judge(ch.id, { userId: 'user-1' })).rejects.toThrow(InvalidChallengeTransitionError);
    });

    it('allows only one of two concurrent judgment attempts', async () => {
      const ch = await engine.issue('user-1', { userId: 'user-1', domain: 'coding', objective: 'Concurrent test', difficulty: 5 });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Completed with proof.' });

      const attempts = await Promise.allSettled([
        engine.judge(ch.id, { userId: 'user-1' }),
        engine.judge(ch.id, { userId: 'user-1' }),
      ]);

      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
      expect(judgmentCount).toBe(1);
    });

    it('rejects judgment after an evaluator requests more evidence', async () => {
      const ch = await engine.issue('user-1', { userId: 'user-1', domain: 'coding', objective: 'Test', difficulty: 5 });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Ambiguous evidence.' });
      fakeEvaluator.setEvaluationResult({ outcome: 'needs_more_evidence', confidence: 0.7, reasoning: 'Need another screenshot.' });
      await engine.judge(ch.id, { userId: 'user-1' });

      await expect(engine.judge(ch.id, { userId: 'user-1' })).rejects.toThrow(InvalidChallengeTransitionError);
    });

    it('rejects malformed evaluation results from AI provider', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Pushups',
        difficulty: 5,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, {
        userId: 'user-1',
        content: 'Did them.',
      });

      (fakeEvaluator as any).setEvaluationResult({
        outcome: 'invalid_outcome_from_bad_llm',
        confidence: 0.5,
        reasoning: 'bad',
      });

      await expect(
        engine.judge(ch.id, { userId: 'user-1' }),
      ).rejects.toThrow(InvalidEvaluationError);
    });

    it('rejects evidence that does not belong to the authenticated challenge owner', async () => {
      const ch = await engine.issue('user-1', { userId: 'user-1', domain: 'fitness', objective: 'Pushups', difficulty: 5 });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Did them.' });
      evidenceTable[ch.id][0].user_id = 'user-2';

      await expect(engine.judge(ch.id, { userId: 'user-1' })).rejects.toThrow(MissingEvidenceError);
    });

    it('ignores extra AI relationship fields and uses deterministic deltas only', async () => {
      const ch = await engine.issue('user-1', { userId: 'user-1', domain: 'fitness', objective: 'Pushups', difficulty: 5 });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Completed all repetitions.' });
      fakeEvaluator.setEvaluationResult({
        outcome: 'completed', confidence: 0.9, reasoning: 'Complete.', respectDelta: 100,
      } as any);

      const judgment = await engine.judge(ch.id, { userId: 'user-1' });
      expect(judgment.respectDelta).toBe(4);
    });
  });

  describe('6. Close Challenge', () => {
    it('closes a judged challenge', async () => {
      const ch = await engine.issue('user-1', {
        userId: 'user-1',
        domain: 'fitness',
        objective: 'Run',
        difficulty: 5,
      });
      await engine.accept(ch.id, 'user-1');
      await engine.start(ch.id, 'user-1');
      await engine.submitEvidence(ch.id, { userId: 'user-1', content: 'Done' });
      await engine.judge(ch.id, { userId: 'user-1' });

      const closed = await engine.close(ch.id, 'user-1');
      expect(closed.status).toBe('closed');
    });
  });

  describe('7. Suggest Next Difficulty', () => {
    it('delegates to pure computeNextDifficulty algorithm', () => {
      const history = [
        { passed: true, effortSignal: 0.9, confidence: 0.95 },
        { passed: true, effortSignal: 0.9, confidence: 0.95 },
      ];
      const result = engine.suggestNextDifficulty(history, 5);
      expect(result.nextDifficulty).toBe(7); // 2 exceptional passes -> +2
    });
  });
});
