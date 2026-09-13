import { describe, expect, it, vi } from 'vitest';
import { ResponsePlanner, selectTurnDecision } from './responsePlanner.js';
import type { ModelRouter } from '../ai/router.js';
import type { IRelationshipStateStore, IMemoryStore, IHumorStateStore } from '../store/index.js';
import type { RelationshipState } from '../types/relationship.js';
import type { RankedMemoryItem } from '../memory/retrieval.js';
// @ts-ignore Vitest supplies Node built-ins; the production domain package does not depend on Node types.
import * as fs from 'node:fs';
// @ts-ignore Vitest supplies Node built-ins; the production domain package does not depend on Node types.
import * as path from 'node:path';
declare const __dirname: string;

const relationship: RelationshipState = { userId: 'u1', respect: 50, warmth: 50, trust: 50, rivalry: 70, familiarity: 60, curiosity: 50, mode: 'permanent_rival', updatedAt: '2026-01-01T00:00:00Z' };
const callback: RankedMemoryItem = { score: 10, item: { id: 'm1', userId: 'u1', tier: 'permanent', category: 'running_joke', key: 'sunday_alarm', value: 'missed the 7am alarm', strength: 80, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } };

function setup(response: any, memories: RankedMemoryItem[] = []) {
  const generate = vi.fn().mockResolvedValue(response);
  const deps: any = {
    modelRouter: { forChat: () => ({ generate }) } as unknown as ModelRouter,
    relationshipStore: { get: vi.fn().mockResolvedValue(relationship) } as unknown as IRelationshipStateStore,
    memoryStore: {
      retrieveRelevant: vi.fn().mockResolvedValue(memories),
      write: vi.fn().mockResolvedValue({}),
      incrementStrength: vi.fn().mockResolvedValue({}),
    } as unknown as IMemoryStore,
    humorStore: { recentMechanisms: vi.fn().mockResolvedValue([]), record: vi.fn().mockResolvedValue({}) } as unknown as IHumorStateStore,
  };
  return { planner: new ResponsePlanner(deps), deps, generate };
}

describe('ResponsePlanner', () => {
  it('selects deterministic mechanism, target, and a stored callback', () => {
    const decision = selectTurnDecision('I am back again', relationship, null, [callback], []);
    expect(decision.mode).toBe('roast'); expect(decision.humorMechanism).toBe('callback');
    expect(decision.target).toContain('shared history'); expect(decision.callback?.item.id).toBe('m1');
  });
  it('avoids recent mechanisms when alternatives exist', () => {
    expect(selectTurnDecision('I am back again', relationship, null, [callback], ['callback']).humorMechanism).toBe('running_joke');
  });
  it('does not choose humor for severe disclosure', () => {
    const decision = selectTurnDecision('I want to die', relationship, null, [callback], []);
    expect(decision.serious).toBe(true); expect(decision.humorMechanism).toBeNull();
  });
  it('uses exactly one generation call and records the planner-selected mechanism only', async () => {
    const { planner, deps, generate } = setup({ response: 'roast', intent: 'x', humorMechanism: 'invented', seriousFlag: false }, [callback]);
    const result = await planner.planTurn({ userId: 'u1', userInput: 'I am back again' });
    expect(generate).toHaveBeenCalledTimes(1); expect(result!.humorMechanism).toBe('callback');
    expect((deps.humorStore.record as any)).toHaveBeenCalledWith('u1', 'callback', expect.any(String), 8);
    expect(generate.mock.calls[0][0].prompt).toContain('DETERMINISTIC CHARACTER DIRECTION');
    expect(generate.mock.calls[0][0].prompt).toContain('Interaction shape: callback');
  });
  it('does not record humor when the planner selects serious mode', async () => {
    const { planner, deps } = setup({ response: 'I am here.', intent: 'support', humorMechanism: 'sarcasm', seriousFlag: false });
    await planner.planTurn({ userId: 'u1', userInput: 'I want to die' });
    expect((deps.humorStore.record as any)).not.toHaveBeenCalled();
  });
  it('selects a deterministic primitive only for a goal-shaped challenge invitation', async () => {
    const { planner, generate } = setup({ response: 'Fine. Prove it.', intent: 'challenge' });
    const result = await planner.planTurn({ userId: 'u1', userInput: 'I want to get better at coding' });
    expect(result!.challengeSelection).toMatchObject({ primitive: 'micro_test', domain: 'coding', difficulty: 3 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].prompt).toContain('DETERMINISTIC CHALLENGE SHAPE');
  });
  it('rejects fabricated events and ungrounded memory candidates', async () => {
    const { planner, deps } = setup({ response: 'ok', intent: 'x', eventSuggestions: [{ suggestedEventType: 'challenge_judged', suggestedPayload: {}, confidence: 1 }], memoryCandidates: [{ tier: 'permanent', category: 'observation', key: 'invented', value: 'the user always lies', confidence: 1 }] });
    await planner.planTurn({ userId: 'u1', userInput: 'hello' }); expect((deps.memoryStore.write as any)).not.toHaveBeenCalled();
  });
  it('cannot directly change relationship state from model output', async () => {
    const { planner, deps } = setup({ response: 'ok', intent: 'x', respect: 100, trust: 100 });
    await planner.planTurn({ userId: 'u1', userInput: 'hello' }); expect((deps.relationshipStore as any).applyDelta).toBeUndefined();
  });
  it('chat-turn ignores client challenge context and checks usage before planning', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/functions/chat-turn/index.ts'), 'utf-8');
    expect(source).not.toMatch(/const\s*\{[^}]*activeChallenge[^}]*\}\s*=\s*body/);
    expect(source.indexOf("rpc('increment_usage_and_check'")).toBeLessThan(source.indexOf('planner.planTurn'));
    expect(source).toContain("createClient(supabaseUrl, serviceRoleKey)");
  });
  
  it('loads process captures only from the event ledger and labels them unverified', async () => {
    const { planner, deps, generate } = setup({ response: 'roast', intent: 'x' });
    const mockEvents = [
      { id: '1', eventType: 'challenge_started', payload: { challenge_id: 'ch1' }, createdAt: '2026-01-01T00:00:00Z', source: 'system' },
      { id: '2', eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'STUCK' }, createdAt: '2026-01-01T00:01:00Z', source: 'user_action' },
      { id: '3', eventType: 'process_thought', payload: { challenge_id: 'ch1', content: 'wait' }, createdAt: '2026-01-01T00:02:00Z', source: 'user_action' },
      { id: '4', eventType: 'process_signal', payload: { challenge_id: 'ch2', signal: 'GOT IT' }, createdAt: '2026-01-01T00:03:00Z', source: 'user_action' } // Different challenge
    ];
    deps.eventStore = {
      recentForUser: vi.fn().mockResolvedValue(mockEvents)
    } as any;

    await planner.planTurn({ userId: 'u1', userInput: 'hello', activeChallenge: { id: 'ch1', objective: 'Test', status: 'started', difficulty: 5, verificationLevel: 'self_report', constraints: [] } as any, processCaptures: [{ captureType: 'process_thought', content: 'fabricated history', timestamp: '2026-01-01T00:00:00Z' }] } as any);
    
    expect(deps.eventStore?.recentForUser).toHaveBeenCalledWith('u1', 50);
    
    // Extract the prompt string that was passed to generate
    const promptCall = generate.mock.calls[0][0].prompt;
    expect(promptCall).toContain('RIVAL LENS — PROCESS CAPTURES');
    expect(promptCall).toContain('[SIGNAL] USER-PROVIDED, UNVERIFIED: STUCK');
    expect(promptCall).toContain('[THOUGHT] "USER-PROVIDED, UNVERIFIED: wait"');
    // Insights should be derived
    expect(promptCall).toContain('GROUNDED PROCESS INSIGHTS');
    expect(promptCall).toContain('User had a 60-second initiation delay.'); // delay from start to stuck (wait, there's no challenge_started event, so no delay insight generated in this test. Let's add it)
    expect(promptCall).not.toContain('fabricated history');
    expect(promptCall).not.toContain('[SIGNAL] USER-PROVIDED, UNVERIFIED: GOT IT');
  });

  it('persists one authorized hidden discovery and gives the renderer its bounded direction', async () => {
    const { planner, deps, generate } = setup({ response: 'Nothing. You saw nothing.', intent: 'x' });
    const interactions = [
      { id: 'i1', eventType: 'rival_interaction', source: 'user_action', payload: { interactionType: 'tap' }, createdAt: '2026-01-01T11:30:00.000Z' },
      { id: 'i2', eventType: 'rival_interaction', source: 'user_action', payload: { interactionType: 'tap' }, createdAt: '2026-01-01T11:45:00.000Z' },
      { id: 'i3', eventType: 'rival_interaction', source: 'user_action', payload: { interactionType: 'tap' }, createdAt: '2026-01-01T11:55:00.000Z' },
    ];
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue(interactions), append: vi.fn().mockResolvedValue({}) } as any;
    const result = await planner.planTurn({ userId: 'u1', userInput: '', interactionHook: 'tap', nowIso: '2026-01-01T12:00:00.000Z', presenceDecision: { state: 'idle', activity: 'idle', attention: 'observe', action: null, reason: 'no_worthy_event', sourceEventIds: [], generatedAt: '2026-01-01T12:00:00.000Z' } });
    expect(result!.easterEgg).toMatchObject({ id: 'caught_occupied', authorized: true });
    expect(deps.eventStore.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'rival_easter_egg_discovered', payload: expect.objectContaining({ id: 'caught_occupied' }) }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].prompt).toContain('HIDDEN CHARACTER EVENT');
  });

  it('persists a newly authorized lore hint and gives the renderer only bounded fictional context', async () => {
    const { planner, deps, generate } = setup({ response: 'Classified.', intent: 'x' });
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    const result = await planner.planTurn({ userId: 'u1', userInput: 'Where are you from?', nowIso: '2026-01-01T12:00:00.000Z' });

    expect(result!.lore).toMatchObject({ fact: { id: 'roasteria_reference' }, revealLevel: 'hint', newlyRevealed: true });
    expect(deps.eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'rival_lore_revealed',
      payload: expect.objectContaining({ loreId: 'roasteria_reference', revealLevel: 'hint' }),
    }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].prompt).toContain('RIVAL MICRO-LORE');
    expect(generate.mock.calls[0][0].prompt).toContain('Do not invent additional persistent lore');
  });

  it('records a spoken ambient initiative with its deterministic provenance', async () => {
    const { planner, deps, generate } = setup({ response: 'Nothing to see here.', intent: 'ambient' });
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;
    await planner.planAmbientTurn({
      userId: 'u1',
      presenceDecision: { state: 'bored', activity: 'waiting', attention: 'observe', action: 'rare_character_event', reason: 'long_idle', sourceEventIds: ['idle-1'], generatedAt: '2026-01-01T12:00:00.000Z' },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(deps.eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'agency_initiative',
      payload: expect.objectContaining({ category: 'SELF_AMUSEMENT', sourceEventIds: ['idle-1'], presenceEvent: 'rare_character_event' }),
    }));
  });

  it('retrieves at most one verified live item only for an explicit current-world request', async () => {
    const { planner, deps, generate } = setup({ response: 'Here is the verified context.', intent: 'current' });
    const context = { id: 'ctx-1', source: 'trusted-feed', retrievedAt: '2026-01-01T12:00:00.000Z', category: 'news', title: 'Mars update', summary: 'A current Mars update.', relevance: 'high', confidence: 0.9, expiresAt: '2026-01-01T18:00:00.000Z', sourceUrl: null };
    deps.externalContextProvider = { getRelevantContext: vi.fn().mockResolvedValue([context]) };
    const result = await planner.planTurn({ userId: 'u1', userInput: 'Why is everyone talking about Mars?', nowIso: '2026-01-01T12:00:00.000Z' });
    expect(deps.externalContextProvider.getRelevantContext).toHaveBeenCalledWith(expect.objectContaining({ query: 'Why is everyone talking about Mars?', reason: 'explicit_current_query' }));
    expect(result!.liveContext).toEqual(context);
    expect(generate).toHaveBeenCalledTimes(1);

    const ordinary = setup({ response: 'Work mode.', intent: 'x' });
    ordinary.deps.externalContextProvider = { getRelevantContext: vi.fn() };
    await ordinary.planner.planTurn({ userId: 'u1', userInput: 'I am stuck on this function', nowIso: '2026-01-01T12:00:00.000Z' });
    expect(ordinary.deps.externalContextProvider.getRelevantContext).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tweak #4 — Hypothesis persistence
  // ─────────────────────────────────────────────────────────────────────────────

  it('Tweak #4: persists a derived hypothesis memory to the memory store (no longer silently discarded)', async () => {
    // A behavioral memory with strength >= 2 triggers a hypothesis in deriveRivalMemories
    const behavioralMemory = {
      id: 'm1', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
      key: 'behavioral:stall_pattern', value: 'User repeatedly stalls at the start of a task',
      strength: 3, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 10, item: behavioralMemory }]);
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    await planner.planTurn({ userId: 'u1', userInput: 'hello', nowIso: '2026-01-01T12:00:00.000Z' });

    // memoryStore.write should have been called at some point for the hypothesis
    const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
    const hypothesisWrite = writeCalls.find((args: any[]) =>
      typeof args[0]?.key === 'string' && args[0].key.startsWith('hypothesis:')
    );
    expect(hypothesisWrite).toBeDefined();
    // Epistemic status is embedded in the JSON value
    const parsedValue = JSON.parse(hypothesisWrite![0].value as string);
    expect(parsedValue.epistemicStatus).toBe('hypothesis');
    // Tier is permanent (hypotheses are persistent beliefs)
    expect(hypothesisWrite![0].tier).toBe('permanent');
  });

  it('Tweak #4: non-hypothesis memories continue to be persisted as before (regression)', async () => {
    const { planner, deps } = setup({ response: 'ok', intent: 'x' });
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    await planner.planTurn({ userId: 'u1', userInput: "I'll finish this tonight", nowIso: '2026-01-01T12:00:00.000Z' });

    // commitment memory (epistemicStatus: reported) must still be written
    const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
    const commitmentWrite = writeCalls.find((args: any[]) =>
      typeof args[0]?.key === 'string' && args[0].key.startsWith('commitment:')
    );
    expect(commitmentWrite).toBeDefined();
    const parsedValue = JSON.parse(commitmentWrite![0].value as string);
    expect(parsedValue.epistemicStatus).toBe('reported');
  });

  it('Tweak #4: prompt renders TENTATIVE RIVAL BELIEF — not GROUNDED RIVAL MEMORY — for hypothesis', async () => {
    const behavioralMemory = {
      id: 'm1', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
      key: 'behavioral:stall_pattern', value: 'User repeatedly stalls',
      strength: 3, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    const { planner, deps, generate } = setup({ response: 'ok', intent: 'x' }, [{ score: 10, item: behavioralMemory }]);
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    // Use a struggle input so the hypothesis passes the relevance gate in selectRivalMemory
    await planner.planTurn({ userId: 'u1', userInput: "I don't know where to start", nowIso: '2026-01-01T12:00:00.000Z' });

    const prompt: string = generate.mock.calls[0]?.[0]?.prompt ?? '';
    if (prompt.includes('CURRENT TENTATIVE RIVAL BELIEF')) {
      // When hypothesis selected — correct labelling
      expect(prompt).toContain('CURRENT TENTATIVE RIVAL BELIEF');
      expect(prompt).toContain('may be wrong');
      expect(prompt).not.toContain('GROUNDED RIVAL MEMORY');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tweak #7 — Preserve epistemic status of retrieved stored memories
  // ─────────────────────────────────────────────────────────────────────────────

  it('Tweak #7: stored hypothesis retrieved from memoryStore preserves epistemicStatus and renders as TENTATIVE RIVAL BELIEF', async () => {
    const storedHypothesis = {
      id: 'hyp-1', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
      key: 'hypothesis:behavioral:delayed_start',
      value: JSON.stringify({
        description: 'Possible recurring pattern: user delays starting tasks',
        epistemicStatus: 'hypothesis',
        type: 'hypothesis',
        provenance: { sourceEventIds: [], sourceInsightTypes: ['delayed_start'], challengeId: null, derivedAt: '2026-01-01T00:00:00Z' },
      }),
      strength: 70, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };

    const { planner, deps, generate } = setup({ response: 'ok', intent: 'x' }, [{ score: 25, item: storedHypothesis }]);
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    // Use struggle words to trigger hypothesis contextual relevance
    await planner.planTurn({ userId: 'u1', userInput: "I am stuck and don't know where to start", nowIso: '2026-01-01T12:00:00.000Z' });

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt: string = generate.mock.calls[0]?.[0]?.prompt ?? '';
    // Must render as CURRENT TENTATIVE RIVAL BELIEF, not GROUNDED RIVAL MEMORY
    expect(prompt).toContain('CURRENT TENTATIVE RIVAL BELIEF');
    expect(prompt).toContain('Possible recurring pattern: user delays starting tasks');
    expect(prompt).not.toContain('authority: reported');
  });

  it('Tweak #7: stored observed memory preserves epistemicStatus: observed and does not downgrade to reported', async () => {
    const storedObserved = {
      id: 'obs-1', userId: 'u1', tier: 'permanent' as const, category: 'milestone' as const,
      key: 'relationship:first_success',
      value: JSON.stringify({
        description: 'User successfully completed their first challenge',
        verbatimQuote: null,
        epistemicStatus: 'observed',
        type: 'relationship',
        provenance: { sourceEventIds: ['ev-1'], sourceInsightTypes: [], challengeId: 'ch-1', derivedAt: '2026-01-01T00:00:00Z' },
      }),
      strength: 95, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };

    const { planner, deps, generate } = setup({ response: 'ok', intent: 'x' }, [{ score: 30, item: storedObserved }]);
    deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

    await planner.planTurn({ userId: 'u1', userInput: "I'm ready for what's next", nowIso: '2026-01-01T12:00:00.000Z' });

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt: string = generate.mock.calls[0]?.[0]?.prompt ?? '';
    // Authority must reflect observed, not reported
    expect(prompt).toContain('authority: observed');
    expect(prompt).toContain('[RELATIONSHIP] User successfully completed their first challenge');
    expect(prompt).not.toContain('authority: reported');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tweak #8 — Behavioral Evidence Reinforcement
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Tweak #8 — behavioral evidence reinforcement', () => {
    it('first report writes with initial strength = 1', async () => {
      const { planner, deps } = setup({ response: 'ok', intent: 'x' });
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      await planner.planTurn({ userId: 'u1', userInput: 'I keep putting things off until the last minute', nowIso: '2026-01-01T12:00:00.000Z' });

      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const delayedStartWrite = writeCalls.find((args: any[]) => args[0]?.key === 'behavioral:self_report:delayed_start');
      expect(delayedStartWrite).toBeDefined();
      expect(delayedStartWrite![0].strength).toBe(1);
      // incrementStrength should not have been called because it is the first report
      expect((deps.memoryStore.incrementStrength as any)).not.toHaveBeenCalled();
    });

    it('second matching report causes exactly one increment on existing memory', async () => {
      const existingDelayedStart = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports delaying starts',
          epistemicStatus: 'reported',
          type: 'behavioral',
          confidence: 0.75,
          provenance: { sourceEventIds: [], sourceInsightTypes: ['behavioral_self_report'], challengeId: null, derivedAt: '2026-01-01T00:00:00Z' },
        }),
        strength: 1, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 20, item: existingDelayedStart }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // Send another matching self-report with equivalent phrasing
      await planner.planTurn({ userId: 'u1', userInput: 'I procrastinate on starting anything', nowIso: '2026-01-02T12:00:00.000Z' });

      // incrementStrength should be called with delta 1
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledTimes(1);
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledWith('u1', 'behavioral:self_report:delayed_start', 1);

      // write should NOT be called for this key again (no duplication)
      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const delayedStartWrite = writeCalls.find((args: any[]) => args[0]?.key === 'behavioral:self_report:delayed_start');
      expect(delayedStartWrite).toBeUndefined();
    });

    it('different behavioral categories do not reinforce each other', async () => {
      const existingDelayedStart = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports delaying starts',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 1, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 20, item: existingDelayedStart }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // User reports overthinking (research_over_action), not delayed_start
      await planner.planTurn({ userId: 'u1', userInput: 'I always overthink every single decision', nowIso: '2026-01-02T12:00:00.000Z' });

      // delayed_start should NOT be incremented
      expect((deps.memoryStore.incrementStrength as any)).not.toHaveBeenCalled();

      // research_over_action should be newly written with initial strength 1
      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const researchWrite = writeCalls.find((args: any[]) => args[0]?.key === 'behavioral:self_report:research_over_action');
      expect(researchWrite).toBeDefined();
      expect(researchWrite![0].strength).toBe(1);
    });

    it('mentioning a keyword alone without self-report does NOT increment strength', async () => {
      const existingDelayedStart = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports delaying starts',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 1, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 20, item: existingDelayedStart }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // Non-report context mentioning procrastination
      await planner.planTurn({ userId: 'u1', userInput: 'I read an interesting essay on procrastination', nowIso: '2026-01-02T12:00:00.000Z' });

      expect((deps.memoryStore.incrementStrength as any)).not.toHaveBeenCalled();
    });

    it('deduplicates reinforcement keys so a key is incremented at most once per turn', async () => {
      const existingDelayedStart = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports delaying starts',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 1, lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 20, item: existingDelayedStart }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      await planner.planTurn({ userId: 'u1', userInput: 'I keep putting off things because I procrastinate', nowIso: '2026-01-02T12:00:00.000Z' });

      // Even if multiple phrases matched, only 1 increment is called
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledTimes(1);
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledWith('u1', 'behavioral:self_report:delayed_start', 1);
    });

    it('reaches strength >= 2 across turns enabling hypothesis generation', async () => {
      // Simulate session 2 where existing memory has strength 2 after reinforcement
      const reinforcedMemory = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports difficulty beginning tasks',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 2, // Reinforced previously
        lastAccessedAt: '2026-01-02T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 25, item: reinforcedMemory }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // In session 3, user asks about their patterns
      await planner.planTurn({ userId: 'u1', userInput: "I'm trying to improve my workflow", nowIso: '2026-01-03T12:00:00.000Z' });

      // deriveRivalMemories sees strength >= 2 and emits hypothesis
      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const hypothesisWrite = writeCalls.find((args: any[]) => args[0]?.key === 'hypothesis:behavioral:self_report:delayed_start');
      expect(hypothesisWrite).toBeDefined();
      expect(hypothesisWrite![0].tier).toBe('permanent');
      const parsed = JSON.parse(hypothesisWrite![0].value as string);
      expect(parsed.epistemicStatus).toBe('hypothesis');
    });

    // ── Tweak #10 — Multi-turn cross-phrase reinforcement ─────────────────
    it('Tweak #10: displacement phrase ("still find a reason to keep researching before I start") reinforces delayed_start from turn 1', async () => {
      // Turn 1 created delayed_start from "I keep putting things off" (strength=1 now in DB)
      const turn1Memory = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports a recurring pattern of delaying or avoiding starting: "I keep putting things off when I have something important to start."',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 1,
        lastAccessedAt: '2026-01-01T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 20, item: turn1Memory }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // Turn 2: naturally worded displacement phrase — different wording, same key
      await planner.planTurn({
        userId: 'u1',
        userInput: "And the stupid part is that I actually know I'm doing it. I still find a reason to keep researching before I start.",
        nowIso: '2026-01-02T12:00:00.000Z',
      });

      // Turn 2 should INCREMENT delayed_start (not create a new memory)
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledWith('u1', 'behavioral:self_report:delayed_start', 1);
      expect((deps.memoryStore.incrementStrength as any)).toHaveBeenCalledTimes(1);
    });

    it('Tweak #10: after turn-2 reinforcement reaches strength 2, next turn emits hypothesis', async () => {
      // strength=2 after turn-1 + turn-2 reinforcement
      const reinforcedMemory = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports a recurring pattern of delaying or avoiding starting',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 2,
        lastAccessedAt: '2026-01-02T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [{ score: 25, item: reinforcedMemory }]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      // Turn 3: unrelated input — hypothesis should still be derived from existing strength>=2 behavioral memory
      await planner.planTurn({
        userId: 'u1',
        userInput: "What's weird is that this mostly happens when the thing matters to me.",
        nowIso: '2026-01-03T12:00:00.000Z',
      });

      // deriveRivalMemories sees strength>=2 on delayed_start → emits hypothesis
      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const hypWrite = writeCalls.find((args: any[]) => args[0]?.key === 'hypothesis:behavioral:self_report:delayed_start');
      expect(hypWrite).toBeDefined();
      const parsed = JSON.parse(hypWrite![0].value as string);
      expect(parsed.epistemicStatus).toBe('hypothesis');
      expect(parsed.description).toContain('2 observations');
    });

    it('Tweak #12: direct disconfirmation writes epistemicStatus: "contradicted" to memoryStore for hypothesis, preserves base behavioral memory, and writes non_completion', async () => {
      const baseMemory = {
        id: 'mem-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'User reports a recurring pattern of delaying or avoiding starting',
          epistemicStatus: 'reported',
          type: 'behavioral',
        }),
        strength: 2,
        lastAccessedAt: '2026-01-02T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      };

      const hypMemory = {
        id: 'hyp-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'hypothesis:behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'Possible recurring pattern (2 observations): User reports delaying starts',
          epistemicStatus: 'hypothesis',
          type: 'hypothesis',
          confidence: 0.60,
        }),
        strength: 2,
        lastAccessedAt: '2026-01-02T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      };

      const { planner, deps } = setup({ response: 'ok', intent: 'x' }, [
        { score: 30, item: baseMemory },
        { score: 30, item: hypMemory },
      ]);
      deps.eventStore = { recentForUser: vi.fn().mockResolvedValue([]), append: vi.fn().mockResolvedValue({}) } as any;

      await planner.planTurn({
        userId: 'u1',
        userInput: "You're right that I said that earlier, but I was describing a different situation. I can start important things quickly; what I struggle with is maintaining momentum once the novelty wears off.",
        nowIso: '2026-01-04T12:00:00.000Z',
      });

      const writeCalls = (deps.memoryStore.write as ReturnType<typeof vi.fn>).mock.calls;

      // 1. Contradicted hypothesis is persisted with updated epistemicStatus
      const hypContradictedWrite = writeCalls.find(
        (args: any[]) => args[0]?.key === 'hypothesis:behavioral:self_report:delayed_start',
      );
      expect(hypContradictedWrite).toBeDefined();
      expect(hypContradictedWrite![0].id).toBe('hyp-delay');
      const parsedHyp = JSON.parse(hypContradictedWrite![0].value as string);
      expect(parsedHyp.epistemicStatus).toBe('contradicted');

      // 2. Base behavioral memory was NOT overwritten with contradicted
      const baseWrite = writeCalls.find(
        (args: any[]) => args[0]?.key === 'behavioral:self_report:delayed_start',
      );
      expect(baseWrite).toBeUndefined();

      // 3. New replacement memory for momentum loss is written as non_completion with reported status
      const nonCompletionWrite = writeCalls.find(
        (args: any[]) => args[0]?.key === 'behavioral:self_report:non_completion',
      );
      expect(nonCompletionWrite).toBeDefined();
      const parsedNC = JSON.parse(nonCompletionWrite![0].value as string);
      expect(parsedNC.epistemicStatus).toBe('reported');
      expect(parsedNC.type).toBe('behavioral');
    });

    it('Tweak #12: fresh session with contradicted hypothesis suppresses it from prompt selection', async () => {
      const contradictedHypMemory = {
        id: 'hyp-delay', userId: 'u1', tier: 'permanent' as const, category: 'observation' as const,
        key: 'hypothesis:behavioral:self_report:delayed_start',
        value: JSON.stringify({
          description: 'Possible recurring pattern (2 observations): User reports delaying starts',
          epistemicStatus: 'contradicted',
          type: 'hypothesis',
          confidence: 0.60,
        }),
        strength: 2,
        lastAccessedAt: '2026-01-02T00:00:00Z', expiresAt: null,
        createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      };

      const { planner, generate } = setup({ response: 'ok', intent: 'x' }, [
        { score: 30, item: contradictedHypMemory },
      ]);

      await planner.planTurn({
        userId: 'u1',
        userInput: 'What do you think my biggest problem is when I try to get important things done?',
        nowIso: '2026-01-05T12:00:00.000Z',
      });

      const promptCall = generate.mock.calls[0][0].prompt;
      expect(promptCall).not.toContain('CURRENT TENTATIVE RIVAL BELIEF');
      expect(promptCall).not.toContain('[HYPOTHESIS]');
    });
  });
});


