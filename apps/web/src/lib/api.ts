import { supabase } from '../lib/supabase';
import { deriveProcessInsights, type Challenge, type DomainEvent, type PresenceDecision, type PresenceInteraction } from '@ai-rival/domain';

interface EventRow {
  id: string;
  user_id: string;
  event_type: DomainEvent['eventType'];
  source?: DomainEvent['source'];
  payload: Record<string, unknown>;
  created_at: string;
}

export async function ensureSession() {
  let { data: { session } } = await supabase.auth.getSession();

  // If a session exists in localStorage, verify the user still exists in DB
  if (session) {
    const isExpired = session.expires_at ? (session.expires_at * 1000 <= Date.now() + 60000) : false;
    if (isExpired) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        await supabase.auth.signOut().catch(() => {});
        session = null;
      } else {
        session = refreshData.session;
      }
    }
  }

  if (session) {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      // Stale session (e.g. after local supabase db reset)
      await supabase.auth.signOut().catch(() => {});
      session = null;
    }
  }

  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      console.warn('Anonymous sign-in not supported or failed', error);
      throw error || new Error('Failed to create anonymous session');
    }
    session = data.session;
  }
  return session;
}

export async function chatTurn(userInput: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('chat-turn', {
    body: { userInput },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

/**
 * An ambient turn is requested only after the browser's deterministic Presence
 * Engine selected a concrete event. It uses the existing chat-turn function and
 * does not create a second generation path.
 */
export async function ambientTurn(presenceDecision: PresenceDecision) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('chat-turn', {
    body: { presenceDecision },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function rivalInteraction(interactionHook: PresenceInteraction, presenceDecision: PresenceDecision) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('chat-turn', {
    body: { interactionHook, presenceDecision },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function acceptChallenge(challengeId: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('challenge-action', {
    body: { action: 'accept', challengeId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function startChallenge(challengeId: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('challenge-action', {
    body: { action: 'start', challengeId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function attemptChallenge(challengeId: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('challenge-action', {
    body: { action: 'attempt', challengeId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function declineChallenge(challengeId: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('challenge-action', {
    body: { action: 'decline', challengeId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function submitEvidence(challengeId: string, content: string) {
  const session = await ensureSession();
  const { data, error } = await supabase.functions.invoke('challenge-action', {
    body: { action: 'submit_evidence', challengeId, params: { content } },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (error) throw error;
  return data.data; // { submission, challenge }
}

export async function checkJudgment(challengeId: string) {
  const { data, error } = await supabase.from('judgments').select('*').eq('challenge_id', challengeId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/** A single, post-judgment read of the immutable ledger; this does not call AI. */
export async function getGroundedProcessInsight(challenge: Challenge): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  const events: DomainEvent[] = ((data || []) as EventRow[]).map((event) => ({
    id: event.id,
    userId: event.user_id,
    eventType: event.event_type,
    source: event.source || 'system',
    payload: event.payload,
    createdAt: event.created_at,
  }));
  return deriveProcessInsights(challenge, events)[0]?.description || null;
}

export async function recordProcessCapture(challengeId: string, captureType: 'process_signal' | 'process_thought', opts: { signal?: string; content?: string } = {}) {
  const { error } = await supabase.rpc('record_process_capture', {
    p_challenge_id: challengeId,
    p_capture_type: captureType,
    p_content: opts.content ?? null,
    p_signal: opts.signal ?? null,
    p_artifact_reference: null,
  });
  if (error) throw error;
}
