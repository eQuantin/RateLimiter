/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Fatal errors that cannot be recovered from */
  FATAL = "fatal",

  /** Errors that can be recovered from with intervention */
  RECOVERABLE = "recoverable",

  /** Temporary errors that might resolve on retry */
  TRANSIENT = "transient",
}

/**
 * Error type categories
 */
export enum ErrorType {
  /** Network-related errors */
  NETWORK = "network",

  /** Timeout errors */
  TIMEOUT = "timeout",

  /** Rate limiting errors */
  RATE_LIMIT = "rate_limit",

  /** Validation errors */
  VALIDATION = "validation",

  /** Internal system errors */
  SYSTEM = "system",

  /** Generic/unknown errors */
  UNKNOWN = "unknown",
}

/**
 * Base error interface that all custom errors implement
 */
export interface IBaseError {
  /** Unique error identifier */
  code: string;

  /** Error message */
  message: string;

  /** Error type category */
  type: ErrorType;

  /** Error severity level */
  severity: ErrorSeverity;

  /** Whether this error can be retried */
  retryable: boolean;

  /** Original error if this wraps another error */
  cause?: Error | unknown;

  /** Additional context data for debugging */
  context?: Record<string, unknown>;
}

/**
 * Base custom error class that extends Error with additional properties
 */
export class BaseError extends Error implements IBaseError {
  code: string;
  type: ErrorType;
  severity: ErrorSeverity;
  retryable: boolean;
  cause?: Error | unknown;
  context?: Record<string, unknown>;

  constructor(options: {
    code: string;
    message: string;
    type: ErrorType;
    severity: ErrorSeverity;
    retryable: boolean;
    cause?: Error | unknown;
    context?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.type = options.type;
    this.severity = options.severity;
    this.retryable = options.retryable;
    this.cause = options.cause;
    this.context = options.context;

    // Ensures proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Adds additional context to the error
   */
  addContext(key: string, value: unknown): this {
    if (!this.context) {
      this.context = {};
    }
    this.context[key] = value;
    return this;
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends BaseError {
  constructor(options: Omit<IBaseError, "type"> & { cause?: Error | unknown }) {
    super({
      ...options,
      type: ErrorType.NETWORK,
    });
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends BaseError {
  constructor(options: Omit<IBaseError, "type"> & { cause?: Error | unknown }) {
    super({
      ...options,
      type: ErrorType.TIMEOUT,
    });
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends BaseError {
  retryAfter?: number;

  constructor(
    options: Omit<IBaseError, "type"> & {
      cause?: Error | unknown;
      retryAfter?: number;
    },
  ) {
    super({
      ...options,
      type: ErrorType.RATE_LIMIT,
    });
    this.retryAfter = options.retryAfter;
  }
}

/**
 * Validation errors
 */
export class ValidationError extends BaseError {
  constructor(options: Omit<IBaseError, "type"> & { cause?: Error | unknown }) {
    super({
      ...options,
      type: ErrorType.VALIDATION,
    });
  }
}

/**
 * System internal errors
 */
export class SystemError extends BaseError {
  constructor(options: Omit<IBaseError, "type"> & { cause?: Error | unknown }) {
    super({
      ...options,
      type: ErrorType.SYSTEM,
    });
  }
}
