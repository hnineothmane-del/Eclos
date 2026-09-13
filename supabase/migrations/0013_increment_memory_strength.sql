-- ============================================================================
-- Migration: 0013_increment_memory_strength.sql
-- Description: Atomic memory strength increment for trusted server callers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.increment_memory_strength(
    p_user_id UUID,
    p_key TEXT,
    p_delta NUMERIC DEFAULT 1
)
RETURNS public.memory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.memory_items;
BEGIN
    UPDATE public.memory_items
    SET strength = GREATEST(0, LEAST(100.00, strength + p_delta)),
        last_accessed_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id
      AND key = p_key
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_memory_strength(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_memory_strength(UUID, TEXT, NUMERIC) TO service_role;
