import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(__dirname, '../migrations/0009_entitlements.sql'), 'utf8');
const initialization = readFileSync(resolve(__dirname, '../migrations/0006_user_initialization.sql'), 'utf8');

describe('minimal V1 entitlements', () => {
  it('initializes a free user without billing-provider identifiers', () => {
    expect(initialization).toMatch(/lemon_squeezy_id, customer_id, status, variant_id/i);
    expect(initialization).toMatch(/NULL, NULL, 'active', NULL, NULL, 'free'/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.initialize_user_state/i);
  });

  it('derives free and paid limits from the authoritative subscription row', () => {
    expect(migration).toMatch(/tier = 'paid'/i);
    expect(migration).toMatch(/THEN 200 ELSE 20/i);
    expect(migration).toMatch(/THEN 30 ELSE 10/i);
    expect(migration).not.toMatch(/v_daily_limit := p_daily_limit/i);
  });

  it('maps active provider-backed subscriptions to paid without trusting a client tier', () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_derive_subscription_tier/i);
    expect(migration).toMatch(/NEW\.lemon_squeezy_id IS NOT NULL/i);
    expect(migration).toMatch(/NEW\.tier := CASE/i);
  });

  it('does not grant clients access to the usage RPC', () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.increment_usage_and_check[\s\S]*authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.increment_usage_and_check[\s\S]*service_role/i);
  });

  it('serializes a user usage check before evaluating rate and daily limits', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtext\(p_user_id::text\)\)/i);
  });

  it('keeps usage denial non-mutating and preserves existing user state', () => {
    expect(migration).toMatch(/WHERE public\.usage_counters\.interaction_count \+ p_interaction_delta <= v_daily_limit/i);
    expect(migration).toMatch(/reason', CASE WHEN v_allowed THEN NULL ELSE 'daily_limit_reached'/i);
    expect(migration).not.toMatch(/relationship_state.*UPDATE/i);
    expect(migration).not.toMatch(/challenges.*UPDATE/i);
  });
});
