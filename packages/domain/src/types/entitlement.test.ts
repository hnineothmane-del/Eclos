import { describe, expect, it } from 'vitest';
import { deriveUserEntitlement } from './entitlement.js';

const nowIso = '2026-09-01T12:00:00.000Z';

describe('deriveUserEntitlement', () => {
  it('keeps the free tier active without a billing-provider period', () => {
    expect(deriveUserEntitlement({ tier: 'free', status: 'active', currentPeriodEndsAt: null, nowIso }))
      .toMatchObject({ tier: 'free', active: true, limits: { dailyGenerations: 20 } });
  });

  it('grants paid limits only to an active, unexpired paid subscription', () => {
    expect(deriveUserEntitlement({ tier: 'paid', status: 'active', currentPeriodEndsAt: '2026-10-01T00:00:00.000Z', nowIso }))
      .toMatchObject({ tier: 'paid', active: true, limits: { dailyGenerations: 200 } });
  });

  it('falls an expired or inactive paid subscription back to free without changing history', () => {
    expect(deriveUserEntitlement({ tier: 'paid', status: 'expired', currentPeriodEndsAt: '2026-08-01T00:00:00.000Z', nowIso }))
      .toMatchObject({ tier: 'free', active: true });
  });
});
