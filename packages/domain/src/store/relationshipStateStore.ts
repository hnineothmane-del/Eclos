import type {
  RelationshipState,
  RelationshipMode,
  RelationshipDeltas,
} from '../types/relationship.js';
import type { EventType } from '../types/events.js';
import type { SupabaseClientLike } from './client.js';
import { DatabaseError, StoreValidationError, NotFoundError } from './errors.js';

export interface ApplyDeltaOptions {
  eventType?: EventType;
  payload?: Record<string, unknown>;
}

export interface IRelationshipStateStore {
  get(userId: string): Promise<RelationshipState | null>;
  applyDelta(
    userId: string,
    deltas: RelationshipDeltas,
    options?: ApplyDeltaOptions,
  ): Promise<{ eventId: string; state: RelationshipState }>;
}

interface RelationshipStateRow {
  id?: string;
  user_id: string;
  respect: number;
  warmth: number;
  trust: number;
  rivalry: number;
  familiarity: number;
  curiosity: number;
  mode: string;
  created_at?: string;
  updated_at: string;
}

function mapRowToRelationshipState(row: RelationshipStateRow): RelationshipState {
  return {
    userId: row.user_id,
    respect: row.respect,
    warmth: row.warmth,
    trust: row.trust,
    rivalry: row.rivalry,
    familiarity: row.familiarity,
    curiosity: row.curiosity,
    mode: row.mode as RelationshipMode,
    updatedAt: row.updated_at,
  };
}

export class SupabaseRelationshipStateStore implements IRelationshipStateStore {
  constructor(private readonly client: SupabaseClientLike) {}

  /**
   * Retrieves the current relationship state for a user.
   */
  async get(userId: string): Promise<RelationshipState | null> {
    if (!userId) {
      throw new StoreValidationError('userId is required to query relationship state.');
    }

    const { data, error } = await this.client
      .from<RelationshipStateRow>('relationship_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        `Failed to retrieve relationship state for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    if (!data) {
      return null;
    }

    return mapRowToRelationshipState(data);
  }

  /**
   * Applies relationship deltas atomically via the authoritative Postgres RPC:
   * append_event_and_apply_delta
   */
  async applyDelta(
    userId: string,
    deltas: RelationshipDeltas,
    options: ApplyDeltaOptions = {},
  ): Promise<{ eventId: string; state: RelationshipState }> {
    if (!userId) {
      throw new StoreValidationError('userId is required to apply relationship deltas.');
    }

    const eventType = options.eventType || 'relationship_delta_applied';
    const payload = options.payload || {};

    const rpcParams = {
      p_user_id: userId,
      p_event_type: eventType,
      p_payload: payload,
      p_respect_delta: deltas.respectDelta ?? 0,
      p_warmth_delta: deltas.warmthDelta ?? 0,
      p_trust_delta: deltas.trustDelta ?? 0,
      p_rivalry_delta: deltas.rivalryDelta ?? 0,
      p_familiarity_delta: deltas.familiarityDelta ?? 0,
      p_curiosity_delta: deltas.curiosityDelta ?? 0,
      p_mode: null,
    };

    const { data: eventId, error } = await this.client.rpc<string>(
      'append_event_and_apply_delta',
      rpcParams,
    );

    if (error || !eventId) {
      throw new DatabaseError(
        `Failed to apply relationship delta via RPC: ${error?.message || 'Unknown database error'}`,
        error?.code,
      );
    }

    // Fetch the updated state
    const state = await this.get(userId);
    if (!state) {
      throw new NotFoundError('RelationshipState', userId);
    }

    return {
      eventId,
      state,
    };
  }

}
