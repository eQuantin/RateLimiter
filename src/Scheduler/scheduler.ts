/**
 * A request handler function that can be executed by the scheduler
 */
export type RequestHandler<T = any> = () => Promise<T>;

/**
 * A task represents a request to be executed with its associated metadata
 */
export interface Task<T = any> {
  id: string;
  handler: RequestHandler<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  isCancelled?: boolean;
}

/**
 * Base scheduler interface
 */
export interface IScheduler {
  /**
   * Schedules a request for execution
   * @param handler The request handler function to execute
   * @returns A promise that resolves with the result of the request
   */
  schedule<T>(handler: RequestHandler<T>): Promise<T>;

  /**
   * Clears the current queue of tasks
   */
  clearQueue(): void;

  /**
   * Returns the current queue length
   */
  readonly queueLength: number;
}

/**
 * Configuration options for the scheduler
 */
export interface SchedulerOptions {
  /**
   * Maximum number of concurrent requests
   * @default Infinity (no limit)
   */
  maxConcurrent?: number;
}

/**
 * A unified scheduler that can execute tasks sequentially or concurrently based on configuration
 */
export class Scheduler implements IScheduler {
  protected queue: Task[] = [];
  private activeCount: number = 0;
  private maxConcurrent: number;
  private activeTasks: Map<string, Task> = new Map();

  /**
   * Creates a new scheduler
   * @param options Configuration options
   */
  constructor(options: SchedulerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? Infinity;
  }

  /**
   * Schedules a request for execution
   * @param handler The request handler function to execute
   * @returns A promise that resolves with the result of the request
   */
  public schedule<T>(handler: RequestHandler<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = {
        id: this.generateTaskId(),
        handler,
        resolve,
        reject,
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  /**
   * Process the queue of tasks based on concurrency settings
   */
  protected processQueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return Promise.resolve();
    }

    // Process as many tasks as possible (up to maxConcurrent)
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;

      // Skip tasks that were cancelled while in queue
      if (task.isCancelled) {
        continue;
      }

      this.activeCount++;
      this.activeTasks.set(task.id, task);

      // Execute the task asynchronously
      this.executeTask(task).finally(() => {
        this.activeCount--;
        // Remove from active tasks
        this.activeTasks.delete(task.id);
        // When a task finishes, try to process more tasks
        this.processQueue();
      });
    }

    return Promise.resolve();
  }

  /**
   * Execute a single task
   * @param task The task to execute
   */
  private async executeTask<T>(task: Task<T>): Promise<void> {
    try {
      // Don't execute if the task was cancelled
      if (task.isCancelled) {
        return;
      }

      const result = await task.handler();

      // Only resolve if not cancelled during execution
      if (!task.isCancelled) {
        task.resolve(result);
      }
    } catch (error) {
      if (!task.isCancelled) {
        task.reject(error);
      }
    }
  }

  /**
   * Generates a unique ID for a task
   */
  protected generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Returns the current queue length
   */
  public get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Clears the current queue of tasks
   */
  public clearQueue(): void {
    const cancelError = new Error("Task was cancelled");

    // Reject all queued tasks
    this.queue.forEach((task) => {
      task.isCancelled = true;
      task.reject(cancelError);
    });

    // Reject all active tasks
    for (const task of this.activeTasks.values()) {
      task.isCancelled = true;
      task.reject(cancelError);
    }

    this.queue = [];
    this.activeTasks.clear();
  }

  /**
   * Cancels a specific task by ID
   * @param taskId The ID of the task to cancel
   * @returns true if a task was found and cancelled, false otherwise
   */
  public cancelTask(taskId: string): boolean {
    // Check in queue
    const queueIndex = this.queue.findIndex((task) => task.id === taskId);
    if (queueIndex >= 0) {
      const task = this.queue[queueIndex];
      task.isCancelled = true;
      task.reject(new Error("Task was cancelled"));
      this.queue.splice(queueIndex, 1);
      return true;
    }

    // Check in active tasks
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      activeTask.isCancelled = true;
      activeTask.reject(new Error("Task was cancelled"));
      // Remove from active tasks immediately
      this.activeTasks.delete(taskId);
      // Decrement active count since we're removing an active task
      this.activeCount--;
      // Process the queue to start a new task if any are waiting
      this.processQueue();
      return true;
    }

    return false;
  }
}
