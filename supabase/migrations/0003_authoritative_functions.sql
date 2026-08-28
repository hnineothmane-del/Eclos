-- ============================================================================
-- Migration: 0003_authoritative_functions.sql
-- Description: Authoritative transactional RPC functions enforcing domain invariants
-- ============================================================================

-- ============================================================================
-- 1. append_event_and_apply_delta
-- Appends an event and atomically applies relationship deltas (clamped 0-100)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.append_event_and_apply_delta(
    p_user_id UUID,
    p_event_type TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_respect_delta INT DEFAULT 0,
    p_warmth_delta INT DEFAULT 0,
    p_trust_delta INT DEFAULT 0,
    p_rivalry_delta INT DEFAULT 0,
    p_familiarity_delta INT DEFAULT 0,
    p_curiosity_delta INT DEFAULT 0,
    p_mode TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
BEGIN
    -- 1. Insert immutable event
    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (p_user_id, p_event_type, p_payload)
    RETURNING id INTO v_event_id;

    -- 2. Atomically upsert/update relationship state with clamping
    INSERT INTO public.relationship_state (
        user_id, respect, warmth, trust, rivalry, familiarity, curiosity, mode, updated_at
    ) VALUES (
        p_user_id,
        GREATEST(0, LEAST(100, 50 + p_respect_delta)),
        GREATEST(0, LEAST(100, 50 + p_warmth_delta)),
        GREATEST(0, LEAST(100, 50 + p_trust_delta)),
        GREATEST(0, LEAST(100, 50 + p_rivalry_delta)),
        GREATEST(0, LEAST(100, 0 + p_familiarity_delta)),
        GREATEST(0, LEAST(100, 50 + p_curiosity_delta)),
        COALESCE(p_mode, 'observing'),
        now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        respect = GREATEST(0, LEAST(100, public.relationship_state.respect + p_respect_delta)),
        warmth = GREATEST(0, LEAST(100, public.relationship_state.warmth + p_warmth_delta)),
        trust = GREATEST(0, LEAST(100, public.relationship_state.trust + p_trust_delta)),
        rivalry = GREATEST(0, LEAST(100, public.relationship_state.rivalry + p_rivalry_delta)),
        familiarity = GREATEST(0, LEAST(100, public.relationship_state.familiarity + p_familiarity_delta)),
        curiosity = GREATEST(0, LEAST(100, public.relationship_state.curiosity + p_curiosity_delta)),
        mode = COALESCE(p_mode, public.relationship_state.mode),
        updated_at = now();

    RETURN v_event_id;
END;
$$;

-- ============================================================================
-- 2. transition_challenge_status
-- Validates lifecycle state transitions and records transition event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transition_challenge_status(
    p_challenge_id UUID,
    p_new_status TEXT,
    p_user_id UUID,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_status TEXT;
    v_challenge_user_id UUID;
    v_updated_record JSONB;
BEGIN
    SELECT user_id, status INTO v_challenge_user_id, v_current_status
    FROM public.challenges
    WHERE id = p_challenge_id;

    IF v_challenge_user_id IS NULL THEN
        RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
    END IF;

    IF v_challenge_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: challenge does not belong to user';
    END IF;

    -- Validate lifecycle transitions:
    -- issued -> negotiated | accepted | closed
    -- negotiated -> accepted | closed
    -- accepted -> started | closed
    -- started -> attempted | evidence_submitted | closed
    -- attempted -> evidence_submitted | closed
    -- evidence_submitted -> needs_more_evidence | judged | closed
    -- needs_more_evidence -> evidence_submitted | closed
    -- judged -> closed
    -- closed -> terminal
    IF NOT (
        (v_current_status = 'issued' AND p_new_status IN ('negotiated', 'accepted', 'closed')) OR
        (v_current_status = 'negotiated' AND p_new_status IN ('accepted', 'closed')) OR
        (v_current_status = 'accepted' AND p_new_status IN ('started', 'closed')) OR
        (v_current_status = 'started' AND p_new_status IN ('attempted', 'evidence_submitted', 'closed')) OR
        (v_current_status = 'attempted' AND p_new_status IN ('evidence_submitted', 'closed')) OR
        (v_current_status = 'evidence_submitted' AND p_new_status IN ('needs_more_evidence', 'judged', 'closed')) OR
        (v_current_status = 'needs_more_evidence' AND p_new_status IN ('evidence_submitted', 'closed')) OR
        (v_current_status = 'judged' AND p_new_status = 'closed')
    ) THEN
        RAISE EXCEPTION 'Invalid challenge status transition from % to %', v_current_status, p_new_status;
    END IF;

    -- Update challenge status
    UPDATE public.challenges
    SET status = p_new_status, updated_at = now()
    WHERE id = p_challenge_id;

    -- Append transition event
    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        CASE
            WHEN p_new_status = 'accepted' THEN 'challenge_accepted'
            WHEN p_new_status = 'negotiated' THEN 'challenge_negotiated'
            WHEN p_new_status = 'started' THEN 'challenge_started'
            WHEN p_new_status = 'attempted' THEN 'challenge_attempted'
            WHEN p_new_status = 'closed' THEN 'challenge_closed'
            ELSE 'challenge_issued'
        END,
        jsonb_build_object(
            'challenge_id', p_challenge_id,
            'previous_status', v_current_status,
            'new_status', p_new_status,
            'metadata', p_metadata
        )
    );

    SELECT to_jsonb(c.*) INTO v_updated_record
    FROM public.challenges c
    WHERE c.id = p_challenge_id;

    RETURN v_updated_record;
END;
$$;

-- ============================================================================
-- 3. record_evidence_submission
-- Enforces challenge.user_id = p_user_id, round increments, and submittable status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_evidence_submission(
    p_challenge_id UUID,
    p_user_id UUID,
    p_content TEXT,
    p_kind TEXT DEFAULT 'text',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenge_user_id UUID;
    v_challenge_status TEXT;
    v_round INT;
    v_submission_id UUID;
BEGIN
    -- Query challenge and check existence
    SELECT user_id, status INTO v_challenge_user_id, v_challenge_status
    FROM public.challenges
    WHERE id = p_challenge_id;

    IF v_challenge_user_id IS NULL THEN
        RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
    END IF;

    -- REQUIRED CORRECTION 1: Verify challenge.user_id === p_user_id internally
    IF v_challenge_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: challenge does not belong to user';
    END IF;

    -- Check submittable lifecycle states
    IF v_challenge_status NOT IN ('started', 'attempted', 'evidence_submitted', 'needs_more_evidence') THEN
        RAISE EXCEPTION 'Challenge is not in a submittable state (current status: %)', v_challenge_status;
    END IF;

    -- Calculate next round number
    SELECT COALESCE(MAX(round), 0) + 1 INTO v_round
    FROM public.evidence_submissions
    WHERE challenge_id = p_challenge_id;

    -- Insert submission
    INSERT INTO public.evidence_submissions (
        challenge_id, user_id, round, kind, content, metadata
    ) VALUES (
        p_challenge_id, p_user_id, v_round, p_kind, p_content, p_metadata
    )
    RETURNING id INTO v_submission_id;

    -- Update challenge status
    UPDATE public.challenges
    SET status = 'evidence_submitted', updated_at = now()
    WHERE id = p_challenge_id;

    -- Append evidence_submitted event
    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        'evidence_submitted',
        jsonb_build_object(
            'challenge_id', p_challenge_id,
            'evidence_submission_id', v_submission_id,
            'round', v_round,
            'kind', p_kind
        )
    );

    RETURN v_submission_id;
END;
$$;

-- ============================================================================
-- 4. judge_challenge
-- Evaluates evidence submission, preserves traceability chain, updates relationship
-- ============================================================================
CREATE OR REPLACE FUNCTION public.judge_challenge(
    p_challenge_id UUID,
    p_evidence_submission_id UUID,
    p_user_id UUID,
    p_verdict TEXT,
    p_feedback TEXT,
    p_score INT DEFAULT NULL,
    p_respect_delta INT DEFAULT 0,
    p_warmth_delta INT DEFAULT 0,
    p_trust_delta INT DEFAULT 0,
    p_rivalry_delta INT DEFAULT 0,
    p_familiarity_delta INT DEFAULT 0,
    p_curiosity_delta INT DEFAULT 0,
    p_observation_category TEXT DEFAULT NULL,
    p_observation_text TEXT DEFAULT NULL,
    p_observation_valence TEXT DEFAULT 'neutral',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ch_user UUID;
    v_sub_user UUID;
    v_judgment_id UUID;
    v_new_challenge_status TEXT;
    v_obs_id UUID := NULL;
    v_rel_state JSONB;
    v_event_id UUID;
BEGIN
    -- Verify challenge ownership
    SELECT user_id INTO v_ch_user
    FROM public.challenges
    WHERE id = p_challenge_id;

    IF v_ch_user IS NULL OR v_ch_user <> p_user_id THEN
        RAISE EXCEPTION 'Challenge not found or unauthorized';
    END IF;

    -- Verify evidence submission matches challenge and user
    SELECT user_id INTO v_sub_user
    FROM public.evidence_submissions
    WHERE id = p_evidence_submission_id AND challenge_id = p_challenge_id;

    IF v_sub_user IS NULL OR v_sub_user <> p_user_id THEN
        RAISE EXCEPTION 'Evidence submission not found or does not belong to specified challenge/user';
    END IF;

    -- Validate verdict
    IF p_verdict NOT IN ('passed', 'failed', 'needs_more_evidence') THEN
        RAISE EXCEPTION 'Invalid verdict: %', p_verdict;
    END IF;

    -- 1. Insert judgment
    INSERT INTO public.judgments (
        challenge_id, evidence_submission_id, user_id, verdict, feedback, score, metadata
    ) VALUES (
        p_challenge_id, p_evidence_submission_id, p_user_id, p_verdict, p_feedback, p_score, p_metadata
    )
    RETURNING id INTO v_judgment_id;

    -- 2. Update challenge status
    v_new_challenge_status := CASE
        WHEN p_verdict IN ('passed', 'failed') THEN 'judged'
        ELSE 'needs_more_evidence'
    END;

    UPDATE public.challenges
    SET status = v_new_challenge_status, updated_at = now()
    WHERE id = p_challenge_id;

    -- 3. Insert capability observation if provided
    IF p_observation_category IS NOT NULL AND p_observation_text IS NOT NULL THEN
        INSERT INTO public.capability_observations (
            user_id, category, observation, valence, evidence
        ) VALUES (
            p_user_id,
            p_observation_category,
            p_observation_text,
            p_observation_valence,
            jsonb_build_object(
                'challenge_id', p_challenge_id,
                'evidence_submission_id', p_evidence_submission_id,
                'judgment_id', v_judgment_id
            )
        )
        RETURNING id INTO v_obs_id;
    END IF;

    -- 4. Apply authoritative relationship state deltas (clamped 0-100)
    INSERT INTO public.relationship_state (
        user_id, respect, warmth, trust, rivalry, familiarity, curiosity, updated_at
    ) VALUES (
        p_user_id,
        GREATEST(0, LEAST(100, 50 + p_respect_delta)),
        GREATEST(0, LEAST(100, 50 + p_warmth_delta)),
        GREATEST(0, LEAST(100, 50 + p_trust_delta)),
        GREATEST(0, LEAST(100, 50 + p_rivalry_delta)),
        GREATEST(0, LEAST(100, 0 + p_familiarity_delta)),
        GREATEST(0, LEAST(100, 50 + p_curiosity_delta)),
        now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        respect = GREATEST(0, LEAST(100, public.relationship_state.respect + p_respect_delta)),
        warmth = GREATEST(0, LEAST(100, public.relationship_state.warmth + p_warmth_delta)),
        trust = GREATEST(0, LEAST(100, public.relationship_state.trust + p_trust_delta)),
        rivalry = GREATEST(0, LEAST(100, public.relationship_state.rivalry + p_rivalry_delta)),
        familiarity = GREATEST(0, LEAST(100, public.relationship_state.familiarity + p_familiarity_delta)),
        curiosity = GREATEST(0, LEAST(100, public.relationship_state.curiosity + p_curiosity_delta)),
        updated_at = now()
    RETURNING jsonb_build_object(
        'respect', respect,
        'warmth', warmth,
        'trust', trust,
        'rivalry', rivalry,
        'familiarity', familiarity,
        'curiosity', curiosity,
        'mode', mode
    ) INTO v_rel_state;

    -- 5. REQUIRED CORRECTION 3: Event traceability chain
    -- evidence_submission -> judgment -> event -> relationship state change
    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        'challenge_judged',
        jsonb_build_object(
            'evidence_submission_id', p_evidence_submission_id,
            'judgment_id', v_judgment_id,
            'challenge_id', p_challenge_id,
            'verdict', p_verdict,
            'score', p_score,
            'deltas', jsonb_build_object(
                'respect', p_respect_delta,
                'warmth', p_warmth_delta,
                'trust', p_trust_delta,
                'rivalry', p_rivalry_delta,
                'familiarity', p_familiarity_delta,
                'curiosity', p_curiosity_delta
            ),
            'resulting_relationship_state', v_rel_state,
            'observation_id', v_obs_id
        )
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
        'judgment_id', v_judgment_id,
        'challenge_id', p_challenge_id,
        'evidence_submission_id', p_evidence_submission_id,
        'event_id', v_event_id,
        'challenge_status', v_new_challenge_status,
        'relationship_state', v_rel_state,
        'observation_id', v_obs_id
    );
END;
$$;

-- ============================================================================
-- 5. process_billing_webhook
-- Lemon Squeezy idempotent webhook ingestion and subscription synchronization
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_billing_webhook(
    p_event_id TEXT,
    p_event_name TEXT,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_status TEXT;
    v_user_id UUID;
    v_ls_id TEXT;
    v_customer_id TEXT;
    v_sub_status TEXT;
    v_variant_id TEXT;
    v_ends_at TIMESTAMPTZ;
BEGIN
    -- Check idempotency
    SELECT status INTO v_existing_status
    FROM public.webhook_events
    WHERE event_id = p_event_id;

    IF v_existing_status = 'processed' THEN
        RETURN jsonb_build_object('status', 'already_processed', 'event_id', p_event_id);
    END IF;

    -- Record pending webhook
    INSERT INTO public.webhook_events (event_id, event_name, payload, status)
    VALUES (p_event_id, p_event_name, p_payload, 'pending')
    ON CONFLICT (event_id) DO NOTHING;

    -- Extract attributes
    v_user_id := COALESCE(
        (p_payload->'custom_data'->>'user_id')::uuid,
        (p_payload->'data'->'attributes'->'custom_data'->>'user_id')::uuid,
        (p_payload->'meta'->'custom_data'->>'user_id')::uuid
    );

    v_ls_id := COALESCE(
        p_payload->>'lemon_squeezy_id',
        p_payload->'data'->>'id',
        p_payload->>'subscription_id'
    );

    v_customer_id := COALESCE(
        p_payload->>'customer_id',
        p_payload->'data'->'attributes'->>'customer_id',
        'unknown'
    );

    v_sub_status := COALESCE(
        p_payload->>'status',
        p_payload->'data'->'attributes'->>'status'
    );

    v_variant_id := COALESCE(
        p_payload->>'variant_id',
        p_payload->'data'->'attributes'->>'variant_id',
        'default'
    );

    IF (p_payload->>'current_period_ends_at') IS NOT NULL THEN
        v_ends_at := (p_payload->>'current_period_ends_at')::timestamptz;
    ELSIF (p_payload->'data'->'attributes'->>'renews_at') IS NOT NULL THEN
        v_ends_at := (p_payload->'data'->'attributes'->>'renews_at')::timestamptz;
    ELSIF (p_payload->'data'->'attributes'->>'ends_at') IS NOT NULL THEN
        v_ends_at := (p_payload->'data'->'attributes'->>'ends_at')::timestamptz;
    END IF;

    -- Synchronize subscription if user and subscription status are available
    IF v_user_id IS NOT NULL AND v_sub_status IS NOT NULL AND v_ls_id IS NOT NULL THEN
        INSERT INTO public.subscriptions (
            user_id, lemon_squeezy_id, customer_id, status, variant_id, current_period_ends_at, updated_at
        ) VALUES (
            v_user_id, v_ls_id, v_customer_id, v_sub_status, v_variant_id, v_ends_at, now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            lemon_squeezy_id = EXCLUDED.lemon_squeezy_id,
            customer_id = EXCLUDED.customer_id,
            status = EXCLUDED.status,
            variant_id = EXCLUDED.variant_id,
            current_period_ends_at = EXCLUDED.current_period_ends_at,
            updated_at = now();

        INSERT INTO public.events (user_id, event_type, payload)
        VALUES (
            v_user_id,
            'billing_webhook_processed',
            jsonb_build_object(
                'event_id', p_event_id,
                'event_name', p_event_name,
                'subscription_id', v_ls_id,
                'status', v_sub_status
            )
        );
    END IF;

    -- Mark webhook event processed
    UPDATE public.webhook_events
    SET status = 'processed', processed_at = now()
    WHERE event_id = p_event_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'event_id', p_event_id,
        'user_id', v_user_id,
        'subscription_status', v_sub_status
    );
END;
$$;

-- ============================================================================
-- 6. increment_usage_and_check
-- Atomically increments usage bucket for (user_id, period) and checks daily limit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_usage_and_check(
    p_user_id UUID,
    p_interaction_delta INT DEFAULT 1,
    p_challenge_delta INT DEFAULT 0,
    p_token_delta INT DEFAULT 0,
    p_daily_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_interaction_cnt INT;
    v_challenge_cnt INT;
    v_token_cnt INT;
    v_allowed BOOLEAN;
BEGIN
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
    RETURNING interaction_count, challenge_count, token_count
    INTO v_interaction_cnt, v_challenge_cnt, v_token_cnt;

    v_allowed := (v_interaction_cnt <= p_daily_limit);

    -- Log usage event if needed
    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        'usage_incremented',
        jsonb_build_object(
            'period', CURRENT_DATE,
            'interaction_count', v_interaction_cnt,
            'allowed', v_allowed
        )
    );

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'current_interactions', v_interaction_cnt,
        'current_challenges', v_challenge_cnt,
        'current_tokens', v_token_cnt,
        'daily_limit', p_daily_limit,
        'period', CURRENT_DATE
    );
END;
$$;

-- ============================================================================
-- 7. RPC Permissions and Execution Grants
-- ============================================================================
-- Revoke all function executions from public and anon
REVOKE EXECUTE ON FUNCTION public.append_event_and_apply_delta FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_challenge_status FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_evidence_submission FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.judge_challenge FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_billing_webhook FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_usage_and_check FROM PUBLIC, anon;

-- Grant execution to authenticated for client-invokable RPCs
GRANT EXECUTE ON FUNCTION public.record_evidence_submission TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_challenge_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_and_check TO authenticated;

-- Grant execution to service_role for all authoritative and administrative RPCs
GRANT EXECUTE ON FUNCTION public.append_event_and_apply_delta TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_challenge_status TO service_role;
GRANT EXECUTE ON FUNCTION public.record_evidence_submission TO service_role;
GRANT EXECUTE ON FUNCTION public.judge_challenge TO service_role;
GRANT EXECUTE ON FUNCTION public.process_billing_webhook TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage_and_check TO service_role;
