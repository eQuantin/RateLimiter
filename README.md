# Rate Limiter

A flexible and efficient client library for consuming rate-limited APIs with
Deno. This library helps clients respect API rate limits, manage request
throughput, and optimize usage of rate-limited services.

## Features

- Client-side protection against rate limit errors
- Support for multiple rate limiting strategies used by common APIs:
  - Fixed Window
  - Sliding Window
  - Token Bucket
  - Leaky Bucket
- Customizable time windows (seconds, minutes, hours)
- Automatic handling of rate limit response headers
- Response headers parsing for metrics and rate limit tracking
- Priority system with weighted request and token reserve system
- Multi-tiered rate limits for different API endpoints and user roles
- Support for resource-specific rate limiting
- Circuit breaker to prevent excessive requests during API backpressure
- Good error handling with graceful degradation
- Extensive testing
- Automatic retry with configurable backoff strategies
- Request queuing with timeout options
- Rate limit event emitters for application monitoring
- Cache integration for reducing API calls
- Request throttling based on server-side feedback
- Duplicate request detection and prevention
- Request coalescing for concurrent identical requests
- Scheduler for planning and distributing requests over time

## Supported Rate Limiting Algorithms

### Fixed Window

Handles APIs that use fixed time window rate limiting. Manages client requests
to respect server-defined windows.

### Sliding Window

For APIs using a moving time window approach, providing smoother client-side
request management.

### Token Bucket

Manages client requests for APIs using token bucket rate limiting, optimizing
for burst allowances.

### Leaky Bucket

Controls the flow of requests at a constant rate for APIs that process requests
with a queue system.

## How It Helps

- Prevents 429 Too Many Requests errors
- Optimizes API usage within allowed limits
- Gracefully handles rate limit errors when they occur
- Prioritizes important requests when approaching rate limits
- Provides backoff strategies when limits are reached
