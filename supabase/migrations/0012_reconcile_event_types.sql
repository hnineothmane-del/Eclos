-- ============================================================================
-- Migration: 0012_reconcile_event_types.sql
-- Description: Reconcile DB CHECK constraint with authoritative DomainEvent union
-- ============================================================================

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
    'challenge_issued', 
    'challenge_accepted', 
    'challenge_negotiated', 
    'challenge_started',
    'challenge_attempted', 
    'evidence_submitted', 
    'needs_more_evidence',
    'challenge_judged', 
    'challenge_closed',
    'relationship_delta_applied', 
    'observation_recorded', 
    'memory_stored', 
    'memory_decayed',
    'subscription_created', 
    'subscription_updated', 
    'subscription_cancelled',
    'billing_webhook_processed', 
    'usage_incremented', 
    'chat_message_sent',
    'process_signal', 
    'process_thought',
    'rival_interaction',
    'agency_initiative',
    'rival_easter_egg_discovered',
    'rival_lore_revealed'
));
