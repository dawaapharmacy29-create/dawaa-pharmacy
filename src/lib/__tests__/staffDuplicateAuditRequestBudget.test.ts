import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  STAFF_COUNT_CONCURRENCY,
  STAFF_COUNT_MAX_STAFF,
  STAFF_LINKED_RECORD_SOURCES,
  fetchStaffLinkedRecordCounts,
  getDuplicateStatistics,
  type StaffDuplicateAuditClient,
} from '../staffDuplicateAudit';

// Regression for the Production smoke finding: /staff-duplicate-audit sent ~3,000 HEAD count
// requests in two minutes (82 staff × 11 tables, unbounded, plus postgrest-js retries).

const LEGACY_SOURCES = ['points_transactions', 'point_records', 'time_off', 'staff_sales_summary'];

function makeStaff(count: number) {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i += 1) rows.push({ id: `staff-${i}`, name: `موظف ${i}`, role: 'doctor', branch: 'فرع', active: true });
  // three duplicate pairs
  rows.push({ id: 'dup-a1', name: 'كريم علي', role: 'doctor', branch: 'فرع', active: true });
  rows.push({ id: 'dup-a2', name: 'كريم على', role: 'doctor', branch: 'فرع', active: false });
  rows.push({ id: 'dup-b1', name: 'سارة', role: 'assistant', branch: 'فرع', active: true });
  rows.push({ id: 'dup-b2', name: 'ساره', role: 'assistant', branch: 'فرع', active: true });
  return rows;
}

function makeClient(staffRows: Array<Record<string, unknown>>, failTable?: string) {
  const log: Array<{ kind: 'select' | 'count' | 'rpc'; target: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client: StaffDuplicateAuditClient = {
    rpc: (fn) => {
      log.push({ kind: 'rpc', target: fn });
      return Promise.resolve({ data: [], error: null });
    },
    from: (table) => ({
      select: (_columns, options) => {
        const isCount = Boolean(options?.head);
        const listResult = { data: staffRows, error: null };
        const base = {
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            log.push({ kind: 'select', target: table });
            return Promise.resolve(listResult).then(resolve, reject);
          },
          eq: (_column: string, _value: string) => {
            const countQuery = {
              abortSignal: () => countQuery,
              then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
                log.push({ kind: 'count', target: table });
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                return new Promise((done) => setTimeout(done, 1))
                  .then(() => {
                    inFlight -= 1;
                    return failTable === table
                      ? { count: null, error: { message: 'boom' } }
                      : { count: 5, error: null };
                  })
                  .then(resolve, reject);
              },
            };
            return isCount ? countQuery : countQuery;
          },
        };
        return base as never;
      },
    }),
  };
  return { client, log, maxInFlight: () => maxInFlight };
}

describe('staff duplicate audit request budget', () => {
  it('REQUEST_COUNT_BOUNDED: page load issues exactly two requests regardless of staff count', async () => {
    const { client, log } = makeClient(makeStaff(82));
    const stats = await getDuplicateStatistics(client);
    expect(log).toHaveLength(2);
    expect(log.filter((entry) => entry.kind === 'count')).toHaveLength(0);
    expect(stats.totalStaff).toBe(86);
    expect(stats.uniqueDuplicateNames).toBe(2);
    expect(stats.totalDuplicates).toBe(4);
  });

  it('NO_TABLE_EXISTENCE_FLOOD: counts are bounded per call and concurrency is capped', async () => {
    const { client, log, maxInFlight } = makeClient([]);
    const ids = Array.from({ length: 82 }, (_, i) => `staff-${i}`);
    await fetchStaffLinkedRecordCounts(ids, { client });
    const counts = log.filter((entry) => entry.kind === 'count');
    expect(counts.length).toBe(STAFF_COUNT_MAX_STAFF * STAFF_LINKED_RECORD_SOURCES.length);
    expect(counts.length).toBeLessThanOrEqual(100);
    expect(maxInFlight()).toBeLessThanOrEqual(STAFF_COUNT_CONCURRENCY);
  });

  it('one expanded duplicate pair costs exactly 2 × sources requests', async () => {
    const { client, log } = makeClient([]);
    await fetchStaffLinkedRecordCounts(['dup-a1', 'dup-a2'], { client });
    expect(log.filter((entry) => entry.kind === 'count')).toHaveLength(2 * STAFF_LINKED_RECORD_SOURCES.length);
  });

  it('NO_LEGACY_TABLE_PROBING: only canonical existing sources are queried', async () => {
    const { client, log } = makeClient([]);
    await fetchStaffLinkedRecordCounts(['dup-a1'], { client });
    const tables = new Set(log.map((entry) => entry.target));
    for (const legacy of LEGACY_SOURCES) expect(tables.has(legacy)).toBe(false);
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/staffDuplicateAudit.ts'), 'utf8');
    for (const legacy of LEGACY_SOURCES) expect(source.includes(`table: '${legacy}'`)).toBe(false);
  });

  it('failed counts are unavailable (null), never a valid-looking zero', async () => {
    const { client } = makeClient([], 'attendance');
    const result = await fetchStaffLinkedRecordCounts(['dup-a1'], { client });
    expect(result.get('dup-a1')?.attendance_count).toBeNull();
    expect(result.get('dup-a1')?.sales_invoice_count).toBe(5);
  });

  it('aborted loads issue no further requests', async () => {
    const { client, log } = makeClient([]);
    const controller = new AbortController();
    controller.abort();
    await fetchStaffLinkedRecordCounts(['dup-a1', 'dup-a2'], { client, signal: controller.signal });
    expect(log).toHaveLength(0);
  });

  it('NO_RENDER_LOOP: page loads statistics once with cancellation and counts only for the expanded group', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/pages/StaffDuplicateAudit.tsx'), 'utf8');
    expect(page).toMatch(/let cancelled = false;[\s\S]*getDuplicateStatistics\(\)[\s\S]*cancelled = true;[\s\S]*\}, \[\]\);/);
    expect(page).toMatch(/fetchStaffLinkedRecordCounts\(missing, \{ signal: controller\.signal \}\)/);
    expect(page).toMatch(/if \(missing\.length === 0\) return;/);
    expect(page).toMatch(/return \(\) => controller\.abort\(\);/);
    expect(page.includes('fetchAllStaffWithCounts')).toBe(false);
  });
});
