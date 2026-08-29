import { describe, it, expect, vi } from 'vitest';
import { SupabaseRelationshipStateStore } from './relationshipStateStore.js';
import type { SupabaseClientLike } from './client.js';
import { StoreValidationError, DatabaseError, NotFoundError } from './errors.js';

function createMockClient(): { client: SupabaseClientLike; mockQuery: any } {
  const mockQuery: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: 'rel-1',
        user_id: 'user-abc',
        respect: 65,
        warmth: 40,
        trust: 55,
        rivalry: 70,
        familiarity: 10,
        curiosity: 60,
        mode: 'sparring',
        updated_at: '2026-08-29T00:00:00.000Z',
      },
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'rel-1',
        user_id: 'user-abc',
        respect: 65,
        warmth: 40,
        trust: 55,
        rivalry: 70,
        familiarity: 10,
        curiosity: 60,
        mode: 'mocking',
        updated_at: '2026-08-29T00:05:00.000Z',
      },
      error: null,
    }),
  };

  const client: SupabaseClientLike = {
    from: vi.fn().mockReturnValue(mockQuery),
    rpc: vi.fn().mockResolvedValue({
      data: 'event-uuid-999',
      error: null,
    }),
  };

  return { client, mockQuery };
}

describe('SupabaseRelationshipStateStore', () => {
  it('get maps DB row to domain RelationshipState', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseRelationshipStateStore(client);

    const state = await store.get('user-abc');

    expect(client.from).toHaveBeenCalledWith('relationship_state');
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-abc');
    expect(state).toEqual({
      userId: 'user-abc',
      respect: 65,
      warmth: 40,
      trust: 55,
      rivalry: 70,
      familiarity: 10,
      curiosity: 60,
      mode: 'sparring',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
  });

  it('get returns null if record does not exist', async () => {
    const { client, mockQuery } = createMockClient();
    mockQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const store = new SupabaseRelationshipStateStore(client);
    const state = await store.get('non-existent-user');
    expect(state).toBeNull();
  });

  it('applyDelta calls authoritative Postgres RPC append_event_and_apply_delta', async () => {
    const { client } = createMockClient();
    const store = new SupabaseRelationshipStateStore(client);

    const result = await store.applyDelta(
      'user-abc',
      {
        respectDelta: 5,
        trustDelta: 2,
        rivalryDelta: 1,
      },
      {
        eventType: 'challenge_judged',
        payload: { challengeId: 'ch-1' },
      },
    );

    expect(client.rpc).toHaveBeenCalledWith('append_event_and_apply_delta', {
      p_user_id: 'user-abc',
      p_event_type: 'challenge_judged',
      p_payload: { challengeId: 'ch-1' },
      p_respect_delta: 5,
      p_warmth_delta: 0,
      p_trust_delta: 2,
      p_rivalry_delta: 1,
      p_familiarity_delta: 0,
      p_curiosity_delta: 0,
      p_mode: null,
    });

    expect(result.eventId).toBe('event-uuid-999');
    expect(result.state.respect).toBe(65);
  });

  it('setMode validates and updates mode', async () => {
    const { client, mockQuery } = createMockClient();
    const store = new SupabaseRelationshipStateStore(client);

    const updated = await store.setMode('user-abc', 'mocking');

    expect(client.from).toHaveBeenCalledWith('relationship_state');
    expect(mockQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'mocking' }),
    );
    expect(updated.mode).toBe('mocking');
  });

  it('throws StoreValidationError on invalid inputs', async () => {
    const { client } = createMockClient();
    const store = new SupabaseRelationshipStateStore(client);

    await expect(store.get('')).rejects.toThrow(StoreValidationError);
    await expect(store.applyDelta('', {})).rejects.toThrow(StoreValidationError);
    await expect(store.setMode('', 'sparring')).rejects.toThrow(StoreValidationError);
    await expect(store.setMode('user-abc', 'invalid_mode' as any)).rejects.toThrow(
      StoreValidationError,
    );
  });

  it('throws DatabaseError when RPC fails', async () => {
    const { client } = createMockClient();
    (client.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC execution failure', code: '42883' },
    });

    const store = new SupabaseRelationshipStateStore(client);
    await expect(store.applyDelta('user-abc', { respectDelta: 2 })).rejects.toThrow(DatabaseError);
  });
});
