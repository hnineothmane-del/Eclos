import { describe, expect, it, vi } from 'vitest';
import { PRESENCE_TIMING, resolvePresence, toPresenceVisualState, type PresenceInput } from './presenceEngine.js';
import { ResponsePlanner } from './responsePlanner.js';
import { FakeAIProvider } from '../ai/fakeProvider.js';

const now = '2026-08-31T12:00:00.000Z';
const relationship = { userId: 'u', respect: 50, warmth: 50, trust: 60, rivalry: 65, familiarity: 60, curiosity: 50, mode: 'permanent_rival' as const, updatedAt: now };
const base: PresenceInput = { currentTimeIso: now, state: 'active', sessionStartedAt: '2026-08-31T11:00:00.000Z', lastUserInteractionAt: now, userActivity: 'engaged', relationship };
const before = (milliseconds: number) => new Date(new Date(now).getTime() - milliseconds).toISOString();

describe('presence engine', () => {
  it.each([
    ['active to idle', { ...base, userActivity: 'idle' as const, lastUserInteractionAt: before(PRESENCE_TIMING.IDLE_MS) }, 'idle'],
    ['idle to observing', { ...base, state: 'idle' as const, userActivity: 'idle' as const, lastUserInteractionAt: before(PRESENCE_TIMING.OBSERVE_MS) }, 'observing'],
    ['observing to active', { ...base, state: 'observing' as const }, 'active'],
    ['active to sleeping', { ...base, userActivity: 'idle' as const, lastUserInteractionAt: before(PRESENCE_TIMING.SLEEP_MS) }, 'sleeping'],
    ['sleeping to awakening', { ...base, state: 'sleeping' as const }, 'awakening'],
    ['awakening to active', { ...base, state: 'awakening' as const }, 'active'],
    ['away to returning', { ...base, state: 'away' as const, lastUserInteractionAt: before(PRESENCE_TIMING.AWAY_MS) }, 'returning'],
    ['returning to active', { ...base, state: 'returning' as const }, 'active'],
  ])('%s is deterministic', (_name, input, state) => {
    expect(resolvePresence(input as PresenceInput).state).toBe(state);
    expect(resolvePresence(input as PresenceInput)).toEqual(resolvePresence(input as PresenceInput));
  });

  it('suppresses ambient behavior for serious and challenge-critical context', () => {
    expect(resolvePresence({ ...base, seriousness: 9, userActivity: 'idle', lastUserInteractionAt: before(PRESENCE_TIMING.SLEEP_MS) })).toMatchObject({ state: 'serious', action: null, reason: 'serious_context' });
    expect(resolvePresence({ ...base, activeChallenge: { status: 'evidence_submitted' } as any, userActivity: 'idle', lastUserInteractionAt: before(PRESENCE_TIMING.SLEEP_MS) })).toMatchObject({ state: 'active', action: null, reason: 'challenge_critical' });
  });

  it('uses relationship-aware interruption, cooldowns, silence, and provenance', () => {
    const stalled = resolvePresence({ ...base, userActivity: 'idle', opportunity: 'user_stalled', sourceEventIds: ['signal-1'], lastUserInteractionAt: before(PRESENCE_TIMING.OBSERVE_MS) });
    expect(stalled).toMatchObject({ state: 'observing', action: 'idle_reaction', sourceEventIds: ['signal-1'] });
    expect(resolvePresence({ ...base, userActivity: 'idle', opportunity: 'user_stalled', lastUserInteractionAt: before(PRESENCE_TIMING.OBSERVE_MS), recentAmbientEvents: [{ type: 'idle_reaction', occurredAt: before(1_000) }] }).action).toBeNull();
    expect(resolvePresence({ ...base, relationship: { ...relationship, familiarity: 10 }, userActivity: 'idle', opportunity: 'user_stalled', lastUserInteractionAt: before(PRESENCE_TIMING.OBSERVE_MS) }).action).toBeNull();
    expect(resolvePresence(base).action).toBeNull();
  });

  it('uses silent boredom and rest states before sleep, with a typed visual contract', () => {
    const bored = resolvePresence({ ...base, userActivity: 'idle', lastUserInteractionAt: before(PRESENCE_TIMING.BORED_MS) });
    const resting = resolvePresence({ ...base, userActivity: 'idle', lastUserInteractionAt: before(PRESENCE_TIMING.REST_MS) });
    expect(bored).toMatchObject({ state: 'bored', activity: 'waiting', action: null });
    expect(resting).toMatchObject({ state: 'resting', activity: 'resting', action: null });
    expect(toPresenceVisualState(bored)).toMatchObject({ animationHint: 'waiting', canInteract: false });
    expect(toPresenceVisualState(resting)).toMatchObject({ animationHint: 'resting', canInteract: true });
  });

  it('limits ambient speech to one selected event per session without changing visual life states', () => {
    const returning = resolvePresence({ ...base, state: 'away', lastUserInteractionAt: before(PRESENCE_TIMING.AWAY_MS) });
    expect(returning.action).toBe('return_greeting');
    const later = resolvePresence({ ...base, state: 'sleeping', recentAmbientEvents: [{ type: 'return_greeting', occurredAt: now }] });
    expect(later).toMatchObject({ state: 'awakening', action: null, reason: 'cooldown' });
  });

  it('uses zero calls for silence and one existing generation only for an action', async () => {
    const provider = new FakeAIProvider({ defaultGenerateResponse: { response: 'Back already.', intent: 'ambient', humorMechanism: null, register: 'direct', seriousFlag: false } });
    const planner = new ResponsePlanner({
      modelRouter: { forChat: () => provider },
      relationshipStore: { get: vi.fn().mockResolvedValue(relationship) },
      memoryStore: { retrieveRelevant: vi.fn().mockResolvedValue([]), write: vi.fn() },
      humorStore: { recentMechanisms: vi.fn().mockResolvedValue([]), record: vi.fn() },
    } as never);
    const silent = resolvePresence(base);
    expect(await planner.planAmbientTurn({ userId: 'u', presenceDecision: silent })).toBeNull();
    expect(provider.generateCalls).toHaveLength(0);
    const returning = resolvePresence({ ...base, state: 'away', lastUserInteractionAt: before(PRESENCE_TIMING.AWAY_MS) });
    await planner.planAmbientTurn({ userId: 'u', presenceDecision: returning });
    expect(provider.generateCalls).toHaveLength(1);
    expect(provider.generateCalls[0].prompt).toContain('DETERMINISTIC PRESENCE EVENT');
  });
});
