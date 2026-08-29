-- ============================================================================
-- Migration: 0005_challenge_judgment_guard.sql
-- Description: Atomic challenge negotiation, evidence rounds, and judgment guard
-- ============================================================================

-- Replaces the earlier UUID-returning RPC so callers receive the authoritative
-- evidence round assigned while the locked challenge row serializes submissions.
DROP FUNCTION IF EXISTS public.record_evidence_submission(UUID, UUID, TEXT, TEXT, JSONB);

CREATE FUNCTION public.record_evidence_submission(
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
    RETURN jsonb_build_object('submission_id', v_submission_id, 'evidence_round', v_round);
END;
$$;

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
BEGIN
    SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
    IF v_challenge.id IS NULL OR v_challenge.user_id <> p_user_id THEN RAISE EXCEPTION 'Challenge not found or unauthorized'; END IF;
    IF v_challenge.status <> 'evidence_submitted' THEN RAISE EXCEPTION 'Challenge must be in evidence_submitted state to be judged'; END IF;
    SELECT * INTO v_submission FROM public.evidence_submissions
    WHERE id = p_evidence_submission_id AND challenge_id = p_challenge_id FOR UPDATE;
    IF v_submission.id IS NULL OR v_submission.user_id <> p_user_id THEN RAISE EXCEPTION 'Evidence submission not found or does not belong to specified challenge/user'; END IF;
    IF p_verdict NOT IN ('passed', 'failed', 'needs_more_evidence') THEN RAISE EXCEPTION 'Invalid verdict: %', p_verdict; END IF;
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

REVOKE EXECUTE ON FUNCTION public.record_evidence_submission(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_challenge_negotiation(UUID, UUID, TEXT, TEXT, INT, JSONB, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.judge_challenge(UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT, INT, INT, INT, INT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_evidence_submission(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_challenge_negotiation(UUID, UUID, TEXT, TEXT, INT, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.judge_challenge(UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT, INT, INT, INT, INT, TEXT, TEXT, TEXT, JSONB) TO service_role;
