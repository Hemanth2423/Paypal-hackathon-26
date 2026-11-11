// Runs `fn` over items with limited concurrency. Retries rate-limit and timeout errors with backoff.

const RETRYABLE = new Set(["tooManyRequestsError", "requestTimeoutError", "gatewayTimeoutError", "serviceUnavailableError", "serverError"]);

export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const type = (err as { type?: string })?.type ?? "";
      const network = (err as { code?: string })?.code === "ECONNRESET";
      if (i >= tries - 1 || !(RETRYABLE.has(type) || network)) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
