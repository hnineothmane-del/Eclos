import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { 
  ResponsePlanner, 
  DefaultModelRouter, 
  SupabaseRelationshipStateStore, 
  SupabaseMemoryStore, 
  SupabaseHumorStateStore, 
  SupabaseEventStore,
  type PresenceDecision,
} from '@ai-rival/domain';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const activeStatuses = ['issued', 'negotiated', 'accepted', 'started', 'attempted', 'evidence_submitted', 'needs_more_evidence'];
const ambientEventTypes = new Set(['ambient_observation', 'ambient_comment', 'unexpected_wake', 'sleep_start', 'sleep_end', 'return_greeting', 'idle_reaction', 'session_reentry', 'rare_character_event']);
const interactionHooks = new Set(['tap', 'poke', 'wake', 'user_roast']);

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

function isPresenceDecision(value: unknown): value is { state: string; activity: string; attention: string; action: string | null; reason: string; sourceEventIds: string[]; generatedAt: string } {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Record<string, unknown>;
  return typeof decision.state === 'string'
    && typeof decision.activity === 'string'
    && typeof decision.attention === 'string'
    && (decision.action === null || (typeof decision.action === 'string' && ambientEventTypes.has(decision.action)))
    && typeof decision.reason === 'string'
    && typeof decision.generatedAt === 'string'
    && Array.isArray(decision.sourceEventIds)
    && decision.sourceEventIds.every((id) => typeof id === 'string');
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

    const tAuthStart = performance.now();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      console.warn('Auth failed in chat-turn:', authError?.message);
      return json({ error: 'Unauthorized' }, 401);
    }
    const tAuthEnd = performance.now();

    const body = await req.json();
    const presenceDecision = isPresenceDecision(body.presenceDecision) ? body.presenceDecision : null;
    const ambientDecision = presenceDecision?.action ? presenceDecision : null;
    const interactionHook = typeof body.interactionHook === 'string' && interactionHooks.has(body.interactionHook) ? body.interactionHook : null;
    const userInput = typeof body.userInput === 'string' ? body.userInput.trim() : '';
    if (!userInput && !ambientDecision && !interactionHook) return json({ error: 'userInput, a valid ambient event, or interaction is required' }, 400);

    const trustedClient = createClient(supabaseUrl, serviceRoleKey);
    
    // Ensure user state is initialized
    await trustedClient.rpc('initialize_user_state', { p_user_id: user.id });

    // The service-role client stays inside this Edge Function and performs trusted writes.
    const tUsageStart = performance.now();
    const { data: usage, error: usageError } = await trustedClient.rpc('increment_usage_and_check', { p_user_id: user.id, p_interaction_delta: 1 });
    const tUsageEnd = performance.now();
    
    if (usageError) throw usageError;
    if (!usage?.allowed) {
      return json({
        error: usage?.reason === 'rate_limited' ? 'Please slow down and try again shortly.' : 'You have used today\'s allowance.',
        code: usage?.reason === 'rate_limited' ? 'RATE_LIMITED' : 'USAGE_LIMIT_REACHED',
        entitlement: {
          tier: usage?.tier === 'paid' ? 'paid' : 'free',
          active: Boolean(usage?.active),
          dailyLimit: Number(usage?.daily_limit || 0),
          currentInteractions: Number(usage?.current_interactions || 0),
        },
      }, 429);
    }

    const tChallengeStart = performance.now();
    const { data: challengeRows, error: challengeError } = await trustedClient
      .from('challenges').select('*').eq('user_id', user.id).in('status', activeStatuses).order('updated_at', { ascending: false }).limit(1);
    const tChallengeEnd = performance.now();
    if (challengeError) throw challengeError;
    const activeChallenge = challengeRows?.[0] ? mapChallenge(challengeRows[0]) : null;
    const modelRouter = new DefaultModelRouter({ apiKey: geminiApiKey, cheapModel, strongModel, multimodalModel });
    const dbClient = trustedClient as any;
    const eventStore = new SupabaseEventStore(dbClient);
    const planner = new ResponsePlanner({
      modelRouter,
      relationshipStore: new SupabaseRelationshipStateStore(dbClient),
      memoryStore: new SupabaseMemoryStore(dbClient),
      humorStore: new SupabaseHumorStateStore(dbClient),
      eventStore,
    });
    
    const tPlanStart = performance.now();
    
    // Write chat_message_sent event BEFORE planning the turn so derivation can see it
    let chatEvent: any = null;
    if (userInput && !ambientDecision) {
      try {
        chatEvent = await eventStore.append({
          userId: user.id,
          eventType: 'chat_message_sent',
          source: 'user_action',
          payload: { content: userInput },
        });
      } catch (e) {
        console.error('Failed to append chat_message_sent event:', e);
      }
    }

    const nowIso = chatEvent?.createdAt || new Date().toISOString();

    const aiResponse = ambientDecision
      ? await planner.planAmbientTurn({ userId: user.id, presenceDecision: ambientDecision as PresenceDecision, activeChallenge })
      : await planner.planTurn({ userId: user.id, userInput, activeChallenge, presenceDecision: presenceDecision as PresenceDecision | null, interactionHook: interactionHook as any, nowIso });
    const tPlanEnd = performance.now();

    console.log(`[TIMING] Auth: ${Math.round(tAuthEnd - tAuthStart)}ms, Usage: ${Math.round(tUsageEnd - tUsageStart)}ms, ChallengeLookup: ${Math.round(tChallengeEnd - tChallengeStart)}ms, AI PlanTurn: ${Math.round(tPlanEnd - tPlanStart)}ms, Total (so far): ${Math.round(tPlanEnd - tAuthStart)}ms`);

    // A silent presence result is not a model call and has no UI message.
    if (!aiResponse) return json({ ambient: true, response: null });

    // The selector is deterministic server-side context; AI event suggestions
    // never create challenges.
    let issuedChallenge = null;
    if (!ambientDecision && aiResponse.challengeSelection && !activeChallenge) {
      try {
        const { ChallengeEngine } = await import('@ai-rival/domain');
        const selection = aiResponse.challengeSelection;
        const challengeEngine = new ChallengeEngine({ client: dbClient, authenticatedUserId: user.id, router: modelRouter });
        issuedChallenge = await challengeEngine.issue(user.id, {
          userId: user.id,
          domain: selection.domain,
          objective: selection.objective,
          difficulty: selection.difficulty,
          constraints: selection.constraints,
          expectedDurationMinutes: selection.expectedDurationMinutes,
          verificationLevel: selection.verificationLevel,
          hypothesis: `Selected primitive: ${selection.primitive}`,
          primitive: selection.primitive,
        });
      } catch (e) {
        console.error('Failed to issue deterministic challenge:', e);
      }
    }

    return json({
      response: aiResponse.response,
      intent: aiResponse.intent,
      mode: aiResponse.register,
      humorMechanism: aiResponse.humorMechanism,
      seriousFlag: aiResponse.seriousFlag,
      ambient: !!ambientDecision,
      challenge: issuedChallenge,
      easterEgg: aiResponse.easterEgg?.authorized ? { id: aiResponse.easterEgg.id, visualCue: aiResponse.easterEgg.visualCue } : null,
      entitlement: {
        tier: usage?.tier === 'paid' ? 'paid' : 'free',
        active: Boolean(usage?.active),
        dailyLimit: Number(usage?.daily_limit || 0),
        currentInteractions: Number(usage?.current_interactions || 0),
      },
    });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] chat-turn failed:`, error);
    return json({ 
      error: 'Unable to complete chat turn',
      correlationId
    }, 500);
  }
});
