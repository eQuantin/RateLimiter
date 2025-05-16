import { BaseError, ErrorSeverity, ErrorType } from "./customErrors";

/**
 * Retry strategy options
 */
export interface RetryStrategyOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Base delay in milliseconds */
  baseDelay: number;

  /** Factor by which the delay increases with each retry (for exponential backoff) */
  backoffFactor: number;

  /** Maximum delay in milliseconds */
  maxDelay: number;

  /** Random jitter factor (0-1) to add to delay times */
  jitter: number;
}

/**
 * Default retry strategy options
 */
export const DEFAULT_RETRY_STRATEGY: RetryStrategyOptions = {
  maxRetries: 3,
  baseDelay: 300,
  backoffFactor: 2,
  maxDelay: 10000,
  jitter: 0.2,
};

/**
 * Error handler interface
 */
export interface IErrorHandler {
  /**
   * Handle an error with potential retry logic
   */
  handleError<T>(
    error: unknown,
    operation: () => Promise<T>,
    options?: Partial<RetryStrategyOptions>,
  ): Promise<T>;

  /**
   * Wrap an operation with error handling and retry logic
   */
  withRetry<T>(
    operation: () => Promise<T>,
    options?: Partial<RetryStrategyOptions>,
  ): Promise<T>;

  /**
   * Register a custom error handler for specific error types
   */
  registerErrorHandler(
    predicate: (error: unknown) => boolean,
    handler: (error: unknown) => Promise<unknown>,
  ): void;
}

/**
 * Error handler implementation that provides retry capabilities
 */
export class ErrorHandler implements IErrorHandler {
  private customHandlers: Array<{
    predicate: (error: unknown) => boolean;
    handler: (error: unknown) => Promise<unknown>;
  }> = [];

  /**
   * Creates a new ErrorHandler instance
   */
  constructor() {}

  /**
   * Transforms an unknown error into a structured BaseError
   */
  private normalizeError(error: unknown): BaseError {
    // If it's already a BaseError, return it
    if (error instanceof BaseError) {
      return error;
    }

    // If it's a standard Error, wrap it
    if (error instanceof Error) {
      return new BaseError({
        code: "UNKNOWN_ERROR",
        message: error.message || "An unknown error occurred",
        type: ErrorType.UNKNOWN,
        severity: ErrorSeverity.RECOVERABLE,
        retryable: true,
        cause: error,
      });
    }

    // For anything else, create a generic error
    return new BaseError({
      code: "UNKNOWN_ERROR",
      message: String(error) || "An unknown error occurred",
      type: ErrorType.UNKNOWN,
      severity: ErrorSeverity.RECOVERABLE,
      retryable: true,
      cause: error,
    });
  }

  /**
   * Determines if an error is retryable
   */
  private isRetryable(error: unknown): boolean {
    const normalizedError = this.normalizeError(error);

    // Check if explicitly marked as retryable
    if (normalizedError.retryable === false) {
      return false;
    }

    // Some errors should not be retried by default
    if (
      normalizedError.severity === ErrorSeverity.FATAL ||
      normalizedError.type === ErrorType.VALIDATION
    ) {
      return false;
    }

    return true;
  }

  /**
   * Calculates the delay for the next retry attempt
   */
  private calculateRetryDelay(
    attempt: number,
    options: RetryStrategyOptions,
  ): number {
    // Exponential backoff: baseDelay * (backoffFactor ^ attempt)
    const exponentialDelay = options.baseDelay *
      Math.pow(options.backoffFactor, attempt);

    // Apply maximum delay cap
    const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

    // Apply jitter: delay * (1 ± random * jitter)
    const jitterMultiplier = 1 + (Math.random() * 2 - 1) * options.jitter;

    return Math.floor(cappedDelay * jitterMultiplier);
  }

  /**
   * Handle an error with potential retry logic
   */
  public async handleError<T>(
    error: unknown,
    operation: () => Promise<T>,
    options: Partial<RetryStrategyOptions> = {},
  ): Promise<T> {
    // Merge with default options
    const retryOptions: RetryStrategyOptions = {
      ...DEFAULT_RETRY_STRATEGY,
      ...options,
    };

    // Normalize the error
    const normalizedError = this.normalizeError(error);

    // Check for custom handlers first
    for (const { predicate, handler } of this.customHandlers) {
      if (predicate(normalizedError)) {
        try {
          // Custom handler might resolve the issue or throw another error
          await handler(normalizedError);
          // If handler succeeds, retry the operation
          return operation();
        } catch (handlerError) {
          // If handler throws, continue with normal retry logic
          break;
        }
      }
    }

    // Check if error is retryable
    if (!this.isRetryable(normalizedError)) {
      throw normalizedError;
    }

    // Retry logic with backoff
    let lastError = normalizedError;
    let attempt = 0;

    while (attempt < retryOptions.maxRetries) {
      attempt++;

      try {
        // Calculate delay for this attempt
        const delay = this.calculateRetryDelay(attempt, retryOptions);

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Retry the operation
        return await operation();
      } catch (retryError) {
        lastError = this.normalizeError(retryError);

        // If the new error is not retryable, stop retrying
        if (!this.isRetryable(lastError)) {
          throw lastError;
        }
      }
    }

    // If we've exhausted retries, throw the last error
    throw lastError;
  }

  /**
   * Wrap an operation with error handling and retry logic
   */
  public async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryStrategyOptions> = {},
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      return this.handleError(error, operation, options);
    }
  }

  /**
   * Register a custom error handler for specific error types
   */
  public registerErrorHandler(
    predicate: (error: unknown) => boolean,
    handler: (error: unknown) => Promise<unknown>,
  ): void {
    this.customHandlers.push({ predicate, handler });
  }
}
