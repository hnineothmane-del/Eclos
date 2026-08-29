import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Challenge judgment guard migration', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/0005_challenge_judgment_guard.sql'),
    'utf-8',
  );

  it('locks and guards the challenge before creating a judgment', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.judge_challenge[\s\S]*?FROM\s+public\.challenges[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/v_challenge\.status\s*<>\s*'evidence_submitted'/i);
    expect(sql).toMatch(/Evidence submission not found or does not belong/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.judgments/i);
  });

  it('serializes evidence rounds and returns the authoritative result', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.record_evidence_submission[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/'submission_id',\s*v_submission_id,\s*'evidence_round',\s*v_round/i);
  });

  it('negotiates terms and event atomically in one RPC', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.transition_challenge_negotiation/i);
    expect(sql).toMatch(/v_challenge\.status\s+NOT\s+IN\s*\('issued',\s*'negotiated'\)/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.events[\s\S]*?'challenge_negotiated'/i);
  });
});
