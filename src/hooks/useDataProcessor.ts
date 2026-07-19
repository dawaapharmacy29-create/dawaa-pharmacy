import { useCallback, useEffect, useRef, useState } from 'react';

interface WorkerRequest {
  id: string;
  type: 'aggregate' | 'filter' | 'sort' | 'transform';
  payload: unknown;
}

interface WorkerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

/**
 * Hook for offloading heavy data processing to a Web Worker.
 * Prevents UI blocking during large computations.
 */
export function useDataProcessor() {
  const workerRef = useRef<Worker | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const callbacksRef = useRef<Map<string, (result: unknown) => void>>(new Map());
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Initialize worker
    try {
      workerRef.current = new Worker(new URL('../workers/dataProcessor.ts', import.meta.url), {
        type: 'module',
      });

      workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, result, error: workerError } = event.data;
        const callback = callbacksRef.current.get(id);
        if (callback) {
          if (workerError) {
            console.error(`[useDataProcessor] Worker error for ${id}:`, workerError);
          } else {
            callback(result);
          }
          callbacksRef.current.delete(id);
        }
      };

      workerRef.current.onerror = (errorEvent) => {
        console.error('[useDataProcessor] Worker error:', errorEvent.message);
        setError(new Error(errorEvent.message));
      };
    } catch (err) {
      console.warn('[useDataProcessor] Failed to initialize worker:', err);
      // Gracefully degrade - worker not available
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const aggregate = useCallback(
    async (rows: Record<string, unknown>[], field: string, operation: string) => {
      if (!workerRef.current) {
        // Fallback: compute in main thread
        const values = rows.map((r) => Number(r[field]) || 0);
        switch (operation) {
          case 'sum':
            return values.reduce((a, b) => a + b, 0);
          case 'avg':
            return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
          case 'count':
            return rows.length;
          default:
            return null;
        }
      }

      return new Promise((resolve) => {
        const id = `agg-${++requestIdRef.current}`;
        callbacksRef.current.set(id, resolve);
        setLoading(true);
        setError(null);

        try {
          workerRef.current!.postMessage({
            id,
            type: 'aggregate',
            payload: { rows, field, operation },
          } as WorkerRequest);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
          resolve(null);
        } finally {
          setLoading(false);
        }
      });
    },
    []
  );

  const filter = useCallback(
    async (
      rows: Record<string, unknown>[],
      conditions: Array<{ field: string; op: string; value: unknown }>
    ) => {
      if (!workerRef.current) {
        // Fallback: filter in main thread
        return rows.filter((row) =>
          conditions.every(({ field, op, value }) => {
            const rowVal = row[field];
            switch (op) {
              case 'eq':
                return rowVal === value;
              case 'contains':
                return String(rowVal).includes(String(value));
              default:
                return true;
            }
          })
        );
      }

      return new Promise<Record<string, unknown>[]>((resolve) => {
        const id = `filt-${++requestIdRef.current}`;
        callbacksRef.current.set(id, resolve);
        setLoading(true);

        try {
          workerRef.current!.postMessage({
            id,
            type: 'filter',
            payload: { rows, conditions },
          } as WorkerRequest);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
          resolve(rows);
        } finally {
          setLoading(false);
        }
      });
    },
    []
  );

  const sort = useCallback(
    async (
      rows: Record<string, unknown>[],
      fields: Array<{ field: string; ascending?: boolean }>
    ) => {
      if (!workerRef.current) {
        // Fallback: sort in main thread
        return [...rows].sort((a, b) => {
          for (const { field, ascending = true } of fields) {
            const aVal = a[field];
            const bVal = b[field];
            if (aVal < bVal) return ascending ? -1 : 1;
            if (aVal > bVal) return ascending ? 1 : -1;
          }
          return 0;
        });
      }

      return new Promise<Record<string, unknown>[]>((resolve) => {
        const id = `sort-${++requestIdRef.current}`;
        callbacksRef.current.set(id, resolve);
        setLoading(true);

        try {
          workerRef.current!.postMessage({
            id,
            type: 'sort',
            payload: { rows, fields },
          } as WorkerRequest);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
          resolve(rows);
        } finally {
          setLoading(false);
        }
      });
    },
    []
  );

  return { aggregate, filter, sort, loading, error };
}
