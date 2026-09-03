import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const initializationMigration = readFileSync(resolve(__dirname, '../migrations/0009_entitlements.sql'), 'utf8');
const modeAlignmentMigration = readFileSync(resolve(__dirname, '../migrations/0010_relationship_mode_alignment.sql'), 'utf8');
const functionSource = readFileSync(resolve(__dirname, '../functions/chat-turn/index.ts'), 'utf8');

describe('fresh user initialization contract', () => {
  it('creates the relationship state with the domain initializer mode', () => {
    expect(initializationMigration).toMatch(/INSERT INTO public\.relationship_state/i);
    expect(initializationMigration).toMatch(/p_user_id, 0, 0, 0, 0, 0, 0, 'adaptive'/i);
    expect(modeAlignmentMigration).toMatch(/'adaptive'/i);
    expect(modeAlignmentMigration).toMatch(/relationship_state_mode_check/i);
  });

  it('allows the service-role chat-turn path to initialize before planning', () => {
    expect(functionSource).toMatch(/createClient\(supabaseUrl, serviceRoleKey\)/i);
    expect(functionSource).toMatch(/trustedClient\.rpc\('initialize_user_state', \{ p_user_id: user\.id \}\)/i);
    expect(functionSource.indexOf("initialize_user_state")).toBeLessThan(functionSource.indexOf('new ResponsePlanner'));
  });
});
