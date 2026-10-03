import { describe, expect, it, vi } from 'vitest';
import {
  requestCanonicalSalesIntelligenceRefreshForFile,
} from '../refreshClient';

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('requestCanonicalSalesIntelligenceRefreshForFile', () => {
  it('refreshes every page for one export file and keeps canonical gate blocks non-fatal', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        sourceFileName: 'customer.zip',
        sourceOffset: 0,
        nextOffset: 2,
        hasMore: true,
        blockedSources: [
          {
            sourceId: 'coarse',
            error: 'blocked_non_canonical_source',
            reason: 'superseded_by_finer_canonical_sources',
          },
        ],
        derivedCases: [
          { conversationId: 'fine-a', saleProofState: 'not_proven' },
        ],
        conversationEvaluations: [],
      }))
      .mockResolvedValueOnce(response({
        sourceFileName: 'customer.zip',
        sourceOffset: 2,
        nextOffset: 3,
        hasMore: false,
        blockedSources: [],
        derivedCases: [
          { conversationId: 'fine-b', saleProofState: 'proven' },
        ],
        conversationEvaluations: [
          {
            caseId: 'case-b',
            sourceId: 'fine-b',
            status: 'saved',
            reviewId: 'review-b',
            finalScore: 95,
            evidenceCoveragePercent: 100,
            automaticReliabilityPercent: 98,
            warning: null,
            error: null,
          },
        ],
      }));

    const result = await requestCanonicalSalesIntelligenceRefreshForFile({
      sourceFileName: 'customer.zip',
      accessToken: 'staff-token',
      sourceLimit: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      sourceFileName: 'customer.zip',
      sourceOffset: 0,
      sourceLimit: 2,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      sourceFileName: 'customer.zip',
      sourceOffset: 2,
      sourceLimit: 2,
    });
    expect(result.errors).toEqual([]);
    expect(result.bySource.coarse).toEqual({
      status: 'blocked',
      reason: 'superseded_by_finer_canonical_sources',
      saleProofState: null,
    });
    expect(result.bySource['fine-a']).toEqual({
      status: 'allowed',
      reason: null,
      saleProofState: 'not_proven',
    });
    expect(result.bySource['fine-b']).toEqual({
      status: 'allowed',
      reason: null,
      saleProofState: 'proven',
    });
    expect(result.conversationEvaluations).toHaveLength(1);
  });

  it('stops file pagination and marks auth invalid on an expired staff session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ error: 'invalid_or_expired_staff_session' }, 401)
    );

    const result = await requestCanonicalSalesIntelligenceRefreshForFile({
      sourceFileName: 'customer.zip',
      accessToken: 'expired-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.authInvalid).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.bySource['file:customer.zip:0'].status).toBe('failed');
  });
});
