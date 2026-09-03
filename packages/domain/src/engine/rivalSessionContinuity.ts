import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';

export type ContinuityType = 'new_session' | 'active_continuation' | 'resumed_session' | 'returned_after_absence' | 'unfinished_thread' | 'new_context';

export interface ContinuityThread {
  challengeId: string;
  description: string;
  status: Challenge['status'];
  lastMeaningfulEventId: string | null;
}

export interface RivalSessionContinuity {
  continuityType: ContinuityType;
  previousSessionAt: string | null;
  lastMeaningfulEventAt: string | null;
  elapsedSinceMeaningfulActivityMs: number | null;
  activeThread: ContinuityThread | null;
  recentSequence: string[];
  sourceEventIds: string[];
  renderingDirectives: string[];
}

export interface SessionContinuityInput {
  nowIso: string;
  userInput: string;
  activeChallenge: Challenge | null;
  events: readonly DomainEvent[];
}

export const SESSION_CONTINUITY_TIMING = {
  ACTIVE_CONTINUATION_MS: 10 * 60 * 1000,
  RESUMED_SESSION_MS: 2 * 60 * 60 * 1000,
} as const;

const meaningfulTypes = new Set<string>([
  'challenge_issued', 'challenge_accepted', 'challenge_negotiated', 'challenge_started', 'challenge_attempted',
  'evidence_submitted', 'challenge_judged', 'challenge_closed', 'process_signal', 'process_thought', 'chat_message_sent',
]);
const unresolvedStatuses = new Set<Challenge['status']>(['issued', 'negotiated', 'accepted', 'started', 'attempted', 'needs_more_evidence']);

function elapsed(from: string, to: string): number | null {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

function isSocialInput(input: string): boolean {
  const normalized = input.toLowerCase();
  return ['hello', 'hi', 'hey', 'movie', 'music', 'joke', 'what do you think', 'how are you'].some((term) => normalized.includes(term));
}

function belongsToChallenge(event: DomainEvent, challengeId: string): boolean {
  return (event.payload as { challenge_id?: unknown }).challenge_id === challengeId;
}

function sequenceLabel(event: DomainEvent): string | null {
  const type = event.eventType as string;
  if (type === 'process_signal') {
    const signal = (event.payload as { signal?: unknown }).signal;
    return signal === 'CHANGING_APPROACH' ? 'strategy_switch' : typeof signal === 'string' ? `process_${signal.toLowerCase()}` : null;
  }
  const labels: Record<string, string> = {
    challenge_issued: 'challenge_issued', challenge_started: 'challenge_started', challenge_attempted: 'challenge_attempted',
    evidence_submitted: 'evidence_submitted', challenge_judged: 'challenge_judged', challenge_closed: 'challenge_closed',
    chat_message_sent: 'claim_made', process_thought: 'process_thought',
  };
  return labels[type] || null;
}

/** Pure, compact continuity extraction from trusted ledger events and challenge state. */
export function deriveSessionContinuity(input: SessionContinuityInput): RivalSessionContinuity {
  const chronological = [...input.events]
    .filter((event) => meaningfulTypes.has(event.eventType as string))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latest = chronological.at(-1) || null;
  const elapsedMs = latest ? elapsed(latest.createdAt, input.nowIso) : null;
  const unfinished = input.activeChallenge && unresolvedStatuses.has(input.activeChallenge.status) ? input.activeChallenge : null;
  const threadEvents = unfinished ? chronological.filter((event) => belongsToChallenge(event, unfinished.id)) : [];
  const threadLast = threadEvents.at(-1) || null;
  const socialNewContext = Boolean(unfinished && isSocialInput(input.userInput));

  if (!latest) {
    return { continuityType: 'new_session', previousSessionAt: null, lastMeaningfulEventAt: null, elapsedSinceMeaningfulActivityMs: null, activeThread: null, recentSequence: [], sourceEventIds: [], renderingDirectives: [] };
  }

  const activeThread = unfinished && !socialNewContext
    ? { challengeId: unfinished.id, description: unfinished.objective, status: unfinished.status, lastMeaningfulEventId: threadLast?.id || null }
    : null;
  const sequenceEvents = (threadEvents.length > 0 ? threadEvents : chronological).slice(-4);
  const recentSequence = sequenceEvents.map(sequenceLabel).filter((label): label is string => label !== null);
  const sourceEventIds = Array.from(new Set([...sequenceEvents.map((event) => event.id), ...(threadLast ? [threadLast.id] : [])]));

  let continuityType: ContinuityType;
  if (socialNewContext) continuityType = 'new_context';
  else if ((elapsedMs || 0) < SESSION_CONTINUITY_TIMING.ACTIVE_CONTINUATION_MS) continuityType = 'active_continuation';
  else if ((elapsedMs || 0) < SESSION_CONTINUITY_TIMING.RESUMED_SESSION_MS && unfinished) continuityType = 'resumed_session';
  else if ((elapsedMs || 0) >= SESSION_CONTINUITY_TIMING.RESUMED_SESSION_MS) continuityType = 'returned_after_absence';
  else if (unfinished) continuityType = 'unfinished_thread';
  else continuityType = 'new_context';

  const renderingDirectives = activeThread
    ? ['Continuity facts are authoritative. Refer to the unfinished thread only if it naturally fits this turn.', 'Do not invent actions, durations, or history beyond this packet.']
    : continuityType === 'returned_after_absence'
      ? ['Continuity facts are authoritative. Acknowledge return naturally; do not guilt, pressure, or force productivity.']
      : [];

  return {
    continuityType,
    previousSessionAt: latest.createdAt,
    lastMeaningfulEventAt: latest.createdAt,
    elapsedSinceMeaningfulActivityMs: elapsedMs,
    activeThread,
    recentSequence,
    sourceEventIds,
    renderingDirectives,
  };
}
