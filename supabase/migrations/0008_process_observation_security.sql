-- ============================================================================
-- Migration: 0008_process_observation_security.sql
-- Description: Bind Rival Lens captures to the authenticated caller and bound
--              their payload before they enter the immutable event ledger.
-- ============================================================================

-- Replace the original client-supplied-user RPC signature. Dropping this
-- overload is necessary because PostgreSQL cannot remove an argument with
-- CREATE OR REPLACE FUNCTION.
DROP FUNCTION IF EXISTS public.record_process_capture(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.record_process_capture(
    p_challenge_id UUID,
    p_capture_type TEXT,
    p_content TEXT DEFAULT NULL,
    p_signal TEXT DEFAULT NULL,
    p_artifact_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_challenge_user_id UUID;
    v_domain TEXT;
    v_allowed_signals TEXT[];
    v_event_id UUID;
    v_payload JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT user_id, lower(COALESCE(parameters ->> 'domain', 'general'))
      INTO v_challenge_user_id, v_domain
      FROM public.challenges
     WHERE id = p_challenge_id;

    IF v_challenge_user_id IS NULL THEN
        RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
    END IF;
    IF v_challenge_user_id <> v_user_id THEN
        RAISE EXCEPTION 'Unauthorized: challenge does not belong to authenticated user';
    END IF;

    IF p_capture_type NOT IN ('process_signal', 'process_thought') THEN
        RAISE EXCEPTION 'Invalid capture_type: %', p_capture_type;
    END IF;
    IF p_content IS NOT NULL AND char_length(p_content) > 1000 THEN
        RAISE EXCEPTION 'Process thought content exceeds 1000 characters';
    END IF;
    IF p_signal IS NOT NULL AND char_length(p_signal) > 64 THEN
        RAISE EXCEPTION 'Process signal exceeds 64 characters';
    END IF;
    IF p_artifact_reference IS NOT NULL AND char_length(p_artifact_reference) > 512 THEN
        RAISE EXCEPTION 'Artifact reference exceeds 512 characters';
    END IF;

    IF p_capture_type = 'process_thought' THEN
        IF p_content IS NULL OR btrim(p_content) = '' THEN
            RAISE EXCEPTION 'Process thought requires content';
        END IF;
        IF p_signal IS NOT NULL THEN
            RAISE EXCEPTION 'Process thought cannot include a signal';
        END IF;
        v_payload := jsonb_build_object(
            'challenge_id', p_challenge_id,
            'content', p_content,
            'captured_at', now()
        );
        IF p_artifact_reference IS NOT NULL THEN
            v_payload := v_payload || jsonb_build_object('artifact_reference', p_artifact_reference);
        END IF;
    ELSE
        IF p_signal IS NULL OR btrim(p_signal) = '' THEN
            RAISE EXCEPTION 'Process signal requires a signal value';
        END IF;
        IF p_artifact_reference IS NOT NULL THEN
            RAISE EXCEPTION 'Process signal cannot include an artifact reference';
        END IF;

        -- This is the exact quick-signal vocabulary from captureProfile.ts,
        -- selected by the challenge's existing domain parameter.
        v_allowed_signals := CASE v_domain
            WHEN 'coding' THEN ARRAY['STUCK', 'GUESSING', 'THINKING', 'OVERTHINKING', 'CHANGING APPROACH', 'NEED A HINT', 'GOT IT']
            WHEN 'study_learning' THEN ARRAY['CONFUSED', 'I KNOW THIS', 'GUESSING', 'STUCK', 'GOT IT', 'CONNECTING IT', 'NEED A HINT']
            WHEN 'writing_creative' THEN ARRAY['STUCK', 'NEW IDEA', 'SCRAPPING THIS', 'REVISING', 'DONE']
            WHEN 'physical_task' THEN ARRAY['STARTING', 'STRUGGLING', 'PUSHING THROUGH', 'DONE']
            ELSE ARRAY['STUCK', 'THINKING', 'CHANGING APPROACH', 'GOT IT', 'NEED A HINT']
        END;
        IF p_signal <> ALL(v_allowed_signals) THEN
            RAISE EXCEPTION 'Invalid process signal for challenge domain';
        END IF;
        IF p_content IS NOT NULL AND btrim(p_content) = '' THEN
            RAISE EXCEPTION 'Optional process signal content cannot be blank';
        END IF;
        v_payload := jsonb_build_object(
            'challenge_id', p_challenge_id,
            'signal', p_signal,
            'captured_at', now()
        );
        IF p_content IS NOT NULL THEN
            v_payload := v_payload || jsonb_build_object('content', p_content);
        END IF;
    END IF;

    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (v_user_id, p_capture_type, v_payload)
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_process_capture(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_process_capture(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_process_capture(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
