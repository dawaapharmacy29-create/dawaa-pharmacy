import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The manual maintenance backfill must write through the same canonical boundary as the HTTP
// transport: Canonical Source Gate -> exactly one V22 -> Sales Intelligence -> case-set reconcile
// -> V44 proof writer.

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
  CASE_SET_RECONCILE_RPC,
  CANONICAL_PROOF_WRITER_RPC,
  runCanonicalSalesIntelligenceBackfill,
} from '../canonicalRefreshService';

const FILE = 'customer 4250.zip';
const fine = {
  id: 'fine',
  raw_text: 'a: hello\nb: hi',
  source_filename: FILE,
  conversation_started_at: '2026-01-02T12:02:21Z',
  conversation_ended_at: '2026-01-02T12:03:48Z',
  review_status: 'ready_detailed',
};
const coarse = {
  ...fine,
  id: 'coarse',
  raw_text: 'a: hello\nb: hi\na: later',
  conversation_ended_at: '2026-01-02T17:26:10Z',
};
const archived = {
  ...fine,
  id: 'archived',
  source_filename: 'other.zip',
  review_status: 'archived',
};
const missing = { ...fine, id: 'missing', source_filename: 'missing.zip' };
const ambiguous = { ...fine, id: 'ambiguous', source_filename: 'ambiguous.zip' };
const allRows = [fine, coarse, archived, missing, ambiguous];

const cases = [
  { id: 'case-fine', root_source_id: 'fine', source_ids: ['fine'] },
  { id: 'case-archived', root_source_id: 'archived', source_ids: ['archived'] },
  { id: 'case-a1', root_source_id: 'ambiguous', source_ids: ['ambiguous'] },
  { id: 'case-a2', root_source_id: 'x', source_ids: ['ambiguous'] },
];

const rpc = vi.fn();
const writes: string[] = [];

function makeService() {
  return {
    rpc,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const rows = () => {
        if (table === 'whatsapp_review_sources') {
          return allRows.filter(
            (row) => !filters.source_filename || row.source_filename === filters.source_filename
          );
        }
        if (table === 'whatsapp_customer_cases_v22') return cases;
        return [];
      };
      const chain: any = {
        select: () => chain,
        gte: () => chain,
        lte: () => chain,
        in: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        or: () =>
          table === 'whatsapp_customer_cases_v22'
            ? Promise.resolve({ data: rows(), error: null })
            : chain,
        limit: () => Promise.resolve({ data: rows(), error: null }),
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      for (const op of ['update', 'insert', 'upsert', 'delete']) {
        chain[op] = () => {
          writes.push(table);
          return chain;
        };
      }
      return chain;
    },
  };
}

function batch(conversations: any[]) {
  const caseAnalyses = conversations.map((row) => ({
    conversationId: row.conversationId,
    caseId: `${row.conversationId}:interaction:0`,
    caseIntelligence: { caseId: `${row.conversationId}:interaction:0` },
    salesOutcome: { outcome: 'sale_proven', saleProofState: 'proven' },
    attribution: {
      selectedInvoiceId: 'inv-1',
      selectedInvoiceNumber: '1',
      attributionLevel: 'proven',
      contradictions: [],
    },
  }));
  return {
    caseOutcomes: caseAnalyses.map((row) => ({ caseId: row.caseId, success: true })),
    caseAnalyses,
  };
}

beforeEach(() => {
  writes.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === CASE_SET_RECONCILE_RPC) {
      return {
        data: { ok: true, status: 'reconciled', retiredCaseIds: [], reactivatedCaseIds: [] },
        error: null,
      };
    }
    return { data: { ok: true, status: 'reconciled' }, error: null };
  });
  runBatchPersistence.mockReset();
  runBatchPersistence.mockImplementation(async (_service: unknown, input: any) =>
    batch(input.conversations)
  );
  loadConversationEvaluationSystemEvidenceWithClient.mockReset();
  loadConversationEvaluationSystemEvidenceWithClient.mockResolvedValue({ version: 'conversation-evaluation-system-evidence-v1' });
  analyzeConversationEvaluation.mockReset();
  analyzeConversationEvaluation.mockImplementation((view: any) => ({
    version: 'conversation-evaluation-v1',
    caseId: view.caseId,
    items: [],
    summary: {
      autoScore: 92,
      evidenceCoveragePercent: 88,
      automaticReliabilityPercent: 84,
    },
  }));
  persistAutomaticCaseConversationReviewWithClient.mockReset();
  persistAutomaticCaseConversationReviewWithClient.mockResolvedValue({
    status: 'saved',
    reviewId: 'review-1',
    finalScore: 92,
    error: null,
  });
});

describe('manual backfill --apply uses the canonical boundary', () => {
  it('writes only the admitted canonical source, with its single V22 identity', async () => {
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: allRows,
      apply: true,
    });
    expect(runBatchPersistence).toHaveBeenCalledTimes(1);
    const [, input] = runBatchPersistence.mock.calls[0];
    expect(input.dryRun).toBe(false);
    expect(
      input.conversations.map((row: any) => [row.conversationId, row.sourceCaseIdV22])
    ).toEqual([['fine', 'case-fine']]);
    expect(result.gate.admittedSourceIds).toEqual(['fine']);
  });

  it('returns explicit blocked results for superseded, archived, missing and ambiguous sources', async () => {
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: allRows,
      apply: true,
    });
    expect(
      Object.fromEntries(
        result.gate.blockedSources.map((row) => [row.sourceId, `${row.error}:${row.reason}`])
      )
    ).toEqual({
      coarse: 'blocked_non_canonical_source:superseded_by_finer_canonical_sources',
      archived: 'blocked_non_canonical_source:source_archived',
      missing: 'blocked_missing_canonical_case:no_customer_case_v22',
      ambiguous: 'blocked_ambiguous_canonical_case:multiple_customer_cases_v22',
    });
  });

  it('writes nothing when every scoped source is blocked', async () => {
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: [coarse, archived, missing, ambiguous],
      apply: true,
    });
    expect(runBatchPersistence).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(result.refresh?.status).toBe('nothing_admitted');
  });

  it('runs case-level conversation evaluation only after persistence/proof and records its result', async () => {
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: allRows,
      apply: true,
    });
    expect(loadConversationEvaluationSystemEvidenceWithClient).toHaveBeenCalledTimes(1);
    expect(analyzeConversationEvaluation).toHaveBeenCalledTimes(1);
    expect(persistAutomaticCaseConversationReviewWithClient).toHaveBeenCalledTimes(1);
    expect(result.refresh?.conversationEvaluations).toEqual([
      expect.objectContaining({
        caseId: 'fine:interaction:0',
        sourceId: 'fine',
        status: 'saved',
        reviewId: 'review-1',
        finalScore: 92,
        evidenceCoveragePercent: 88,
        automaticReliabilityPercent: 84,
      }),
    ]);
  });

  it('continues safely with reduced evidence when external system evidence loading fails', async () => {
    loadConversationEvaluationSystemEvidenceWithClient.mockRejectedValueOnce(new Error('evidence down'));
    await runCanonicalSalesIntelligenceBackfill(makeService(), { rows: allRows, apply: true });
    expect(analyzeConversationEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'fine:interaction:0' }),
      null
    );
    expect(persistAutomaticCaseConversationReviewWithClient).toHaveBeenCalledTimes(1);
  });

  it('publishes the current case set before invoking the V44 proof writer and never writes V22 directly', async () => {
    await runCanonicalSalesIntelligenceBackfill(makeService(), { rows: allRows, apply: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, CASE_SET_RECONCILE_RPC, {
      p_conversation_id: 'fine',
      p_active_case_ids: ['fine:interaction:0'],
    });
    expect(rpc).toHaveBeenNthCalledWith(2, CANONICAL_PROOF_WRITER_RPC, {
      p_sales_case_id: 'fine:interaction:0',
    });
    expect(writes).not.toContain('whatsapp_customer_cases_v22');
  });

  it('stops before proof/evaluation when case-set reconciliation fails', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === CASE_SET_RECONCILE_RPC) {
        return { data: { ok: false, status: 'active_case_not_owned_by_conversation' }, error: null };
      }
      return { data: { ok: true, status: 'reconciled' }, error: null };
    });
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: allRows,
      apply: true,
    });
    expect(result.refresh?.status).toBe('case_set_reconciliation_failure');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(persistAutomaticCaseConversationReviewWithClient).not.toHaveBeenCalled();
  });
});

describe('manual backfill dry-run', () => {
  it('reports gate decisions and never writes or reconciles', async () => {
    const result = await runCanonicalSalesIntelligenceBackfill(makeService(), {
      rows: allRows,
      apply: false,
      previewRows: [coarse],
    });
    expect(result.mode).toBe('dry-run');
    expect(result.gate.admittedSourceIds).toEqual(['fine']);
    expect(result.gate.blockedSources).toHaveLength(4);
    expect(runBatchPersistence).toHaveBeenCalledTimes(1);
    expect(runBatchPersistence.mock.calls[0][1].dryRun).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('canonical refresh invoice read boundary', () => {
  const serviceCode = fs.readFileSync(
    path.resolve(__dirname, '../canonicalRefreshService.ts'),
    'utf8'
  );
  const invoiceReadModelCode = fs.readFileSync(
    path.resolve(__dirname, '../../../readModels/invoiceRecordReadModel.ts'),
    'utf8'
  );

  it('never queries sales_invoices directly from the refresh service', () => {
    expect(serviceCode).not.toMatch(/\.from\(\s*['"]sales_invoices['"]\s*\)/);
    expect(serviceCode).toMatch(/readInvoiceRecordById\(/);
    expect(serviceCode).toMatch(/readInvoiceRecordsByCustomerWindow\(/);
  });

  it('keeps delivery staff in the approved invoice projection used for complaint context', () => {
    expect(invoiceReadModelCode).toContain("'delivery_staff'");
  });
});

describe('backfill script has no bypass of the canonical boundary', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '../../../../../scripts/run-sales-intelligence-backfill.cjs'),
    'utf8'
  );
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('does not load the batch writer or adapter directly', () => {
    expect(code).not.toMatch(
      /batchPersistenceService|reviewSourceBatchAdapter|runBatchPersistence\(/
    );
  });

  it('writes through runCanonicalSalesIntelligenceBackfill', () => {
    expect(code).toMatch(/refresh\/canonicalRefreshService\.ts/);
    expect(code).toMatch(/runCanonicalSalesIntelligenceBackfill\(supabase,/);
  });
});
