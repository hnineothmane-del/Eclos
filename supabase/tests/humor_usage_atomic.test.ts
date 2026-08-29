import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Atomic humor usage migration', () => {
  const migrationPath = path.resolve(__dirname, '../migrations/0004_humor_usage_atomic.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('increments usage_count inside a single ON CONFLICT statement', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_humor_usage/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(user_id,\s*theme,\s*target\)\s+DO\s+UPDATE/i);
    expect(sql).toMatch(/usage_count\s*=\s*public\.humor_ledger\.usage_count\s*\+\s*1/i);
  });

  it('restricts the authoritative RPC to service_role', () => {
    expect(sql).toMatch(/REVOKE\s+EXECUTE[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated;/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*?TO\s+service_role;/i);
  });
});
