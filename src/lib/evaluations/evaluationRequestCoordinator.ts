// In-flight sharing for manager evaluation reads. The weekly evaluation page, its live incentive card
// and its monthly report all ask for the same metrics/snapshot/history at the same time (and React
// StrictMode runs each effect twice in development). Identical concurrent reads now share one request.
// Nothing is cached after a request settles, and every evaluation write bumps the epoch so a read issued
// after a write never joins a request that started before it.

const inFlight = new Map<string, Promise<unknown>>();
const queue: Array<() => void> = [];
let activeHeavy = 0;
let evaluationEpoch = 0;

/** Upper bound of concurrent heavy evaluation aggregations (calculate_weekly_manager_metrics_v5 / fast_v1). */
export const MAX_CONCURRENT_HEAVY_EVALUATION_REQUESTS = 2;

export function markManagerEvaluationChanged() {
  evaluationEpoch += 1;
}

function acquireHeavySlot(): Promise<void> {
  if (activeHeavy < MAX_CONCURRENT_HEAVY_EVALUATION_REQUESTS) {
    activeHeavy += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      activeHeavy += 1;
      resolve();
    });
  });
}

function releaseHeavySlot() {
  activeHeavy = Math.max(0, activeHeavy - 1);
  const next = queue.shift();
  if (next) next();
}

export function shareEvaluationRequest<T>(
  requestKey: string,
  task: () => Promise<T>,
  options: { heavy?: boolean } = {}
): Promise<T> {
  const key = `${requestKey}#${evaluationEpoch}`;
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = (async () => {
    if (!options.heavy) return task();
    await acquireHeavySlot();
    try {
      return await task();
    } finally {
      releaseHeavySlot();
    }
  })();

  inFlight.set(key, request);
  void request
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    })
    .catch(() => undefined);

  return request;
}
