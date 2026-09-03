export type EventSource = 'ai_suggested' | 'system' | 'user_action';

export type EventType =
  | 'challenge_issued'
  | 'challenge_accepted'
  | 'challenge_negotiated'
  | 'challenge_started'
  | 'challenge_attempted'
  | 'evidence_submitted'
  | 'needs_more_evidence'
  | 'challenge_judged'
  | 'challenge_closed'
  | 'relationship_delta_applied'
  | 'observation_recorded'
  | 'memory_stored'
  | 'memory_decayed'
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_cancelled'
  | 'billing_webhook_processed'
  | 'usage_incremented'
  | 'chat_message_sent'
  | 'process_signal'
  | 'process_thought'
  | 'rival_interaction'
  | 'agency_initiative'
  | 'rival_easter_egg_discovered'
  | 'rival_lore_revealed';

export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  userId: string;
  eventType: EventType;
  source: EventSource;
  payload: T;
  createdAt: string;
}
