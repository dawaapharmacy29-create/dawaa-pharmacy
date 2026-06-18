// Simple Web Worker to run heavy reconciliation or aggregation tasks.
// Usage (Vite): new Worker(new URL('./reconcile.worker.ts', import.meta.url))

self.addEventListener('message', async (ev) => {
  const { id, task, payload } = ev.data || {};
  try {
    if (task === 'reconcileInvoices') {
      // placeholder heavy computation
      const invoices = payload?.invoices || [];
      // example: sum totals grouped by day
      const byDay = invoices.reduce((acc: any, inv: any) => {
        const day = new Date(inv.created_at).toISOString().slice(0,10);
        acc[day] = (acc[day] || 0) + (Number(inv.total) || 0);
        return acc;
      }, {} as Record<string, number>);
      self.postMessage({ id, ok: true, result: byDay });
    } else {
      self.postMessage({ id, ok: false, error: 'unknown task' });
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) });
  }
});

export {};
