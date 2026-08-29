import { describe, it, expect, vi } from 'vitest';
import { SupabaseEventStore } from './eventStore.js';
import type { SupabaseClientLike } from './client.js';
import { StoreValidationError, DatabaseError } from './errors.js';

function createMockClient(): { client: SupabaseClientLike; mockQuery: any } {
  const mockQuery: any = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'evt-123',
        user_id: 'user-abc',
        event_type: 'challenge_issued',
        payload: { challenge_id: 'ch-1' },
        created_at: '2026-08-29T00:00:00.000Z',
      },
      error: null,
    }),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'evt-1',
          user_id: 'user-abc',
          event_type: 'challenge_started',
          payload: { challenge_id: 'ch-1' },
          created_at: '2026-08-29T01:00:00.000Z',
        },
      ],
      error: null,
    }),
  };

  const client: SupabaseClientLike = {
    from: vi.fn().mockReturnValue(mockQuery),
    rpc: vi.fn(),
  };

  return { client, mockQuery };
}

describe('SupabaseEventStore', () => {
  it('append produces expected insert and returns domain event', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseEventStore(client);

    const event = await store.append({
      userId: 'user-abc',
      eventType: 'challenge_issued',
      payload: { challenge_id: 'ch-1' },
      source: 'system',
    });

    expect(client.from).toHaveBeenCalledWith('events');
    expect(mockQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-abc',
      event_type: 'challenge_issued',
      payload: { challenge_id: 'ch-1', source: 'system' },
    });
    expect(event.id).toBe('evt-123');
    expect(event.userId).toBe('user-abc');
    expect(event.eventType).toBe('challenge_issued');
    expect(event.source).toBe('system');
  });

  it('recentForUser queries with user filter, created_at desc ordering, and limit', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseEventStore(client);

    const events = await store.recentForUser('user-abc', 10);

    expect(client.from).toHaveBeenCalledWith('events');
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-abc');
    expect(mockQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(10);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-1');
  });

  it('throws StoreValidationError when userId or eventType is missing', async () => {
    const { client } = createMockClient();
    const store = new SupabaseEventStore(client);

    await expect(store.append({ userId: '', eventType: 'challenge_issued' })).rejects.toThrow(
      StoreValidationError,
    );
    await expect(store.append({ userId: 'user-1', eventType: '' as any })).rejects.toThrow(
      StoreValidationError,
    );
    await expect(store.recentForUser('')).rejects.toThrow(StoreValidationError);
  });

  it('throws DatabaseError when Supabase returns an error', async () => {
    const { client, mockQuery } = createMockClient();
    mockQuery.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database failure', code: 'PGRST500' },
    });

    const store = new SupabaseEventStore(client);

    await expect(
      store.append({ userId: 'user-1', eventType: 'challenge_issued' }),
    ).rejects.toThrow(DatabaseError);
  });

  it('does not expose update or delete methods', () => {
    const { client } = createMockClient();
    const store = new SupabaseEventStore(client);

    expect((store as any).update).toBeUndefined();
    expect((store as any).delete).toBeUndefined();
  });
});
