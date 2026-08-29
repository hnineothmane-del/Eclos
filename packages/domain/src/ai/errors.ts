export function sanitizeErrorMessage(message: string): string {
  let value = String(message ?? '');
  const redacted = '[REDACTED]';

  // Completely remove or heavily redact authorization strings
  value = value
    // Scrub "API key xyz" or "API_KEY=xyz"
    .replace(/(?:api[-_\s]*key)(?:\s*[:=]\s*|\s+)([^\s'",&]+)/gi, `API_KEY=${redacted}`)
    // Scrub "key=xyz"
    .replace(/(?:key\s*[:=]\s*)([^\s'",&]+)/gi, `key=${redacted}`)
    // Scrub "Authorization: Bearer xyz", "Authorization xyz"
    .replace(/(?:authorization)(?:\s*[:=]\s*|\s+)(?:bearer\s+)?([^\s'",]+)/gi, `[REDACTED_AUTH]`)
    // Scrub generic bearer tokens
    .replace(/(?:bearer\s+)([a-zA-Z0-9._~+/-]+)/gi, `[REDACTED_BEARER]`)
    // Scrub URLs containing secrets/tokens
    .replace(/https?:\/\/[^\s"'<>]+(?:key|token|auth)[^\s"'<>]*/gi, '[REDACTED_URL]')
    // Scrub raw request headers block
    .replace(/(?:request\s+)?headers?(?:\s*[:=]\s*|\s+)(?:{[^}]*}|[^\n]+)/gi, '[REDACTED_HEADERS]');

  return value;
}

/**
 * Base class for all AI provider errors.
 */
export class AIProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = 'AI_PROVIDER_ERROR', status?: number) {
    super(sanitizeErrorMessage(message));
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
    this.rawOutput = rawOutput ? sanitizeErrorMessage(rawOutput).slice(0, 500) : undefined;
    this.validationIssues = validationIssues?.map((issue) => sanitizeErrorMessage(issue));
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
