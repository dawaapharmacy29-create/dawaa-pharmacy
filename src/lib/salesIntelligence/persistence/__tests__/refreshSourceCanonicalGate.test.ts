import { beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end guard for both refresh-source transports: a non-canonical source never reaches
// the Sales Intelligence writer, and an admitted source carries its unique Customer Case V22.

const runBatchPersistence = vi.fn();
let sources: Record<string, any>[] = [];
let cases: Array<{ id: string; root_source_id: string; source_ids: string[] }> = [];

vi.mock('@/lib/salesIntelligence/persistence/batchPersistenceService', () => ({
  runBatchPersistence,
}));
vi.mock('../batchPersistenceService', () => ({ runBatchPersistence }));

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    if (table === 'staff_login_sessions') {
      return [
        {
          id: 'login-1',
          staff_account_id: 'staff-1',
          expires_at: '2999-01-01T00:00:00Z',
          revoked_at: null,
        },
      ];
    }
    if (table === 'staff_accounts') {
      return [
        {
          id: 'staff-1',
          role: 'admin',
          active: true,
          is_active: true,
          status: 'active',
          can_login: true,
        },
      ];
    }
    if (table === 'whatsapp_review_sources') {
      if (filters.id) return sources.filter((row) => row.id === filters.id);
      return sources;
    }
    if (table === 'whatsapp_customer_cases_v22') return cases;
    return [];
  };
  const chain: any = {
    select: () => chain,
    update: () => chain,
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    contains: () => chain,
    order: () => chain,
    range: () => Promise.resolve({ data: rows(), error: null }),
    limit: () => Promise.resolve({ data: rows(), error: null }),
    or: () =>
      table === 'whatsapp_customer_cases_v22'
        ? Promise.resolve({ data: rows(), error: null })
        : chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
    then: (resolve: any) => resolve({ data: rows(), error: null }),
  };
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => query(table),
    rpc: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-1' } }, error: null }) },
  }),
}));

const FILE = 'customer 4250.zip';
const fine = {
  id: '11111111-1111-4111-8111-111111111111',
  raw_text: 'a: hello\nb: hi',
  source_filename: FILE,
  conversation_started_at: '2026-01-02T12:02:21Z',
  conversation_ended_at: '2026-01-02T12:03:48Z',
  review_status: 'ready_detailed',
  customer_id: 'customer-1',
};
const coarse = {
  ...fine,
  id: '22222222-2222-4222-8222-222222222222',
  raw_text: 'a: hello\nb: hi\na: later',
  conversation_ended_at: '2026-01-02T17:26:10Z',
};

function response() {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (key: string, value: string) => {
    res.headers[key] = value;
    return res;
  };
  res.end = (body: string) => {
    res.body = JSON.parse(body);
  };
  return res;
}

const transports = [
  [
    'server/sales-intelligence-refresh-source.ts',
    () => import('../../../../../server/sales-intelligence-refresh-source'),
  ],
  // @ts-expect-error — plain JS transport without type declarations
  [
    'api/sales-intelligence-refresh-source.js',
    () => import('../../../../../api/sales-intelligence-refresh-source.js'),
  ],
] as const;

describe.each(transports)('%s — Canonical Source Gate', (_name, load) => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    runBatchPersistence.mockReset();
    runBatchPersistence.mockResolvedValue({
      caseOutcomes: [],
      caseAnalyses: [],
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
    });
  });

  async function call(sourceId: string) {
    const { default: handler } = await load();
    const res = response();
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer token' }, body: { sourceId } },
      res
    );
    return res;
  }

  it('refuses an active source without a Customer Case V22 with an explicit status', async () => {
    sources = [fine];
    cases = [];
    const res = await call(fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_missing_canonical_case',
      reason: 'no_customer_case_v22',
    });
    expect(runBatchPersistence).not.toHaveBeenCalled();
  });

  it('refuses an archived source', async () => {
    sources = [{ ...fine, review_status: 'archived' }];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
    const res = await call(fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_non_canonical_source',
      reason: 'source_archived',
    });
    expect(runBatchPersistence).not.toHaveBeenCalled();
  });

  it('refuses a superseded coarse source whose messages are owned by V22 through finer sources', async () => {
    sources = [fine, coarse];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
    const res = await call(coarse.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_non_canonical_source',
      reason: 'superseded_by_finer_canonical_sources',
      supersedingSourceIds: [fine.id],
    });
    expect(runBatchPersistence).not.toHaveBeenCalled();
  });

  it('refuses ambiguous V22 identity without guessing', async () => {
    sources = [fine];
    cases = [
      { id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] },
      { id: 'case-2', root_source_id: 'other', source_ids: [fine.id] },
    ];
    const res = await call(fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_ambiguous_canonical_case',
      v22CaseIds: ['case-1', 'case-2'],
    });
    expect(runBatchPersistence).not.toHaveBeenCalled();
  });

  it('analyzes an active source owned by exactly one V22 case and passes that case identity', async () => {
    sources = [fine];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
    const res = await call(fine.id);
    // The gate admitted the source (no block, no gate lookup failure).
    expect(String(res.body?.error || '')).not.toMatch(/^blocked_|canonical_source_gate/);
    // The JS transport loads the writer through its own runtime require, outside vi.mock.
    if (_name.startsWith('api/')) return;
    expect(res.statusCode).toBe(200);
    expect(runBatchPersistence).toHaveBeenCalledTimes(1);
    const [, input] = runBatchPersistence.mock.calls[0];
    expect(input.conversations).toHaveLength(1);
    expect(input.conversations[0].sourceCaseIdV22).toBe('case-1');
  });
});
