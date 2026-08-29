import { describe, it, expect, vi } from 'vitest';
import { SupabaseHumorStateStore } from './humorStateStore.js';
import type { SupabaseClientLike } from './client.js';
import { StoreValidationError, DatabaseError } from './errors.js';

function createMockClient(): { client: SupabaseClientLike; mockQuery: any } {
  const mockQuery: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [{ theme: 'sarcasm' }, { theme: 'hyperbole' }, { theme: 'irony' }],
      error: null,
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: 'humor-1',
        user_id: 'user-abc',
        theme: 'sarcasm',
        target: 'procrastination',
        intensity: 7,
        usage_count: 3,
        last_used_at: '2026-08-29T00:00:00.000Z',
        created_at: '2026-08-28T00:00:00.000Z',
      },
      error: null,
    }),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'humor-1',
        user_id: 'user-abc',
        theme: 'sarcasm',
        target: 'procrastination',
        intensity: 7,
        usage_count: 4,
        last_used_at: '2026-08-29T01:00:00.000Z',
        created_at: '2026-08-28T00:00:00.000Z',
      },
      error: null,
    }),
  };

  const client: SupabaseClientLike = {
    from: vi.fn().mockReturnValue(mockQuery),
    rpc: vi.fn(),
  };

  return { client, mockQuery };
}

describe('SupabaseHumorStateStore', () => {
  it('recentMechanisms queries user-scoped and ordered themes', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseHumorStateStore(client);

    const mechanisms = await store.recentMechanisms('user-abc', 5);

    expect(client.from).toHaveBeenCalledWith('humor_ledger');
    expect(mockQuery.select).toHaveBeenCalledWith('theme');
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-abc');
    expect(mockQuery.order).toHaveBeenCalledWith('last_used_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(5);
    expect(mechanisms).toEqual(['sarcasm', 'hyperbole', 'irony']);
  });

  it('jokeCooldownStatus calculates cooldown correctly', async () => {
    const { client } = createMockClient();
    const store = new SupabaseHumorStateStore(client);

    // 10 minutes after last_used_at (2026-08-29T00:00:00.000Z) -> inCooldown should be true (30m window)
    const tenMinutesLater = '2026-08-29T00:10:00.000Z';
    const statusInCooldown = await store.jokeCooldownStatus(
      'user-abc',
      { theme: 'sarcasm', target: 'procrastination' },
      30,
      tenMinutesLater,
    );

    expect(statusInCooldown.inCooldown).toBe(true);
    expect(statusInCooldown.usageCount).toBe(3);

    // 45 minutes after last_used_at -> inCooldown should be false
    const fortyFiveMinutesLater = '2026-08-29T00:45:00.000Z';
    const statusAfterCooldown = await store.jokeCooldownStatus(
      'user-abc',
      { theme: 'sarcasm', target: 'procrastination' },
      30,
      fortyFiveMinutesLater,
    );

    expect(statusAfterCooldown.inCooldown).toBe(false);
  });

  it('jokeCooldownStatus returns false if joke was never used', async () => {
    const { client, mockQuery } = createMockClient();
    mockQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const store = new SupabaseHumorStateStore(client);
    const status = await store.jokeCooldownStatus('user-abc', 'new_theme:target');

    expect(status.inCooldown).toBe(false);
    expect(status.usageCount).toBe(0);
    expect(status.lastUsedAt).toBeNull();
  });

  it('record upserts and increments usage count', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseHumorStateStore(client);

    const result = await store.record('user-abc', 'sarcasm', 'procrastination', 7);

    expect(client.from).toHaveBeenCalledWith('humor_ledger');
    expect(mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-abc',
        theme: 'sarcasm',
        target: 'procrastination',
        intensity: 7,
        usage_count: 4,
      }),
      { onConflict: 'user_id,theme,target' },
    );
    expect(result.usageCount).toBe(4);
  });

  it('throws StoreValidationError on invalid parameters', async () => {
    const { client } = createMockClient();
    const store = new SupabaseHumorStateStore(client);

    await expect(store.recentMechanisms('')).rejects.toThrow(StoreValidationError);
    await expect(store.jokeCooldownStatus('', 'theme:target')).rejects.toThrow(
      StoreValidationError,
    );
    await expect(store.record('', 'theme')).rejects.toThrow(StoreValidationError);
    await expect(store.record('user-1', '')).rejects.toThrow(StoreValidationError);
  });
});
