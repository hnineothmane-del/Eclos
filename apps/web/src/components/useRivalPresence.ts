import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRESENCE_TIMING,
  resolvePresence,
  toPresenceVisualState,
  type AmbientEventRecord,
  type PresenceDecision,
  type PresenceInteraction,
  type PresenceState,
  type PresenceVisualState,
  type RelationshipState,
} from '@ai-rival/domain';
import type { Challenge } from '@ai-rival/domain';

const neutralRelationship: RelationshipState = {
  userId: 'runtime',
  respect: 0,
  warmth: 0,
  trust: 0,
  rivalry: 0,
  familiarity: 0,
  curiosity: 0,
  mode: 'adaptive',
  updatedAt: '',
};

export interface UseRivalPresenceOptions {
  activeChallenge?: Challenge | null;
  /** A response already marked serious suppresses non-critical ambient behavior. */
  serious?: boolean;
  relationship?: RelationshipState;
  onAmbientEvent?: (decision: PresenceDecision) => void;
}

export interface RivalPresenceRuntime {
  decision: PresenceDecision;
  visual: PresenceVisualState;
  /** Future touch/poke/wake/interrupt interactions enter through this explicit seam. */
  recordInteraction: (interaction: PresenceInteraction) => void;
  markMeaningfulActivity: () => void;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Browser-only runtime adapter. It resolves the pure Presence Engine from
 * timestamps whenever the page becomes relevant; it never polls the network or
 * creates language for a visual-only transition.
 */
export function useRivalPresence({ activeChallenge = null, serious = false, relationship = neutralRelationship, onAmbientEvent }: UseRivalPresenceOptions): RivalPresenceRuntime {
  const startedAt = useRef(nowIso());
  const lastUserInteractionAt = useRef(startedAt.current);
  const currentState = useRef<PresenceState>('active');
  const recentEvents = useRef<AmbientEventRecord[]>([]);
  const onAmbientEventRef = useRef(onAmbientEvent);
  const activeChallengeRef = useRef(activeChallenge);
  const seriousRef = useRef(serious);
  const relationshipRef = useRef(relationship);
  const [decision, setDecision] = useState(() => resolvePresence({
    currentTimeIso: startedAt.current,
    state: 'active',
    sessionStartedAt: startedAt.current,
    lastUserInteractionAt: startedAt.current,
    userActivity: 'engaged',
    relationship,
  }));

  onAmbientEventRef.current = onAmbientEvent;
  activeChallengeRef.current = activeChallenge;
  seriousRef.current = serious;
  relationshipRef.current = relationship;

  const resolve = useCallback((userActivity: 'engaged' | 'idle' | 'away', sourceEventIds: string[] = [], allowAmbient = true) => {
    const currentTimeIso = nowIso();
    const next = resolvePresence({
      currentTimeIso,
      state: currentState.current,
      sessionStartedAt: startedAt.current,
      lastUserInteractionAt: lastUserInteractionAt.current,
      lastAmbientEventAt: recentEvents.current.at(-1)?.occurredAt ?? null,
      userActivity,
      relationship: relationshipRef.current,
      activeChallenge: activeChallengeRef.current,
      seriousness: seriousRef.current ? 8 : 0,
      sourceEventIds,
      recentAmbientEvents: recentEvents.current,
    });

    currentState.current = next.state;
    setDecision(next);
    if (allowAmbient && next.action) {
      recentEvents.current = [...recentEvents.current.slice(-9), { type: next.action, occurredAt: next.generatedAt }];
      onAmbientEventRef.current?.(next);
    }
    return next;
  }, []);

  const markMeaningfulActivity = useCallback(() => {
    lastUserInteractionAt.current = nowIso();
    resolve('engaged');
  }, [resolve]);

  const recordInteraction = useCallback((interaction: PresenceInteraction) => {
    // This is a contract seam only. Future interaction mechanics can attach
    // provenance here without adding an independent character runtime.
    if (interaction === 'wake') currentState.current = 'sleeping';
    markMeaningfulActivity();
  }, [markMeaningfulActivity]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resolve('away', [], false);
        return;
      }
      // Browser timers are unreliable while suspended. First resolve the time
      // away, then resolve the actual return so only the engine may select it.
      resolve('away', [], false);
      resolve('engaged');
    };
    const onFocus = () => {
      // visibilitychange has already produced the returning manifestation. A
      // paired focus event must not immediately consume it or re-run the path.
      if (document.visibilityState === 'visible' && currentState.current !== 'returning') {
        resolve('away', [], false);
        resolve('engaged');
      }
    };
    const onActivity = () => markMeaningfulActivity();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', onActivity, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [markMeaningfulActivity, resolve]);

  useEffect(() => {
    // One state-only wake-up, not an interval: missed mobile timers are harmless
    // because visibility and focus always resolve from real timestamps again.
    const idleFor = Math.max(0, Date.now() - new Date(lastUserInteractionAt.current).getTime());
    const nextThreshold = idleFor < PRESENCE_TIMING.IDLE_MS
      ? PRESENCE_TIMING.IDLE_MS
      : idleFor < PRESENCE_TIMING.OBSERVE_MS
        ? PRESENCE_TIMING.OBSERVE_MS
        : idleFor < PRESENCE_TIMING.BORED_MS
          ? PRESENCE_TIMING.BORED_MS
          : idleFor < PRESENCE_TIMING.REST_MS
          ? PRESENCE_TIMING.REST_MS
          : idleFor < PRESENCE_TIMING.SLEEP_MS
            ? PRESENCE_TIMING.SLEEP_MS
          : null;
    if (nextThreshold === null) return;
    const timeout = window.setTimeout(() => resolve('idle'), Math.max(0, nextThreshold - idleFor));
    return () => window.clearTimeout(timeout);
  }, [decision.state, resolve]);

  return { decision, visual: toPresenceVisualState(decision), recordInteraction, markMeaningfulActivity };
}
