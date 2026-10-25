import { expect, it } from 'vitest';
import { fetchQaCaseDetail } from '../queries';
import { createInMemorySupabase } from './inMemorySupabase.testkit';
import { fixtureTables } from './selectedCaseFixtures.testkit';

it('measures the selected detail read waterfall under uniform synthetic transport latency', async () => {
  const client = createInMemorySupabase(fixtureTables());
  const from = client.from.bind(client);
  const events: Array<{ table: string; start: number; end: number }> = [];
  const delayMs = 8;
  client.from = (table: string) => {
    const builder = from(table);
    const terminal = async (run: () => unknown) => {
      const event = { table, start: performance.now(), end: 0 };
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try { return await run(); } finally { event.end = performance.now(); }
    };
    const proxy: any = new Proxy(builder, {
      get(target, key) {
        if (key === 'then') return (resolve: any, reject: any) => terminal(() => Promise.resolve(target)).then(resolve, reject);
        if (key === 'maybeSingle' || key === 'single') return () => terminal(() => target[key]());
        const value = target[key];
        return typeof value === 'function' ? (...args: any[]) => {
          const result = value.apply(target, args);
          return result === target ? proxy : result;
        } : value;
      },
    });
    return proxy;
  };
  const start = performance.now();
  const bundle = await fetchQaCaseDetail(client, 'case-A');
  const productEvents = events.filter((event) => event.table === 'products');
  expect(bundle?.persisted.analysisRow.case_id).toBe('case-A');
  expect(productEvents).toHaveLength(2);
  expect(productEvents[1].start).toBeLessThan(productEvents[0].end);
  console.log('DETAIL_WATERFALL', JSON.stringify({
    latencyModel: '8ms per synthetic read; not Production latency',
    reads: client.reads.length, productReads: productEvents.length,
    productReadsOverlap: productEvents[1].start < productEvents[0].end,
    totalMs: performance.now() - start,
    events: events.map((event) => ({ table: event.table, startMs: event.start - start, endMs: event.end - start })),
  }));
});
