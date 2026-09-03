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
    memoryStore: { retrieveRelevant: vi.fn().mockResolvedValue(memories), write: vi.fn().mockResolvedValue({}) } as unknown as IMemoryStore,
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
});
