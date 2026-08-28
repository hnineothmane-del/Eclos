export type CapabilityCategory =
  | 'pressure_response'
  | 'ambiguity_response'
  | 'persistence'
  | 'recovery'
  | 'learning_performance'
  | 'adaptation';

export type CapabilityValence = 'positive' | 'neutral' | 'negative';

export interface CapabilityObservation {
  id: string;
  userId: string;
  category: CapabilityCategory;
  observation: string;
  valence: CapabilityValence;
  evidence: Record<string, unknown>;
  createdAt: string;
}
