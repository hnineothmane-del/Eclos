-- ============================================================================
-- Migration: 0007_process_observation.sql
-- Description: Add process capture event types to events table
-- ============================================================================

ALTER TABLE public.events DROP CONSTRAINT events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
    'challenge_issued', 'challenge_accepted', 'challenge_negotiated', 'challenge_started',
    'challenge_attempted', 'evidence_submitted', 'challenge_judged', 'challenge_closed',
    'relationship_delta_applied', 'observation_recorded', 'memory_stored', 'memory_decayed',
    'subscription_created', 'subscription_updated', 'subscription_cancelled',
    'billing_webhook_processed', 'usage_incremented', 'chat_message_sent',
    'process_signal', 'process_thought'
));

-- ============================================================================
-- RPC: record_process_capture
-- Records a voluntary process signal or thought to the events table.
-- SECURITY: server enforces challenge.user_id === p_user_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_process_capture(
    p_user_id UUID,
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
    v_challenge_user UUID;
    v_event_type TEXT;
    v_event_id UUID;
BEGIN
    -- Verify challenge ownership
    SELECT user_id INTO v_challenge_user
    FROM public.challenges
    WHERE id = p_challenge_id;

    IF v_challenge_user IS NULL THEN
        RAISE EXCEPTION 'Challenge not found: %', p_challenge_id;
    END IF;
    IF v_challenge_user <> p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: challenge does not belong to user';
    END IF;

    -- Map capture_type to event_type
    IF p_capture_type NOT IN ('process_signal', 'process_thought') THEN
        RAISE EXCEPTION 'Invalid capture_type: %', p_capture_type;
    END IF;
    v_event_type := p_capture_type;

    INSERT INTO public.events (user_id, event_type, payload)
    VALUES (
        p_user_id,
        v_event_type,
        jsonb_build_object(
            'challenge_id', p_challenge_id,
            'content', p_content,
            'signal', p_signal,
            'artifact_reference', p_artifact_reference,
            'captured_at', now()
        )
    )
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_process_capture TO authenticated, service_role;
