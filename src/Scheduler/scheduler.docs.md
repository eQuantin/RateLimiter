# Scheduler Documentation

The Scheduler is a utility that helps manage concurrent task execution with
configurable concurrency limits. It's designed to handle asynchronous operations
efficiently, preventing overwhelming systems with too many concurrent tasks.

## Features

- **Configurable Concurrency**: Limit the number of tasks running simultaneously
- **Queue Management**: Automatically queues tasks when concurrency limit is
  reached
- **FIFO Processing**: Tasks are executed in the order they are scheduled
- **Task Cancellation**: Individual tasks or the entire queue can be cancelled
- **Promise-based API**: Simple asynchronous interface using Promises

## Installation

```ts
// Import the Scheduler
import { Scheduler } from "./Scheduler.ts";
```

## Basic Usage

```ts
// Create a scheduler with a concurrency limit of 2
const scheduler = new Scheduler({ maxConcurrent: 2 });

// Schedule tasks (only 2 will run concurrently)
const task1 = scheduler.schedule(() => fetchData("/api/users"));
const task2 = scheduler.schedule(() => fetchData("/api/products"));
const task3 = scheduler.schedule(() => fetchData("/api/orders"));

// Wait for all tasks to complete
const results = await Promise.all([task1, task2, task3]);
```

## API Reference

### Constructor

```ts
new Scheduler(options?: SchedulerOptions)
```

#### Options

- `maxConcurrent` (number, optional): Maximum number of tasks allowed to run
  concurrently. Defaults to `Infinity` (no limit).

### Methods

#### `schedule<T>(handler: RequestHandler<T>): Promise<T>`

Schedules a task for execution according to concurrency constraints.

- `handler`: A function that returns a Promise with the task's result
- Returns: A Promise that resolves with the result of the task or rejects if the
  task fails or is cancelled

```ts
const result = await scheduler.schedule(async () => {
  const data = await fetchData("/api/resource");
  return processData(data);
});
```

#### `clearQueue(): void`

Cancels all pending and currently executing tasks.

```ts
// Cancel all tasks
scheduler.clearQueue();
```

#### `cancelTask(taskId: string): boolean`

Cancels a specific task by its ID. Returns `true` if the task was found and
cancelled, `false` otherwise.

Note: Task IDs are generated internally and not normally exposed to users.

#### `queueLength` (getter)

Returns the current number of tasks waiting in the queue (not currently
executing).

```ts
console.log(`Tasks waiting: ${scheduler.queueLength}`);
```

## Use Cases

### API Rate Limiting

```ts
// Create a scheduler to limit API calls to 2 concurrent requests
const apiRateLimiter = new Scheduler({ maxConcurrent: 2 });

// Fetch multiple resources with rate limiting
const userIds = [1, 2, 3, 4, 5];
const userDataPromises = userIds.map((userId) =>
  apiRateLimiter.schedule(() => fetch(`/api/users/${userId}`))
);

// Process results as they complete
for (const promise of userDataPromises) {
  try {
    const userData = await promise;
    console.log(`Processed user data: ${userData}`);
  } catch (error) {
    console.error(`Error processing user: ${error.message}`);
  }
}
```

### Sequential Processing

```ts
// Create a scheduler with concurrency of 1 for sequential execution
const sequentialScheduler = new Scheduler({ maxConcurrent: 1 });

// These tasks will run one after another
const task1 = sequentialScheduler.schedule(() => processStep1());
const task2 = sequentialScheduler.schedule(() => processStep2());
const task3 = sequentialScheduler.schedule(() => processStep3());

await Promise.all([task1, task2, task3]);
```

### Error Handling

```ts
const scheduler = new Scheduler({ maxConcurrent: 2 });

try {
  const result = await scheduler.schedule(async () => {
    // Task that might fail
    const response = await fetch("/api/data");
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return response.json();
  });

  console.log("Task succeeded:", result);
} catch (error) {
  console.error("Task failed:", error.message);
}
```

## Best Practices

1. **Choose appropriate concurrency limits** based on the resources being
   accessed
2. **Handle task errors** at the individual task level, as one task failing
   doesn't affect others
3. **Consider using timeouts** for long-running tasks to prevent blocking the
   queue indefinitely
4. **Clear the queue** when needed to cancel pending operations, such as when a
   user navigates away

## Implementation Notes

- Tasks are processed in a first-in, first-out (FIFO) order
- When a task completes, the next task in the queue is processed immediately
- If a task is cancelled while executing, it is marked as cancelled and removed
  from active tasks
- The scheduler doesn't retry failed tasks; implement retry logic in your task
  handlers if needed
