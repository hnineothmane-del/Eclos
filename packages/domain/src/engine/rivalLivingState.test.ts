import { describe, expect, it } from 'vitest';
import {
  deriveRivalLivingState,
  withInteractionHook,
  describeLivingState,
} from './rivalLivingState.js';
import type { PresenceDecision } from './presenceEngine.js';
import type { RivalInitiativeDecision } from './rivalAgency.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-02-01T00:00:00Z';

function mkPresence(overrides: Partial<PresenceDecision> = {}): PresenceDecision {
  return {
    state: 'active',
    activity: 'watching',
    attention: 'ignore',
    action: null,
    reason: 'no_worthy_event',
    sourceEventIds: [],
    generatedAt: NOW,
    ...overrides,
  };
}

function mkAgency(action: RivalInitiativeDecision['action'] = 'QUIET'): RivalInitiativeDecision {
  return {
    action,
    priority: 0,
    reason: 'test',
    sourceEventIds: [],
    sourceMemoryKeys: [],
    sourceInsightKeys: [],
    requestedInteractionMode: null,
    urgency: 'low',
    cooldownKey: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRivalLivingState', () => {
  it('maps active/watching presence to active/watching living state', () => {
    const state = deriveRivalLivingState(mkPresence(), null, NOW);
    expect(state.internalState).toBe('active');
    expect(state.microActivity).toBe('watching');
    expect(state.expressionMode).toBe('silent');
    expect(state.canInteract).toBe(false);
    expect(state.isTransition).toBe(false);
    expect(state.derivedAt).toBe(NOW);
    expect(state.pendingInteractionHook).toBeNull();
  });

  it('maps idle/idle presence to observing/idle living state', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'idle', activity: 'idle' }), null, NOW);
    expect(state.internalState).toBe('observing');
    expect(state.microActivity).toBe('idle');
    expect(state.expressionMode).toBe('silent');
    expect(state.canInteract).toBe(false);
  });

  it('maps bored/waiting presence to bored/waiting living state, canInteract=true', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'bored', activity: 'waiting', attention: 'observe' }), null, NOW);
    expect(state.internalState).toBe('bored');
    expect(state.microActivity).toBe('waiting');
    expect(state.canInteract).toBe(true);
    // With no agency action but attention === 'observe' → expressionMode = 'observing'
    expect(state.expressionMode).toBe('observing');
  });

  it('maps resting/resting to resting/resting, canInteract=true', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'resting', activity: 'resting' }), null, NOW);
    expect(state.internalState).toBe('resting');
    expect(state.canInteract).toBe(true);
  });

  it('maps sleeping/sleeping to sleeping, canInteract=true', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'sleeping', activity: 'sleeping' }), null, NOW);
    expect(state.internalState).toBe('sleeping');
    expect(state.microActivity).toBe('sleeping');
    expect(state.canInteract).toBe(true);
  });

  it('maps awakening to returning, marks isTransition=true', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'awakening', activity: 'thinking' }), null, NOW);
    expect(state.internalState).toBe('returning');
    expect(state.isTransition).toBe(true);
  });

  it('marks isTransition=true for return_greeting action', () => {
    const state = deriveRivalLivingState(
      mkPresence({ state: 'returning', activity: 'returning', action: 'return_greeting' }),
      null,
      NOW,
    );
    expect(state.isTransition).toBe(true);
  });

  it('maps occupied activity to occupied internal state', () => {
    const state = deriveRivalLivingState(
      mkPresence({ state: 'active', activity: 'occupied', action: 'rare_character_event' }),
      null,
      NOW,
    );
    expect(state.internalState).toBe('occupied');
    expect(state.microActivity).toBe('occupied');
    expect(state.canInteract).toBe(false);
    expect(state.reason).toContain('occupied');
  });

  // ─── Expression mode ───────────────────────────────────────────────────────

  it('sets expressionMode=speaking when agency has non-QUIET action', () => {
    const agency = mkAgency('RETURN_REMARK');
    const state = deriveRivalLivingState(mkPresence({ state: 'returning', activity: 'returning' }), agency, NOW);
    expect(state.expressionMode).toBe('speaking');
  });

  it('sets expressionMode=silent for QUIET agency, ignore attention', () => {
    const state = deriveRivalLivingState(mkPresence({ attention: 'ignore' }), mkAgency('QUIET'), NOW);
    expect(state.expressionMode).toBe('silent');
  });

  it('sets expressionMode=observing for QUIET agency, observe attention', () => {
    const state = deriveRivalLivingState(mkPresence({ attention: 'observe', state: 'observing', activity: 'watching' }), mkAgency('QUIET'), NOW);
    expect(state.expressionMode).toBe('observing');
  });

  // ─── Determinism ───────────────────────────────────────────────────────────

  it('is deterministic: same inputs produce same output', () => {
    const presence = mkPresence({ state: 'bored', activity: 'waiting' });
    const a = deriveRivalLivingState(presence, null, NOW);
    const b = deriveRivalLivingState(presence, null, NOW);
    expect(a).toEqual(b);
  });

  it('does not mutate input presence or agency', () => {
    const presence = mkPresence();
    const agency = mkAgency();
    const presenceCopy = JSON.stringify(presence);
    const agencyCopy = JSON.stringify(agency);
    deriveRivalLivingState(presence, agency, NOW);
    expect(JSON.stringify(presence)).toBe(presenceCopy);
    expect(JSON.stringify(agency)).toBe(agencyCopy);
  });

  // ─── Interaction hook seam ─────────────────────────────────────────────────

  it('starts with no interaction hook', () => {
    const state = deriveRivalLivingState(mkPresence(), null, NOW);
    expect(state.pendingInteractionHook).toBeNull();
  });

  it('withInteractionHook attaches a hook without mutating the original', () => {
    const state = deriveRivalLivingState(mkPresence(), null, NOW);
    const withHook = withInteractionHook(state, 'poke');
    expect(withHook.pendingInteractionHook).toBe('poke');
    expect(state.pendingInteractionHook).toBeNull(); // original untouched
  });

  it('supports all defined hook types without type error', () => {
    const state = deriveRivalLivingState(mkPresence(), null, NOW);
    const hooks = ['touch', 'tap', 'poke', 'wake', 'interrupt', 'user_roast', 'user_challenge', 'easter_egg', 'mini_game', 'lore_event', 'rare_activity'] as const;
    for (const hook of hooks) {
      expect(withInteractionHook(state, hook).pendingInteractionHook).toBe(hook);
    }
  });

  // ─── Description helper ───────────────────────────────────────────────────

  it('describes a sleeping/silent state', () => {
    const state = deriveRivalLivingState(mkPresence({ state: 'sleeping', activity: 'sleeping' }), null, NOW);
    const desc = describeLivingState(state);
    expect(desc).toContain('sleeping');
    expect(desc).toContain('silent');
  });

  it('describes a speaking state', () => {
    const agency = mkAgency('WAKE_REMARK');
    const state = deriveRivalLivingState(mkPresence({ state: 'awakening', activity: 'thinking', action: 'sleep_end' }), agency, NOW);
    const desc = describeLivingState(state);
    expect(desc).toContain('returning');
    expect(desc).toContain('speaking');
  });
});
