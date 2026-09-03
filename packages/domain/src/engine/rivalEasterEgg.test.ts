import { describe, expect, it } from 'vitest';
import { deriveRivalEasterEgg } from './rivalEasterEgg.js';
import type { DomainEvent } from '../types/events.js';

const now = '2026-09-01T12:00:00.000Z';
const event = (id: string, createdAt: string, eventType: DomainEvent['eventType'] = 'rival_interaction'): DomainEvent => ({ id, userId: 'u', eventType, source: 'user_action', payload: { interactionType: 'tap' }, createdAt });
const base = {
  nowIso: now, interaction: 'tap' as const,
  relationship: { userId: 'u', familiarity: 60, respect: 50, warmth: 40, trust: 50, rivalry: 50, curiosity: 50, mode: 'adaptive' as const, updatedAt: now },
  livingState: { internalState: 'observing' as const, microActivity: 'watching' as const, expressionMode: 'silent' as const, authorizedAmbientEvent: null, canInteract: false, isTransition: false, reason: 'idle', derivedAt: now, pendingInteractionHook: null },
  activeChallenge: null, serious: false,
  events: [event('i1', '2026-09-01T11:30:00.000Z'), event('i2', '2026-09-01T11:45:00.000Z'), event('i3', '2026-09-01T11:55:00.000Z')],
};

describe('rival Easter egg', () => {
  it('authorizes exactly one grounded caught-occupied event', () => {
    const decision = deriveRivalEasterEgg(base);
    expect(decision).toMatchObject({ id: 'caught_occupied', authorized: true, speechAuthorized: true, visualCue: 'caught', sourceEventIds: ['i1', 'i2', 'i3'] });
    expect(deriveRivalEasterEgg(base)).toEqual(decision);
  });
  it('requires familiarity, history, eligible state, and non-critical context', () => {
    expect(deriveRivalEasterEgg({ ...base, relationship: { ...base.relationship, familiarity: 20 } }).authorized).toBe(false);
    expect(deriveRivalEasterEgg({ ...base, events: base.events.slice(0, 2) }).authorized).toBe(false);
    expect(deriveRivalEasterEgg({ ...base, livingState: { ...base.livingState, internalState: 'active' } }).authorized).toBe(false);
    expect(deriveRivalEasterEgg({ ...base, serious: true }).authorized).toBe(false);
    expect(deriveRivalEasterEgg({ ...base, activeChallenge: { status: 'evidence_submitted' } as any }).authorized).toBe(false);
  });
  it('cannot rediscover the secret after its ledger event exists', () => {
    expect(deriveRivalEasterEgg({ ...base, events: [...base.events, { ...event('secret', now, 'rival_easter_egg_discovered'), payload: { id: 'caught_occupied' } }] }).authorized).toBe(false);
  });
});
