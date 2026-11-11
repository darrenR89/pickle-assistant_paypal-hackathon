// Small retry helper for the cron trigger. Each attempt gets its own deadline so one
// hung request can't eat the whole run (Node's fetch waits 5 minutes for headers).

export type RetryOptions = {
  attempts: number;
  /** Abort an attempt that hasn't answered after this long. */
  timeoutMs: number;
  /** Wait before attempt n+1 (n starts at 1). */
  waitMs: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, err: unknown) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === opts.attempts) break;
    opts.onRetry?.(attempt, lastErr);
    await sleep(opts.waitMs(attempt));
  }
  throw lastErr;
}
