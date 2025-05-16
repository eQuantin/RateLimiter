import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_STRATEGY,
  ErrorHandler,
  RetryStrategyOptions,
} from "./errorHandler";
import {
  BaseError,
  ErrorSeverity,
  ErrorType,
  NetworkError,
  RateLimitError,
  SystemError,
  TimeoutError,
  ValidationError,
} from "./customErrors";

describe("ErrorHandler", () => {
  // Mock timers for testing delays
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("should handle successful operations without retry", async () => {
      const handler = new ErrorHandler();
      const operation = vi.fn().mockResolvedValue("success");

      const result = await handler.withRetry(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should normalize different error types", async () => {
      const handler = new ErrorHandler();

      // Test private method through a wrapper
      const normalizeErrorMethod = vi.spyOn(handler as any, "normalizeError");

      // Standard Error
      const standardError = new Error("Standard error");
      try {
        await handler.withRetry(() => {
          throw standardError;
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BaseError);
        expect((error as BaseError).message).toBe("Standard error");
        expect((error as BaseError).type).toBe(ErrorType.UNKNOWN);
      }

      // String error
      try {
        await handler.withRetry(() => {
          throw "String error";
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BaseError);
        expect((error as BaseError).message).toBe("String error");
      }

      // Custom error
      const customError = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      try {
        await handler.withRetry(() => {
          throw customError;
        });
      } catch (error) {
        expect(error).toBe(customError);
      }

      expect(normalizeErrorMethod).toHaveBeenCalledTimes(3);
    });
  });

  describe("Retry logic", () => {
    it("should retry retryable errors", async () => {
      const handler = new ErrorHandler();
      const error = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const result = await handler.withRetry(operation, {
        maxRetries: 3,
        baseDelay: 100,
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should not retry non-retryable errors", async () => {
      const handler = new ErrorHandler();
      const error = new ValidationError({
        code: "VALIDATION_ERROR",
        message: "Validation error",
        severity: ErrorSeverity.RECOVERABLE,
        retryable: false,
      });

      const operation = vi.fn().mockRejectedValue(error);

      await expect(handler.withRetry(operation, { maxRetries: 3 }))
        .rejects.toThrow(error);

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should not retry fatal errors", async () => {
      const handler = new ErrorHandler();
      const error = new SystemError({
        code: "SYSTEM_ERROR",
        message: "System error",
        severity: ErrorSeverity.FATAL,
        retryable: true, // Even if marked as retryable
      });

      const operation = vi.fn().mockRejectedValue(error);

      await expect(handler.withRetry(operation, { maxRetries: 3 }))
        .rejects.toThrow(error);

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw after maximum retries", async () => {
      const handler = new ErrorHandler();
      const error = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        handler.withRetry(operation, { maxRetries: 3, baseDelay: 100 }),
      )
        .rejects.toThrow(error);

      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe("Retry timing", () => {
    it("should use exponential backoff for retries", async () => {
      const handler = new ErrorHandler();
      const error = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      // Create a spy to track setTimeout calls
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      // Start the retry process but don't await it yet
      const retryPromise = handler.withRetry(operation, {
        maxRetries: 3,
        baseDelay: 100,
        backoffFactor: 2,
        jitter: 0, // No jitter for predictable testing
      });

      // After first failure, should schedule retry with base delay
      await vi.runAllTimersAsync();

      // After second failure, should schedule retry with increased delay
      await vi.runAllTimersAsync();

      // Now the operation should succeed
      const result = await retryPromise;

      expect(result).toBe("success");

      // Extract the delays from setTimeout calls
      const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);

      // First retry should use baseDelay
      expect(delays[0]).toBe(100);

      // Second retry should use exponential backoff: baseDelay * (backoffFactor ^ attempt)
      expect(delays[1]).toBe(200); // 100 * (2 ^ 1)
    });

    it("should respect maxDelay limit", async () => {
      const handler = new ErrorHandler();
      const error = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      // Create a spy to track setTimeout calls
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      // Start the retry process
      const retryPromise = handler.withRetry(operation, {
        maxRetries: 4,
        baseDelay: 1000,
        backoffFactor: 3,
        maxDelay: 5000, // Cap at 5000ms
        jitter: 0, // No jitter for predictable testing
      });

      // Run all timers to complete all retries
      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const result = await retryPromise;
      expect(result).toBe("success");

      // Extract the delays from setTimeout calls
      const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);

      // First retry: 1000ms
      expect(delays[0]).toBe(1000);

      // Second retry: 1000 * 3 = 3000ms
      expect(delays[1]).toBe(3000);

      // Third retry: 1000 * 3^2 = 9000ms, but capped at 5000ms
      expect(delays[2]).toBe(5000);
    });
  });

  describe("Custom error handlers", () => {
    it("should use custom handler for matching errors", async () => {
      const handler = new ErrorHandler();

      // Register a custom handler for rate limit errors
      const customHandler = vi.fn().mockResolvedValue(undefined);
      handler.registerErrorHandler(
        (error) => error instanceof RateLimitError,
        customHandler,
      );

      // Create a rate limit error
      const error = new RateLimitError({
        code: "RATE_LIMITED",
        message: "Rate limited",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
        retryAfter: 1000,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const result = await handler.withRetry(operation);

      expect(result).toBe("success");
      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(customHandler).toHaveBeenCalledWith(error);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should continue with normal retry if custom handler fails", async () => {
      const handler = new ErrorHandler();

      // Register a custom handler that fails
      const customHandlerError = new Error("Handler failed");
      const customHandler = vi.fn().mockRejectedValue(customHandlerError);

      handler.registerErrorHandler(
        (error) => error instanceof TimeoutError,
        customHandler,
      );

      // Create a timeout error
      const timeoutError = new TimeoutError({
        code: "TIMEOUT",
        message: "Request timed out",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce("success");

      const result = await handler.withRetry(operation, { baseDelay: 100 });

      expect(result).toBe("success");
      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should check multiple custom handlers in registration order", async () => {
      const handler = new ErrorHandler();

      // Register two handlers
      const firstHandler = vi.fn().mockResolvedValue(undefined);
      const secondHandler = vi.fn().mockResolvedValue(undefined);

      handler.registerErrorHandler(
        () => false, // Never matches
        firstHandler,
      );

      handler.registerErrorHandler(
        (error) => error instanceof NetworkError,
        secondHandler,
      );

      // Create a network error
      const error = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      await handler.withRetry(operation);

      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Integration with real-world scenarios", () => {
    it("should handle a sequence of different errors", async () => {
      const handler = new ErrorHandler();

      // Register custom handler for rate limit errors
      handler.registerErrorHandler(
        (error) => error instanceof RateLimitError,
        async (error) => {
          if (error instanceof RateLimitError && error.retryAfter) {
            await new Promise((resolve) =>
              setTimeout(resolve, error.retryAfter)
            );
            return;
          }
          throw error;
        },
      );

      // Sequence of errors followed by success
      const networkError = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const rateLimitError = new RateLimitError({
        code: "RATE_LIMITED",
        message: "Rate limited",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
        retryAfter: 100,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce("success");

      const retryPromise = handler.withRetry(operation, { baseDelay: 50 });

      // After first error (network), should retry with delay
      await vi.runAllTimersAsync();

      // After second error (rate limit), should use custom handler
      await vi.runAllTimersAsync();

      const result = await retryPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should handle errors that change type during retries", async () => {
      const handler = new ErrorHandler();

      // First a retryable error, then a non-retryable error
      const networkError = new NetworkError({
        code: "NETWORK_ERROR",
        message: "Network error",
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
      });

      const validationError = new ValidationError({
        code: "VALIDATION_ERROR",
        message: "Validation error",
        severity: ErrorSeverity.RECOVERABLE,
        retryable: false,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(validationError);

      const retryPromise = handler.withRetry(operation, { baseDelay: 50 });

      // After first error (network), should retry with delay
      await vi.runAllTimersAsync();

      // Should reject with the validation error
      await expect(retryPromise).rejects.toThrow(validationError);

      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});
