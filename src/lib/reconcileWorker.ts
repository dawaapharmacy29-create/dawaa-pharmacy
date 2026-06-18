// Wrapper to use the reconcile web worker
export function createReconcileWorker() {
  if (typeof Worker === 'undefined') throw new Error('Workers not supported in this environment');
  // Vite-friendly import
  const worker = new Worker(new URL('../workers/reconcile.worker.ts', import.meta.url));
  let counter = 0;
  return {
    run(task: string, payload: any) {
      return new Promise((resolve, reject) => {
        const id = `${Date.now()}:${++counter}`;
        const handler = (ev: MessageEvent) => {
          if (ev.data?.id !== id) return;
          worker.removeEventListener('message', handler);
          if (ev.data.ok) resolve(ev.data.result);
          else reject(ev.data.error);
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ id, task, payload });
      });
    },
    terminate() {
      worker.terminate();
    }
  };
}
