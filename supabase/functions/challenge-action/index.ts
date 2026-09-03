import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ChallengeEngine } from '@ai-rival/domain';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) return json({ error: 'Unauthorized' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const { action, challengeId, params } = body;
    if (!action || !challengeId || typeof action !== 'string' || typeof challengeId !== 'string') {
      return json({ error: 'action and challengeId are required' }, 400);
    }

    const trustedClient = createClient(supabaseUrl, serviceRoleKey);
    const dbClient = trustedClient as any;
    
    // We instantiate ChallengeEngine but we don't strictly need AI for transitions,
    // so we pass the trusted client and authenticated user.
    const engine = new ChallengeEngine({ client: dbClient, authenticatedUserId: user.id });

    let result;
    switch (action) {
      case 'accept':
        result = await engine.accept(challengeId, user.id);
        break;
      case 'start':
        result = await engine.start(challengeId, user.id);
        break;
      case 'attempt':
        result = await engine.attempt(challengeId, user.id);
        break;
      case 'submit_evidence':
        result = await engine.submitEvidence(challengeId, {
          userId: user.id,
          content: params?.content || '',
          kind: params?.kind || 'text',
          metadata: params?.metadata || {}
        });
        break;
      case 'decline':
      case 'abandon':
        result = await engine.close(challengeId, user.id);
        break;
      default:
        return json({ error: `Unsupported action: ${action}` }, 400);
    }

    return json({ data: result });
  } catch (error: any) {
    console.error('Challenge action error:', error);
    return json({ 
      error: error.message || 'Internal server error',
      details: error.stack
    }, 500);
  }
});
