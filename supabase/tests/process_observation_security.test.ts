import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Process observation security migration', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/0008_process_observation_security.sql'),
    'utf-8',
  );

  it('derives capture ownership from the authenticated user and challenge', () => {
    expect(sql).toMatch(/v_user_id\s+UUID\s*:=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/IF\s+v_user_id\s+IS\s+NULL[\s\S]*?Authentication required/i);
    expect(sql).toMatch(/v_challenge_user_id\s*<>\s*v_user_id/i);
    expect(sql).not.toMatch(/p_user_id/i);
  });

  it('removes the old client-user overload and restricts execution to authenticated callers', () => {
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.record_process_capture\(UUID,\s*UUID,/i);
    expect(sql).toMatch(/REVOKE\s+EXECUTE[\s\S]*?FROM\s+PUBLIC/i);
    expect(sql).toMatch(/REVOKE\s+EXECUTE[\s\S]*?FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*?TO\s+authenticated/i);
  });

  it('bounds and validates capture payloads against the capture-profile vocabulary', () => {
    expect(sql).toMatch(/content exceeds 1000 characters/i);
    expect(sql).toMatch(/signal exceeds 64 characters/i);
    expect(sql).toMatch(/Artifact reference exceeds 512 characters/i);
    expect(sql).toContain("'CHANGING APPROACH'");
    expect(sql).toContain("'CONNECTING IT'");
    expect(sql).toMatch(/Invalid process signal for challenge domain/i);
    expect(sql).toMatch(/Process thought cannot include a signal/i);
    expect(sql).toMatch(/Process signal cannot include an artifact reference/i);
  });

  it('records only the authenticated user, a server timestamp, and fixed payload fields', () => {
    expect(sql).toMatch(/VALUES\s*\(v_user_id,\s*p_capture_type,\s*v_payload\)/i);
    expect(sql).toMatch(/'captured_at',\s*now\(\)/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.events/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.events|DELETE\s+FROM\s+public\.events/i);
  });
});
