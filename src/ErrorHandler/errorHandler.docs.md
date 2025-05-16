# Error Handling System

The Error Handling System provides a robust framework for classifying, handling,
and retrying operations that encounter errors. It's designed to be
protocol-agnostic, making it versatile for various use cases while providing
powerful retry capabilities.

## Core Components

### 1. Error Classification System

The system classifies errors based on:

- **Error Types**:
  - `NETWORK`: Connection and network-related errors
  - `TIMEOUT`: Time-based failures
  - `RATE_LIMIT`: Rate limiting or throttling errors
  - `VALIDATION`: Input validation failures
  - `SYSTEM`: Internal system errors
  - `UNKNOWN`: Unclassified errors

- **Severity Levels**:
  - `FATAL`: Non-recoverable errors that require intervention
  - `RECOVERABLE`: Errors that can be handled with proper intervention
  - `TRANSIENT`: Temporary errors that may resolve on retry

### 2. Custom Error Classes

All custom errors extend the `BaseError` class, which provides:

- Consistent error properties (code, message, type, severity)
- Retryability flag to indicate if an operation can be retried
- Context data for debugging
- Cause tracking for wrapped errors

The system includes specialized error classes:

- `NetworkError`
- `TimeoutError`
- `RateLimitError` (with retry-after information)
- `ValidationError`
- `SystemError`

### 3. Error Handler

The `ErrorHandler` class is the central component that:

- Normalizes various error types into a structured format
- Determines if an error is retryable
- Implements configurable retry strategies
- Supports custom error handlers for specific error types
- Provides a convenient way to wrap operations with retry logic

## Retry Strategies

The system implements sophisticated retry strategies:

- **Exponential Backoff**: Increases delay between retries exponentially
- **Jitter**: Adds randomness to retry timing to prevent thundering herd
  problems
- **Maximum Retry Limit**: Caps the number of retry attempts
- **Delay Capping**: Prevents excessive wait times between retries

## Usage Examples

### Basic Usage

```typescript
import { ErrorHandler } from "./ErrorHandler/errorHandler";

const errorHandler = new ErrorHandler();

async function fetchData() {
  return errorHandler.withRetry(
    async () => {
      // Your operation that might fail
      const response = await fetch("https://api.example.com/data");
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      return response.json();
    },
  );
}
```

### Custom Retry Strategy

```typescript
const result = await errorHandler.withRetry(
  () => someOperation(),
  {
    maxRetries: 5,
    baseDelay: 200,
    backoffFactor: 2,
    maxDelay: 10000,
    jitter: 0.2,
  },
);
```

### Custom Error Handlers

```typescript
// Register a custom handler for rate limit errors
errorHandler.registerErrorHandler(
  // Predicate function to identify the error type
  (error) => error instanceof RateLimitError,
  // Handler function
  async (error) => {
    if (error instanceof RateLimitError && error.retryAfter) {
      // Wait for the specified time before retrying
      await new Promise((resolve) => setTimeout(resolve, error.retryAfter));
      return; // Success - will retry the operation
    }
    throw error; // Re-throw if can't handle
  },
);
```

## Integration with Scheduler

The Error Handling system works seamlessly with the Scheduler component:

```typescript
import { Scheduler } from "../Scheduler/scheduler";
import { ErrorHandler } from "./errorHandler";

const scheduler = new Scheduler({ maxConcurrent: 5 });
const errorHandler = new ErrorHandler();

// Method 1: Wrap the handler with error handling before scheduling
const result = await scheduler.schedule(
  () => errorHandler.withRetry(() => fetchData()),
);

// Method 2: Extend the scheduler to include error handling
class ResilientScheduler extends Scheduler {
  private errorHandler = new ErrorHandler();

  async schedule<T>(handler: () => Promise<T>): Promise<T> {
    return super.schedule(() => this.errorHandler.withRetry(handler));
  }
}
```

## Best Practices

1. **Categorize errors appropriately** - Set the correct type and severity to
   enable proper handling
2. **Be explicit about retryability** - Clearly mark which errors should be
   retried
3. **Include context data** - Add relevant debugging information to errors
4. **Use custom handlers** for specialized recovery logic
5. **Configure retry strategies** based on the operation characteristics
6. **Don't retry validation errors** - They typically won't succeed without
   input changes
