import { supabase } from '../lib/supabase';
import { deriveProcessInsights, type Challenge, type DomainEvent, type PresenceDecision } from '@ai-rival/domain';

interface EventRow {
  id: string;
  user_id: string;
  event_type: DomainEvent['eventType'];
  source?: DomainEvent['source'];
  payload: Record<string, unknown>;
  created_at: string;
}

export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // If no session, create anonymous user
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('Anonymous sign-in not supported or failed, attempting custom flow', error);
      // Fallback or handle differently if anon is disabled
      throw error;
    }
    return data.session;
  }
  return session;
}

export async function chatTurn(userInput: string) {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke('chat-turn', {
    body: { userInput },
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
  await ensureSession();
  const { data, error } = await supabase.functions.invoke('chat-turn', {
    body: { presenceDecision },
  });
  if (error) throw error;
  return data;
}

export async function acceptChallenge(challengeId: string) {
  await ensureSession();
  const { error } = await supabase.rpc('transition_challenge_status', {
    p_challenge_id: challengeId,
    p_new_status: 'accepted',
    p_metadata: {}
  });
  if (error) throw error;
  
  const { error: startError } = await supabase.rpc('transition_challenge_status', {
    p_challenge_id: challengeId,
    p_new_status: 'started',
    p_metadata: {}
  });
  if (startError) throw startError;

  const { error: attemptError } = await supabase.rpc('transition_challenge_status', {
    p_challenge_id: challengeId,
    p_new_status: 'attempted',
    p_metadata: {}
  });
  if (attemptError) throw attemptError;
}

export async function declineChallenge(challengeId: string) {
  await ensureSession();
  // We can just decline by closing or ignoring. 
  // Wait, there's no native "declined" state in V1 challenge lifecycle, maybe 'closed' or 'abandoned'?
  // We'll just transition to 'closed' for now if they decline.
  const { error } = await supabase.rpc('transition_challenge_status', {
    p_challenge_id: challengeId,
    p_new_status: 'closed',
    p_metadata: { reason: 'declined' }
  });
  if (error) throw error;
}

export async function submitEvidence(challengeId: string, content: string) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc('record_evidence_submission', {
    p_challenge_id: challengeId,
    p_user_id: user?.id,
    p_content: content,
    p_kind: 'text',
    p_metadata: {}
  });
  if (error) throw error;
  return data;
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
