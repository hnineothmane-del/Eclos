import { supabase } from '../lib/supabase';

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
