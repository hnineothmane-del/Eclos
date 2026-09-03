-- ============================================================================
-- Migration: 0009_entitlements.sql
-- Description: Minimal provider-agnostic access tiers and server-only usage.
-- ============================================================================

-- Existing installations may have the original provider-first columns. Free
-- users intentionally have no provider IDs, while paid rows retain them.
ALTER TABLE public.subscriptions
    ALTER COLUMN lemon_squeezy_id DROP NOT NULL,
    ALTER COLUMN customer_id DROP NOT NULL,
    ALTER COLUMN variant_id DROP NOT NULL;

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'paid'));

-- Provider webhook synchronization already owns subscription writes. This
-- trigger makes its resulting entitlement explicit without coupling product
-- code to Lemon Squeezy (or any future provider) identifiers.
CREATE OR REPLACE FUNCTION public.derive_subscription_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.tier := CASE
        WHEN NEW.lemon_squeezy_id IS NOT NULL
         AND NEW.status IN ('active', 'on_trial')
         AND (NEW.current_period_ends_at IS NULL OR NEW.current_period_ends_at > now())
        THEN 'paid'
        ELSE 'free'
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_subscription_tier ON public.subscriptions;
CREATE TRIGGER trg_derive_subscription_tier
    BEFORE INSERT OR UPDATE OF lemon_squeezy_id, status, current_period_ends_at
    ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.derive_subscription_tier();

-- Bring existing provider-backed active rows into alignment during rollout.
UPDATE public.subscriptions
   SET tier = CASE
       WHEN lemon_squeezy_id IS NOT NULL
        AND status IN ('active', 'on_trial')
        AND (current_period_ends_at IS NULL OR current_period_ends_at > now())
       THEN 'paid'
       ELSE 'free'
   END;

-- Replaces the old initializer for already-migrated projects. It is safe after
-- partial setup and creates a free entitlement without provider IDs.
CREATE OR REPLACE FUNCTION public.initialize_user_state(p_user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_subscription_created boolean := false;
BEGIN
    INSERT INTO public.relationship_state (
        user_id, respect, warmth, trust, rivalry, familiarity, curiosity, mode, updated_at
    ) VALUES (
        p_user_id, 0, 0, 0, 0, 0, 0, 'adaptive', now()
    ) ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.subscriptions (
        user_id, lemon_squeezy_id, customer_id, status, variant_id,
        current_period_ends_at, tier, created_at, updated_at
    ) VALUES (
        p_user_id, NULL, NULL, 'active', NULL, NULL, 'free', now(), now()
    ) ON CONFLICT (user_id) DO NOTHING
    RETURNING true INTO v_subscription_created;

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

-- The function deliberately keeps its historic signature for compatibility,
-- but the caller-supplied limit is ignored. Limits come only from the user's
-- authoritative subscription record.
CREATE OR REPLACE FUNCTION public.increment_usage_and_check(
    p_user_id UUID,
    p_interaction_delta INT DEFAULT 1,
    p_challenge_delta INT DEFAULT 0,
    p_token_delta INT DEFAULT 0,
    p_daily_limit INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tier TEXT := 'free';
    v_active BOOLEAN := false;
    v_daily_limit INT;
    v_requests_per_minute INT;
    v_interaction_cnt INT;
    v_challenge_cnt INT;
    v_token_cnt INT;
    v_recent_requests INT;
    v_allowed BOOLEAN := false;
BEGIN
    IF p_user_id IS NULL
       OR p_interaction_delta < 0 OR p_interaction_delta > 1
       OR p_challenge_delta < 0 OR p_token_delta < 0 THEN
        RAISE EXCEPTION 'Invalid usage increment';
    END IF;

    -- Serialize a user's usage check so concurrent Edge invocations cannot
    -- both pass the same rate/daily allowance window.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    SELECT
        CASE
            WHEN tier = 'paid'
             AND status IN ('active', 'on_trial')
             AND (current_period_ends_at IS NULL OR current_period_ends_at > now())
            THEN 'paid'
            ELSE 'free'
        END,
        status IN ('active', 'on_trial')
          AND (current_period_ends_at IS NULL OR current_period_ends_at > now())
      INTO v_tier, v_active
      FROM public.subscriptions
     WHERE user_id = p_user_id;

    v_tier := COALESCE(v_tier, 'free');
    -- An expired paid plan falls back to active free access; history is never
    -- removed or made inaccessible by an entitlement transition.
    v_active := true;
    v_daily_limit := CASE WHEN v_tier = 'paid' THEN 200 ELSE 20 END;
    v_requests_per_minute := CASE WHEN v_tier = 'paid' THEN 30 ELSE 10 END;

    SELECT count(*) INTO v_recent_requests
      FROM public.events
     WHERE user_id = p_user_id
       AND event_type = 'usage_incremented'
       AND created_at >= now() - interval '1 minute';

    IF v_recent_requests >= v_requests_per_minute THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'rate_limited',
            'tier', v_tier,
            'active', v_active,
            'daily_limit', v_daily_limit,
            'requests_per_minute', v_requests_per_minute,
            'period', CURRENT_DATE
        );
    END IF;

    INSERT INTO public.usage_counters (
        user_id, period, interaction_count, challenge_count, token_count, updated_at
    ) VALUES (
        p_user_id, CURRENT_DATE, p_interaction_delta, p_challenge_delta, p_token_delta, now()
    )
    ON CONFLICT (user_id, period) DO UPDATE SET
        interaction_count = public.usage_counters.interaction_count + p_interaction_delta,
        challenge_count = public.usage_counters.challenge_count + p_challenge_delta,
        token_count = public.usage_counters.token_count + p_token_delta,
        updated_at = now()
    WHERE public.usage_counters.interaction_count + p_interaction_delta <= v_daily_limit
    RETURNING interaction_count, challenge_count, token_count
      INTO v_interaction_cnt, v_challenge_cnt, v_token_cnt;

    IF FOUND THEN
        v_allowed := true;
        INSERT INTO public.events (user_id, event_type, payload)
        VALUES (
            p_user_id,
            'usage_incremented',
            jsonb_build_object(
                'period', CURRENT_DATE,
                'interaction_count', v_interaction_cnt,
                'tier', v_tier,
                'daily_limit', v_daily_limit
            )
        );
    ELSE
        SELECT interaction_count, challenge_count, token_count
          INTO v_interaction_cnt, v_challenge_cnt, v_token_cnt
          FROM public.usage_counters
         WHERE user_id = p_user_id AND period = CURRENT_DATE;
    END IF;

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'reason', CASE WHEN v_allowed THEN NULL ELSE 'daily_limit_reached' END,
        'tier', v_tier,
        'active', v_active,
        'current_interactions', COALESCE(v_interaction_cnt, 0),
        'current_challenges', COALESCE(v_challenge_cnt, 0),
        'current_tokens', COALESCE(v_token_cnt, 0),
        'daily_limit', v_daily_limit,
        'requests_per_minute', v_requests_per_minute,
        'period', CURRENT_DATE
    );
END;
$$;

-- Usage is an Edge/server concern. Removing the authenticated grant prevents
-- clients from self-selecting a high limit or charging another user's bucket.
REVOKE EXECUTE ON FUNCTION public.increment_usage_and_check(UUID, INT, INT, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_and_check(UUID, INT, INT, INT, INT)
    TO service_role;
REVOKE EXECUTE ON FUNCTION public.initialize_user_state(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_user_state(UUID) TO service_role;
