import { describe, expect, it, vi } from 'vitest';
import { runCanonicalSalesIntelligenceRefresh } from '../canonicalRefreshService';
import { rehearseInvoiceChanges, type InvoiceRehearsalCase } from '../invoiceChangeRehearsal';

vi.mock('../canonicalRefreshService', () => ({
  CANONICAL_REFRESH_SOURCE_COLUMNS: 'id,raw_text',
  runCanonicalSalesIntelligenceRefresh: vi.fn(),
}));

const changes = [{ before: { invoiceId: 'changed', invoiceAt: null }, after: null }];
const row = (sourceId: string, candidateInvoiceIds: string[], overrides: Partial<InvoiceRehearsalCase> = {}): InvoiceRehearsalCase => ({
  sourceId, candidateInvoiceIds, active: true, deleted: false, startedAt: null, endedAt: null,
  ...overrides,
});
const focused = row('a', ['x'], { selectedInvoiceId: 'changed' });

function client(missingId?: string) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        in: (_: string, ids: string[]) => Promise.resolve({
          data: ids.filter((id) => id !== missingId).map((id) => ({ id, raw_text: 'fixture' })),
          error: null,
        }),
      }),
    })),
    rpc: vi.fn(() => { throw new Error('queue RPC called during rehearsal'); }),
  };
}

describe('invoice change rehearsal', () => {
  it('runs one canonical dry run for the transitive competing group', async () => {
    const service = client();
    const result = await rehearseInvoiceChanges(service, [...changes, ...changes], [
      focused, row('b', ['x']), row('b', ['y']),
      row('c', [], { selectedInvoiceId: 'y' }), row('retired', ['x'], { active: false }),
      row('deleted', ['y'], { deleted: true }), row('isolated', ['other']),
    ]);
    expect(result.sourceIds).toEqual(['a', 'b', 'c']);
    expect(service.from).toHaveBeenCalledTimes(1);
    expect(service.from).toHaveBeenCalledWith('whatsapp_review_sources');
    expect(runCanonicalSalesIntelligenceRefresh).toHaveBeenCalledTimes(1);
    expect(runCanonicalSalesIntelligenceRefresh).toHaveBeenCalledWith(service, {
      sources: result.sourceIds.map((id) => ({ id, raw_text: 'fixture' })), dryRun: true,
    });
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('includes a known candidate when a line change has only the invoice ID', async () => {
    const service = client();
    expect((await rehearseInvoiceChanges(service, changes, [row('candidate', ['changed'])])).sourceIds)
      .toEqual(['candidate']);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('does not split a competing group or run a partial source set', async () => {
    const service = client('b');
    await expect(rehearseInvoiceChanges(service, changes, [
      focused, ...Array.from({ length: 25 }, (_, i) => row(String(i), ['x'])),
    ])).rejects.toThrow('invoice_rehearsal_source_limit');
    expect(service.from).not.toHaveBeenCalled();
    await expect(rehearseInvoiceChanges(service, changes, [focused, row('b', ['x'])]))
      .rejects.toThrow('invoice_rehearsal_source_missing');
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('does not read source rows when there is no impact', async () => {
    const service = client();
    expect(await rehearseInvoiceChanges(service, changes, [row('isolated', [])]))
      .toEqual({ sourceIds: [], refresh: null });
    expect(service.from).not.toHaveBeenCalled();
  });
});
