import { ErrorHandler } from "./errorHandler";
import {
  BaseError,
  ErrorSeverity,
  ErrorType,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "./customErrors";

// Create an instance of the error handler
const errorHandler = new ErrorHandler();

/**
 * Example function that simulates an API call that might fail
 */
async function fetchUserData(userId: string): Promise<any> {
  // Simulate random failures for demonstration
  const random = Math.random();

  if (random < 0.2) {
    // Simulate network error (20% chance)
    throw new NetworkError({
      code: "NETWORK_FAILURE",
      message: "Failed to connect to API server",
      severity: ErrorSeverity.TRANSIENT,
      retryable: true,
    });
  } else if (random < 0.3) {
    // Simulate timeout (10% chance)
    throw new TimeoutError({
      code: "REQUEST_TIMEOUT",
      message: "Request timed out after 5000ms",
      severity: ErrorSeverity.TRANSIENT,
      retryable: true,
      context: { timeoutMs: 5000 },
    });
  } else if (random < 0.4) {
    // Simulate rate limiting (10% chance)
    throw new RateLimitError({
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
      severity: ErrorSeverity.TRANSIENT,
      retryable: true,
      retryAfter: 5000, // Retry after 5 seconds
      context: { remainingRequests: 0, resetTime: Date.now() + 5000 },
    });
  } else if (random < 0.5) {
    // Simulate validation error (10% chance) - not retryable
    throw new ValidationError({
      code: "INVALID_USER_ID",
      message: `Invalid user ID: ${userId}`,
      severity: ErrorSeverity.RECOVERABLE,
      retryable: false,
      context: { providedId: userId },
    });
  }

  // Success case (50% chance)
  return {
    id: userId,
    name: "John Doe",
    email: "john.doe@example.com",
  };
}

/**
 * Example 1: Basic usage with retry
 */
async function example1() {
  console.log("Example 1: Basic retry");

  try {
    // Wrap the operation with retry logic
    const userData = await errorHandler.withRetry(() =>
      fetchUserData("user123")
    );
    console.log("User data retrieved successfully:", userData);
  } catch (error) {
    console.error("Failed to fetch user data after retries:", error);
  }
}

/**
 * Example 2: Custom retry strategy
 */
async function example2() {
  console.log("\nExample 2: Custom retry strategy");

  try {
    // Use custom retry options
    const userData = await errorHandler.withRetry(
      () => fetchUserData("user456"),
      {
        maxRetries: 5,
        baseDelay: 100,
        backoffFactor: 1.5,
        maxDelay: 5000,
        jitter: 0.1,
      },
    );
    console.log("User data retrieved successfully:", userData);
  } catch (error) {
    console.error(
      "Failed to fetch user data with custom retry strategy:",
      error,
    );
  }
}

/**
 * Example 3: Register custom error handler for rate limit errors
 */
async function example3() {
  console.log("\nExample 3: Custom handler for rate limit errors");

  // Register a custom handler for rate limit errors
  errorHandler.registerErrorHandler(
    // Predicate to identify rate limit errors
    (error: unknown) => error instanceof RateLimitError,
    // Custom handler
    async (error: unknown) => {
      if (error instanceof RateLimitError && error.retryAfter) {
        console.log(
          `Rate limited. Waiting for ${error.retryAfter}ms before retrying...`,
        );
        // Wait for the specified retry-after time
        await new Promise((resolve) => setTimeout(resolve, error.retryAfter));
        // Return without throwing to indicate success
        return;
      }
      // Re-throw the error if it couldn't be handled
      throw error;
    },
  );

  try {
    const userData = await errorHandler.withRetry(() =>
      fetchUserData("user789")
    );
    console.log(
      "User data retrieved successfully after handling rate limit:",
      userData,
    );
  } catch (error) {
    console.error("Failed even with custom rate limit handler:", error);
  }
}

/**
 * Example 4: Use with scheduler
 */
async function example4() {
  console.log("\nExample 4: Integration with scheduler");

  // Import would come from scheduler module
  // import { Scheduler } from '../Scheduler/scheduler';

  // This is a mock of the scheduler for example purposes
  class MockScheduler {
    async schedule<T>(handler: () => Promise<T>): Promise<T> {
      console.log("Scheduling task through mock scheduler");
      // Wrap the handler with error handling
      return errorHandler.withRetry(handler);
    }
  }

  const scheduler = new MockScheduler();

  try {
    const userData = await scheduler.schedule(() => fetchUserData("user999"));
    console.log(
      "User data retrieved through scheduler with error handling:",
      userData,
    );
  } catch (error) {
    console.error("Failed to fetch user data through scheduler:", error);
  }
}

/**
 * Run all examples
 */
async function runExamples() {
  await example1();
  await example2();
  await example3();
  await example4();
  console.log("\nAll examples completed");
}

// Run the examples
runExamples().catch(console.error);

/**
 * Example of how to use the error handling system in a real application:

// 1. Create and configure the error handler
const errorHandler = new ErrorHandler();

// 2. Register custom handlers for specific error types
errorHandler.registerErrorHandler(
  (error: unknown) => error instanceof RateLimitError,
  async (error: unknown) => {
    if (error instanceof RateLimitError && error.retryAfter) {
      await new Promise(resolve => setTimeout(resolve, error.retryAfter));
      return;
    }
    throw error;
  }
);

// 3. Create a function that performs some operation
async function fetchData(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5000', 10);
      throw new RateLimitError({
        code: 'API_RATE_LIMITED',
        message: 'Rate limited by API',
        severity: ErrorSeverity.TRANSIENT,
        retryable: true,
        retryAfter
      });
    }
    throw new NetworkError({
      code: `HTTP_${response.status}`,
      message: `HTTP error ${response.status}: ${response.statusText}`,
      severity: ErrorSeverity.TRANSIENT,
      retryable: response.status >= 500, // Only retry server errors
      context: { status: response.status, statusText: response.statusText }
    });
  }
  return response.json();
}

// 4. Use the error handler with the operation
async function getProduct(productId: string) {
  return errorHandler.withRetry(
    () => fetchData(`https://api.example.com/products/${productId}`),
    { maxRetries: 3 }
  );
}

*/
