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
  mode?: RelationshipMode;
}

export interface IRelationshipStateStore {
  get(userId: string): Promise<RelationshipState | null>;
  applyDelta(
    userId: string,
    deltas: RelationshipDeltas,
    options?: ApplyDeltaOptions,
  ): Promise<{ eventId: string; state: RelationshipState }>;
  setMode(userId: string, mode: RelationshipMode): Promise<RelationshipState>;
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

const VALID_MODES = new Set<RelationshipMode>([
  'adaptive',
  'permanent_rival',
  'sparring',
  'coaching',
  'mocking',
  'observing',
  'dismissive',
]);

const DB_MODES = new Set([
  'sparring',
  'coaching',
  'mocking',
  'observing',
  'dismissive',
]);

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

    let modeParam: string | null = null;
    if (options.mode) {
      if (!VALID_MODES.has(options.mode)) {
        throw new StoreValidationError(`Invalid relationship mode: "${options.mode}"`);
      }
      modeParam = DB_MODES.has(options.mode) ? options.mode : 'observing';
    }

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
      p_mode: modeParam,
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

  /**
   * Updates the relationship mode for a user.
   */
  async setMode(userId: string, mode: RelationshipMode): Promise<RelationshipState> {
    if (!userId) {
      throw new StoreValidationError('userId is required to set relationship mode.');
    }
    if (!VALID_MODES.has(mode)) {
      throw new StoreValidationError(`Invalid relationship mode: "${mode}"`);
    }

    const dbMode = DB_MODES.has(mode) ? mode : 'observing';

    const { data, error } = await this.client
      .from<RelationshipStateRow>('relationship_state')
      .update({
        mode: dbMode,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new DatabaseError(
        `Failed to update relationship mode for user ${userId}: ${error?.message || 'Unknown error'}`,
        error?.code,
      );
    }

    return mapRowToRelationshipState(data);
  }
}
