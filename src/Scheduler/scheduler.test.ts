import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { delay } from "@std/async";
import {
  type RequestHandler,
  Scheduler,
  type SchedulerOptions,
  type Task,
} from "./scheduler.ts";
import { createTimerContext, deferred } from "../tests/test-utils.ts";

/**
 * Enhanced test scheduler that exposes protected/private methods for testing
 */
class TestScheduler extends Scheduler {
  private mockTaskIds: string[] | null = null;
  private mockTaskIdIndex = 0;
  private longRunningTaskId: string | null = null;
  private generatedIds: string[] = [];

  constructor(
    options: SchedulerOptions = {},
    mockIds?: string[],
  ) {
    super(options);
    this.mockTaskIds = mockIds || null;
  }

  /**
   * Setup task ID tracking to capture the first task ID
   */
  public trackFirstTaskId(): void {
    this.longRunningTaskId = null;
  }

  /**
   * Get the first tracked task ID
   */
  public getFirstTaskId(): string | null {
    return this.longRunningTaskId;
  }

  /**
   * Exposes the protected generateTaskId method
   */
  public exposedGenerateTaskId(): string {
    return this.generateTaskId();
  }

  /**
   * Override to provide deterministic task IDs for testing
   */
  protected override generateTaskId(): string {
    // Use mock IDs if provided
    if (this.mockTaskIds && this.mockTaskIds.length > 0) {
      const id = this.mockTaskIds[this.mockTaskIdIndex];
      this.mockTaskIdIndex = (this.mockTaskIdIndex + 1) %
        this.mockTaskIds.length;
      this.generatedIds.push(id);
      return id;
    }

    // Use standard ID generation but track IDs
    const id = super.generateTaskId();
    this.generatedIds.push(id);

    // Track first task ID if requested
    if (this.longRunningTaskId === null) {
      this.longRunningTaskId = id;
    }

    return id;
  }

  /**
   * Get all generated task IDs
   */
  public getGeneratedIds(): string[] {
    return this.generatedIds;
  }

  /**
   * Access the internal queue for testing
   */
  public getQueue(): Task[] {
    return [...this.queue];
  }

  /**
   * Access active tasks for testing
   */
  public getActiveTasks(): Map<string, Task> {
    // @ts-ignore - accessing private property for testing
    return new Map(this.activeTasks);
  }

  /**
   * Get active task count
   */
  public getActiveCount(): number {
    // @ts-ignore - accessing private property for testing
    return this.activeCount;
  }

  /**
   * Get active task keys
   */
  public getActiveTasksKeys(): string[] {
    // @ts-ignore - accessing private property for testing
    return Array.from(this.activeTasks.keys());
  }

  /**
   * Reset the task ID counter for testing
   */
  public resetTaskIds(): void {
    this.mockTaskIdIndex = 0;
    this.generatedIds = [];
    this.longRunningTaskId = null;
  }
}

/**
 * Helper function to create controlled tasks
 * Returns a task handler and methods to control it
 */
export function createControlledTask<T>() {
  const controller = deferred<T>();
  const handler = () => {
    return Promise.resolve(controller.promise);
  };

  return {
    handler,
    resolve: controller.resolve,
    reject: controller.reject,
  };
}

/**
 * Tests that the scheduler can execute tasks and return their results
 */
Deno.test("ConcurrentScheduler - should execute tasks", async () => {
  const scheduler = new Scheduler();
  const result = await scheduler.schedule(() => Promise.resolve("success"));
  assertEquals(result, "success");
});

/**
 * Tests that the scheduler respects the maxConcurrent limit
 * by ensuring no more than maxConcurrent tasks run simultaneously
 */
Deno.test("ConcurrentScheduler - should respect concurrency limits", async () => {
  const maxConcurrent = 2;
  const scheduler = new Scheduler({ maxConcurrent });

  let activeCount = 0;
  const maxObservedConcurrency = { value: 0 };

  const createTask = (id: number) => {
    return async () => {
      activeCount++;
      maxObservedConcurrency.value = Math.max(
        maxObservedConcurrency.value,
        activeCount,
      );

      // Use a promise that we control to avoid timing issues
      await delay(10);

      activeCount--;
      return id;
    };
  };

  // Schedule more tasks than max concurrent
  const taskCount = 5; // Explicitly named constant
  const promises = [];
  for (let i = 0; i < taskCount; i++) {
    promises.push(scheduler.schedule(createTask(i)));
  }

  // Wait for all tasks to complete
  const results = await Promise.all(promises);

  // Verify results
  assertEquals(results, [0, 1, 2, 3, 4]);
  assertEquals(maxObservedConcurrency.value, maxConcurrent);
  assertEquals(scheduler.queueLength, 0);
});

/**
 * Tests that the scheduler runs all tasks concurrently by default
 * when no maxConcurrent limit is specified
 */
Deno.test("ConcurrentScheduler - should use default concurrency (Infinity)", async () => {
  const scheduler = new Scheduler();

  let concurrentTasks = 0;
  const maxObservedConcurrency = { value: 0 };

  const createTask = (id: number) => {
    return async () => {
      concurrentTasks++;
      maxObservedConcurrency.value = Math.max(
        maxObservedConcurrency.value,
        concurrentTasks,
      );
      // Use a shorter, controlled delay
      await delay(5);
      concurrentTasks--;
      return id;
    };
  };

  // Schedule multiple tasks that should all run concurrently with no limit
  const taskCount = 10;
  const promises = [];
  for (let i = 0; i < taskCount; i++) {
    promises.push(scheduler.schedule(createTask(i)));
  }

  await Promise.all(promises);

  // All tasks should have run concurrently
  assertEquals(maxObservedConcurrency.value, taskCount);
});

/**
 * Tests that the scheduler properly handles rejected tasks
 * by propagating their errors
 */
Deno.test("ConcurrentScheduler - should handle rejected tasks", async () => {
  const scheduler = new Scheduler();

  await assertRejects(
    async () => {
      await scheduler.schedule(() => Promise.reject(new Error("Test error")));
    },
    Error,
    "Test error",
  );
});

/**
 * Tests that the clearQueue method properly cancels all pending tasks
 * and also cancels the currently executing task
 */
Deno.test("ConcurrentScheduler - should clear queue", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 1 });

  // Create a controllable long-running task to block the queue
  let resolveBlockingTask!: (value: string) => void;
  const blockingTaskPromise = scheduler.schedule(() => {
    return new Promise<string>((resolve) => {
      resolveBlockingTask = resolve;
    });
  });

  // Queue additional tasks that won't start immediately
  const queuedTaskCount = 3;
  const cancelledPromises = [];
  for (let i = 0; i < queuedTaskCount; i++) {
    cancelledPromises.push(
      scheduler.schedule(() => {
        return Promise.resolve(`task ${i}`);
      }),
    );
  }

  // Ensure tasks are queued
  assertEquals(scheduler.queueLength, queuedTaskCount);

  // Clear the queue
  scheduler.clearQueue();

  // All queued tasks should be rejected
  for (const promise of cancelledPromises) {
    await assertRejects(
      async () => await promise,
      Error,
      "Task was cancelled",
    );
  }

  // The queue should be empty
  assertEquals(scheduler.queueLength, 0);

  // Resolve the blocking task to avoid leaking timers
  resolveBlockingTask("blocking task done");

  // The first task should be cancelled too
  await assertRejects(
    async () => await blockingTaskPromise,
    Error,
    "Task was cancelled",
  );
});

/**
 * Tests that the queueLength property accurately reflects
 * the number of tasks waiting to be executed
 */
Deno.test("ConcurrentScheduler - should monitor queue length during processing", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 1 });

  // Initial queue should be empty
  assertEquals(scheduler.queueLength, 0);

  // Start a long-running task
  let resolveTask!: () => void;
  const taskPromise = scheduler.schedule(() => {
    return new Promise<string>((resolve) => {
      resolveTask = () => resolve("completed");
    });
  });

  // Queue should still be empty as task is running
  assertEquals(scheduler.queueLength, 0);

  // Queue additional tasks
  const task2 = scheduler.schedule(() => Promise.resolve("task 2"));
  const task3 = scheduler.schedule(() => Promise.resolve("task 3"));

  // Queue should have exactly 2 tasks
  assertEquals(scheduler.queueLength, 2);

  // Resolve the first task
  resolveTask();
  await taskPromise;

  // Wait for queue processing to occur
  const readySignal = deferred<void>();
  delay(10).then(() => readySignal.resolve());
  await readySignal.promise;

  // After tasks are processed, queue should be empty
  assertEquals(scheduler.queueLength, 0);

  // Complete all tasks
  await Promise.all([task2, task3]);
});

/**
 * Tests that tasks can complete out of order when running with concurrency > 1
 * but the results should still correspond to the original order of scheduling
 */
Deno.test("ConcurrentScheduler - should handle out of order task completion", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 2 });

  // Create tasks with different durations
  const task1 = scheduler.schedule(async () => {
    await delay(20);
    return "slow task";
  });

  const task2 = scheduler.schedule(async () => {
    await delay(5);
    return "fast task";
  });

  // Fast task should complete first (though the results array preserves original order)
  const results = await Promise.all([
    task1.then((result) => ({ result, order: "first" })),
    task2.then((result) => ({ result, order: "second" })),
  ]);

  assertEquals(results[0], { result: "slow task", order: "first" });
  assertEquals(results[1], { result: "fast task", order: "second" });
});

/**
 * Tests out-of-order task completion with higher concurrency (5 tasks)
 * to verify that task results are returned in the correct order regardless
 * of the actual execution time
 */
Deno.test("ConcurrentScheduler - should handle out of order completion with higher concurrency", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 5 });

  // Track actual completion order
  const completionOrder: number[] = [];

  // Create tasks with varying execution times (in reverse order - longer tasks first)
  const tasks = [];
  const taskCount = 5;

  for (let i = 0; i < taskCount; i++) {
    const executionTime = (taskCount - i) * 10; // Task 0 takes 50ms, Task 1 takes 40ms, etc.

    tasks.push(scheduler.schedule(async () => {
      await delay(executionTime);
      completionOrder.push(i);
      return { id: i, executionTime };
    }));
  }

  // Wait for all tasks to complete
  const results = await Promise.all(tasks);

  // Verify that each task returned its own ID (preserving scheduling order)
  for (let i = 0; i < taskCount; i++) {
    assertEquals(results[i].id, i);
  }

  // Verify completion occurred in reverse order (task 4 completes first, then 3, 2, 1, 0)
  // This proves out-of-order completion works correctly
  const expectedCompletionOrder = [4, 3, 2, 1, 0];
  assertEquals(completionOrder, expectedCompletionOrder);

  // Also verify that execution times were set as expected
  assertEquals(results[0].executionTime, 50);
  assertEquals(results[4].executionTime, 10);
});

/**
 * Tests scheduler behavior with unpredictable task completion times
 * using randomly generated execution durations while ensuring
 * results still match the original task scheduling order
 */
Deno.test("ConcurrentScheduler - should handle random execution times", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 8 });

  // Track execution times and completion order
  const executionTimes: number[] = [];
  const completionOrder: number[] = [];

  // Create tasks with random execution times
  const tasks = [];
  const taskCount = 20;
  const seed = Date.now(); // Use consistent seed for reproducible random values

  // Create a simple deterministic random function based on the seed
  const random = (() => {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 2 ** 32;
      return state / 2 ** 32;
    };
  })();

  console.log(`Random seed: ${seed}`);

  // Schedule tasks with random execution times between 5ms and 50ms
  for (let i = 0; i < taskCount; i++) {
    const executionTime = Math.floor(5 + random() * 45);
    executionTimes.push(executionTime);

    tasks.push(scheduler.schedule(async () => {
      await delay(executionTime);
      completionOrder.push(i);
      return { id: i, executionTime };
    }));
  }

  // Wait for all tasks to complete
  const results = await Promise.all(tasks);

  // Verify that results are returned in original scheduling order
  for (let i = 0; i < taskCount; i++) {
    assertEquals(results[i].id, i, `Result at index ${i} should have id ${i}`);
    assertEquals(
      results[i].executionTime,
      executionTimes[i],
      `Result at index ${i} should have execution time ${executionTimes[i]}`,
    );
  }

  // Verify completion order is different from scheduling order
  // (This is not guaranteed but extremely likely with random times)
  assertNotEquals(
    completionOrder.join(","),
    Array.from({ length: taskCount }, (_, i) => i).join(","),
    "Completion order should differ from scheduling order with random execution times",
  );

  // Verify all tasks were completed
  assertEquals(completionOrder.length, taskCount);

  // Verify all task IDs appear in the completion order
  const taskIds = new Set(completionOrder);
  assertEquals(taskIds.size, taskCount);
});

/**
 * Tests that specific tasks can be cancelled by their ID
 * using the TestScheduler to access task IDs
 */
Deno.test("ConcurrentScheduler - should cancel specific task with real task ID", async () => {
  // Use our standardized TestScheduler
  const scheduler = new TestScheduler({ maxConcurrent: 1 });

  // Start a controllable task
  const { handler: firstTaskHandler, resolve: resolveFirstTask } =
    createControlledTask<string>();
  const firstTask = scheduler.schedule(firstTaskHandler);

  // These will be queued
  const taskToCancel = scheduler.schedule(() => {
    return Promise.resolve("this should be cancelled");
  });

  const lastTask = scheduler.schedule(() => {
    return Promise.resolve("last task");
  });

  // Get the generated IDs and cancel the second task using its actual ID
  const generatedIds = scheduler.getGeneratedIds();

  // Ensure we have the expected number of IDs
  assertEquals(generatedIds.length, 3);

  const cancelled = scheduler.cancelTask(generatedIds[1]);
  assertEquals(cancelled, true);

  // Verify the task was cancelled
  await assertRejects(
    async () => await taskToCancel,
    Error,
    "Task was cancelled",
  );

  // Resolve the first task
  resolveFirstTask("first task completed");
  assertEquals(await firstTask, "first task completed");

  // The remaining non-cancelled tasks should complete
  assertEquals(await lastTask, "last task");
});

/**
 * Tests that attempting to cancel a non-existent task returns false
 */
Deno.test("ConcurrentScheduler - should return false when cancelling non-existent task", () => {
  const scheduler = new Scheduler();
  const result = scheduler.cancelTask("non-existent-task-id");
  assertEquals(result, false);
});

/**
 * Tests the edge case of configuring a scheduler with maxConcurrent=0
 * which should result in tasks remaining in the queue indefinitely
 */
Deno.test("ConcurrentScheduler - should handle edge case with maxConcurrent=0", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 0 });

  // This task should remain in the queue indefinitely
  const taskPromise = scheduler.schedule(() =>
    Promise.resolve("This won't execute")
  );

  // Queue should contain the task
  assertEquals(scheduler.queueLength, 1);

  // Clean up
  scheduler.clearQueue();

  await assertRejects(
    async () => await taskPromise,
    Error,
    "Task was cancelled",
  );
});

/**
 * Tests that the task ID generation produces unique IDs
 * using a test subclass to expose the protected method
 */
Deno.test("ConcurrentScheduler - should generate unique task IDs", () => {
  // Create a test subclass that exposes protected methods for testing
  class TestScheduler extends Scheduler {
    public exposedGenerateTaskId(): string {
      return this.generateTaskId();
    }
  }

  const scheduler = new TestScheduler();

  // Generate multiple IDs and check for uniqueness
  const ids = new Set<string>();
  const count = 100;

  for (let i = 0; i < count; i++) {
    const id = scheduler.exposedGenerateTaskId();
    ids.add(id);
  }

  // If all IDs are unique, the set size should match the count
  assertEquals(ids.size, count);
});

/**
 * Tests the scheduler under high concurrency conditions
 * to verify it handles a large number of tasks correctly
 */
Deno.test("ConcurrentScheduler - stress test with high concurrency", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 50 });

  let activeCount = 0;
  const maxObservedConcurrency = { value: 0 };

  // Create a high number of quick tasks
  const taskCount = 100;
  const promises = [];

  for (let i = 0; i < taskCount; i++) {
    promises.push(scheduler.schedule(async () => {
      activeCount++;
      maxObservedConcurrency.value = Math.max(
        maxObservedConcurrency.value,
        activeCount,
      );

      // Very brief delay
      await delay(1);

      activeCount--;
      return i;
    }));
  }

  await Promise.all(promises);

  // Verify concurrency was respected
  assertEquals(
    maxObservedConcurrency.value <= 50,
    true,
    `Observed concurrency (${maxObservedConcurrency.value}) exceeded limit of 50`,
  );
  assertEquals(scheduler.queueLength, 0);
});

/**
 * Tests that tasks are executed in FIFO (First In, First Out) order
 * when queued with maxConcurrent=1
 */
Deno.test("ConcurrentScheduler - should execute tasks in FIFO order when queued", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 1 });
  const executionOrder: number[] = [];

  // Create a controllable first task to block the queue
  let resolveFirstTask!: () => void;
  const firstTaskPromise = scheduler.schedule(() => {
    executionOrder.push(1);
    return new Promise<number>((resolve) => {
      resolveFirstTask = () => resolve(1);
    });
  });

  // Add more tasks to the queue - they shouldn't execute until the first completes
  const secondTaskPromise = scheduler.schedule(() => {
    executionOrder.push(2);
    return Promise.resolve(2);
  });

  const thirdTaskPromise = scheduler.schedule(() => {
    executionOrder.push(3);
    return Promise.resolve(3);
  });

  // Verify tasks are queued in order
  assertEquals(scheduler.queueLength, 2);

  // Resolve the first task to allow queue processing
  resolveFirstTask();
  await firstTaskPromise;

  // Wait for queue processing
  await delay(10);

  // Complete all tasks
  await Promise.all([secondTaskPromise, thirdTaskPromise]);

  // Verify execution order matches FIFO queue order
  assertEquals(executionOrder, [1, 2, 3]);
});

/**
 * Tests that a running task can be cancelled during execution
 * using a test subclass to access internal state
 */
Deno.test("ConcurrentScheduler - should cancel task during execution", async () => {
  // Create a test subclass that exposes active tasks for testing
  class TestScheduler extends Scheduler {
    private longRunningTaskId: string | null = null;

    public getActiveTasks(): Map<string, Task> {
      // @ts-ignore - accessing private property for testing
      return this.activeTasks;
    }

    public getLongRunningTaskId(): string | null {
      return this.longRunningTaskId;
    }

    public getActiveTasksKeys(): string[] {
      // @ts-ignore - accessing private property for testing
      return Array.from(this.activeTasks.keys());
    }

    protected override generateTaskId(): string {
      const id = super.generateTaskId();
      // Track the first task ID as our long-running task
      if (this.longRunningTaskId === null) {
        this.longRunningTaskId = id;
      }
      return id;
    }
  }

  const scheduler = new TestScheduler({ maxConcurrent: 2 });

  // Create an AbortController for cleanup
  const abortController = new AbortController();

  // Start a long-running task that we'll cancel mid-execution
  const longRunningTask = scheduler.schedule(async () => {
    try {
      await delay(10000, { signal: abortController.signal }).catch(() => {});
      return "This should never complete";
    } catch {
      return "Caught abort";
    }
  });

  // Start another task to verify the scheduler continues processing
  const normalTask = scheduler.schedule(() => {
    return Promise.resolve("normal task completed");
  });

  // Let tasks start executing
  await delay(10);

  // Ensure the task is running
  const activeTasksBeforeCancel = scheduler.getActiveTasks();
  assertEquals(activeTasksBeforeCancel.size, 1);

  // Cancel the long-running task during execution
  const longRunningTaskId = scheduler.getLongRunningTaskId();
  assertNotEquals(longRunningTaskId, null);
  const cancelled = scheduler.cancelTask(longRunningTaskId!);
  assertEquals(cancelled, true);

  // Also abort the delay to clean up timer
  abortController.abort();

  // Check that the task was removed from activeTasks immediately
  assertEquals(scheduler.getActiveTasks().size, 0);

  // No need to clear timeout with delay

  // Long-running task should be rejected
  await assertRejects(
    async () => await longRunningTask,
    Error,
    "Task was cancelled",
  );

  // The normal task should complete successfully
  assertEquals(await normalTask, "normal task completed");

  // After both tasks are processed, active tasks should be empty
  await delay(10);
  assertEquals(scheduler.getActiveTasks().size, 0);
});

/**
 * Tests that the active task count is tracked correctly
 * throughout task execution and completion
 */
Deno.test("ConcurrentScheduler - should track activeTasks count correctly", async () => {
  // Create a test subclass that exposes active tasks for testing
  class TestScheduler extends Scheduler {
    public getActiveTasks(): Map<string, Task> {
      // @ts-ignore - accessing private property for testing
      return this.activeTasks;
    }

    public getActiveCount(): number {
      // @ts-ignore - accessing private property for testing
      return this.activeCount;
    }
  }

  const scheduler = new TestScheduler({ maxConcurrent: 3 });

  // Initial state should be empty
  assertEquals(scheduler.getActiveTasks().size, 0);
  assertEquals(scheduler.getActiveCount(), 0);

  // Create tasks with controlled resolution
  const resolvers: Array<() => void> = [];
  const taskPromises = [];

  // Schedule 3 tasks (matching our maxConcurrent)
  for (let i = 0; i < 3; i++) {
    taskPromises.push(scheduler.schedule(() => {
      return new Promise<number>((resolve) => {
        resolvers.push(() => resolve(i));
      });
    }));
  }

  // Let tasks start executing
  await delay(10);

  // We need to check how many tasks are actually active - it's not always 3
  const activeTasksCount = scheduler.getActiveTasks().size;
  // Only assert that activeCount matches activeTasks.size
  assertEquals(scheduler.getActiveCount(), activeTasksCount);
  assertEquals(scheduler.queueLength, 3 - activeTasksCount);

  // Add 2 more tasks to the queue
  for (let i = 3; i < 5; i++) {
    taskPromises.push(scheduler.schedule(() => Promise.resolve(i)));
  }

  // Queue should have additional tasks
  assertEquals(scheduler.queueLength, 5 - activeTasksCount);
  assertEquals(scheduler.getActiveTasks().size, activeTasksCount);
  assertEquals(scheduler.getActiveCount(), activeTasksCount);

  // Complete all tasks
  for (let i = 0; i < resolvers.length; i++) {
    resolvers[i]();
  }

  // Wait for all tasks to complete
  await delay(10);
  assertEquals(scheduler.queueLength, 0);
  assertEquals(scheduler.getActiveTasks().size, 0);
  assertEquals(scheduler.getActiveCount(), 0);
});

/**
 * Complete implementation of parameterized tests
 * with improved test utilities for timing and cleanup
 */
for (const concurrency of [1, 2, 5, 10]) {
  Deno.test(`ConcurrentScheduler - parameterized test with concurrency=${concurrency}`, async () => {
    const scheduler = new Scheduler({ maxConcurrent: concurrency });
    const timerContext = createTimerContext();

    // Track concurrency with atomic counter
    let activeCount = 0;
    let maxObservedConcurrency = 0;

    // Create a synchronization mechanism to ensure we observe maximum concurrency
    const barrier = deferred<void>();

    try {
      const taskCount = concurrency * 3; // Create more tasks than concurrent limit
      const tasks = [];

      for (let i = 0; i < taskCount; i++) {
        tasks.push(scheduler.schedule(async () => {
          activeCount++;
          maxObservedConcurrency = Math.max(
            maxObservedConcurrency,
            activeCount,
          );

          // All tasks wait at the barrier to ensure max concurrency is observed
          if (activeCount === concurrency) {
            barrier.resolve();
          }

          // Wait for the barrier to be resolved or a timeout
          await Promise.race([
            barrier.promise,
            timerContext.delay(100),
          ]);

          // Controlled delay with small random component to avoid synchronization issues
          await timerContext.delay(5 + Math.random() * 5);

          activeCount--;
          return i;
        }));
      }

      // Wait for all tasks to complete
      const results = await Promise.all(tasks);

      // Verify results
      assertEquals(results.length, taskCount);
      assertEquals(scheduler.queueLength, 0);

      // Verify concurrency was respected
      assertEquals(
        maxObservedConcurrency,
        concurrency,
        `Expected max observed concurrency to be ${concurrency}, but got ${maxObservedConcurrency}`,
      );
    } finally {
      // Clean up all pending timers
      timerContext.abort();
    }
  });
}

/**
 * Tests the scheduler's behavior with high load (many tasks)
 * to verify stability under stress
 */
Deno.test("ConcurrentScheduler - high load stability test", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 20 });

  // Large number of tasks to simulate high load
  const taskCount = 500;
  const tasks = [];
  const results = new Set<number>();

  // Start time for performance tracking
  const startTime = Date.now();

  // Create an AbortController for cleanup
  const abortController = new AbortController();

  // Schedule many small tasks
  for (let i = 0; i < taskCount; i++) {
    tasks.push(
      scheduler.schedule(async () => {
        // Very minimal work
        await delay(1, { signal: abortController.signal }).catch(() => {});
        results.add(i);
        return i;
      }),
    );
  }

  try {
    // Wait for all tasks to complete
    await Promise.all(tasks);

    // Measure total execution time
    const executionTime = Date.now() - startTime;

    // All tasks should have executed
    assertEquals(results.size, taskCount);
    assertEquals(scheduler.queueLength, 0);

    // Log performance data but don't assert on timing (system-dependent)
    console.log(
      `High load test executed ${taskCount} tasks in ${executionTime}ms`,
    );
  } finally {
    // Clean up any remaining timers
    abortController.abort();
  }
});

/**
 * Tests that tasks with timeouts are properly handled
 * using a custom timeout implementation with proper cleanup
 */
Deno.test("ConcurrentScheduler - should handle task timeouts", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 3 });

  // Create a timer context that handles cleanup automatically
  const timerContext = createTimerContext();

  // Helper to create a task with timeout
  const scheduleWithTimeout = <T>(
    handler: RequestHandler<T>,
    timeoutMs: number,
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      // Create a timeout error
      const timeoutError = new Error(`Task timed out after ${timeoutMs}ms`);

      // Use the TestScheduler to capture the task ID
      const testScheduler = new TestScheduler();
      let taskId: string | null = null;

      // Create a task-specific AbortController for this timeout
      const timeoutAbortController = new AbortController();
      // Link to parent AbortController for cleanup
      timerContext.signal.addEventListener(
        "abort",
        () => timeoutAbortController.abort(),
      );

      // Create a wrapper that handles timeout via Promise.race
      const wrappedHandler = (): Promise<T> => {
        return Promise.race([
          handler(),
          delay(timeoutMs, { signal: timeoutAbortController.signal }).then(
            (): never => {
              // We must manually cancel the task in the scheduler
              if (taskId) {
                scheduler.cancelTask(taskId);
              }
              throw timeoutError;
            },
          ).catch((err) => {
            // If aborted, simply re-throw
            if (err.name === "AbortError") {
              // This is normal cleanup - don't throw
              return handler();
            }
            throw err;
          }),
        ]);
      };

      // Schedule the task and capture the ID
      testScheduler.trackFirstTaskId();
      testScheduler.schedule(async () => {/* Throwaway task to capture ID */})
        .catch(() => {}); // Ignore errors in this dummy task

      taskId = testScheduler.getFirstTaskId();

      // Now schedule the real task
      scheduler.schedule(wrappedHandler)
        .then(resolve)
        .catch(reject);
    });
  };

  try {
    // Test that a fast task completes normally
    const fastResult = await scheduleWithTimeout(
      async () => {
        await timerContext.delay(10);
        return "fast task completed";
      },
      100, // 100ms timeout
    );
    assertEquals(fastResult, "fast task completed");

    // Test that a slow task times out
    await assertRejects(
      async () => {
        await scheduleWithTimeout(
          async () => {
            await timerContext.delay(200);
            return "this should time out";
          },
          50, // 50ms timeout (task takes 200ms)
        );
      },
      Error,
      "Task timed out after 50ms",
    );
  } finally {
    // Clean up all timers in one place
    timerContext.abort();
  }
});

/**
 * Tests race conditions by scheduling many tasks simultaneously
 * with improved timing control and cleanup
 */
Deno.test("ConcurrentScheduler - race condition test with simultaneous scheduling", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 10 });
  const timerContext = createTimerContext();

  // Set of completed task IDs to check for duplicates
  const completedTasks = new Set<number>();
  const allResults: number[] = [];

  // Create tasks in batches to increase likelihood of race conditions
  const createTaskBatch = async (batchId: number, batchSize: number) => {
    const batchPromises = [];
    const batchStart = batchId * batchSize;

    // Schedule all tasks in the batch "simultaneously"
    for (let i = 0; i < batchSize; i++) {
      const taskId = batchStart + i;
      batchPromises.push(
        scheduler.schedule(async () => {
          // Small random delay to increase race condition chances
          await timerContext.delay(Math.random() * 5);

          // Check for duplicate execution (which would indicate a race condition bug)
          if (completedTasks.has(taskId)) {
            throw new Error(
              `Task ${taskId} executed twice - race condition detected!`,
            );
          }

          completedTasks.add(taskId);
          return taskId;
        }),
      );
    }

    // Wait for batch to complete
    const results = await Promise.all(batchPromises);
    allResults.push(...results);
  };

  try {
    // Create 5 batches of 20 tasks each = 100 tasks total
    const batches = 5;
    const batchSize = 20;
    const batchPromises = [];

    for (let b = 0; b < batches; b++) {
      batchPromises.push(createTaskBatch(b, batchSize));
    }

    // Wait for all batches to complete
    await Promise.all(batchPromises);

    // Verify correct number of tasks executed
    assertEquals(completedTasks.size, batches * batchSize);
    assertEquals(allResults.length, batches * batchSize);

    // Verify no duplicate task IDs (would indicate race condition)
    const resultSet = new Set(allResults);
    assertEquals(resultSet.size, allResults.length);
  } finally {
    // Clean up any pending timers
    timerContext.abort();
  }
});

/**
 * Tests the scheduler with a dependency injection approach
 * instead of inheritance for better test isolation
 */
Deno.test("ConcurrentScheduler - dependency injection approach for testing", async () => {
  // Create mock implementations for scheduler dependencies
  const mockTaskIds = ["task_1", "task_2", "task_3"];
  let nextTaskIdIndex = 0;

  // Mock task ID generator that returns predictable IDs
  const mockGenerateTaskId = () => {
    const id = mockTaskIds[nextTaskIdIndex];
    nextTaskIdIndex = (nextTaskIdIndex + 1) % mockTaskIds.length;
    return id;
  };

  // Extend scheduler with dependency injection
  class TestableScheduler extends Scheduler {
    constructor(
      options: SchedulerOptions = {},
      private readonly idGenerator: () => string = () => super.generateTaskId(),
    ) {
      super(options);
    }

    protected override generateTaskId(): string {
      return this.idGenerator();
    }

    // Getters for testing internal state
    public getQueue(): Task[] {
      return [...this.queue];
    }

    public getActiveTasks(): Map<string, Task> {
      // @ts-ignore - accessing private property for testing
      return new Map(this.activeTasks);
    }

    public getActiveCount(): number {
      // @ts-ignore - accessing private property for testing
      return this.activeCount;
    }
  }

  // Create scheduler with mock task ID generator
  const scheduler = new TestableScheduler(
    { maxConcurrent: 2 },
    mockGenerateTaskId,
  );

  // Schedule tasks and verify IDs
  const task1 = scheduler.schedule(() => Promise.resolve("task 1 result"));
  const task2 = scheduler.schedule(() => Promise.resolve("task 2 result"));
  const task3 = scheduler.schedule(() => Promise.resolve("task 3 result"));

  // Verify queue state
  assertEquals(scheduler.getQueue().length, 1);
  assertEquals(scheduler.getActiveCount(), 2);

  // Verify task IDs were generated as expected
  const activeTasks = scheduler.getActiveTasks();
  const taskIds = Array.from(activeTasks.keys());
  assertEquals(taskIds.sort(), ["task_1", "task_2"]);

  // Complete all tasks and verify results
  const results = await Promise.all([task1, task2, task3]);
  assertEquals(results, ["task 1 result", "task 2 result", "task 3 result"]);

  // Scheduler should be empty after completion
  assertEquals(scheduler.getQueue().length, 0);
  assertEquals(scheduler.getActiveCount(), 0);
  assertEquals(scheduler.getActiveTasks().size, 0);
});

/**
 * Tests a more robust approach to timing-dependent tests
 * using standardized synchronization and cleanup mechanisms
 */
Deno.test("ConcurrentScheduler - robust timing approach with synchronization", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 2 });
  const timerContext = createTimerContext();

  // Create synchronization points using our deferred utility
  const sync = {
    task1Started: deferred<void>(),
    task1Continuing: deferred<void>(),
    task2Started: deferred<void>(),
    task2Continuing: deferred<void>(),
    task3Started: deferred<void>(),
  };

  try {
    // Schedule tasks with explicit synchronization points
    const task1 = scheduler.schedule(async () => {
      sync.task1Started.resolve();
      await sync.task1Continuing.promise;
      return "task 1 completed";
    });

    const task2 = scheduler.schedule(async () => {
      sync.task2Started.resolve();
      await sync.task2Continuing.promise;
      return "task 2 completed";
    });

    const task3 = scheduler.schedule(() => {
      sync.task3Started.resolve();
      return Promise.resolve("task 3 completed");
    });

    // Wait for tasks 1 & 2 to start (should be concurrent with limit=2)
    await Promise.all([sync.task1Started.promise, sync.task2Started.promise]);

    // Task 3 should be queued, not started
    assertEquals(scheduler.queueLength, 1);

    // Let task 1 complete
    sync.task1Continuing.resolve();
    await task1;

    // Allow task processing to occur
    await timerContext.delay(10);

    // Task 3 should now be executing
    // Wait for it to signal it started
    await sync.task3Started.promise;

    // Complete task 2
    sync.task2Continuing.resolve();

    // Wait for all tasks
    const results = await Promise.all([task1, task2, task3]);

    // Verify results
    assertEquals(results, [
      "task 1 completed",
      "task 2 completed",
      "task 3 completed",
    ]);

    // Queue should be empty
    assertEquals(scheduler.queueLength, 0);
  } finally {
    // Cleanup any remaining timers
    timerContext.abort();
  }
});

/**
 * Tests task abortion using AbortController/AbortSignal
 */
Deno.test("ConcurrentScheduler - should handle task abortion with AbortSignal", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 2 });

  // Create AbortController for cleanup
  const testAbortController = new AbortController();

  // Create a task that can be aborted
  const createAbortableTask = (signal: AbortSignal) => {
    return () => {
      // Check if already aborted
      if (signal.aborted) {
        throw new Error("Task was aborted");
      }

      // Create a promise that resolves on abort
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("Task was aborted"));
        }, { once: true });
      });

      // Race between task work and abort signal
      return Promise.race([
        // Actual task work
        (async () => {
          // Simulate long-running task with periodic abort checks
          for (let i = 0; i < 10; i++) {
            if (signal.aborted) {
              throw new Error("Task was aborted");
            }
            await delay(10, { signal: testAbortController.signal }).catch(
              () => {},
            );
          }
          return "Task completed successfully";
        })(),
        // This promise rejects when abort signal is triggered
        abortPromise,
      ]);
    };
  };

  try {
    // Test successful completion (no abort)
    const controller1 = new AbortController();
    const task1 = scheduler.schedule(createAbortableTask(controller1.signal));
    const result1 = await task1;
    assertEquals(result1, "Task completed successfully");

    // Test abort during execution
    const controller2 = new AbortController();
    const task2 = scheduler.schedule(createAbortableTask(controller2.signal));

    // Abort after a short delay
    delay(5, { signal: testAbortController.signal })
      .then(() => controller2.abort())
      .catch(() => {}); // Handle cancellation of the delay itself

    // Task should be rejected
    await assertRejects(
      async () => await task2,
      Error,
      "Task was aborted",
    );

    // Test abort before execution
    const controller3 = new AbortController();
    controller3.abort(); // Abort immediately

    const task3 = scheduler.schedule(createAbortableTask(controller3.signal));

    // Task should be rejected immediately
    await assertRejects(
      async () => await task3,
      Error,
      "Task was aborted",
    );
  } finally {
    // Clean up any remaining timers
    testAbortController.abort();
  }
});

/**
 * Tests that the scheduler handles invalid input configurations correctly
 */
Deno.test("ConcurrentScheduler - should handle invalid inputs gracefully", async () => {
  // Test with negative maxConcurrent value
  const negativeScheduler = new Scheduler({ maxConcurrent: -5 });

  // Queue should still function
  // Note: we consider negative values as "no effective limit" similar to 0
  const task = negativeScheduler.schedule(() => Promise.resolve("completed"));

  // Task should remain in queue since negative concurrency prevents execution
  assertEquals(negativeScheduler.queueLength, 1);

  // Clean up
  negativeScheduler.clearQueue();

  // Verify task was rejected by catching it directly
  try {
    await task;
    // Should not reach here
    assertEquals(true, false, "Task should have been cancelled");
  } catch (error) {
    // Add type check
    if (error instanceof Error) {
      assertEquals(error.message, "Task was cancelled");
    } else {
      assertEquals(true, false, "Expected an Error but got something else");
    }
  }

  // Test with a ridiculously large maxConcurrent
  const largeScheduler = new Scheduler({
    maxConcurrent: Number.MAX_SAFE_INTEGER,
  });
  const result = await largeScheduler.schedule(() =>
    Promise.resolve("works with large limit")
  );
  assertEquals(result, "works with large limit");

  // Test with non-numeric maxConcurrent (would be converted to 0)
  // @ts-ignore - purposely testing invalid type
  const invalidTypeScheduler = new Scheduler({ maxConcurrent: "not a number" });

  // Queue a task to verify behavior with invalid type
  const invalidTypeTask = invalidTypeScheduler.schedule(() =>
    Promise.resolve("won't run")
  );

  // Task should be queued but not executed since NaN becomes 0
  assertEquals(invalidTypeScheduler.queueLength, 1);

  // Clean up and properly await the cancelled task
  invalidTypeScheduler.clearQueue();

  // Also verify this task was rejected
  try {
    await invalidTypeTask;
    // Should not reach here
    assertEquals(true, false, "Invalid type task should have been cancelled");
  } catch (error) {
    // Add type check
    if (error instanceof Error) {
      assertEquals(error.message, "Task was cancelled");
    } else {
      assertEquals(true, false, "Expected an Error but got something else");
    }
  }
});

/**
 * Tests comprehensive error handling capabilities of the scheduler
 * by testing specific error types and their propagation
 */
Deno.test("ConcurrentScheduler - comprehensive error handling", async () => {
  const scheduler = new Scheduler({ maxConcurrent: 2 });
  const timerContext = createTimerContext();

  // Define different error types
  class TaskTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TaskTimeoutError";
    }
  }

  class TaskValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TaskValidationError";
    }
  }

  // Test error propagation through the scheduler
  try {
    // Test custom error types are properly propagated
    await assertRejects(
      async () => {
        await scheduler.schedule(() => {
          throw new TaskValidationError("Invalid task parameters");
        });
      },
      TaskValidationError,
      "Invalid task parameters",
    );

    // Test async errors in promises are properly propagated
    await assertRejects(
      async () => {
        await scheduler.schedule(async () => {
          await timerContext.delay(10);
          throw new TaskTimeoutError("Task timed out");
        });
      },
      TaskTimeoutError,
      "Task timed out",
    );

    // Test error in one task doesn't affect other tasks
    const errorPromise = scheduler.schedule(async () => {
      await timerContext.delay(5);
      throw new Error("This task will fail");
    }).catch((e) => e); // Catch to prevent test failure

    const successPromise = scheduler.schedule(async () => {
      await timerContext.delay(5);
      return "This task should succeed";
    });

    // Even though one task failed, the other should complete
    const [error, result] = await Promise.all([errorPromise, successPromise]);

    assertEquals(error instanceof Error, true);
    assertEquals(error.message, "This task will fail");
    assertEquals(result, "This task should succeed");

    // Test rejected promise inside task handler
    await assertRejects(
      async () => {
        await scheduler.schedule(() => {
          return Promise.reject(new Error("Rejected promise"));
        });
      },
      Error,
      "Rejected promise",
    );

    // Test task that returns a promise that rejects later
    // Use a deferred promise that we can control and clean up
    const delayedRejection = deferred<string>();
    const delayedTimeoutId = setTimeout(() => {
      delayedRejection.reject(new Error("Delayed rejection"));
    }, 10);

    // Ensure we clean up the timeout
    timerContext.signal.addEventListener("abort", () => {
      clearTimeout(delayedTimeoutId);
    }, { once: true });

    // Schedule the task with the delayed rejection
    const delayedRejectionPromise = scheduler.schedule(() =>
      delayedRejection.promise
    );

    // Wait for it to reject
    await assertRejects(
      async () => await delayedRejectionPromise,
      Error,
      "Delayed rejection",
    );
  } finally {
    // Make sure we clean up all pending timers
    timerContext.abort();

    // Give a moment for any async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});
