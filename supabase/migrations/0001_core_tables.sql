-- ============================================================================
-- Migration: 0001_core_tables.sql
-- Description: Core 13-table schema for AI Rival MVP
-- ============================================================================

-- Ensure pgcrypto / uuid extensions are available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. goals: Long-term user objectives
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_status ON public.goals(user_id, status);

-- ============================================================================
-- 2. chat_messages: Recent conversation continuity (NOT memory system)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON public.chat_messages(user_id, created_at DESC);

-- ============================================================================
-- 3. relationship_state: Exactly one row per user (0-100 clamped attributes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.relationship_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    respect INTEGER NOT NULL DEFAULT 50 CHECK (respect >= 0 AND respect <= 100),
    warmth INTEGER NOT NULL DEFAULT 50 CHECK (warmth >= 0 AND warmth <= 100),
    trust INTEGER NOT NULL DEFAULT 50 CHECK (trust >= 0 AND trust <= 100),
    rivalry INTEGER NOT NULL DEFAULT 50 CHECK (rivalry >= 0 AND rivalry <= 100),
    familiarity INTEGER NOT NULL DEFAULT 0 CHECK (familiarity >= 0 AND familiarity <= 100),
    curiosity INTEGER NOT NULL DEFAULT 50 CHECK (curiosity >= 0 AND curiosity <= 100),
    mode TEXT NOT NULL DEFAULT 'observing' CHECK (mode IN ('sparring', 'coaching', 'mocking', 'observing', 'dismissive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relationship_state_user_id ON public.relationship_state(user_id);

-- ============================================================================
-- 4. challenges: Lifecycle-managed user challenges
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('trivial', 'easy', 'medium', 'hard', 'brutal')),
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN (
        'issued', 'negotiated', 'accepted', 'started',
        'attempted', 'evidence_submitted', 'needs_more_evidence',
        'judged', 'closed'
    )),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_user_id ON public.challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_user_status ON public.challenges(user_id, status);

-- ============================================================================
-- 5. evidence_submissions: Multi-round challenge evidence
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.evidence_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1),
    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'link', 'image', 'code', 'file')),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_challenge_round UNIQUE (challenge_id, round)
);

CREATE INDEX IF NOT EXISTS idx_evidence_challenge_round ON public.evidence_submissions(challenge_id, round);
CREATE INDEX IF NOT EXISTS idx_evidence_user_id ON public.evidence_submissions(user_id);

-- ============================================================================
-- 6. judgments: Evaluations for specific evidence submissions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.judgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
    evidence_submission_id UUID NOT NULL REFERENCES public.evidence_submissions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('passed', 'failed', 'needs_more_evidence')),
    feedback TEXT NOT NULL,
    score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgments_challenge_id ON public.judgments(challenge_id);
CREATE INDEX IF NOT EXISTS idx_judgments_submission_id ON public.judgments(evidence_submission_id);
CREATE INDEX IF NOT EXISTS idx_judgments_user_id ON public.judgments(user_id);

-- ============================================================================
-- 7. memory_items: Long-term memory tiers (permanent or decaying)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.memory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('permanent', 'decaying')),
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    strength NUMERIC(5, 2) NOT NULL DEFAULT 100.00 CHECK (strength >= 0 AND strength <= 100),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_user_tier ON public.memory_items(user_id, tier);
CREATE INDEX IF NOT EXISTS idx_memory_user_category ON public.memory_items(user_id, category);

-- ============================================================================
-- 8. humor_ledger: Anti-repetition tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.humor_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    target TEXT NOT NULL,
    intensity INTEGER NOT NULL DEFAULT 5 CHECK (intensity >= 1 AND intensity <= 10),
    usage_count INTEGER NOT NULL DEFAULT 1 CHECK (usage_count >= 1),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_humor_user_theme_target UNIQUE (user_id, theme, target)
);

CREATE INDEX IF NOT EXISTS idx_humor_user_last_used ON public.humor_ledger(user_id, last_used_at DESC);

-- ============================================================================
-- 9. events: Append-only source-of-truth event ledger
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_issued', 'challenge_accepted', 'challenge_negotiated', 'challenge_started',
        'challenge_attempted', 'evidence_submitted', 'challenge_judged', 'challenge_closed',
        'relationship_delta_applied', 'observation_recorded', 'memory_stored', 'memory_decayed',
        'subscription_created', 'subscription_updated', 'subscription_cancelled',
        'billing_webhook_processed', 'usage_incremented', 'chat_message_sent'
    )),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_user_created ON public.events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_type ON public.events(user_id, event_type);

-- ============================================================================
-- 10. capability_observations: Controlled vocabulary psychological observations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.capability_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN (
        'pressure_response', 'ambiguity_response', 'persistence',
        'recovery', 'learning_performance', 'adaptation'
      )),
    observation TEXT NOT NULL,
    valence TEXT NOT NULL DEFAULT 'neutral' CHECK (valence IN ('positive', 'neutral', 'negative')),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_user_category ON public.capability_observations(user_id, category);
CREATE INDEX IF NOT EXISTS idx_observations_user_created ON public.capability_observations(user_id, created_at DESC);

-- ============================================================================
-- 11. subscriptions: Exactly one authoritative subscription row per user
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    lemon_squeezy_id TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'
    )),
    variant_id TEXT NOT NULL,
    current_period_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_lemon_id ON public.subscriptions(lemon_squeezy_id);

-- ============================================================================
-- 12. webhook_events: Lemon Squeezy idempotency ledger
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON public.webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events(status);

-- ============================================================================
-- 13. usage_counters: Daily usage bucket per (user_id, period)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.usage_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period DATE NOT NULL DEFAULT CURRENT_DATE,
    interaction_count INTEGER NOT NULL DEFAULT 0 CHECK (interaction_count >= 0),
    challenge_count INTEGER NOT NULL DEFAULT 0 CHECK (challenge_count >= 0),
    token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_user_period UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_period ON public.usage_counters(user_id, period);
