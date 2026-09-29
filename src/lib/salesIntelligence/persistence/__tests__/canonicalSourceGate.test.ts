import { describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_SOURCE_GATE_CODES,
  evaluateCanonicalSourceGate,
  loadCanonicalSourceGateContext,
  type CanonicalGateSourceRow,
} from '../canonicalSourceGate';

const FILE = 'اليماني حسين حسن 4250.zip';
const fineA: CanonicalGateSourceRow = {
  id: 'fine-a',
  review_status: 'needs_context',
  source_filename: FILE,
  conversation_started_at: '2025-12-22T06:54:14Z',
  conversation_ended_at: '2025-12-22T07:14:17Z',
  raw_text: '22/12 06:54 customer: عايز دوا\n22/12 07:14 doctor: متاح',
};
const fineB: CanonicalGateSourceRow = {
  id: 'fine-b',
  review_status: 'ready_detailed',
  source_filename: FILE,
  conversation_started_at: '2025-12-22T12:07:59Z',
  conversation_ended_at: '2025-12-22T12:20:20Z',
  raw_text: '22/12 12:07 customer: تمام ابعته',
};
// Same conversation re-imported under a coarser segmentation: one source spanning both.
const coarse: CanonicalGateSourceRow = {
  id: 'coarse',
  review_status: 'ready_detailed',
  source_filename: FILE,
  conversation_started_at: '2025-12-22T06:54:14Z',
  conversation_ended_at: '2025-12-22T12:20:20Z',
  raw_text: `${fineA.raw_text}\n${fineB.raw_text}`,
};

function context(
  owners: Record<string, string[]>,
  siblings: CanonicalGateSourceRow[] = [fineA, fineB, coarse]
) {
  return { siblings, v22CaseIdsBySource: new Map(Object.entries(owners)) };
}

describe('Canonical Source Gate — admission rule', () => {
  it('allows an active source owned by exactly one Customer Case V22', () => {
    expect(
      evaluateCanonicalSourceGate(fineA, context({ 'fine-a': ['case-1'], 'fine-b': ['case-1'] }))
    ).toEqual({
      allowed: true,
      sourceId: 'fine-a',
      v22CaseId: 'case-1',
    });
  });

  it('blocks an archived source even when it still has a V22 case', () => {
    const decision = evaluateCanonicalSourceGate(
      { ...fineA, review_status: 'archived' },
      context({ 'fine-a': ['case-1'] })
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: 'source_archived',
    });
  });

  it('blocks a coarse re-segmentation whose messages are already owned by V22 through finer sources', () => {
    const decision = evaluateCanonicalSourceGate(
      coarse,
      context({ 'fine-a': ['case-1'], 'fine-b': ['case-1'] })
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: 'superseded_by_finer_canonical_sources',
      supersedingSourceIds: ['fine-a', 'fine-b'],
      v22CaseIds: ['case-1'],
    });
  });

  it('blocks a superseded source even if it has its own V22 case — V22 presence alone is not enough', () => {
    const decision = evaluateCanonicalSourceGate(
      coarse,
      context({ 'fine-a': ['case-1'], 'fine-b': ['case-1'], coarse: ['case-coarse'] })
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'superseded_by_finer_canonical_sources',
    });
  });

  it('repeated import under different segmentation yields exactly one canonical analysis path', () => {
    const ctx = context({ 'fine-a': ['case-1'], 'fine-b': ['case-1'] });
    const admitted = [fineA, fineB, coarse].filter(
      (row) => evaluateCanonicalSourceGate(row, ctx).allowed
    );
    expect(admitted.map((row) => row.id)).toEqual(['fine-a', 'fine-b']);
  });

  it('does not treat a contained source without V22 (other ingest path) as superseding', () => {
    const autoIngest: CanonicalGateSourceRow = {
      ...fineB,
      id: 'auto-1',
      review_status: 'ready_quick',
    };
    const decision = evaluateCanonicalSourceGate(
      coarse,
      context({ coarse: ['case-coarse'] }, [coarse, autoIngest])
    );
    expect(decision).toEqual({ allowed: true, sourceId: 'coarse', v22CaseId: 'case-coarse' });
  });

  it('blocks an active source without a V22 case with an explicit status', () => {
    expect(evaluateCanonicalSourceGate(fineA, context({}, [fineA]))).toMatchObject({
      allowed: false,
      code: 'blocked_missing_canonical_case',
      reason: 'no_customer_case_v22',
    });
  });

  it('never picks one of several V22 cases', () => {
    const decision = evaluateCanonicalSourceGate(
      fineA,
      context({ 'fine-a': ['case-2', 'case-1'] }, [fineA])
    );
    expect(decision).toEqual({
      allowed: false,
      sourceId: 'fine-a',
      code: 'blocked_ambiguous_canonical_case',
      reason: 'multiple_customer_cases_v22',
      v22CaseIds: ['case-1', 'case-2'],
      supersedingSourceIds: [],
    });
    expect(decision).not.toHaveProperty('v22CaseId');
  });
});

function mockService(options: {
  siblings?: CanonicalGateSourceRow[];
  cases?: any[];
  failTable?: string;
}) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    const result =
      options.failTable === table
        ? { data: null, error: { message: 'boom' } }
        : {
            data:
              table === 'whatsapp_review_sources' ? options.siblings || [] : options.cases || [],
            error: null,
          };
    const chain: any = {
      select: () => chain,
      in: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      or: () => (table === 'whatsapp_customer_cases_v22' ? Promise.resolve(result) : chain),
      limit: () => Promise.resolve(result),
    };
    return chain;
  });
  return { service: { from }, calls };
}

describe('Canonical Source Gate — bounded loader', () => {
  it('uses one sibling query and one V22 query for a single source', async () => {
    const { service, calls } = mockService({
      siblings: [fineA, fineB, coarse],
      cases: [{ id: 'case-1', root_source_id: 'fine-a', source_ids: ['fine-a', 'fine-b'] }],
    });
    const ctx = await loadCanonicalSourceGateContext(service, [coarse]);
    expect(calls).toEqual(['whatsapp_review_sources', 'whatsapp_customer_cases_v22']);
    expect(ctx.v22CaseIdsBySource.get('fine-a')).toEqual(['case-1']);
    expect(ctx.v22CaseIdsBySource.get('fine-b')).toEqual(['case-1']);
    expect(evaluateCanonicalSourceGate(coarse, ctx)).toMatchObject({
      reason: 'superseded_by_finer_canonical_sources',
    });
  });

  it('fails closed when the V22 lookup errors instead of treating it as missing', async () => {
    const { service } = mockService({
      siblings: [fineA],
      failTable: 'whatsapp_customer_cases_v22',
    });
    await expect(loadCanonicalSourceGateContext(service, [fineA])).rejects.toThrow(
      'canonical_source_gate_case_lookup_failed'
    );
  });

  it('fails closed when the sibling lookup errors', async () => {
    const { service } = mockService({ failTable: 'whatsapp_review_sources' });
    await expect(loadCanonicalSourceGateContext(service, [fineA])).rejects.toThrow(
      'canonical_source_gate_sibling_lookup_failed'
    );
  });
});
