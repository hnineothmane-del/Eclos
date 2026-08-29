-- ============================================================================
-- Migration: 0004_humor_usage_atomic.sql
-- Description: Atomic humor-ledger usage recording for trusted server callers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_humor_usage(
    p_user_id UUID,
    p_theme TEXT,
    p_target TEXT DEFAULT 'general',
    p_intensity INTEGER DEFAULT 5
)
RETURNS public.humor_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.humor_ledger;
BEGIN
    INSERT INTO public.humor_ledger (
        user_id, theme, target, intensity, usage_count, last_used_at
    ) VALUES (
        p_user_id,
        p_theme,
        COALESCE(NULLIF(p_target, ''), 'general'),
        GREATEST(1, LEAST(10, p_intensity)),
        1,
        now()
    )
    ON CONFLICT (user_id, theme, target) DO UPDATE SET
        intensity = EXCLUDED.intensity,
        usage_count = public.humor_ledger.usage_count + 1,
        last_used_at = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_humor_usage(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_humor_usage(UUID, TEXT, TEXT, INTEGER) TO service_role;
