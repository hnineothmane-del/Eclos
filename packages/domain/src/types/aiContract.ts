import type { MemoryTier, MemoryCategory } from './memory.js';
import type { CapabilityCategory, CapabilityValence } from './capability.js';
import type { EventType } from './events.js';

export interface AIMemoryCandidate {
  tier: MemoryTier;
  category: MemoryCategory;
  key: string;
  value: Record<string, unknown> | string;
  confidence: number;
}

export interface AIObservationCandidate {
  category: CapabilityCategory;
  observation: string;
  valence: CapabilityValence;
  evidenceSnippet?: string;
}

export interface AIEventSuggestion {
  suggestedEventType: EventType;
  suggestedPayload: Record<string, unknown>;
  confidence: number;
}

/**
 * Advisory AI response contract.
 * Note: These fields are non-authoritative recommendations from the LLM.
 * Authoritative state changes (relationship deltas, challenge transitions,
 * subscription statuses) are strictly resolved by backend domain logic.
 */
export interface AIResponseContract {
  response: string;
  intent: string;
  humorMechanism?: string | null;
  register?: string | null;
  seriousFlag?: boolean;
  eventSuggestions?: AIEventSuggestion[];
  memoryCandidates?: AIMemoryCandidate[];
  observationCandidates?: AIObservationCandidate[];
}
