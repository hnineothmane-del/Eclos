import { DatabaseError } from './errors.js';

export interface PostgrestResponse<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

export interface QueryFilterBuilder<TRow = any> extends PromiseLike<PostgrestResponse<TRow[]>> {
  select(columns?: string): QueryFilterBuilder<TRow>;
  eq(column: string, value: unknown): QueryFilterBuilder<TRow>;
  neq(column: string, value: unknown): QueryFilterBuilder<TRow>;
  gt(column: string, value: unknown): QueryFilterBuilder<TRow>;
  gte(column: string, value: unknown): QueryFilterBuilder<TRow>;
  lt(column: string, value: unknown): QueryFilterBuilder<TRow>;
  lte(column: string, value: unknown): QueryFilterBuilder<TRow>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryFilterBuilder<TRow>;
  limit(count: number): QueryFilterBuilder<TRow>;
  range(from: number, to: number): QueryFilterBuilder<TRow>;
  single(): Promise<PostgrestResponse<TRow>>;
  maybeSingle(): Promise<PostgrestResponse<TRow>>;
}

export interface QueryTableBuilder<TRow = any> {
  select(columns?: string): QueryFilterBuilder<TRow>;
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): QueryFilterBuilder<TRow>;
  upsert(
    values: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): QueryFilterBuilder<TRow>;
  update(values: Record<string, unknown>): QueryFilterBuilder<TRow>;
  delete(): QueryFilterBuilder<TRow>;
}

export interface SupabaseClientLike {
  from<TRow = any>(table: string): QueryTableBuilder<TRow>;
  rpc<T = any>(fn: string, params?: Record<string, unknown>): Promise<PostgrestResponse<T>>;
}

export interface SupabaseClientConfig {
  supabaseUrl?: string;
  supabaseKey?: string;
  fetchFn?: typeof fetch;
}

function getEnvVar(key: string): string {
  const globalEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return globalEnv?.[key] || '';
}

/**
 * Creates a minimal, fetch-based server-side SupabaseClientLike implementation
 * without external dependencies. Write-capable stores require server credentials.
 */
export function createSupabaseClient(config: SupabaseClientConfig = {}): SupabaseClientLike {
  const url = config.supabaseUrl || getEnvVar('SUPABASE_URL') || '';
  const key = config.supabaseKey || getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || '';
  const fetchFn = config.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as unknown as typeof fetch));

  const cleanUrl = url.replace(/\/+$/, '');

  const executePostgrest = async <T>(
    endpoint: string,
    method: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<PostgrestResponse<T>> => {
    if (!fetchFn) {
      throw new DatabaseError('No fetch implementation available in current environment.');
    }
    if (!url || !key) {
      throw new DatabaseError('Supabase URL and API Key must be configured.');
    }

    const reqHeaders: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    };

    try {
      const response = await fetchFn(`${cleanUrl}${endpoint}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        let errorData: { message?: string; code?: string; details?: string; hint?: string } = {};
        try {
          errorData = (await response.json()) as typeof errorData;
        } catch {
          errorData = { message: `HTTP ${response.status} ${response.statusText}` };
        }
        return {
          data: null,
          error: {
            message: errorData.message || `Database error (${response.status})`,
            code: errorData.code,
            details: errorData.details,
            hint: errorData.hint,
          },
        };
      }

      // Check if response has body
      const text = await response.text();
      if (!text) {
        return { data: null, error: null };
      }

      const data = JSON.parse(text) as T;
      return { data, error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network request failed';
      return {
        data: null,
        error: { message: `Supabase network error: ${msg}` },
      };
    }
  };

  return {
    from<TRow = any>(table: string): QueryTableBuilder<TRow> {
      let method = 'GET';
      const params = new URLSearchParams();
      let bodyData: unknown = undefined;
      const headers: Record<string, string> = {};

      const createBuilder = (): QueryFilterBuilder<TRow> => {
        const builder: any = {
          select(cols = '*') {
            params.set('select', cols);
            return builder;
          },
          eq(col: string, val: unknown) {
            params.append(col, `eq.${String(val)}`);
            return builder;
          },
          neq(col: string, val: unknown) {
            params.append(col, `neq.${String(val)}`);
            return builder;
          },
          gt(col: string, val: unknown) {
            params.append(col, `gt.${String(val)}`);
            return builder;
          },
          gte(col: string, val: unknown) {
            params.append(col, `gte.${String(val)}`);
            return builder;
          },
          lt(col: string, val: unknown) {
            params.append(col, `lt.${String(val)}`);
            return builder;
          },
          lte(col: string, val: unknown) {
            params.append(col, `lte.${String(val)}`);
            return builder;
          },
          order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
            const dir = opts?.ascending === false ? 'desc' : 'asc';
            const nulls = opts?.nullsFirst ? '.nullsfirst' : '';
            params.append('order', `${col}.${dir}${nulls}`);
            return builder;
          },
          limit(count: number) {
            params.set('limit', String(count));
            return builder;
          },
          range(from: number, to: number) {
            params.set('offset', String(from));
            params.set('limit', String(to - from + 1));
            return builder;
          },
          async single() {
            headers['Accept'] = 'application/vnd.pgrst.object+json';
            const qs = params.toString();
            const endpoint = `/rest/v1/${table}${qs ? `?${qs}` : ''}`;
            return executePostgrest<TRow>(endpoint, method, headers, bodyData);
          },
          async maybeSingle() {
            headers['Accept'] = 'application/vnd.pgrst.object+json';
            const qs = params.toString();
            const endpoint = `/rest/v1/${table}${qs ? `?${qs}` : ''}`;
            const res = await executePostgrest<TRow>(endpoint, method, headers, bodyData);
            if (res.error && res.error.code === 'PGRST116') {
              return { data: null, error: null };
            }
            return res;
          },
          then(onfulfilled: any, onrejected: any) {
            const qs = params.toString();
            const endpoint = `/rest/v1/${table}${qs ? `?${qs}` : ''}`;
            return executePostgrest<TRow[]>(endpoint, method, headers, bodyData).then(onfulfilled, onrejected);
          },
        };
        return builder;
      };

      return {
        select(columns = '*') {
          method = 'GET';
          params.set('select', columns);
          return createBuilder();
        },
        insert(values) {
          method = 'POST';
          bodyData = values;
          headers['Prefer'] = 'return=representation';
          return createBuilder();
        },
        upsert(values, options) {
          method = 'POST';
          bodyData = values;
          if (options?.onConflict) {
            params.set('on_conflict', options.onConflict);
          }
          headers['Prefer'] = `return=representation,resolution=${options?.ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'}`;
          return createBuilder();
        },
        update(values) {
          method = 'PATCH';
          bodyData = values;
          headers['Prefer'] = 'return=representation';
          return createBuilder();
        },
        delete() {
          method = 'DELETE';
          headers['Prefer'] = 'return=representation';
          return createBuilder();
        },
      };
    },

    async rpc<T = any>(fn: string, rpcParams?: Record<string, unknown>): Promise<PostgrestResponse<T>> {
      return executePostgrest<T>(`/rest/v1/rpc/${fn}`, 'POST', {}, rpcParams || {});
    },
  };
}
