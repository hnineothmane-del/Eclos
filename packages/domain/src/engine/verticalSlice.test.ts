import { describe, it, expect, vi } from 'vitest';
import { ResponsePlanner } from './responsePlanner.js';
import { ChallengeEngine } from '../challenge/challengeEngine.js';
import { FakeAIProvider } from '../ai/fakeProvider.js';
import { DefaultModelRouter } from '../ai/router.js';
import type { SupabaseClientLike } from '../store/client.js';

describe('Vertical Slice Integration', () => {
  it('executes the full backend flow', async () => {
    const userId = 'user-123';
    
    // In-memory state
    const db = {
      relationship: { user_id: userId, respect: 0, warmth: 0, trust: 0, rivalry: 0, familiarity: 0, curiosity: 0, mode: 'adaptive', updated_at: new Date().toISOString() },
      events: [] as any[],
      memories: [] as any[],
      challenges: [] as any[],
      evidence: [] as any[],
      humor: [] as any[],
    };

    // Very basic mock client to satisfy the stores and engines
    const mockClient: SupabaseClientLike = {
      from: (table: string) => {
        const queryBuilder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((key: string, value: any) => {
             // simplified mock: assume it matches
             return queryBuilder;
          }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          insert: vi.fn((payload: any) => {
             const row = { id: `id-${Date.now()}`, created_at: new Date().toISOString(), ...payload };
             if (table === 'events') db.events.push(row);
             if (table === 'challenges') db.challenges.push(row);
             return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
          }),
          upsert: vi.fn((payload: any) => {
             return { select: () => ({ single: () => Promise.resolve({ data: payload, error: null }) }) };
          }),
          delete: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => {
             if (table === 'challenges') return { data: db.challenges[db.challenges.length - 1], error: null };
             if (table === 'humor_ledger') return { data: null, error: null };
             return { data: null, error: null };
          }),
          then: (resolve: any) => {
             if (table === 'challenges') resolve({ data: db.challenges, error: null });
             else if (table === 'memory_items') resolve({ data: db.memories, error: null });
             else if (table === 'evidence_submissions') resolve({ data: db.evidence, error: null });
             else if (table === 'humor_ledger') resolve({ data: db.humor, error: null });
             else resolve({ data: [], error: null });
          }
        };
        return queryBuilder;
      },
      rpc: vi.fn(async (rpcName: string, args: any) => {
        if (rpcName === 'increment_usage_and_check') return { data: { allowed: true }, error: null };
        if (rpcName === 'record_humor_usage') {
           const row = { id: 'h1', user_id: args.p_user_id, theme: args.p_theme, target: args.p_target, intensity: args.p_intensity, usage_count: 1, last_used_at: new Date().toISOString(), created_at: new Date().toISOString() };
           db.humor.push(row);
           return { data: row, error: null };
        }
        if (rpcName === 'transition_challenge_status') {
           const idx = db.challenges.findIndex(c => c.id === args.p_challenge_id);
           if (idx >= 0) db.challenges[idx].status = args.p_new_status;
           return { data: {}, error: null };
        }
        if (rpcName === 'issue_challenge') {
           const row = { id: `id-${Date.now()}`, user_id: args.p_user_id, status: 'issued', title: args.p_title, description: args.p_description, difficulty: args.p_difficulty, parameters: args.p_parameters, created_at: new Date().toISOString() };
           db.challenges.push(row);
           return { data: row, error: null };
        }
        if (rpcName === 'record_evidence_submission') {
           const dbRow = { id: 'ev1', challenge_id: args.p_challenge_id, user_id: args.p_user_id, round: 1, kind: args.p_kind, content: args.p_content, metadata: args.p_metadata, created_at: new Date().toISOString() };
           const apiRow = { id: 'ev1', challengeId: args.p_challenge_id, userId: args.p_user_id, round: 1, kind: args.p_kind, content: args.p_content, metadata: args.p_metadata, submittedAt: new Date().toISOString() };
           db.evidence.push(dbRow);
           return { data: apiRow, error: null };
        }
        if (rpcName === 'judge_challenge') {
           db.relationship.respect += args.p_respect_delta;
           db.relationship.trust += args.p_trust_delta;
           return { data: { judgment_id: 'j1' }, error: null };
        }
        return { data: null, error: null };
      })
    } as any;

    const fakeProvider = new FakeAIProvider();
    const router = new DefaultModelRouter({
       apiKey: 'test', cheapModel: 'test', strongModel: 'test', multimodalModel: 'test'
    });
    router.forChat = () => fakeProvider;
    router.forEvaluation = () => fakeProvider;

    // We manually construct stores using the mockClient
    // We can't easily import them directly due to module structure, let's just use the ones from store/index.js
    const { SupabaseRelationshipStateStore, SupabaseMemoryStore, SupabaseHumorStateStore, SupabaseEventStore } = await import('../store/index.js');
    
    const relStore = new SupabaseRelationshipStateStore(mockClient);
    const memStore = new SupabaseMemoryStore(mockClient);
    const humorStore = new SupabaseHumorStateStore(mockClient);
    const evStore = new SupabaseEventStore(mockClient);

    // Mock relStore.get since it is slightly complex
    relStore.get = vi.fn().mockResolvedValue(db.relationship);

    const planner = new ResponsePlanner({
      modelRouter: router,
      relationshipStore: relStore,
      memoryStore: memStore,
      humorStore: humorStore,
      eventStore: evStore
    });

    const engine = new ChallengeEngine({
      client: mockClient,
      authenticatedUserId: userId,
      router
    });

    // 1. First chat turn
    fakeProvider.setGenerateResponse({
      response: 'I challenge you!',
      intent: 'challenge_request',
      humorMechanism: 'sarcasm',
      register: 'informal',
      seriousFlag: false,
      memoryCandidates: [],
      eventSuggestions: [
        { suggestedEventType: 'challenge_issued', suggestedPayload: { objective: 'Prove it' }, confidence: 0.9 }
      ]
    });

    const turn1 = await planner.planTurn({ userId, userInput: 'I want to get good at Python.' });
    expect(turn1!.challengeSelection).toBeDefined();
    expect(turn1!.response).toBe('I challenge you!');

    // 2. Bridge issues challenge
    const challenge = await engine.issue(userId, {
      userId, domain: 'general', objective: 'Prove it', difficulty: 5
    });
    expect(challenge.status).toBe('issued');

    // 3. Accept/Start/Attempt
    await engine.accept(challenge.id, userId);
    await engine.start(challenge.id, userId);
    await engine.attempt(challenge.id, userId);
    
    expect(db.challenges[0].status).toBe('attempted');

    // 4. Submit evidence
    await engine.submitEvidence(challenge.id, {
      userId, content: 'Here is my python code'
    });

    // Force status to evidence_submitted manually because mock didn't do it via RPC side effects
    db.challenges[0].status = 'evidence_submitted';

    // 5. Judge
    fakeProvider.setEvaluationResult({
      outcome: 'completed',
      confidence: 0.9,
      reasoning: 'Good job'
    });

    const judgment = await engine.judge(challenge.id, { userId });
    expect(judgment.outcome).toBe('completed');
    expect(judgment.respectDelta).toBeGreaterThan(0); // From deterministic engine
    expect(db.relationship.respect).toBeGreaterThan(0); // Applied by judge_challenge mock

    // 6. Next chat turn sees updated relationship
    fakeProvider.setGenerateResponse({
      response: 'You did well.',
      intent: 'roast',
      humorMechanism: 'mock_formal',
      register: 'informal',
      seriousFlag: false,
      memoryCandidates: [],
      eventSuggestions: []
    });
    const turn2 = await planner.planTurn({ userId, userInput: 'Did I do good?' });
    expect(turn2!.response).toBe('You did well.');
  });
});
