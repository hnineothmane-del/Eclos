import type { HumorLedgerItem } from '../types/memory.js';
import type { SupabaseClientLike } from './client.js';
import { DatabaseError, StoreValidationError } from './errors.js';

export interface JokeKeyInput {
  theme: string;
  target: string;
}

export interface JokeCooldownResult {
  inCooldown: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface IHumorStateStore {
  recentMechanisms(userId: string, windowSize?: number): Promise<string[]>;
  jokeCooldownStatus(
    userId: string,
    jokeKey: JokeKeyInput | string,
    cooldownWindowMinutes?: number,
    nowIso?: string,
  ): Promise<JokeCooldownResult>;
  record(
    userId: string,
    theme: string,
    target?: string,
    intensity?: number,
  ): Promise<HumorLedgerItem>;
}

interface HumorLedgerRow {
  id: string;
  user_id: string;
  theme: string;
  target: string;
  intensity: number;
  usage_count: number;
  last_used_at: string;
  created_at: string;
}

function mapRowToHumorLedgerItem(row: HumorLedgerRow): HumorLedgerItem {
  return {
    id: row.id,
    userId: row.user_id,
    theme: row.theme,
    target: row.target,
    intensity: row.intensity,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function parseJokeKey(jokeKey: JokeKeyInput | string): JokeKeyInput {
  if (typeof jokeKey === 'string') {
    const parts = jokeKey.split(':');
    return {
      theme: parts[0] || 'general',
      target: parts.slice(1).join(':') || 'general',
    };
  }
  return jokeKey;
}

export class SupabaseHumorStateStore implements IHumorStateStore {
  constructor(private readonly client: SupabaseClientLike) {}

  /**
   * Returns recent themes/mechanisms used for the user, ordered by last_used_at DESC.
   */
  async recentMechanisms(userId: string, windowSize = 10): Promise<string[]> {
    if (!userId) {
      throw new StoreValidationError('userId is required to query recent mechanisms.');
    }

    const effectiveLimit = Math.max(1, Math.min(windowSize, 100));

    const { data, error } = await this.client
      .from<HumorLedgerRow>('humor_ledger')
      .select('theme')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(effectiveLimit);

    if (error) {
      throw new DatabaseError(
        `Failed to query recent humor mechanisms for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    return (data || []).map((row) => row.theme);
  }

  /**
   * Determines if a joke theme/target is currently in cooldown.
   */
  async jokeCooldownStatus(
    userId: string,
    jokeKey: JokeKeyInput | string,
    cooldownWindowMinutes = 30,
    nowIso?: string,
  ): Promise<JokeCooldownResult> {
    if (!userId) {
      throw new StoreValidationError('userId is required to check joke cooldown.');
    }

    const parsedKey = parseJokeKey(jokeKey);
    const effectiveNow = nowIso ? new Date(nowIso) : new Date();

    const { data, error } = await this.client
      .from<HumorLedgerRow>('humor_ledger')
      .select('*')
      .eq('user_id', userId)
      .eq('theme', parsedKey.theme)
      .eq('target', parsedKey.target)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        `Failed to check joke cooldown for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    if (!data) {
      return {
        inCooldown: false,
        usageCount: 0,
        lastUsedAt: null,
      };
    }

    const lastUsedTime = new Date(data.last_used_at).getTime();
    const elapsedMinutes = (effectiveNow.getTime() - lastUsedTime) / (1000 * 60);

    const inCooldown = elapsedMinutes < cooldownWindowMinutes;

    return {
      inCooldown,
      usageCount: data.usage_count,
      lastUsedAt: data.last_used_at,
    };
  }

  /**
   * Records the usage of a humor theme/target, updating usage_count and last_used_at.
   */
  async record(
    userId: string,
    theme: string,
    target = 'general',
    intensity = 5,
  ): Promise<HumorLedgerItem> {
    if (!userId) {
      throw new StoreValidationError('userId is required to record humor usage.');
    }
    if (!theme) {
      throw new StoreValidationError('theme is required to record humor usage.');
    }

    const effectiveTarget = target || 'general';
    const effectiveIntensity = Math.max(1, Math.min(10, intensity));
    const nowIso = new Date().toISOString();

    // Check if existing record exists to increment usage_count
    const { data: existing } = await this.client
      .from<HumorLedgerRow>('humor_ledger')
      .select('*')
      .eq('user_id', userId)
      .eq('theme', theme)
      .eq('target', effectiveTarget)
      .maybeSingle();

    const nextUsageCount = existing ? existing.usage_count + 1 : 1;

    const payload: Record<string, unknown> = {
      user_id: userId,
      theme,
      target: effectiveTarget,
      intensity: effectiveIntensity,
      usage_count: nextUsageCount,
      last_used_at: nowIso,
    };

    if (existing?.id) {
      payload.id = existing.id;
    }

    const { data, error } = await this.client
      .from<HumorLedgerRow>('humor_ledger')
      .upsert(payload, { onConflict: 'user_id,theme,target' })
      .select()
      .single();

    if (error || !data) {
      throw new DatabaseError(
        `Failed to record humor ledger item: ${error?.message || 'Unknown database error'}`,
        error?.code,
      );
    }

    return mapRowToHumorLedgerItem(data);
  }
}
