const inFlight = new Map<string, Promise<unknown>>();
const queue: Array<() => void> = [];
let activeCount = 0;
const MAX_CONCURRENT_HEAVY_PAYROLL_REQUESTS = 2;

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_HEAVY_PAYROLL_REQUESTS) {
    activeCount += 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    queue.push(() => {
      activeCount += 1;
      resolve();
    });
  });
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  const next = queue.shift();
  if (next) next();
}

export function runPayrollHeavyRequest<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = (async () => {
    await acquireSlot();
    try {
      return await task();
    } finally {
      releaseSlot();
    }
  })();

  inFlight.set(key, request);
  void request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }).catch(() => undefined);

  return request;
}
