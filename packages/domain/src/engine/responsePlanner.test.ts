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
  const deps = {
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
    expect(generate).toHaveBeenCalledTimes(1); expect(result.humorMechanism).toBe('callback');
    expect((deps.humorStore.record as any)).toHaveBeenCalledWith('u1', 'callback', expect.any(String), 8);
  });
  it('does not record humor when the planner selects serious mode', async () => {
    const { planner, deps } = setup({ response: 'I am here.', intent: 'support', humorMechanism: 'sarcasm', seriousFlag: false });
    await planner.planTurn({ userId: 'u1', userInput: 'I want to die' });
    expect((deps.humorStore.record as any)).not.toHaveBeenCalled();
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
  
  it('fetches processCaptures from eventStore and passes them to promptBuilder', async () => {
    const { planner, deps, generate } = setup({ response: 'roast', intent: 'x' });
    const mockEvents = [
      { eventType: 'process_signal', payload: { challenge_id: 'ch1', signal: 'STUCK' }, createdAt: '2026-01-01T00:00:00Z' },
      { eventType: 'process_thought', payload: { challenge_id: 'ch1', content: 'wait' }, createdAt: '2026-01-01T00:01:00Z' },
      { eventType: 'process_signal', payload: { challenge_id: 'ch2', signal: 'GOT IT' }, createdAt: '2026-01-01T00:02:00Z' } // Different challenge
    ];
    deps.eventStore = {
      recentForUser: vi.fn().mockResolvedValue(mockEvents)
    } as any;

    await planner.planTurn({ userId: 'u1', userInput: 'hello', activeChallenge: { id: 'ch1', objective: 'Test', status: 'started', difficulty: 5, verificationLevel: 'self_report', constraints: [] } as any });
    
    expect(deps.eventStore?.recentForUser).toHaveBeenCalledWith('u1', 50);
    
    // Extract the prompt string that was passed to generate
    const promptCall = generate.mock.calls[0][0].prompt;
    expect(promptCall).toContain('RIVAL LENS — PROCESS CAPTURES');
    expect(promptCall).toContain('[SIGNAL] STUCK');
    expect(promptCall).toContain('[THOUGHT] "wait"');
    // Should filter out the one for ch2
    expect(promptCall).not.toContain('[SIGNAL] GOT IT');
  });
});
