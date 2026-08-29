import type {
  AIResponseContract,
  AIMemoryCandidate,
  AIObservationCandidate,
  AIEventSuggestion,
} from '../types/aiContract.js';
import type { EvaluationResult, MultimodalAnalysisResult } from './provider.js';
import { InvalidStructuredOutputError } from './errors.js';

const VALID_MEMORY_TIERS = new Set(['permanent', 'decaying']);
const VALID_CAPABILITY_VALENCES = new Set(['positive', 'negative', 'neutral']);
const VALID_EVALUATION_OUTCOMES = new Set(['completed', 'failed', 'needs_more_evidence']);

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validates that an untyped object matches the AIResponseContract specification.
 * Throws InvalidStructuredOutputError on failure.
 */
export function validateAIResponseContract(data: unknown, rawText?: string): AIResponseContract {
  if (!isObject(data)) {
    throw new InvalidStructuredOutputError(
      'Malformed AIResponseContract: Expected a JSON object',
      rawText,
      ['Root must be an object'],
    );
  }

  const issues: string[] = [];

  if (typeof data.response !== 'string') {
    issues.push('Missing or non-string "response" field');
  }

  if (typeof data.intent !== 'string') {
    issues.push('Missing or non-string "intent" field');
  }

  if (data.humorMechanism !== undefined && data.humorMechanism !== null && typeof data.humorMechanism !== 'string') {
    issues.push('Field "humorMechanism" must be string, null, or undefined');
  }

  if (data.register !== undefined && data.register !== null && typeof data.register !== 'string') {
    issues.push('Field "register" must be string, null, or undefined');
  }

  if (data.seriousFlag !== undefined && typeof data.seriousFlag !== 'boolean') {
    issues.push('Field "seriousFlag" must be boolean or undefined');
  }

  // Validate eventSuggestions
  let eventSuggestions: AIEventSuggestion[] | undefined;
  if (data.eventSuggestions !== undefined) {
    if (!Array.isArray(data.eventSuggestions)) {
      issues.push('Field "eventSuggestions" must be an array');
    } else {
      eventSuggestions = [];
      for (let i = 0; i < data.eventSuggestions.length; i++) {
        const item = data.eventSuggestions[i];
        if (!isObject(item)) {
          issues.push(`eventSuggestions[${i}] must be an object`);
          continue;
        }
        if (typeof item.suggestedEventType !== 'string') {
          issues.push(`eventSuggestions[${i}].suggestedEventType must be a string`);
        }
        if (!isObject(item.suggestedPayload)) {
          issues.push(`eventSuggestions[${i}].suggestedPayload must be an object`);
        }
        if (typeof item.confidence !== 'number' || Number.isNaN(item.confidence)) {
          issues.push(`eventSuggestions[${i}].confidence must be a valid number`);
        }
        eventSuggestions.push(item as unknown as AIEventSuggestion);
      }
    }
  }

  // Validate memoryCandidates
  let memoryCandidates: AIMemoryCandidate[] | undefined;
  if (data.memoryCandidates !== undefined) {
    if (!Array.isArray(data.memoryCandidates)) {
      issues.push('Field "memoryCandidates" must be an array');
    } else {
      memoryCandidates = [];
      for (let i = 0; i < data.memoryCandidates.length; i++) {
        const item = data.memoryCandidates[i];
        if (!isObject(item)) {
          issues.push(`memoryCandidates[${i}] must be an object`);
          continue;
        }
        if (typeof item.tier !== 'string' || !VALID_MEMORY_TIERS.has(item.tier)) {
          issues.push(`memoryCandidates[${i}].tier must be 'permanent' or 'decaying'`);
        }
        if (typeof item.category !== 'string') {
          issues.push(`memoryCandidates[${i}].category must be a string`);
        }
        if (typeof item.key !== 'string') {
          issues.push(`memoryCandidates[${i}].key must be a string`);
        }
        if (typeof item.confidence !== 'number' || Number.isNaN(item.confidence)) {
          issues.push(`memoryCandidates[${i}].confidence must be a valid number`);
        }
        memoryCandidates.push(item as unknown as AIMemoryCandidate);
      }
    }
  }

  // Validate observationCandidates
  let observationCandidates: AIObservationCandidate[] | undefined;
  if (data.observationCandidates !== undefined) {
    if (!Array.isArray(data.observationCandidates)) {
      issues.push('Field "observationCandidates" must be an array');
    } else {
      observationCandidates = [];
      for (let i = 0; i < data.observationCandidates.length; i++) {
        const item = data.observationCandidates[i];
        if (!isObject(item)) {
          issues.push(`observationCandidates[${i}] must be an object`);
          continue;
        }
        if (typeof item.category !== 'string') {
          issues.push(`observationCandidates[${i}].category must be a string`);
        }
        if (typeof item.observation !== 'string') {
          issues.push(`observationCandidates[${i}].observation must be a string`);
        }
        if (typeof item.valence !== 'string' || !VALID_CAPABILITY_VALENCES.has(item.valence)) {
          issues.push(`observationCandidates[${i}].valence must be 'positive', 'negative', or 'neutral'`);
        }
        observationCandidates.push(item as unknown as AIObservationCandidate);
      }
    }
  }

  if (issues.length > 0) {
    throw new InvalidStructuredOutputError(
      `Invalid AIResponseContract schema: ${issues.join('; ')}`,
      rawText,
      issues,
    );
  }

  return {
    response: data.response as string,
    intent: data.intent as string,
    humorMechanism: (data.humorMechanism as string | null | undefined) ?? null,
    register: (data.register as string | null | undefined) ?? null,
    seriousFlag: typeof data.seriousFlag === 'boolean' ? data.seriousFlag : false,
    eventSuggestions,
    memoryCandidates,
    observationCandidates,
  };
}

/**
 * Validates EvaluationResult structure.
 */
export function validateEvaluationResult(data: unknown, rawText?: string): EvaluationResult {
  if (!isObject(data)) {
    throw new InvalidStructuredOutputError(
      'Malformed EvaluationResult: Expected a JSON object',
      rawText,
      ['Root must be an object'],
    );
  }

  const issues: string[] = [];

  if (typeof data.outcome !== 'string' || !VALID_EVALUATION_OUTCOMES.has(data.outcome)) {
    issues.push(`outcome must be 'completed', 'failed', or 'needs_more_evidence' (received "${String(data.outcome)}")`);
  }

  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence)) {
    issues.push('confidence must be a valid number');
  }

  if (typeof data.reasoning !== 'string') {
    issues.push('reasoning must be a string');
  }

  if (issues.length > 0) {
    throw new InvalidStructuredOutputError(
      `Invalid EvaluationResult schema: ${issues.join('; ')}`,
      rawText,
      issues,
    );
  }

  return {
    outcome: data.outcome as 'completed' | 'failed' | 'needs_more_evidence',
    confidence: data.confidence as number,
    reasoning: data.reasoning as string,
  };
}

/**
 * Validates MultimodalAnalysisResult structure.
 */
export function validateMultimodalAnalysisResult(data: unknown, rawText?: string): MultimodalAnalysisResult {
  if (!isObject(data)) {
    throw new InvalidStructuredOutputError(
      'Malformed MultimodalAnalysisResult: Expected a JSON object',
      rawText,
      ['Root must be an object'],
    );
  }

  const issues: string[] = [];

  if (typeof data.description !== 'string') {
    issues.push('description must be a string');
  }

  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence)) {
    issues.push('confidence must be a valid number');
  }

  if (issues.length > 0) {
    throw new InvalidStructuredOutputError(
      `Invalid MultimodalAnalysisResult schema: ${issues.join('; ')}`,
      rawText,
      issues,
    );
  }

  return {
    description: data.description as string,
    confidence: data.confidence as number,
  };
}
