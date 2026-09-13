import { describe, it, expect, vi } from 'vitest';
import { SupabaseMemoryStore } from './memoryStore.js';
import type { SupabaseClientLike } from './client.js';
import { StoreValidationError, DatabaseError } from './errors.js';

function createMockClient(): { client: SupabaseClientLike; mockQuery: any } {
  const mockQuery: any = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'mem-1',
        user_id: 'user-abc',
        tier: 'permanent',
        category: 'goal',
        key: 'run_marathon',
        value: { target: 'Sub 4 hours' },
        strength: 100,
        last_accessed_at: '2026-08-29T00:00:00.000Z',
        expires_at: null,
        created_at: '2026-08-29T00:00:00.000Z',
        updated_at: '2026-08-29T00:00:00.000Z',
      },
      error: null,
    }),
    eq: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lte: vi.fn().mockResolvedValue({
      data: [{ id: 'expired-1' }, { id: 'expired-2' }],
      error: null,
    }),
  };

  const client: SupabaseClientLike = {
    from: vi.fn().mockReturnValue(mockQuery),
    rpc: vi.fn(),
  };

  return { client, mockQuery };
}

describe('SupabaseMemoryStore', () => {
  it('write maps fields correctly and returns domain MemoryItem', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseMemoryStore(client);

    const result = await store.write({
      userId: 'user-abc',
      tier: 'permanent',
      category: 'goal',
      key: 'run_marathon',
      value: { target: 'Sub 4 hours' },
    });

    expect(client.from).toHaveBeenCalledWith('memory_items');
    expect(mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-abc',
        tier: 'permanent',
        category: 'goal',
        key: 'run_marathon',
        value: { target: 'Sub 4 hours' },
        strength: 100,
      }),
      { onConflict: 'id' },
    );
    expect(result.id).toBe('mem-1');
    expect(result.tier).toBe('permanent');
  });

  it('retrieveRelevant fetches candidate items and delegates to pure rankMemories', async () => {
    const { client, mockQuery } = createMockClient();
    const candidateRows = [
      {
        id: 'mem-1',
        user_id: 'user-abc',
        tier: 'permanent',
        category: 'goal',
        key: 'run_marathon',
        value: 'sub 4 hours',
        strength: 100,
        last_accessed_at: '2026-08-29T00:00:00.000Z',
        expires_at: null,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      },
      {
        id: 'mem-2',
        user_id: 'user-abc',
        tier: 'decaying',
        category: 'observation',
        key: 'skipped_running',
        value: 'lazy morning',
        strength: 80,
        last_accessed_at: '2026-08-29T00:00:00.000Z',
        expires_at: '2026-09-01T00:00:00.000Z',
        created_at: '2026-08-29T00:00:00.000Z',
        updated_at: '2026-08-29T00:00:00.000Z',
      },
      {
        id: 'mem-expired',
        user_id: 'user-abc',
        tier: 'decaying',
        category: 'observation',
        key: 'old_joke',
        value: 'expired',
        strength: 80,
        last_accessed_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-10T00:00:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ];

    mockQuery.eq.mockResolvedValueOnce({
      data: candidateRows,
      error: null,
    });

    const store = new SupabaseMemoryStore(client);
    const ranked = await store.retrieveRelevant('user-abc', {
      nowIso: '2026-08-29T12:00:00.000Z',
      tags: ['goal'],
      topK: 5,
    });

    // Should filter out mem-expired
    expect(ranked.find((r) => r.item.id === 'mem-expired')).toBeUndefined();
    // Permanent goal with matching tag should rank first
    expect(ranked[0].item.id).toBe('mem-1');
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it('compact deletes expired decaying memories', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseMemoryStore(client);

    const result = await store.compact('user-abc', '2026-08-29T12:00:00.000Z');

    expect(client.from).toHaveBeenCalledWith('memory_items');
    expect(mockQuery.delete).toHaveBeenCalled();
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-abc');
    expect(mockQuery.eq).toHaveBeenCalledWith('tier', 'decaying');
    expect(mockQuery.lte).toHaveBeenCalledWith('expires_at', '2026-08-29T12:00:00.000Z');
    expect(result.deletedCount).toBe(2);
  });

  it('throws StoreValidationError on invalid write parameters', async () => {
    const { client } = createMockClient();
    const store = new SupabaseMemoryStore(client);

    await expect(
      store.write({
        userId: '',
        tier: 'permanent',
        category: 'goal',
        key: 'x',
        value: 'y',
      }),
    ).rejects.toThrow(StoreValidationError);

    await expect(
      store.write({
        userId: 'user-1',
        tier: 'invalid' as any,
        category: 'goal',
        key: 'x',
        value: 'y',
      }),
    ).rejects.toThrow(StoreValidationError);
  });

  describe('incrementStrength', () => {
    it('uses RPC when available and maps row correctly', async () => {
      const { client } = createMockClient();
      (client.rpc as any).mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          user_id: 'user-abc',
          tier: 'permanent',
          category: 'observation',
          key: 'behavioral:self_report:delayed_start',
          value: { description: 'procrastination' },
          strength: 2,
          last_accessed_at: '2026-08-29T00:00:00.000Z',
          expires_at: null,
          created_at: '2026-08-29T00:00:00.000Z',
          updated_at: '2026-08-29T00:00:00.000Z',
        },
        error: null,
      });

      const store = new SupabaseMemoryStore(client);
      const result = await store.incrementStrength('user-abc', 'behavioral:self_report:delayed_start', 1);

      expect(client.rpc).toHaveBeenCalledWith('increment_memory_strength', {
        p_user_id: 'user-abc',
        p_key: 'behavioral:self_report:delayed_start',
        p_delta: 1,
      });
      expect(result).not.toBeNull();
      expect(result!.strength).toBe(2);
      expect(result!.key).toBe('behavioral:self_report:delayed_start');
    });

    it('falls back to row update when RPC is not available', async () => {
      const { client, mockQuery } = createMockClient();
      (client.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'function does not exist' },
      });

      // mock select row
      mockQuery.eq.mockReturnValueOnce(mockQuery);
      mockQuery.eq.mockReturnValueOnce(mockQuery);
      mockQuery.limit.mockResolvedValueOnce({
        data: [{
          id: 'mem-1',
          user_id: 'user-abc',
          tier: 'permanent',
          category: 'observation',
          key: 'behavioral:self_report:delayed_start',
          value: { description: 'procrastination' },
          strength: 1,
          last_accessed_at: '2026-08-29T00:00:00.000Z',
          expires_at: null,
          created_at: '2026-08-29T00:00:00.000Z',
          updated_at: '2026-08-29T00:00:00.000Z',
        }],
        error: null,
      });

      // mock update returning updated row
      mockQuery.single.mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          user_id: 'user-abc',
          tier: 'permanent',
          category: 'observation',
          key: 'behavioral:self_report:delayed_start',
          value: { description: 'procrastination' },
          strength: 2,
          last_accessed_at: '2026-08-29T00:00:00.000Z',
          expires_at: null,
          created_at: '2026-08-29T00:00:00.000Z',
          updated_at: '2026-08-29T00:00:00.000Z',
        },
        error: null,
      });

      const store = new SupabaseMemoryStore(client);
      const result = await store.incrementStrength('user-abc', 'behavioral:self_report:delayed_start', 1);

      expect(mockQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({ strength: 2 }),
      );
      expect(result).not.toBeNull();
      expect(result!.strength).toBe(2);
    });

    it('clamps strength to max 100 on fallback', async () => {
      const { client, mockQuery } = createMockClient();
      (client.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'function does not exist' },
      });

      mockQuery.eq.mockReturnValueOnce(mockQuery);
      mockQuery.eq.mockReturnValueOnce(mockQuery);
      mockQuery.limit.mockResolvedValueOnce({
        data: [{
          id: 'mem-1',
          user_id: 'user-abc',
          tier: 'permanent',
          category: 'observation',
          key: 'behavioral:self_report:delayed_start',
          value: { description: 'procrastination' },
          strength: 99.5,
          last_accessed_at: '2026-08-29T00:00:00.000Z',
          expires_at: null,
          created_at: '2026-08-29T00:00:00.000Z',
          updated_at: '2026-08-29T00:00:00.000Z',
        }],
        error: null,
      });

      mockQuery.single.mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          user_id: 'user-abc',
          tier: 'permanent',
          category: 'observation',
          key: 'behavioral:self_report:delayed_start',
          value: { description: 'procrastination' },
          strength: 100,
          last_accessed_at: '2026-08-29T00:00:00.000Z',
          expires_at: null,
          created_at: '2026-08-29T00:00:00.000Z',
          updated_at: '2026-08-29T00:00:00.000Z',
        },
        error: null,
      });

      const store = new SupabaseMemoryStore(client);
      const result = await store.incrementStrength('user-abc', 'behavioral:self_report:delayed_start', 2);

      expect(mockQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({ strength: 100 }),
      );
      expect(result!.strength).toBe(100);
    });

    it('validates userId and key', async () => {
      const { client } = createMockClient();
      const store = new SupabaseMemoryStore(client);

      await expect(store.incrementStrength('', 'key')).rejects.toThrow(StoreValidationError);
      await expect(store.incrementStrength('user-1', '')).rejects.toThrow(StoreValidationError);
    });
  });
});
