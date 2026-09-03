-- ============================================================================
-- Migration: 0011_authorization_and_lifecycle_fixes.sql
-- Description: Phase 1 Foundation Restoration: authorization, locking, and lifecycle event fixes
-- ============================================================================

-- 1. transition_challenge_status
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
    -- Authorization guard
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    SELECT user_id, status INTO v_challenge_user_id, v_current_status
    FROM public.challenges
    WHERE id = p_challenge_id FOR UPDATE;

    IF v_challenge_user_id IS NULL THEN
        RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
    END IF;

    IF v_challenge_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: challenge does not belong to user';
    END IF;

    -- Validate lifecycle transitions:
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

    UPDATE public.challenges
    SET status = p_new_status, updated_at = now()
    WHERE id = p_challenge_id;

    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        CASE
            WHEN p_new_status = 'accepted' THEN 'challenge_accepted'
            WHEN p_new_status = 'negotiated' THEN 'challenge_negotiated'
            WHEN p_new_status = 'started' THEN 'challenge_started'
            WHEN p_new_status = 'attempted' THEN 'challenge_attempted'
            WHEN p_new_status = 'closed' THEN 'challenge_closed'
            WHEN p_new_status = 'evidence_submitted' THEN 'evidence_submitted'
            WHEN p_new_status = 'needs_more_evidence' THEN 'needs_more_evidence'
            WHEN p_new_status = 'judged' THEN 'challenge_judged'
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

-- 2. record_evidence_submission
CREATE OR REPLACE FUNCTION public.record_evidence_submission(
    p_challenge_id UUID,
    p_user_id UUID,
    p_content TEXT,
    p_kind TEXT DEFAULT 'text',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
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
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    SELECT user_id, status INTO v_challenge_user_id, v_challenge_status
    FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;

    IF v_challenge_user_id IS NULL OR v_challenge_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Challenge not found or unauthorized';
    END IF;

    IF v_challenge_status NOT IN ('started', 'attempted', 'evidence_submitted', 'needs_more_evidence') THEN
        RAISE EXCEPTION 'Challenge is not in a submittable state (current status: %)', v_challenge_status;
    END IF;

    SELECT COALESCE(MAX(round), 0) + 1 INTO v_round
    FROM public.evidence_submissions WHERE challenge_id = p_challenge_id;

    INSERT INTO public.evidence_submissions (challenge_id, user_id, round, kind, content, metadata)
    VALUES (p_challenge_id, p_user_id, v_round, p_kind, p_content, p_metadata)
    RETURNING id INTO v_submission_id;

    UPDATE public.challenges SET status = 'evidence_submitted', updated_at = now()
    WHERE id = p_challenge_id;

    INSERT INTO public.events (user_id, event_type, payload) VALUES (
        p_user_id, 'evidence_submitted',
        jsonb_build_object('challenge_id', p_challenge_id, 'evidence_submission_id', v_submission_id, 'round', v_round, 'kind', p_kind)
    );

    -- Align with TypeScript EvidenceSubmission contract
    RETURN jsonb_build_object(
        'id', v_submission_id,
        'challengeId', p_challenge_id,
        'userId', p_user_id,
        'round', v_round,
        'kind', p_kind,
        'content', p_content,
        'metadata', p_metadata,
        'submittedAt', now()
    );
END;
$$;

-- 3. transition_challenge_negotiation
CREATE OR REPLACE FUNCTION public.transition_challenge_negotiation(
    p_challenge_id UUID,
    p_user_id UUID,
    p_objective TEXT,
    p_difficulty TEXT,
    p_difficulty_number INT,
    p_constraints JSONB,
    p_expected_duration_minutes INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenge public.challenges;
    v_updated JSONB;
BEGIN
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;

    IF v_challenge.id IS NULL OR v_challenge.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Challenge not found or unauthorized';
    END IF;

    IF v_challenge.status NOT IN ('issued', 'negotiated') THEN
        RAISE EXCEPTION 'Invalid challenge status transition from % to negotiated', v_challenge.status;
    END IF;

    IF p_difficulty NOT IN ('trivial', 'easy', 'medium', 'hard', 'brutal') OR p_difficulty_number NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'Invalid challenge difficulty';
    END IF;

    UPDATE public.challenges AS c SET
        title = p_objective,
        difficulty = p_difficulty,
        status = 'negotiated',
        parameters = jsonb_set(
          jsonb_set(
            jsonb_set(parameters, '{difficulty_number}', to_jsonb(p_difficulty_number), true),
            '{constraints}', COALESCE(p_constraints, '[]'::jsonb), true),
          '{expected_duration_minutes}', to_jsonb(p_expected_duration_minutes), true),
        updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING to_jsonb(c.*) INTO v_updated;

    INSERT INTO public.events (user_id, event_type, payload) VALUES (
        p_user_id, 'challenge_negotiated',
        jsonb_build_object('challenge_id', p_challenge_id, 'previous_status', v_challenge.status,
          'objective', p_objective, 'difficulty', p_difficulty_number,
          'constraints', COALESCE(p_constraints, '[]'::jsonb),
          'expected_duration_minutes', p_expected_duration_minutes)
    );

    RETURN v_updated;
END;
$$;

-- 4. judge_challenge
CREATE OR REPLACE FUNCTION public.judge_challenge(
    p_challenge_id UUID, p_evidence_submission_id UUID, p_user_id UUID, p_verdict TEXT,
    p_feedback TEXT, p_score INT DEFAULT NULL, p_respect_delta INT DEFAULT 0,
    p_warmth_delta INT DEFAULT 0, p_trust_delta INT DEFAULT 0, p_rivalry_delta INT DEFAULT 0,
    p_familiarity_delta INT DEFAULT 0, p_curiosity_delta INT DEFAULT 0,
    p_observation_category TEXT DEFAULT NULL, p_observation_text TEXT DEFAULT NULL,
    p_observation_valence TEXT DEFAULT 'neutral', p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_challenge public.challenges;
    v_submission public.evidence_submissions;
    v_judgment_id UUID;
    v_status TEXT;
    v_observation_id UUID := NULL;
    v_relationship JSONB;
    v_event_id UUID;
    v_existing_judgment_id UUID;
BEGIN
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
    IF v_challenge.id IS NULL OR v_challenge.user_id <> p_user_id THEN RAISE EXCEPTION 'Challenge not found or unauthorized'; END IF;
    IF v_challenge.status <> 'evidence_submitted' THEN RAISE EXCEPTION 'Challenge must be in evidence_submitted state to be judged'; END IF;

    SELECT * INTO v_submission FROM public.evidence_submissions
    WHERE id = p_evidence_submission_id AND challenge_id = p_challenge_id FOR UPDATE;
    IF v_submission.id IS NULL OR v_submission.user_id <> p_user_id THEN RAISE EXCEPTION 'Evidence submission not found or does not belong to specified challenge/user'; END IF;

    IF p_verdict NOT IN ('passed', 'failed', 'needs_more_evidence') THEN RAISE EXCEPTION 'Invalid verdict: %', p_verdict; END IF;

    -- Guard against duplicate judgments
    SELECT id INTO v_existing_judgment_id FROM public.judgments WHERE evidence_submission_id = p_evidence_submission_id;
    IF v_existing_judgment_id IS NOT NULL THEN
        RAISE EXCEPTION 'Judgment already exists for this evidence submission';
    END IF;

    INSERT INTO public.judgments (challenge_id, evidence_submission_id, user_id, verdict, feedback, score, metadata)
    VALUES (p_challenge_id, p_evidence_submission_id, p_user_id, p_verdict, p_feedback, p_score, p_metadata)
    RETURNING id INTO v_judgment_id;

    v_status := CASE WHEN p_verdict IN ('passed', 'failed') THEN 'judged' ELSE 'needs_more_evidence' END;
    UPDATE public.challenges SET status = v_status, updated_at = now() WHERE id = p_challenge_id;

    IF p_observation_category IS NOT NULL AND p_observation_text IS NOT NULL THEN
      INSERT INTO public.capability_observations (user_id, category, observation, valence, evidence)
      VALUES (p_user_id, p_observation_category, p_observation_text, p_observation_valence,
        jsonb_build_object('challenge_id', p_challenge_id, 'evidence_submission_id', p_evidence_submission_id, 'judgment_id', v_judgment_id))
      RETURNING id INTO v_observation_id;
    END IF;

    INSERT INTO public.relationship_state (user_id, respect, warmth, trust, rivalry, familiarity, curiosity, updated_at)
    VALUES (p_user_id, GREATEST(0,LEAST(100,50+p_respect_delta)), GREATEST(0,LEAST(100,50+p_warmth_delta)), GREATEST(0,LEAST(100,50+p_trust_delta)), GREATEST(0,LEAST(100,50+p_rivalry_delta)), GREATEST(0,LEAST(100,p_familiarity_delta)), GREATEST(0,LEAST(100,50+p_curiosity_delta)), now())
    ON CONFLICT (user_id) DO UPDATE SET
      respect=GREATEST(0,LEAST(100,public.relationship_state.respect+p_respect_delta)), warmth=GREATEST(0,LEAST(100,public.relationship_state.warmth+p_warmth_delta)), trust=GREATEST(0,LEAST(100,public.relationship_state.trust+p_trust_delta)), rivalry=GREATEST(0,LEAST(100,public.relationship_state.rivalry+p_rivalry_delta)), familiarity=GREATEST(0,LEAST(100,public.relationship_state.familiarity+p_familiarity_delta)), curiosity=GREATEST(0,LEAST(100,public.relationship_state.curiosity+p_curiosity_delta)), updated_at=now()
    RETURNING jsonb_build_object('respect',respect,'warmth',warmth,'trust',trust,'rivalry',rivalry,'familiarity',familiarity,'curiosity',curiosity,'mode',mode) INTO v_relationship;

    INSERT INTO public.events (user_id,event_type,payload) VALUES (p_user_id,'challenge_judged',jsonb_build_object('evidence_submission_id',p_evidence_submission_id,'judgment_id',v_judgment_id,'challenge_id',p_challenge_id,'verdict',p_verdict,'score',p_score,'deltas',jsonb_build_object('respect',p_respect_delta,'warmth',p_warmth_delta,'trust',p_trust_delta,'rivalry',p_rivalry_delta,'familiarity',p_familiarity_delta,'curiosity',p_curiosity_delta),'resulting_relationship_state',v_relationship,'observation_id',v_observation_id)) RETURNING id INTO v_event_id;

    RETURN jsonb_build_object('judgment_id',v_judgment_id,'challenge_id',p_challenge_id,'evidence_submission_id',p_evidence_submission_id,'event_id',v_event_id,'challenge_status',v_status,'relationship_state',v_relationship,'observation_id',v_observation_id);
END;
$$;

-- 5. increment_usage_and_check
CREATE OR REPLACE FUNCTION public.increment_usage_and_check(
    p_user_id UUID,
    p_interaction_delta INT DEFAULT 0,
    p_ai_generation_delta INT DEFAULT 0,
    p_audio_generation_delta INT DEFAULT 0,
    p_image_generation_delta INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sub public.subscriptions;
    v_usage public.usage_counters;
    v_is_paid BOOLEAN;
    v_daily_limit INT;
    v_allowed BOOLEAN := true;
    v_reason TEXT := NULL;
    v_new_interactions INT;
    v_new_ai INT;
    v_new_audio INT;
    v_new_image INT;
BEGIN
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id;
    v_is_paid := (v_sub.id IS NOT NULL AND v_sub.status = 'active');
    v_daily_limit := CASE WHEN v_is_paid THEN 500 ELSE 20 END;

    INSERT INTO public.usage_counters (user_id, current_interactions, current_ai_generations, current_audio_generations, current_image_generations)
    VALUES (p_user_id, p_interaction_delta, p_ai_generation_delta, p_audio_generation_delta, p_image_generation_delta)
    ON CONFLICT (user_id) DO UPDATE SET
        current_interactions = public.usage_counters.current_interactions + p_interaction_delta,
        current_ai_generations = public.usage_counters.current_ai_generations + p_ai_generation_delta,
        current_audio_generations = public.usage_counters.current_audio_generations + p_audio_generation_delta,
        current_image_generations = public.usage_counters.current_image_generations + p_image_generation_delta,
        updated_at = now()
    RETURNING * INTO v_usage;

    IF v_usage.current_interactions > v_daily_limit THEN
        v_allowed := false;
        v_reason := 'limit_exceeded';
    END IF;

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'reason', v_reason,
        'tier', CASE WHEN v_is_paid THEN 'paid' ELSE 'free' END,
        'active', v_sub.status = 'active',
        'daily_limit', v_daily_limit,
        'current_interactions', v_usage.current_interactions,
        'current_ai_generations', v_usage.current_ai_generations
    );
END;
$$;

-- Add uniqueness constraint to judgments
ALTER TABLE public.judgments DROP CONSTRAINT IF EXISTS judgments_evidence_submission_id_key;
ALTER TABLE public.judgments ADD CONSTRAINT judgments_evidence_submission_id_key UNIQUE (evidence_submission_id);

-- Provide grants to service_role and authenticated
GRANT EXECUTE ON FUNCTION public.transition_challenge_status TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_evidence_submission TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_challenge_negotiation TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.judge_challenge TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage_and_check TO authenticated, service_role;

-- 6. issue_challenge
CREATE OR REPLACE FUNCTION public.issue_challenge(
    p_user_id UUID,
    p_goal_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_difficulty TEXT,
    p_parameters JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenge public.challenges;
    v_updated JSONB;
BEGIN
    IF current_setting('role', true) <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Effective user does not match p_user_id';
        END IF;
    END IF;

    INSERT INTO public.challenges (user_id, goal_id, title, description, difficulty, status, parameters)
    VALUES (p_user_id, p_goal_id, p_title, p_description, p_difficulty, 'issued', p_parameters)
    RETURNING * INTO v_challenge;

    INSERT INTO public.events (user_id, event_type, payload) VALUES (
        p_user_id, 'challenge_issued',
        jsonb_build_object(
            'challenge_id', v_challenge.id,
            'objective', p_title,
            'difficulty', p_parameters->>'difficulty_number',
            'domain', p_description,
            'primitive', p_parameters->>'challenge_primitive'
        )
    );

    SELECT to_jsonb(v_challenge) INTO v_updated;
    RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_challenge TO authenticated, service_role;
