// Phase I.C.2.1 — regression test for the root cause behind the ~88%-contradicted finding.
//
// Root cause (see the I.C.2.1 report): batchPersistenceService.ts fetches ONE shared candidate
// pool per customer GROUP, spanning the union of every case's own time range in that group (the
// N+1 reduction — instruction #12). For a customer with a long real history (many months, many
// invoices), that pool was then handed UNFILTERED to every case's own attribution run — a case
// from November could see, and in a tie be attributed to, an invoice from June. This is exactly
// what a real Production customer (31119545-c159-4d2f-9b9d-7549ae6c8343) hit: 130 cases spanning
// 2025-11-29 -> 2026-09-15, 95 of them landing on the SAME June 4th invoice out of that customer's
// 33 real invoices.
//
// filterCandidatesToCaseWindow() restores the per-case window (reusing
// buildInvoiceCandidateQuery()'s own real-data-derived bounds, never re-deriving them) — this test
// locks in that a case only ever sees candidates within ITS OWN proper window, never the whole
// group's.
import { describe, expect, it } from 'vitest';
import { filterCandidatesToCaseWindow } from '../batchPersistenceService';
import { CANDIDATE_RETRIEVAL_TIME_WINDOW, type InvoiceCandidateQueryContext } from '../../invoiceCandidateRetrieval';
import type { InvoiceLike } from '../../../invoices/invoiceCore';

function invoice(id: string, invoiceDatetime: string): InvoiceLike {
  return { id, invoice_number: id, invoice_datetime: invoiceDatetime, customer_id: 'cust-1', net_amount: 100 };
}

function context(overrides: Partial<InvoiceCandidateQueryContext> = {}): InvoiceCandidateQueryContext {
  return {
    caseId: 'case-1',
    customerId: 'cust-1',
    customerPhone: null,
    branchNameRaw: 'فرع شكري',
    caseStartedAt: '2026-06-04T14:00:00.000Z',
    caseEndedAt: '2026-06-04T15:00:00.000Z',
    ...overrides,
  };
}

describe('I.C.2.1 — filterCandidatesToCaseWindow (per-case narrowing of a shared group pool)', () => {
  it('keeps only invoices inside this case’s own window, even when the shared pool spans many months', () => {
    // Mirrors the real Production shape: a group-wide pool covering ~10 months of one customer's
    // real invoice history (Jan through Sep), fed to a single case whose own time is June 4th.
    const sharedGroupPool: InvoiceLike[] = [
      invoice('inv-jan', '2026-01-02T19:25:00.000Z'),
      invoice('inv-may', '2026-05-15T14:44:00.000Z'),
      invoice('inv-june-close', '2026-06-04T15:09:00.000Z'), // 9 minutes after caseEndedAt — inside the 168h window
      invoice('inv-june-far', '2026-06-16T10:19:00.000Z'), // ~12 days later — outside the 168h/7-day window
      invoice('inv-sep', '2026-09-15T06:49:00.000Z'),
    ];

    const result = filterCandidatesToCaseWindow(sharedGroupPool, context());
    const ids = result.map((r) => r.id);
    expect(ids).toContain('inv-june-close');
    expect(ids).not.toContain('inv-jan');
    expect(ids).not.toContain('inv-may');
    expect(ids).not.toContain('inv-june-far');
    expect(ids).not.toContain('inv-sep');
  });

  it('a DIFFERENT case in the SAME group, months away, sees a completely different (correct) slice of the same shared pool', () => {
    const sharedGroupPool: InvoiceLike[] = [
      invoice('inv-jan-2', '2026-01-02T19:25:00.000Z'),
      invoice('inv-jan-3', '2026-01-03T14:27:00.000Z'),
      invoice('inv-june-close', '2026-06-04T15:09:00.000Z'),
      invoice('inv-sep', '2026-09-15T06:49:00.000Z'),
    ];

    const novemberCase = context({
      caseId: 'case-november',
      caseStartedAt: '2025-11-29T13:08:07.000Z',
      caseEndedAt: '2025-11-29T13:10:34.000Z',
    });
    const januaryResult = filterCandidatesToCaseWindow(sharedGroupPool, novemberCase);
    // Nothing in the pool is within 24h before / 168h after late-November — this case correctly
    // sees NO candidates rather than being handed the whole group's pool and picking an arbitrary
    // one 6+ months away (the exact bug this fix closes).
    expect(januaryResult).toEqual([]);

    const septemberCase = context({
      caseId: 'case-september',
      caseStartedAt: '2026-09-15T06:00:00.000Z',
      caseEndedAt: '2026-09-15T07:00:00.000Z',
    });
    const septemberResult = filterCandidatesToCaseWindow(sharedGroupPool, septemberCase);
    expect(septemberResult.map((r) => r.id)).toEqual(['inv-sep']);
  });

  it('respects the exact documented boundary (beforeCaseStartHours/afterCaseEndHours), never a wider or narrower one', () => {
    const caseStart = '2026-06-04T14:00:00.000Z';
    const caseEnd = '2026-06-04T15:00:00.000Z';
    const justInsideBefore = new Date(
      new Date(caseStart).getTime() - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 3600_000 + 60_000
    ).toISOString();
    const justOutsideBefore = new Date(
      new Date(caseStart).getTime() - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 3600_000 - 60_000
    ).toISOString();
    const justInsideAfter = new Date(
      new Date(caseEnd).getTime() + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 3600_000 - 60_000
    ).toISOString();
    const justOutsideAfter = new Date(
      new Date(caseEnd).getTime() + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 3600_000 + 60_000
    ).toISOString();

    const pool: InvoiceLike[] = [
      invoice('inside-before', justInsideBefore),
      invoice('outside-before', justOutsideBefore),
      invoice('inside-after', justInsideAfter),
      invoice('outside-after', justOutsideAfter),
    ];
    const result = filterCandidatesToCaseWindow(pool, context({ caseStartedAt: caseStart, caseEndedAt: caseEnd }));
    expect(result.map((r) => r.id).sort()).toEqual(['inside-after', 'inside-before']);
  });

  it('excludes a candidate with no parseable invoice_datetime rather than keeping it by default', () => {
    const pool: InvoiceLike[] = [{ id: 'no-date', invoice_number: 'no-date', customer_id: 'cust-1' }];
    expect(filterCandidatesToCaseWindow(pool, context())).toEqual([]);
  });
});
