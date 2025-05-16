/**
 * Test utilities for consistent testing of the Scheduler
 */
import { delay } from "@std/async";

/**
 * Creates a deferred promise that can be resolved or rejected outside the constructor
 */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Creates a virtual timer context for testing time-dependent code
 * All promises created within will be properly cleaned up when aborted
 */
export function createTimerContext() {
  const abortController = new AbortController();

  // Custom delay that's tied to the abort controller
  const safeDelay = async (ms: number) => {
    try {
      return await delay(ms, { signal: abortController.signal });
    } catch {
      // Silently ignore AbortError when the timer is cancelled
    }
  };

  return {
    delay: safeDelay,
    abort: () => abortController.abort(),
    signal: abortController.signal,
  };
}
