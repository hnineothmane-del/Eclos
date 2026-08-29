import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ResponsePlanner } from '../../../packages/domain/src/engine/responsePlanner.js';
import { DefaultModelRouter } from '../../../packages/domain/src/ai/router.js';
import { 
  SupabaseRelationshipStateStore,
  SupabaseMemoryStore,
  SupabaseHumorStateStore,
  SupabaseEventStore
} from '../../../packages/domain/src/store/index.js';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await req.json();
    const { userInput, activeChallenge } = body;

    if (!userInput) {
      return new Response(JSON.stringify({ error: 'userInput is required' }), { status: 400 });
    }

    // Initialize dependencies
    const modelRouter = new DefaultModelRouter({
      apiKey: Deno.env.get('GEMINI_API_KEY'),
    });
    
    // We cast supabase to any because SupabaseClientLike interface might have minor mismatches with esm.sh version in types, but it is structurally compatible at runtime.
    const dbClient = supabase as any;

    const relationshipStore = new SupabaseRelationshipStateStore(dbClient);
    const memoryStore = new SupabaseMemoryStore(dbClient);
    const humorStore = new SupabaseHumorStateStore(dbClient);
    const eventStore = new SupabaseEventStore(dbClient);

    const planner = new ResponsePlanner({
      modelRouter,
      relationshipStore,
      memoryStore,
      humorStore,
      eventStore
    });

    const aiResponse = await planner.planTurn({
      userId: user.id,
      userInput,
      activeChallenge
    });

    // Return response and minimal state
    return new Response(
      JSON.stringify({
        response: aiResponse.response,
        intent: aiResponse.intent,
        mode: aiResponse.register, // Assuming register maps to mode/tone roughly in UI if needed
        humorMechanism: aiResponse.humorMechanism
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );

  } catch (error: any) {
    console.error('Error in chat-turn function:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
