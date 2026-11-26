import {
  CANONICAL_REFRESH_SOURCE_COLUMNS,
  runCanonicalSalesIntelligenceRefresh,
} from './canonicalRefreshService';
import {
  selectInvoiceChangeImpact,
  type InvoiceEvidenceChange,
  type InvoiceImpactCase,
} from './invoiceChangeImpact';

const MAX_REHEARSAL_BATCH = 25;

export interface InvoiceRehearsalCase extends InvoiceImpactCase {
  /** Complete candidate pool for this case, from the canonical invoice reader. */
  candidateInvoiceIds: readonly string[];
}

/**
 * Rehearse a bounded set of captured events against a complete case/candidate snapshot.
 * Group competing sources transitively before invoking the canonical engine.
 * The queue remains untouched, including when a source is missing or refused.
 */
export async function rehearseInvoiceChanges(
  service: Parameters<typeof runCanonicalSalesIntelligenceRefresh>[0],
  changes: readonly InvoiceEvidenceChange[],
  cases: readonly InvoiceRehearsalCase[],
) {
  if (changes.length > MAX_REHEARSAL_BATCH) throw new Error('invoice_rehearsal_event_limit');
  const sourceIds = new Set(selectInvoiceChangeImpact(changes, cases));
  const changedInvoiceIds = new Set(changes.flatMap(({ before, after }) =>
    [before?.invoiceId, after?.invoiceId].filter(Boolean)
  ));
  const invoicesBySource = new Map<string, Set<string>>();
  const sourcesByInvoice = new Map<string, Set<string>>();
  for (const row of cases) {
    if (!row.active || row.deleted || !row.sourceId) continue;
    const invoices = invoicesBySource.get(row.sourceId) ?? new Set<string>();
    invoicesBySource.set(row.sourceId, invoices);
    for (const id of [...row.candidateInvoiceIds, row.selectedInvoiceId]) {
      if (!id) continue;
      invoices.add(id);
      if (changedInvoiceIds.has(id)) sourceIds.add(row.sourceId);
      const sources = sourcesByInvoice.get(id) ?? new Set<string>();
      sources.add(row.sourceId);
      sourcesByInvoice.set(id, sources);
    }
  }

  if (!sourceIds.size) return { sourceIds: [], refresh: null };

  // A Set iterator also visits newly added sources. Visit each invoice once.
  const visitedInvoices = new Set<string>();
  for (const sourceId of sourceIds) {
    if (sourceIds.size > MAX_REHEARSAL_BATCH) throw new Error('invoice_rehearsal_source_limit');
    for (const id of invoicesBySource.get(sourceId) ?? []) {
      if (visitedInvoices.has(id)) continue;
      visitedInvoices.add(id);
      for (const competitor of sourcesByInvoice.get(id) ?? []) sourceIds.add(competitor);
    }
  }

  const orderedIds = [...sourceIds].sort();
  const { data, error } = await service
    .from('whatsapp_review_sources')
    .select(CANONICAL_REFRESH_SOURCE_COLUMNS)
    .in('id', orderedIds);
  if (error) throw new Error('invoice_rehearsal_source_read_failed');

  const rows = new Map<string, Record<string, unknown>>(
    (data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]),
  );
  const sources = orderedIds.map((id) => {
    const row = rows.get(id);
    if (!row || typeof row.raw_text !== 'string' || !row.raw_text.trim()) {
      throw new Error('invoice_rehearsal_source_missing');
    }
    return row;
  });
  const refresh = await runCanonicalSalesIntelligenceRefresh(service, { sources, dryRun: true });
  return { sourceIds: orderedIds, refresh };
}
