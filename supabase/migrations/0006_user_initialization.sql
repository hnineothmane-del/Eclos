-- Migration: 0006_user_initialization.sql

CREATE OR REPLACE FUNCTION public.initialize_user_state(p_user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_subscription_created boolean := false;
BEGIN
    -- Each insert is independently idempotent so a partially initialized user
    -- can safely resume setup after a retry or an older deployment.
    INSERT INTO public.relationship_state (
        user_id, respect, warmth, trust, rivalry, familiarity, curiosity, mode, updated_at
    ) VALUES (
        p_user_id, 0, 0, 0, 0, 0, 0, 'adaptive', now()
    ) ON CONFLICT (user_id) DO NOTHING;

    -- A free user has no external billing-provider identifiers.
    INSERT INTO public.subscriptions (
        user_id, lemon_squeezy_id, customer_id, status, variant_id,
        current_period_ends_at, tier, created_at, updated_at
    ) VALUES (
        p_user_id, NULL, NULL, 'active', NULL, NULL, 'free', now(), now()
    ) ON CONFLICT (user_id) DO NOTHING
    RETURNING true INTO v_subscription_created;

    -- The usage RPC also upserts this row, but an explicit zero bucket keeps
    -- the visible allowance coherent from the first session.
    INSERT INTO public.usage_counters (
        user_id, period, interaction_count, challenge_count, token_count, created_at, updated_at
    ) VALUES (
        p_user_id, CURRENT_DATE, 0, 0, 0, now(), now()
    ) ON CONFLICT (user_id, period) DO NOTHING;

    IF v_subscription_created THEN
        INSERT INTO public.events (user_id, event_type, payload)
        VALUES (p_user_id, 'subscription_created', '{"tier": "free", "source": "system"}'::jsonb);
    END IF;

    RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.initialize_user_state FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_user_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_user_state TO service_role;
