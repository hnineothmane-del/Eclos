-- ============================================================================
-- Migration: 0002_rls_and_grants.sql
-- Description: Row Level Security policies, grants, and event immutability
-- ============================================================================

-- ============================================================================
-- 1. Enable Row Level Security on ALL 13 tables
-- ============================================================================
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.humor_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Authenticated user SELECT policies (auth.uid() = user_id)
-- Clients can ONLY read their own data and NEVER write directly.
-- ============================================================================

CREATE POLICY "Users can view own goals"
    ON public.goals FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own chat messages"
    ON public.chat_messages FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own relationship state"
    ON public.relationship_state FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own challenges"
    ON public.challenges FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own evidence submissions"
    ON public.evidence_submissions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own judgments"
    ON public.judgments FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own memory items"
    ON public.memory_items FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own humor ledger"
    ON public.humor_ledger FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own events"
    ON public.events FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own capability observations"
    ON public.capability_observations FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own subscriptions"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own usage counters"
    ON public.usage_counters FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Note: webhook_events has NO policies defined for anon or authenticated,
-- guaranteeing zero access to clients.

-- ============================================================================
-- 3. Event Immutability: Prevent UPDATE and DELETE on events table
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_events_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'events table is append-only: updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_events_modification ON public.events;
CREATE TRIGGER trg_prevent_events_modification
    BEFORE UPDATE OR DELETE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_events_modification();

-- ============================================================================
-- 4. Role Grants & Revocations
-- ============================================================================
-- Revoke all default public permissions
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;

-- Grant SELECT to authenticated on user-facing tables
GRANT SELECT ON public.goals TO authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;
GRANT SELECT ON public.relationship_state TO authenticated;
GRANT SELECT ON public.challenges TO authenticated;
GRANT SELECT ON public.evidence_submissions TO authenticated;
GRANT SELECT ON public.judgments TO authenticated;
GRANT SELECT ON public.memory_items TO authenticated;
GRANT SELECT ON public.humor_ledger TO authenticated;
GRANT SELECT ON public.events TO authenticated;
GRANT SELECT ON public.capability_observations TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.usage_counters TO authenticated;

-- Grant full access to service_role (bypasses RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
