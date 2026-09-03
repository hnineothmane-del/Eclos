-- Migration: 0010_relationship_mode_alignment.sql
-- Align the database relationship mode contract with the domain initializer.

ALTER TABLE public.relationship_state
    DROP CONSTRAINT IF EXISTS relationship_state_mode_check;

ALTER TABLE public.relationship_state
    ADD CONSTRAINT relationship_state_mode_check
    CHECK (mode IN (
        'adaptive', 'permanent_rival', 'sparring', 'coaching',
        'mocking', 'observing', 'dismissive'
    ));
