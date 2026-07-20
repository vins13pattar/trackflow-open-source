/** Canonical error codes surfaced through the API (mirrors the PRD's error map). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DUPLICATE: 409,
  QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const errors = {
  validation: (message = 'Validation failed', details?: unknown) =>
    new AppError('VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required') => new AppError('UNAUTHORIZED', message),
  forbidden: (message = 'Insufficient permissions') => new AppError('FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError('NOT_FOUND', message),
  duplicate: (message = 'Resource already exists') => new AppError('DUPLICATE', message),
  quota: (message = 'Plan limit reached') => new AppError('QUOTA_EXCEEDED', message),
  rateLimited: (message = 'Rate limit exceeded') => new AppError('RATE_LIMITED', message),
  internal: (message = 'Internal error') => new AppError('INTERNAL', message),
};
