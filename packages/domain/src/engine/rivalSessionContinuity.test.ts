import { describe, expect, it } from 'vitest';
import { deriveSessionContinuity } from './rivalSessionContinuity.js';
import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';

const now = '2026-09-01T12:00:00.000Z';
const challenge = { id: 'c1', objective: 'Fix the parser', status: 'started' } as Challenge;
const event = (id: string, eventType: DomainEvent['eventType'], createdAt: string, payload: Record<string, unknown> = {}): DomainEvent => ({ id, userId: 'u', eventType, source: 'system', payload, createdAt });

describe('rival session continuity', () => {
  it('derives a deterministic new session with no history', () => {
    const input = { nowIso: now, userInput: 'hello', activeChallenge: null, events: [] };
    expect(deriveSessionContinuity(input)).toMatchObject({ continuityType: 'new_session', activeThread: null, sourceEventIds: [] });
    expect(deriveSessionContinuity(input)).toEqual(deriveSessionContinuity(input));
  });

  it('grounds a recent unfinished challenge as a resumed session with compact sequence and provenance', () => {
    const events = [event('start', 'challenge_started', '2026-09-01T11:00:00.000Z', { challenge_id: 'c1' }), event('switch', 'process_signal', '2026-09-01T11:20:00.000Z', { challenge_id: 'c1', signal: 'CHANGING_APPROACH' })];
    const continuity = deriveSessionContinuity({ nowIso: now, userInput: 'I am back', activeChallenge: challenge, events });
    expect(continuity).toMatchObject({ continuityType: 'resumed_session', activeThread: { challengeId: 'c1', lastMeaningfulEventId: 'switch' } });
    expect(continuity.recentSequence).toEqual(['challenge_started', 'strategy_switch']);
    expect(continuity.sourceEventIds).toEqual(expect.arrayContaining(['start', 'switch']));
  });

  it('distinguishes active continuation, long return, and protected casual new context', () => {
    const events = [event('start', 'challenge_started', '2026-09-01T11:55:00.000Z', { challenge_id: 'c1' })];
    expect(deriveSessionContinuity({ nowIso: now, userInput: 'continue', activeChallenge: challenge, events }).continuityType).toBe('active_continuation');
    expect(deriveSessionContinuity({ nowIso: now, userInput: 'continue', activeChallenge: challenge, events: [event('old', 'challenge_started', '2026-08-31T05:00:00.000Z', { challenge_id: 'c1' })] }).continuityType).toBe('returned_after_absence');
    expect(deriveSessionContinuity({ nowIso: now, userInput: 'what movie should I watch?', activeChallenge: challenge, events }).continuityType).toBe('new_context');
  });
});
