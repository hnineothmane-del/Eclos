-- Migration: 0006_user_initialization.sql

CREATE OR REPLACE FUNCTION public.initialize_user_state(p_user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_exists boolean;
BEGIN
    -- Check if relationship state already exists to prevent duplicate initialization
    SELECT EXISTS (
        SELECT 1 FROM public.relationship_state WHERE user_id = p_user_id
    ) INTO v_exists;

    IF v_exists THEN
        RETURN true; -- Already initialized
    END IF;

    -- Initialize relationship state
    INSERT INTO public.relationship_state (
        user_id, respect, warmth, trust, rivalry, familiarity, curiosity, mode, updated_at
    ) VALUES (
        p_user_id, 0, 0, 0, 0, 0, 0, 'adaptive', now()
    );

    -- Initialize subscription to free tier
    INSERT INTO public.subscriptions (
        user_id, tier, status, current_period_end, created_at, updated_at
    ) VALUES (
        p_user_id, 'free', 'active', now() + interval '100 years', now(), now()
    );

    -- Initialize usage counters (increment_usage_and_check does this via upsert, but safe to initialize)
    INSERT INTO public.usage_counters (
        user_id, interaction_count, challenge_count, reset_at, created_at, updated_at
    ) VALUES (
        p_user_id, 0, 0, now() + interval '1 month', now(), now()
    );

    -- Record initialization event
    INSERT INTO public.events (
        user_id, event_type, payload
    ) VALUES (
        p_user_id, 'subscription_created', '{"message": "User state initialized", "source": "system"}'::jsonb
    );

    RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.initialize_user_state FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_user_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_user_state TO service_role;
