export type SubscriptionStatus =
  | 'on_trial'
  | 'active'
  | 'paused'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'expired';

export interface Subscription {
  id: string;
  userId: string;
  lemonSqueezyId: string;
  customerId: string;
  status: SubscriptionStatus;
  variantId: string;
  currentPeriodEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WebhookStatus = 'pending' | 'processed' | 'failed';

export interface WebhookEvent {
  id: string;
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
  status: WebhookStatus;
  processedAt: string | null;
  createdAt: string;
}

export interface UsageCounter {
  id: string;
  userId: string;
  period: string;
  interactionCount: number;
  challengeCount: number;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}
