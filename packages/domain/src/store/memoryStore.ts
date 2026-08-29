import type { MemoryItem, MemoryTier, MemoryCategory } from '../types/memory.js';
import { rankMemories, type RankedMemoryItem } from '../memory/retrieval.js';
import type { SupabaseClientLike } from './client.js';
import { DatabaseError, StoreValidationError } from './errors.js';

export interface WriteMemoryInput {
  id?: string;
  userId: string;
  tier: MemoryTier;
  category: MemoryCategory;
  key: string;
  value: Record<string, unknown> | string | number | boolean;
  strength?: number;
  lastAccessedAt?: string;
  expiresAt?: string | null;
}

export interface MemoryRetrievalContext {
  tags?: readonly string[];
  nowIso?: string;
  topK?: number;
  lastReferencedAtIso?: Readonly<Record<string, string>>;
}

export interface IMemoryStore {
  write(item: WriteMemoryInput): Promise<MemoryItem>;
  retrieveRelevant(userId: string, context?: MemoryRetrievalContext): Promise<RankedMemoryItem[]>;
  compact(userId: string, nowIso?: string): Promise<{ deletedCount: number }>;
}

interface MemoryRow {
  id: string;
  user_id: string;
  tier: string;
  category: string;
  key: string;
  value: Record<string, unknown> | string | number | boolean;
  strength: number;
  last_accessed_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToMemoryItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    userId: row.user_id,
    tier: row.tier as MemoryTier,
    category: row.category as MemoryCategory,
    key: row.key,
    value: row.value,
    strength: Number(row.strength),
    lastAccessedAt: row.last_accessed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseMemoryStore implements IMemoryStore {
  constructor(private readonly client: SupabaseClientLike) {}

  /**
   * Writes a memory item to Supabase memory_items table.
   */
  async write(item: WriteMemoryInput): Promise<MemoryItem> {
    if (!item.userId) {
      throw new StoreValidationError('userId is required to write a memory item.');
    }
    if (!item.tier || !['permanent', 'decaying'].includes(item.tier)) {
      throw new StoreValidationError(`Invalid memory tier: "${item.tier}"`);
    }
    if (!item.category) {
      throw new StoreValidationError('category is required to write a memory item.');
    }
    if (!item.key) {
      throw new StoreValidationError('key is required to write a memory item.');
    }

    const rowPayload: Record<string, unknown> = {
      user_id: item.userId,
      tier: item.tier,
      category: item.category,
      key: item.key,
      value: item.value,
      strength: item.strength !== undefined ? Math.max(0, Math.min(100, item.strength)) : 100,
      last_accessed_at: item.lastAccessedAt || new Date().toISOString(),
      expires_at: item.expiresAt ?? null,
      updated_at: new Date().toISOString(),
    };

    if (item.id) {
      rowPayload.id = item.id;
    }

    const { data, error } = await this.client
      .from<MemoryRow>('memory_items')
      .upsert(rowPayload, { onConflict: 'id' })
      .select()
      .single();

    if (error || !data) {
      throw new DatabaseError(
        `Failed to write memory item: ${error?.message || 'Unknown database error'}`,
        error?.code,
      );
    }

    return mapRowToMemoryItem(data);
  }

  /**
   * Fetches candidate memories for a user and delegates ranking to the pure rankMemories domain module.
   */
  async retrieveRelevant(userId: string, context: MemoryRetrievalContext = {}): Promise<RankedMemoryItem[]> {
    if (!userId) {
      throw new StoreValidationError('userId is required to retrieve relevant memories.');
    }

    const nowIso = context.nowIso || new Date().toISOString();

    const { data, error } = await this.client
      .from<MemoryRow>('memory_items')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new DatabaseError(
        `Failed to fetch memories for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    const rows = data || [];
    const items = rows.map((row) => mapRowToMemoryItem(row));

    // Filter out expired decaying items before ranking
    const activeItems = items.filter((item) => {
      if (item.tier === 'permanent') return true;
      if (item.expiresAt && new Date(item.expiresAt).getTime() <= new Date(nowIso).getTime()) {
        return false;
      }
      return item.strength > 0;
    });

    return rankMemories(activeItems, {
      tags: context.tags,
      nowIso,
      topK: context.topK,
      lastReferencedAtIso: context.lastReferencedAtIso,
    });
  }

  /**
   * Deletes expired decaying memories.
   */
  async compact(userId: string, nowIso?: string): Promise<{ deletedCount: number }> {
    if (!userId) {
      throw new StoreValidationError('userId is required to compact memory items.');
    }

    const effectiveNow = nowIso || new Date().toISOString();

    const { data, error } = await this.client
      .from<MemoryRow>('memory_items')
      .delete()
      .eq('user_id', userId)
      .eq('tier', 'decaying')
      .lte('expires_at', effectiveNow);

    if (error) {
      throw new DatabaseError(
        `Failed to compact memory items for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    const deletedCount = Array.isArray(data) ? data.length : 0;
    return { deletedCount };
  }
}
