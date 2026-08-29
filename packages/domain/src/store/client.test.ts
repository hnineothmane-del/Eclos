import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseClient } from './client.js';
import { DatabaseError } from './errors.js';

describe('createSupabaseClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('encodes upsert conflict columns in the PostgREST query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'humor-1' }), { status: 201 }),
    );
    const client = createSupabaseClient({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'service-role-key',
      fetchFn,
    });

    await client
      .from('humor_ledger')
      .upsert({ user_id: 'user-1', theme: 'sarcasm', target: 'delay' }, {
        onConflict: 'user_id,theme,target',
      })
      .select()
      .single();

    const [requestUrl, requestOptions] = fetchFn.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.searchParams.get('on_conflict')).toBe('user_id,theme,target');
    expect(requestOptions.headers.Prefer).toBe('return=representation,resolution=merge-duplicates');
  });

  it('does not fall back to VITE/public environment variables for privileged writes', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://public.example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const fetchFn = vi.fn();
    const client = createSupabaseClient({ fetchFn });

    await expect(client.from('events').select()).rejects.toThrow(DatabaseError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
