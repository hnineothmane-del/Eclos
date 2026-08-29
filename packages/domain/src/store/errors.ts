import { sanitizeErrorMessage } from '../ai/errors.js';

/**
 * Base error class for domain store operations.
 */
export class StoreError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = 'STORE_ERROR', status?: number) {
    super(sanitizeErrorMessage(message));
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a requested record is not found.
 */
export class NotFoundError extends StoreError {
  constructor(entity: string, identifier: string) {
    super(`${entity} with identifier "${identifier}" was not found.`, 'NOT_FOUND', 404);
  }
}

/**
 * Thrown when store inputs fail validation.
 */
export class StoreValidationError extends StoreError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

/**
 * Thrown when Supabase or Postgres rejects a query or RPC.
 */
export class DatabaseError extends StoreError {
  readonly originalCode?: string;

  constructor(message: string, originalCode?: string, status = 500) {
    super(message, 'DATABASE_ERROR', status);
    this.originalCode = originalCode;
  }
}
