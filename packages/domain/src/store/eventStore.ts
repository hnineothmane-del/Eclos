import type { DomainEvent, EventType, EventSource } from '../types/events.js';
import type { SupabaseClientLike } from './client.js';
import { DatabaseError, StoreValidationError } from './errors.js';

export interface AppendEventInput<T = Record<string, unknown>> {
  userId: string;
  eventType: EventType;
  payload?: T;
  source?: EventSource;
}

export interface IEventStore {
  append<T = Record<string, unknown>>(event: AppendEventInput<T>): Promise<DomainEvent<T>>;
  recentForUser(userId: string, limit?: number): Promise<DomainEvent[]>;
}

interface EventRow {
  id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function mapRowToDomainEvent<T = Record<string, unknown>>(row: EventRow): DomainEvent<T> {
  const source = (row.payload?.source as EventSource) || 'system';
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type as EventType,
    source,
    payload: row.payload as T,
    createdAt: row.created_at,
  };
}

export class SupabaseEventStore implements IEventStore {
  constructor(private readonly client: SupabaseClientLike) {}

  /**
   * Append-only insertion into the events table.
   * Note: No update or delete operations are exposed.
   */
  async append<T = Record<string, unknown>>(event: AppendEventInput<T>): Promise<DomainEvent<T>> {
    if (!event.userId) {
      throw new StoreValidationError('userId is required to append an event.');
    }
    if (!event.eventType) {
      throw new StoreValidationError('eventType is required to append an event.');
    }

    const payloadObj = (event.payload || {}) as Record<string, unknown>;
    const payloadWithSource = event.source && !payloadObj.source
      ? { ...payloadObj, source: event.source }
      : payloadObj;

    const { data, error } = await this.client
      .from<EventRow>('events')
      .insert({
        user_id: event.userId,
        event_type: event.eventType,
        payload: payloadWithSource,
      })
      .select()
      .single();

    if (error || !data) {
      throw new DatabaseError(
        `Failed to append event: ${error?.message || 'Unknown database error'}`,
        error?.code,
      );
    }

    return mapRowToDomainEvent<T>(data);
  }

  /**
   * Retrieves the most recent events for a given user ordered by created_at DESC.
   */
  async recentForUser(userId: string, limit = 50): Promise<DomainEvent[]> {
    if (!userId) {
      throw new StoreValidationError('userId is required to query recent events.');
    }

    const effectiveLimit = Math.max(1, Math.min(limit, 500));

    const { data, error } = await this.client
      .from<EventRow>('events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(effectiveLimit);

    if (error) {
      throw new DatabaseError(
        `Failed to query recent events for user ${userId}: ${error.message}`,
        error.code,
      );
    }

    return (data || []).map((row) => mapRowToDomainEvent(row));
  }
}
