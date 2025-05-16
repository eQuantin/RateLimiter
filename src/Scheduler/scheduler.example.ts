/**
 * Example file demonstrating various use cases of the Scheduler
 */

import { Scheduler } from "./Scheduler.ts";

// Track timeouts to clean them up
const timeouts: Set<number> = new Set();

// Helper function for simulating API calls with random delays
function simulateApiCall(
  endpoint: string,
  delay = Math.random() * 200 + 50, // Reduced delays
): Promise<string> {
  console.log(`Making API call to ${endpoint}...`);
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log(`Completed API call to ${endpoint}`);
      timeouts.delete(timeoutId);
      resolve(`Response from ${endpoint}`);
    }, delay);
    timeouts.add(timeoutId);
  });
}

// Clean up all pending timeouts
function cleanupTimeouts() {
  console.log(`Cleaning up ${timeouts.size} pending timeouts`);
  for (const id of timeouts) {
    clearTimeout(id);
  }
  timeouts.clear();
}

// Example 1: Basic sequential task scheduling
async function basicExample() {
  console.log("\n--- Basic Sequential Example ---");

  // Create scheduler with concurrency limited to 1 (sequential execution)
  const sequentialScheduler = new Scheduler({ maxConcurrent: 1 });

  console.log("Scheduling 3 sequential tasks...");

  // Schedule three tasks
  const task1 = sequentialScheduler.schedule(() =>
    simulateApiCall("/api/users")
  );
  const task2 = sequentialScheduler.schedule(() =>
    simulateApiCall("/api/products")
  );
  const task3 = sequentialScheduler.schedule(() =>
    simulateApiCall("/api/orders")
  );

  // Wait for all tasks to complete
  const results = await Promise.all([task1, task2, task3]);

  console.log("All sequential tasks completed.");
  console.log("Results:", results);
}

// Example 2: Concurrent task execution with limited concurrency
async function concurrencyExample() {
  console.log("\n--- Concurrent Example (limit: 2) ---");

  // Create scheduler with concurrency limited to 2
  const concurrentScheduler = new Scheduler({ maxConcurrent: 2 });

  console.log("Scheduling 5 tasks with max concurrency of 2...");

  // Schedule five tasks
  const promises = [];
  for (let i = 1; i <= 5; i++) {
    promises.push(
      concurrentScheduler.schedule(() => simulateApiCall(`/api/resource/${i}`)),
    );
  }

  // Wait for all tasks to complete
  const results = await Promise.all(promises);

  console.log("All concurrent tasks completed.");
  console.log("Results:", results);
}

// Example 3: Error handling
async function errorHandlingExample() {
  console.log("\n--- Error Handling Example ---");

  const scheduler = new Scheduler({ maxConcurrent: 2 });

  // Create tasks that might fail
  const successTask = scheduler.schedule(() => simulateApiCall("/api/success"));

  const failTask = scheduler.schedule(() => {
    return new Promise((_, reject) => {
      setTimeout(() => {
        console.log("Task failed with error");
        reject(new Error("API request failed"));
      }, 300);
    });
  });

  // Using try/catch to handle errors
  try {
    await failTask;
    console.log("This won't execute");
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(`Caught error: ${error.message}`);
    } else {
      console.log("Caught unknown error");
    }
  }

  // The successful task should still complete
  const result = await successTask;
  console.log("Success task completed despite error in another task:", result);
}

// Example 4: Task cancellation
async function cancellationExample() {
  console.log("\n--- Task Cancellation Example ---");

  const scheduler = new Scheduler({ maxConcurrent: 1 });

  // Start tracking task IDs for cancellation (implementation-specific)
  const mockTaskId = `task_${Date.now()}_${
    Math.random().toString(36).substring(2, 11)
  }`;
  // This is a simplified way to demonstrate - in real code you would need to access the internal task ID

  // Start a long-running task
  const longRunningTask = scheduler.schedule(() => {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log("Long-running task completed");
        timeouts.delete(timeoutId);
        resolve("Long task result");
      }, 1000); // Reduced from 10000 to 1000
      timeouts.add(timeoutId);
    });
  });

  // Schedule more tasks behind it
  const task2 = scheduler.schedule(() => simulateApiCall("/api/second"));
  const task3 = scheduler.schedule(() => simulateApiCall("/api/third"));

  console.log("Queue length after scheduling:", scheduler.queueLength);

  // Wait a moment to ensure tasks are queued
  await new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, 100);
    timeouts.add(timeoutId);
    setTimeout(() => timeouts.delete(timeoutId), 100);
  });

  // Demonstrate queue cancellation
  console.log("Cancelling all pending tasks...");
  scheduler.clearQueue();

  console.log("Queue length after cancellation:", scheduler.queueLength);

  // Tasks will be rejected, so we need to handle that
  try {
    await longRunningTask;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(`Long-running task was cancelled: ${error.message}`);
    } else {
      console.log("Long-running task was cancelled with unknown error");
    }
  }

  try {
    await task2;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(`Task 2 was cancelled: ${error.message}`);
    } else {
      console.log("Task 2 was cancelled with unknown error");
    }
  }

  try {
    await task3;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(`Task 3 was cancelled: ${error.message}`);
    } else {
      console.log("Task 3 was cancelled with unknown error");
    }
  }

  // Create a new scheduler to demonstrate individual task cancellation
  const scheduler2 = new Scheduler({ maxConcurrent: 2 });

  // Use a custom scheduler to expose task IDs (for demonstration purposes)
  class TestScheduler extends Scheduler {
    private taskId: string | null = null;

    trackFirstTaskId(): void {
      this.taskId = null;
    }

    protected override generateTaskId(): string {
      const id = super.generateTaskId();
      if (this.taskId === null) {
        this.taskId = id;
      }
      return id;
    }

    getFirstTaskId(): string | null {
      return this.taskId;
    }
  }

  const testScheduler = new TestScheduler({ maxConcurrent: 2 });
  testScheduler.trackFirstTaskId();

  // Schedule a task we want to cancel
  const taskToCancel = testScheduler.schedule(() => {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log("This task should be cancelled and never complete");
        timeouts.delete(timeoutId);
        resolve("This should never resolve");
      }, 500); // Reduced from 5000 to 500
      timeouts.add(timeoutId);
    });
  });

  // Get the task ID and cancel it
  const taskId = testScheduler.getFirstTaskId();
  if (taskId) {
    // Wait a moment to ensure task has started
    await new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, 100);
      timeouts.add(timeoutId);
      setTimeout(() => timeouts.delete(timeoutId), 100);
    });

    console.log(`Cancelling specific task with ID: ${taskId}`);
    const cancelled = testScheduler.cancelTask(taskId);
    console.log(`Task was ${cancelled ? "successfully" : "not"} cancelled`);

    try {
      await taskToCancel;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.log(`Task was cancelled: ${error.message}`);
      } else {
        console.log("Task was cancelled with unknown error");
      }
    }
  }
}

// Example 5: Practical use case - API rate limiting
async function rateLimitingExample() {
  console.log("\n--- API Rate Limiting Example ---");

  // Create a scheduler with concurrency of 2 to limit API calls
  const apiRateLimiter = new Scheduler({ maxConcurrent: 2 });

  // Simulate a collection of API calls that need to be rate-limited
  const userIds = Array.from({ length: 10 }, (_, i) => i + 1);

  console.log(
    `Fetching data for ${userIds.length} users with rate limiting...`,
  );

  // Map each user ID to a rate-limited API call
  const userDataPromises = userIds.map((userId) =>
    apiRateLimiter.schedule(() => simulateApiCall(`/api/users/${userId}`, 200))
  );

  // Process results as they complete
  for (const [index, promise] of userDataPromises.entries()) {
    try {
      const userData = await promise;
      console.log(`Processed user ${userIds[index]}: ${userData}`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(
          `Error processing user ${userIds[index]}: ${error.message}`,
        );
      } else {
        console.error(
          `Error processing user ${userIds[index]}: Unknown error`,
        );
      }
    }
  }

  console.log("All rate-limited API calls completed");
}

// Run all examples
async function runAllExamples() {
  try {
    await basicExample();
    await concurrencyExample();
    await errorHandlingExample();
    await cancellationExample();
    await rateLimitingExample();

    // Ensure all timeouts are cleaned up
    cleanupTimeouts();

    console.log("\nAll examples completed successfully!");
  } catch (error: unknown) {
    // Clean up timeouts even on error
    cleanupTimeouts();

    if (error instanceof Error) {
      console.error("Example execution failed:", error.message);
    } else {
      console.error("Example execution failed with unknown error");
    }
  }
}

// Run the examples
runAllExamples();
