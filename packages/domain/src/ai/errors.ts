/**
 * Base class for all AI provider errors.
 */
export class AIProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = 'AI_PROVIDER_ERROR', status?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the provider is unreachable, down, or returning 5xx network errors.
 */
export class ProviderUnavailableError extends AIProviderError {
  constructor(message = 'AI provider is unavailable', status = 503) {
    super(message, 'PROVIDER_UNAVAILABLE', status);
  }
}

/**
 * Thrown when structured output from LLM fails validation or is malformed JSON.
 */
export class InvalidStructuredOutputError extends AIProviderError {
  readonly rawOutput?: string;
  readonly validationIssues?: string[];

  constructor(message: string, rawOutput?: string, validationIssues?: string[]) {
    super(message, 'INVALID_STRUCTURED_OUTPUT', 422);
    this.rawOutput = rawOutput;
    this.validationIssues = validationIssues;
  }
}

/**
 * Thrown when rate limits (HTTP 429 / quota exceeded) are hit.
 */
export class RateLimitError extends AIProviderError {
  readonly retryAfterSeconds?: number;

  constructor(message = 'AI provider rate limit exceeded', retryAfterSeconds?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown when API key is missing, invalid, or forbidden (HTTP 401 / 403).
 */
export class AuthenticationError extends AIProviderError {
  constructor(message = 'AI provider authentication failed') {
    // Ensure no raw secrets are retained or exposed
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

/**
 * Thrown for general upstream client/request errors (e.g. 400 Bad Request).
 */
export class UpstreamRequestError extends AIProviderError {
  constructor(message: string, status?: number) {
    super(message, 'UPSTREAM_REQUEST_ERROR', status ?? 400);
  }
}
