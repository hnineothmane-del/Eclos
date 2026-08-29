import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { 
  ResponsePlanner, 
  DefaultModelRouter, 
  SupabaseRelationshipStateStore, 
  SupabaseMemoryStore, 
  SupabaseHumorStateStore, 
  SupabaseEventStore 
} from '@ai-rival/domain';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const activeStatuses = ['accepted', 'started', 'attempted', 'evidence_submitted', 'needs_more_evidence'];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function mapChallenge(row: Record<string, any>) {
  const parameters = row.parameters || {};
  return {
    id: row.id, userId: row.user_id, goalId: row.goal_id, domain: parameters.domain || row.description,
    objective: row.title, difficulty: parameters.difficulty_number || 5, constraints: parameters.constraints || [],
    expectedDurationMinutes: parameters.expected_duration_minutes ?? null, verificationLevel: parameters.verification_level || 'self_report',
    hypothesis: parameters.hypothesis || null, status: row.status, evidenceRound: parameters.evidence_round || 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const cheapModel = Deno.env.get('GEMINI_MODEL_CHEAP') || 'gemini-2.5-flash';
    const strongModel = Deno.env.get('GEMINI_MODEL_STRONG') || 'gemini-2.5-pro';
    const multimodalModel = Deno.env.get('GEMINI_MODEL_MULTIMODAL') || 'gemini-2.5-pro-vision';
    const authHeader = req.headers.get('Authorization');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !geminiApiKey || !authHeader) return json({ error: 'Unauthorized' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    const body = await req.json();
    if (typeof body.userInput !== 'string' || !body.userInput.trim()) return json({ error: 'userInput is required' }, 400);

    const trustedClient = createClient(supabaseUrl, serviceRoleKey);
    
    // Ensure user state is initialized
    await trustedClient.rpc('initialize_user_state', { p_user_id: user.id });

    // The service-role client stays inside this Edge Function and performs trusted writes.
    const { data: usage, error: usageError } = await trustedClient.rpc('increment_usage_and_check', { p_user_id: user.id, p_interaction_delta: 1 });
    if (usageError) throw usageError;
    if (!usage?.allowed) return json({ error: 'Usage limit reached' }, 429);

    const { data: challengeRows, error: challengeError } = await trustedClient
      .from('challenges').select('*').eq('user_id', user.id).in('status', activeStatuses).order('updated_at', { ascending: false }).limit(1);
    if (challengeError) throw challengeError;
    const activeChallenge = challengeRows?.[0] ? mapChallenge(challengeRows[0]) : null;
    const modelRouter = new DefaultModelRouter({ apiKey: geminiApiKey, cheapModel, strongModel, multimodalModel });
    const dbClient = trustedClient as any;
    const planner = new ResponsePlanner({
      modelRouter,
      relationshipStore: new SupabaseRelationshipStateStore(dbClient),
      memoryStore: new SupabaseMemoryStore(dbClient),
      humorStore: new SupabaseHumorStateStore(dbClient),
      eventStore: new SupabaseEventStore(dbClient),
    });
    
    const aiResponse = await planner.planTurn({ userId: user.id, userInput: body.userInput, activeChallenge });

    // Minimal deterministic bridge to support the first-session experience
    if (aiResponse.eventSuggestions && !activeChallenge) {
      for (const event of aiResponse.eventSuggestions) {
        if (event.suggestedEventType === 'challenge_issued' || event.suggestedEventType === 'challenge_request') {
          try {
            const { ChallengeEngine } = await import('@ai-rival/domain');
            const challengeEngine = new ChallengeEngine({
              client: dbClient,
              authenticatedUserId: user.id,
              router: modelRouter
            });
            await challengeEngine.issue(user.id, {
              userId: user.id,
              domain: 'general',
              objective: (event.suggestedPayload?.objective as string) || 'Prove it',
              difficulty: 5
            });
            break;
          } catch (e) {
            console.error('Failed to bridge challenge issue:', e);
          }
        }
      }
    }

    return json({ response: aiResponse.response, intent: aiResponse.intent, mode: aiResponse.register, humorMechanism: aiResponse.humorMechanism });
  } catch (error) {
    console.error('chat-turn failed', error);
    return json({ error: 'Unable to complete chat turn' }, 500);
  }
});
