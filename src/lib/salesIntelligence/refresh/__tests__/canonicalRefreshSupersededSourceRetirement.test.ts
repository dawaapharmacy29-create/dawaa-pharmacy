import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBatchPersistence: vi.fn(),
  evaluateCanonicalSourceGate: vi.fn(),
  loadCanonicalSourceGateContext: vi.fn(),
}));

vi.mock('../../persistence/batchPersistenceService', () => ({
  runBatchPersistence: mocks.runBatchPersistence,
}));

vi.mock('../../persistence/canonicalSourceGate', () => ({
  evaluateCanonicalSourceGate: mocks.evaluateCanonicalSourceGate,
  loadCanonicalSourceGateContext: mocks.loadCanonicalSourceGateContext,
}));

import {
  CANONICAL_PROOF_WRITER_RPC,
  CASE_SET_RECONCILE_RPC,
  runCanonicalSalesIntelligenceRefresh,
} from '../canonicalRefreshService';

const fine = {
  id: '11111111-1111-4111-8111-111111111111',
  raw_text: 'fine conversation',
};

const coarse = {
  id: '22222222-2222-4222-8222-222222222222',
  raw_text: 'coarse conversation containing fine conversation',
};

function emptyQueryChain() {
  const result = Promise.resolve({ data: [], error: null });
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => result,
  };
  return chain;
}

function serviceMock() {
  const rpc = vi.fn(async (name: string) => {
    if (name === CASE_SET_RECONCILE_RPC) {
      return {
        data: {
          ok: true,
          status: 'reconciled',
          retiredCaseIds: [],
          reactivatedCaseIds: [],
        },
        error: null,
      };
    }
    if (name === CANONICAL_PROOF_WRITER_RPC) {
      return { data: { ok: true, status: 'reconciled' }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc: ${name}` } };
  });
  return {
    rpc,
    from: vi.fn(() => emptyQueryChain()),
  };
}

function fineAnalysis() {
  const caseId = `${fine.id}:interaction:0`;
  return {
    caseOutcomes: [{ caseId, success: true }],
    caseAnalyses: [
      {
        conversationId: fine.id,
        caseId,
        caseIntelligence: null,
      },
    ],
    plan: {
      casesToInsert: [],
      casesToUpdateCanonicalIdentity: [],
      casesUnchanged: [],
      analysesToInsert: [],
      analysesToSupersede: [],
      attributionsToInsert: [],
      matchesToInsert: [],
      conflicts: [],
      warnings: [],
    },
  };
}

describe('canonical refresh retires superseded source case sets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCanonicalSourceGateContext.mockResolvedValue({
      siblings: [fine, coarse],
      v22CaseIdsBySource: new Map([[fine.id, ['case-v22']]]),
    });
    mocks.evaluateCanonicalSourceGate.mockImplementation((source: any) => {
      if (String(source.id) === fine.id) {
        return { allowed: true, sourceId: fine.id, v22CaseId: 'case-v22' };
      }
      return {
        allowed: false,
        sourceId: coarse.id,
        code: 'blocked_non_canonical_source',
        reason: 'superseded_by_finer_canonical_sources',
        v22CaseIds: ['case-v22'],
        supersedingSourceIds: [fine.id],
      };
    });
  });

  it('publishes the fine source and retires the blocked coarse source before proof reconciliation', async () => {
    mocks.runBatchPersistence.mockResolvedValue(fineAnalysis());
    const service = serviceMock();

    const result = await runCanonicalSalesIntelligenceRefresh(service, {
      sources: [fine, coarse],
      dryRun: false,
    });

    const fineCaseId = `${fine.id}:interaction:0`;
    expect(result.status).toBe('ok');
    expect(service.rpc).toHaveBeenNthCalledWith(1, CASE_SET_RECONCILE_RPC, {
      p_conversation_id: fine.id,
      p_active_case_ids: [fineCaseId],
    });
    expect(service.rpc).toHaveBeenNthCalledWith(2, CASE_SET_RECONCILE_RPC, {
      p_conversation_id: coarse.id,
      p_active_case_ids: [],
    });
    expect(service.rpc).toHaveBeenNthCalledWith(3, CANONICAL_PROOF_WRITER_RPC, {
      p_sales_case_id: fineCaseId,
    });
    expect(result.caseSetReconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: coarse.id, activeCaseIds: [], status: 'reconciled' }),
      ])
    );
  });

  it('retires a superseded blocked source even when no source is admitted', async () => {
    mocks.evaluateCanonicalSourceGate.mockReturnValue({
      allowed: false,
      sourceId: coarse.id,
      code: 'blocked_non_canonical_source',
      reason: 'superseded_by_finer_canonical_sources',
      v22CaseIds: ['case-v22'],
      supersedingSourceIds: [fine.id],
    });
    const service = serviceMock();

    const result = await runCanonicalSalesIntelligenceRefresh(service, {
      sources: [coarse],
      dryRun: false,
    });

    expect(result.status).toBe('nothing_admitted');
    expect(mocks.runBatchPersistence).not.toHaveBeenCalled();
    expect(service.rpc).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith(CASE_SET_RECONCILE_RPC, {
      p_conversation_id: coarse.id,
      p_active_case_ids: [],
    });
    expect(result.caseSetReconciliation).toEqual([
      expect.objectContaining({ sourceId: coarse.id, activeCaseIds: [], status: 'reconciled' }),
    ]);
  });
});
