import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Supabase Database Foundation (Task 2)', () => {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const migration1Path = path.join(migrationsDir, '0001_core_tables.sql');
  const migration2Path = path.join(migrationsDir, '0002_rls_and_grants.sql');
  const migration3Path = path.join(migrationsDir, '0003_authoritative_functions.sql');

  const sql1 = fs.readFileSync(migration1Path, 'utf-8');
  const sql2 = fs.readFileSync(migration2Path, 'utf-8');
  const sql3 = fs.readFileSync(migration3Path, 'utf-8');

  describe('1. Clean Migration & Core Tables Structure', () => {
    const requiredTables = [
      'goals',
      'chat_messages',
      'relationship_state',
      'challenges',
      'evidence_submissions',
      'judgments',
      'memory_items',
      'humor_ledger',
      'events',
      'capability_observations',
      'subscriptions',
      'webhook_events',
      'usage_counters',
    ];

    it('creates all 13 required core tables', () => {
      for (const table of requiredTables) {
        const regex = new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?public\\.${table}\\b`, 'i');
        expect(sql1, `Table ${table} should be created`).toMatch(regex);
      }
    });

    it('enforces UUID primary keys with gen_random_uuid()', () => {
      for (const table of requiredTables) {
        expect(sql1).toMatch(new RegExp(`public\\.${table}[\\s\\S]*?id\\s+UUID\\s+PRIMARY\\s+KEY\\s+DEFAULT\\s+gen_random_uuid\\(\\)`, 'i'));
      }
    });
  });

  describe('2. Cross-User Isolation & RLS Policies', () => {
    const userTables = [
      'goals',
      'chat_messages',
      'relationship_state',
      'challenges',
      'evidence_submissions',
      'judgments',
      'memory_items',
      'humor_ledger',
      'events',
      'capability_observations',
      'subscriptions',
      'usage_counters',
    ];

    it('enables RLS on all 13 tables', () => {
      const all13 = [...userTables, 'webhook_events'];
      for (const table of all13) {
        expect(sql2).toMatch(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY;`, 'i'));
      }
    });

    it('defines SELECT policies scoping auth.uid() = user_id for all user-facing tables', () => {
      for (const table of userTables) {
        expect(sql2).toMatch(new RegExp(`ON\\s+public\\.${table}\\s+FOR\\s+SELECT[\\s\\S]*?USING\\s*\\(\\s*auth\\.uid\\(\\)\\s*=\\s*user_id\\s*\\);`, 'i'));
      }
    });

    it('guarantees webhook_events has no client access policies', () => {
      expect(sql2).not.toMatch(/ON\s+public\.webhook_events\s+FOR\s+SELECT\s+TO\s+(authenticated|anon)/i);
      expect(sql2).not.toMatch(/ON\s+public\.webhook_events\s+FOR\s+(INSERT|UPDATE|DELETE)/i);
    });
  });

  describe('3. Client Write Rejection & Security Grants', () => {
    it('does not define INSERT, UPDATE, or DELETE policies for authenticated or anon roles', () => {
      expect(sql2).not.toMatch(/CREATE\s+POLICY[\\s\\S]*?FOR\s+(INSERT|UPDATE|DELETE)\s+TO\s+(authenticated|anon)/i);
    });

    it('revokes public/anon privileges and grants selective permissions', () => {
      expect(sql2).toMatch(/REVOKE\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+PUBLIC,\s*anon;/i);
      expect(sql2).toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO\s+service_role;/i);
    });
  });

  describe('4. Event Immutability Mechanism', () => {
    it('creates an append-only trigger forbidding UPDATE or DELETE on events table', () => {
      expect(sql2).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.prevent_events_modification\(\)/i);
      expect(sql2).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.events/i);
      expect(sql2).toMatch(/RAISE\s+EXCEPTION\s+'events\s+table\s+is\s+append-only/i);
    });
  });

  describe('5. Foreign Keys & Cascading Deletes', () => {
    it('links user_id to auth.users(id) ON DELETE CASCADE', () => {
      const authLinkedTables = [
        'goals',
        'chat_messages',
        'relationship_state',
        'challenges',
        'evidence_submissions',
        'judgments',
        'memory_items',
        'humor_ledger',
        'events',
        'capability_observations',
        'subscriptions',
        'usage_counters',
      ];
      for (const table of authLinkedTables) {
        expect(sql1).toMatch(new RegExp(`public\\.${table}[\\s\\S]*?user_id\\s+UUID\\s+NOT\\s+NULL[\\s\\S]*?REFERENCES\\s+auth\\.users\\(id\\)\\s+ON\\s+DELETE\\s+CASCADE`, 'i'));
      }
    });

    it('links evidence_submissions and judgments to challenges with foreign keys', () => {
      expect(sql1).toMatch(/challenge_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.challenges\(id\)\s+ON\s+DELETE\s+CASCADE/i);
      expect(sql1).toMatch(/evidence_submission_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.evidence_submissions\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    });
  });

  describe('6. Challenge Lifecycle & Constraints', () => {
    it('enforces valid challenge statuses in CHECK constraint', () => {
      const expectedStatuses = [
        'issued', 'negotiated', 'accepted', 'started',
        'attempted', 'evidence_submitted', 'needs_more_evidence',
        'judged', 'closed'
      ];
      for (const status of expectedStatuses) {
        expect(sql1).toContain(`'${status}'`);
      }
    });

    it('validates lifecycle transitions in transition_challenge_status()', () => {
      expect(sql3).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transition_challenge_status/i);
      expect(sql3).toContain('issued');
      expect(sql3).toContain('negotiated');
      expect(sql3).toContain('accepted');
      expect(sql3).toContain('started');
      expect(sql3).toContain('attempted');
      expect(sql3).toContain('evidence_submitted');
      expect(sql3).toContain('needs_more_evidence');
      expect(sql3).toContain('judged');
      expect(sql3).toContain('closed');
      expect(sql3).toMatch(/RAISE\s+EXCEPTION\s+'Invalid\s+challenge\s+status\s+transition/i);
    });
  });

  describe('7. Multi-Round Evidence & Ownership Check', () => {
    it('enforces UNIQUE(challenge_id, round) constraint on evidence_submissions', () => {
      expect(sql1).toMatch(/CONSTRAINT\s+uq_challenge_round\s+UNIQUE\s*\(challenge_id,\s*round\)/i);
    });

    it('verifies challenge.user_id === p_user_id inside record_evidence_submission()', () => {
      expect(sql3).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_evidence_submission/i);
      expect(sql3).toMatch(/IF\s+v_challenge_user_id\s*<>\s*p_user_id\s+THEN\s+RAISE\s+EXCEPTION\s+'Unauthorized:\s*challenge\s+does\s+not\s+belong\s+to\s+user';/i);
    });

    it('automatically increments evidence round number', () => {
      expect(sql3).toMatch(/SELECT\s+COALESCE\(MAX\(round\),\s*0\)\s*\+\s*1\s+INTO\s+v_round/i);
    });
  });

  describe('8. Subscription Uniqueness', () => {
    it('enforces exactly one subscription row per user', () => {
      expect(sql1).toMatch(/user_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+auth\.users\(id\)/i);
      expect(sql1).toMatch(/lemon_squeezy_id\s+TEXT\s+UNIQUE/i);
    });
  });

  describe('9. Webhook Idempotency', () => {
    it('has unique constraint on webhook_events(event_id)', () => {
      expect(sql1).toMatch(/event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    });

    it('handles duplicate webhooks gracefully in process_billing_webhook()', () => {
      expect(sql3).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.process_billing_webhook/i);
      expect(sql3).toMatch(/IF\s+v_existing_status\s*=\s*'processed'\s+THEN\s+RETURN\s+jsonb_build_object\('status',\s*'already_processed'/i);
    });
  });

  describe('10. Atomic Relationship Updates & Clamping', () => {
    it('enforces 0-100 check constraints on relationship_state table', () => {
      const attributes = ['respect', 'warmth', 'trust', 'rivalry', 'familiarity', 'curiosity'];
      for (const attr of attributes) {
        expect(sql1).toMatch(new RegExp(`${attr}\\s+INTEGER\\s+NOT\\s+NULL[\\s\\S]*?CHECK\\s*\\(${attr}\\s*>=\\s*0\\s+AND\\s+${attr}\\s*<=\\s*100\\)`, 'i'));
      }
    });

    it('clamps deltas to 0-100 in append_event_and_apply_delta() and judge_challenge()', () => {
      expect(sql3).toMatch(/GREATEST\(0,\s*LEAST\(100,\s*public\.relationship_state\.respect\s*\+\s*p_respect_delta\)\)/i);
      expect(sql3).toMatch(/GREATEST\(0,\s*LEAST\(100,\s*public\.relationship_state\.trust\s*\+\s*p_trust_delta\)\)/i);
    });

    it('preserves complete event traceability chain in judge_challenge()', () => {
      expect(sql3).toMatch(/'evidence_submission_id',\s*p_evidence_submission_id/i);
      expect(sql3).toMatch(/'judgment_id',\s*v_judgment_id/i);
      expect(sql3).toMatch(/'resulting_relationship_state',\s*v_rel_state/i);
    });
  });

  describe('11. Usage Limits & Counters', () => {
    it('enforces UNIQUE(user_id, period) on usage_counters', () => {
      expect(sql1).toMatch(/CONSTRAINT\s+uq_usage_user_period\s+UNIQUE\s*\(user_id,\s*period\)/i);
    });

    it('implements increment_usage_and_check() with limit calculation', () => {
      expect(sql3).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.increment_usage_and_check/i);
      expect(sql3).toMatch(/v_allowed\s*:=\s*\(v_interaction_cnt\s*<=\s*p_daily_limit\);/i);
    });
  });

  describe('12. Capability Observations Vocabulary', () => {
    it('strictly restricts categories to controlled psychological vocabulary', () => {
      const controlledCategories = [
        'pressure_response',
        'ambiguity_response',
        'persistence',
        'recovery',
        'learning_performance',
        'adaptation',
      ];
      for (const cat of controlledCategories) {
        expect(sql1).toContain(`'${cat}'`);
      }
      expect(sql1).toMatch(/category\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*category\s+IN/i);
    });
  });

  describe('13. Authoritative RPC Security & Privileges', () => {
    it('sets SECURITY DEFINER and search_path = public on all RPC functions', () => {
      const functions = [
        'append_event_and_apply_delta',
        'transition_challenge_status',
        'record_evidence_submission',
        'judge_challenge',
        'process_billing_webhook',
        'increment_usage_and_check',
      ];
      for (const fn of functions) {
        expect(sql3).toMatch(new RegExp(`FUNCTION\\s+public\\.${fn}[\\s\\S]*?SECURITY\\s+DEFINER[\\s\\S]*?SET\\s+search_path\\s*=\\s*public`, 'i'));
      }
    });

    it('restricts administrative functions to service_role', () => {
      expect(sql3).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.judge_challenge\s+FROM\s+PUBLIC,\s*anon;/i);
      expect(sql3).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.process_billing_webhook\s+FROM\s+PUBLIC,\s*anon;/i);
      expect(sql3).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.append_event_and_apply_delta\s+FROM\s+PUBLIC,\s*anon;/i);
    });
  });
});
