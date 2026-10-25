import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-analysis never revives what a general manager deleted: a deleted conversation is refused by
// the Canonical Source Gate, and a deleted case of a live conversation is analyzed but never
// published, proven, projected or evaluated. Only an explicit restore brings it back.

const {
  runBatchPersistence,
  loadConversationEvaluationSystemEvidenceWithClient,
  analyzeConversationEvaluation,
  persistAutomaticCaseConversationReviewWithClient,
} = vi.hoisted(() => ({
  runBatchPersistence: vi.fn(),
  loadConversationEvaluationSystemEvidenceWithClient: vi.fn(),
  analyzeConversationEvaluation: vi.fn(),
  persistAutomaticCaseConversationReviewWithClient: vi.fn(),
}));
vi.mock('../../persistence/batchPersistenceService', () => ({ runBatchPersistence }));
vi.mock('../../conversationEvaluationSystemEvidence', () => ({
  loadConversationEvaluationSystemEvidenceWithClient,
}));
vi.mock('../../conversationEvaluation', () => ({ analyzeConversationEvaluation }));
vi.mock('../../conversationEvaluationPersistence', () => ({
  persistAutomaticCaseConversationReviewWithClient,
}));

import {
  CANONICAL_PROOF_WRITER_RPC,
  CANONICAL_REFRESH_SOURCE_COLUMNS,
  CASE_SET_RECONCILE_RPC,
  loadDeletedCaseIds,
  runCanonicalSalesIntelligenceRefresh,
} from '../canonicalRefreshService';

const live = {
  id: 'live',
  raw_text: 'a: hello\nb: hi',
  source_filename: 'live.zip',
  conversation_started_at: '2026-09-27T07:54:00Z',
  conversation_ended_at: '2026-09-28T01:08:00Z',
  review_status: 'ready_detailed',
  deleted_at: null,
};
const deletedSource = { ...live, id: 'deleted', source_filename: 'deleted.zip', deleted_at: '2026-10-25T01:00:00Z' };
const v22 = [
  { id: 'v22-live', root_source_id: 'live', source_ids: ['live'] },
  { id: 'v22-deleted', root_source_id: 'deleted', source_ids: ['deleted'] },
];
const SERVICE = 'live:interaction:0:session:0';
const ORDER = 'live:interaction:0:session:2';

const rpc = vi.fn();
let deletedCaseRows: Array<{ case_id: string }> = [];
let deletedLookupError: { message: string } | null = null;
const deletedLookups: unknown[][] = [];

function makeService() {
  return {
    rpc,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let notDeleted = false;
      const rows = () => {
        if (table === 'whatsapp_review_sources') {
          return [live, deletedSource].filter((row) => !filters.source_filename || row.source_filename === filters.source_filename);
        }
        if (table === 'whatsapp_customer_cases_v22') return v22;
        if (table === 'sales_intelligence_cases' && notDeleted) return deletedCaseRows;
        return [];
      };
      const result = () =>
        table === 'sales_intelligence_cases' && notDeleted && deletedLookupError
          ? { data: null, error: deletedLookupError }
          : { data: rows(), error: null };
      const chain: any = {
        select: () => chain,
        gte: () => chain,
        lte: () => chain,
        in: (column: string, values: unknown[]) => {
          if (table === 'sales_intelligence_cases') deletedLookups.push(values);
          return chain;
        },
        not: (column: string, op: string, value: unknown) => {
          notDeleted = column === 'deleted_at' && op === 'is' && value === null;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        or: () => (table === 'whatsapp_customer_cases_v22' ? Promise.resolve(result()) : chain),
        limit: () => Promise.resolve(result()),
        then: (resolve: any) => resolve(result()),
      };
      for (const op of ['update', 'insert', 'upsert', 'delete']) chain[op] = () => chain;
      return chain;
    },
  };
}

beforeEach(() => {
  deletedCaseRows = [];
  deletedLookupError = null;
  deletedLookups.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) =>
    name === CASE_SET_RECONCILE_RPC
      ? { data: { ok: true, status: 'reconciled', retiredCaseIds: [], reactivatedCaseIds: [] }, error: null }
      : { data: { ok: true, status: 'reconciled' }, error: null }
  );
  runBatchPersistence.mockReset();
  runBatchPersistence.mockImplementation(async (_service: unknown, input: any) => {
    const caseAnalyses = input.conversations.flatMap((row: any) =>
      [SERVICE, ORDER].map((caseId) => ({
        conversationId: row.conversationId,
        caseId,
        caseIntelligence: { caseId },
        attribution: { attributionLevel: 'unknown', selectedInvoiceId: null, contradictions: [] },
      }))
    );
    return {
      caseAnalyses,
      caseOutcomes: caseAnalyses.map((row: any) => ({ caseId: row.caseId, success: true, analysis: { analysisId: `a-${row.caseId}` } })),
    };
  });
  loadConversationEvaluationSystemEvidenceWithClient.mockReset();
  loadConversationEvaluationSystemEvidenceWithClient.mockResolvedValue(null);
  analyzeConversationEvaluation.mockReset();
  analyzeConversationEvaluation.mockImplementation((view: any) => ({
    caseId: view.caseId,
    items: [],
    summary: { autoScore: 90, evidenceCoveragePercent: 80, automaticReliabilityPercent: 80 },
  }));
  persistAutomaticCaseConversationReviewWithClient.mockReset();
  persistAutomaticCaseConversationReviewWithClient.mockResolvedValue({ status: 'saved', reviewId: 'r', finalScore: 90, error: null });
});

describe('re-analysis and deleted WhatsApp scopes', () => {
  it('every transport loads deleted_at so the gate can see a deletion', () => {
    expect(CANONICAL_REFRESH_SOURCE_COLUMNS.split(',')).toContain('deleted_at');
  });

  it('a deleted conversation is refused by the gate and never analyzed', async () => {
    const result = await runCanonicalSalesIntelligenceRefresh(makeService(), { sources: [deletedSource], dryRun: false });
    expect(result.status).toBe('nothing_admitted');
    expect(result.blockedSources).toEqual([
      expect.objectContaining({ sourceId: 'deleted', reason: 'source_deleted', error: 'blocked_non_canonical_source' }),
    ]);
    expect(runBatchPersistence).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a deleted case is left out of publication, proof, projection and evaluation; siblings proceed', async () => {
    deletedCaseRows = [{ case_id: SERVICE }];
    const result = await runCanonicalSalesIntelligenceRefresh(makeService(), { sources: [live], dryRun: false });
    expect(result.skippedDeletedCaseIds).toEqual([SERVICE]);
    const reconcile = rpc.mock.calls.find(([name]) => name === CASE_SET_RECONCILE_RPC)!;
    expect(reconcile[1]).toEqual({
      p_conversation_id: 'live',
      p_active_case_ids: [ORDER],
      p_analysis_ids: { [ORDER]: `a-${ORDER}` },
    });
    expect(rpc.mock.calls.filter(([name]) => name === CANONICAL_PROOF_WRITER_RPC).map(([, args]) => args.p_sales_case_id)).toEqual([ORDER]);
    expect(persistAutomaticCaseConversationReviewWithClient).toHaveBeenCalledTimes(1);
    expect(persistAutomaticCaseConversationReviewWithClient.mock.calls[0][1].view.caseId).toBe(ORDER);
    expect(result.conversationEvaluations.map((row) => row.caseId)).toEqual([ORDER]);
  });

  it('after an explicit restore (no longer deleted) the case is published again', async () => {
    const result = await runCanonicalSalesIntelligenceRefresh(makeService(), { sources: [live], dryRun: false });
    expect(result.skippedDeletedCaseIds).toEqual([]);
    const reconcile = rpc.mock.calls.find(([name]) => name === CASE_SET_RECONCILE_RPC)!;
    expect(reconcile[1].p_active_case_ids).toEqual([SERVICE, ORDER]);
  });

  it('fails closed when the deletion lookup cannot be read', async () => {
    deletedLookupError = { message: 'boom' };
    await expect(runCanonicalSalesIntelligenceRefresh(makeService(), { sources: [live], dryRun: false })).rejects.toThrow(
      'deleted_case_lookup_failed'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('looks deleted cases up in bounded chunks', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
    await loadDeletedCaseIds(makeService(), [...ids, ...ids]);
    expect(deletedLookups.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
  });
});
