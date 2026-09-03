import { describe, expect, it } from 'vitest';
import { deriveRivalLore } from './rivalLore.js';
import type { DomainEvent } from '../types/events.js';
import { deriveRivalRelationshipContext } from './rivalRelationshipContext.js';

const now = '2026-09-01T12:00:00.000Z';
const base = {
  nowIso: now, userInput: 'where are you from?',
  relationship: { userId: 'u', familiarity: 60, respect: 50, warmth: 40, trust: 50, rivalry: 50, curiosity: 50, mode: 'adaptive' as const, updatedAt: now },
  livingState: { internalState: 'observing' as const, microActivity: 'watching' as const, expressionMode: 'silent' as const, authorizedAmbientEvent: null, canInteract: false, isTransition: false, reason: 'idle', derivedAt: now, pendingInteractionHook: null },
  activeChallenge: null, serious: false, easterEgg: null, events: [] as DomainEvent[],
};

describe('rival lore', () => {
  it('deterministically reveals a grounded origin hint without canonizing it', () => {
    const decision = deriveRivalLore(base);
    expect(decision).toMatchObject({ fact: { id: 'roasteria_reference', category: 'origin_hint' }, revealLevel: 'hint', newlyRevealed: true });
    expect(deriveRivalLore(base)).toEqual(decision);
  });
  it('gates lore by familiarity, serious context, and active challenge work', () => {
    expect(deriveRivalLore({ ...base, relationship: { ...base.relationship, familiarity: 20 } }).fact).toBeNull();
    expect(deriveRivalLore({ ...base, serious: true }).fact).toBeNull();
    expect(deriveRivalLore({ ...base, activeChallenge: { status: 'evidence_submitted' } as any }).fact).toBeNull();
    expect(deriveRivalLore({ ...base, activeChallenge: { status: 'started' } as any }).fact).toBeNull();
  });
  it('turns a later relevant recurrence into known lore and observes cooldown', () => {
    const old: DomainEvent = { id: 'l1', userId: 'u', eventType: 'rival_lore_revealed', source: 'system', payload: { loreId: 'roasteria_reference' }, createdAt: '2026-08-20T12:00:00.000Z' };
    expect(deriveRivalLore({ ...base, events: [old] })).toMatchObject({ revealLevel: 'known', newlyRevealed: false, sourceEventIds: ['l1'] });
    const recent = { ...old, createdAt: '2026-09-01T11:00:00.000Z' };
    expect(deriveRivalLore({ ...base, events: [recent] }).fact).toBeNull();
  });
  it('connects the hidden character moment to the cosmic-phone hint', () => {
    expect(deriveRivalLore({ ...base, userInput: '', easterEgg: { id: 'caught_occupied', authorized: true, speechAuthorized: true, visualCue: 'caught', sourceEventIds: ['i1'], reason: 'caught' } })).toMatchObject({ fact: { id: 'cosmic_phone' }, revealLevel: 'hint', sourceEventIds: ['i1'] });
  });
  it('keeps deeper fictional activity behind relationship disclosure permission', () => {
    const lowTrust = { ...base.relationship, familiarity: 70, trust: 20, warmth: 20, respect: 50 };
    const input = { ...base, userInput: 'what are you doing?', livingState: { ...base.livingState, internalState: 'occupied' as const }, relationship: lowTrust, relationshipContext: deriveRivalRelationshipContext(lowTrust) };
    expect(deriveRivalLore(input).fact).toBeNull();
    const trusted = { ...lowTrust, trust: 75, warmth: 60, respect: 65 };
    expect(deriveRivalLore({ ...input, relationship: trusted, relationshipContext: deriveRivalRelationshipContext(trusted) }).fact?.id).toBe('classified_business');
  });
});
