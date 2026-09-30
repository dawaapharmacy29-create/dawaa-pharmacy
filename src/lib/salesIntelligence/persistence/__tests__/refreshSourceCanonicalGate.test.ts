import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end contract for the canonical refresh transport(s):
//   HTTP transport -> authenticate actor -> load source -> Canonical Source Gate
//   -> exactly one V22 case -> Sales Intelligence -> persist -> V44 proof bridge (only writer).
// api/*.js is generated from server/*.ts; both must behave identically.

const runBatchPersistence = vi.fn();
vi.mock('../batchPersistenceService', () => ({ runBatchPersistence }));

let sources: Record<string, any>[] = [];
let cases: Array<{ id: string; root_source_id: string; source_ids: string[] }> = [];
let loginSession: Record<string, unknown> | null = null;
let actions: Record<string, any>[] = [];
const writes: Array<{ table: string; op: string; payload: unknown }> = [];
const rpc = vi.fn();
const getUser = vi.fn();

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    if (table === 'staff_login_sessions') return loginSession ? [loginSession] : [];
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
    if (table === 'whatsapp_review_sources')
      return filters.id ? sources.filter((row) => row.id === filters.id) : sources;
    if (table === 'whatsapp_customer_cases_v22') return cases;
    if (table === 'whatsapp_conversation_actions') {
      return actions.filter(
        (row) => !filters.action_type || row.action_type === filters.action_type
      );
    }
    if (table === 'sales_invoice_items_v21') {
      return [
        {
          invoice_id: 'inv-1',
          invoice_number: '72368',
          product_id: 'p-1',
          quantity: 1,
          line_total: 50,
        },
      ];
    }
    return [];
  };
  const result = () => ({ data: rows(), error: null });
  const chain: any = {
    select: () => chain,
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    contains: () => chain,
    order: () => chain,
    range: () => Promise.resolve(result()),
    limit: () => Promise.resolve(result()),
    or: () => (table === 'whatsapp_customer_cases_v22' ? Promise.resolve(result()) : chain),
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
    then: (resolve: any) => resolve(result()),
  };
  for (const op of ['update', 'insert', 'upsert', 'delete']) {
    chain[op] = (payload: unknown) => {
      writes.push({ table, op, payload });
      return chain;
    };
  }
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => query(table), rpc, auth: { getUser } }),
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

function analysis(outcome: string, saleProofState: string, attributionLevel: string) {
  return {
    conversationId: fine.id,
    caseId: `${fine.id}:interaction:0`,
    status: 'analyzed',
    conversationCase: { customerId: 'customer-1', customerPhone: null, sourceCaseIdV22: 'case-1' },
    attribution: {
      selectedInvoiceId: 'inv-1',
      selectedInvoiceNumber: '72368',
      attributionLevel,
      contradictions: [],
    },
    basketInvoiceMatch: { itemMatch: 'exact', itemEvidenceReady: true },
    salesOutcome: { outcome, saleProofState },
    failureReasons: [],
  };
}

function batchResult(caseAnalyses: any[]) {
  return {
    caseOutcomes: caseAnalyses.map((row) => ({ caseId: row.caseId, success: true })),
    caseAnalyses,
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
  // @ts-expect-error — generated JS transport without type declarations
  [
    'api/sales-intelligence-refresh-source.js',
    () => import('../../../../../api/sales-intelligence-refresh-source.js'),
  ],
] as const;

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  loginSession = {
    id: 'login-1',
    staff_account_id: 'staff-1',
    expires_at: '2999-01-01T00:00:00Z',
    revoked_at: null,
  };
  actions = [];
  writes.length = 0;
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ok: true, status: 'reconciled' }, error: null });
  getUser.mockReset();
  runBatchPersistence.mockReset();
  runBatchPersistence.mockResolvedValue(batchResult([]));
});

async function call(load: () => Promise<any>, sourceId: string, token = 'staff-session-token') {
  const { default: handler } = await load();
  const res = response();
  await handler(
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { sourceId } },
    res
  );
  return res;
}

describe.each(transports)('%s — identical gate and auth behavior', (_name, load) => {
  it('authenticates with the staff session only (no Supabase auth fallback)', async () => {
    loginSession = null;
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_or_expired_staff_session' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('refuses an active source without a Customer Case V22 with an explicit status', async () => {
    sources = [fine];
    cases = [];
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_missing_canonical_case',
      reason: 'no_customer_case_v22',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(writes.filter((row) => row.table.startsWith('sales_intelligence'))).toEqual([]);
  });

  it('refuses an archived source', async () => {
    sources = [{ ...fine, review_status: 'archived' }];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_non_canonical_source',
      reason: 'source_archived',
    });
  });

  it('refuses a coarse re-segmentation whose messages are owned by V22 through finer sources', async () => {
    sources = [fine, coarse];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
    const res = await call(load, coarse.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_non_canonical_source',
      reason: 'superseded_by_finer_canonical_sources',
      supersedingSourceIds: [fine.id],
    });
  });

  it('refuses ambiguous V22 identity without guessing', async () => {
    sources = [fine];
    cases = [
      { id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] },
      { id: 'case-2', root_source_id: 'other', source_ids: [fine.id] },
    ];
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'blocked_ambiguous_canonical_case',
      v22CaseIds: ['case-1', 'case-2'],
    });
  });
});

describe('canonical refresh — single proof writer (server transport, writer mocked)', () => {
  const load = transports[0][1];

  beforeEach(() => {
    sources = [fine];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
  });

  it('passes exactly one V22 case identity into Sales Intelligence', async () => {
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(200);
    expect(runBatchPersistence).toHaveBeenCalledTimes(1);
    const [, input] = runBatchPersistence.mock.calls[0];
    expect(input.dryRun).toBe(false);
    expect(input.conversations.map((row: any) => row.sourceCaseIdV22)).toEqual(['case-1']);
  });

  it('invokes only the V44 RPC for a proven sale and never writes V22 proof directly', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('dawaa_reconcile_sales_intelligence_case_v22_v1', {
      p_sales_case_id: `${fine.id}:interaction:0`,
    });
    expect(writes.filter((row) => row.table === 'whatsapp_customer_cases_v22')).toEqual([]);
  });

  it('delegates a non-proven outcome to the single writer (which may revoke) and never writes V22 directly', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('order_confirmed_unproven', 'strongly_supported', 'strongly_inferred')])
    );
    rpc.mockResolvedValue({ data: { ok: true, status: 'revoked' }, error: null });
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('dawaa_reconcile_sales_intelligence_case_v22_v1', {
      p_sales_case_id: `${fine.id}:interaction:0`,
    });
    expect(res.body.canonicalReconciliation).toEqual([
      { caseId: `${fine.id}:interaction:0`, ok: true, status: 'revoked' },
    ]);
    expect(writes.filter((row) => row.table === 'whatsapp_customer_cases_v22')).toEqual([]);
    expect(writes.filter((row) => row.table === 'whatsapp_conversation_actions')).toEqual([]);
  });

  it('closes a customer request as sold only after the proof writer accepted the case', async () => {
    actions = [
      {
        id: 'a-1',
        action_type: 'customer_request',
        action_key: 'request:1:p',
        product_id: 'p-1',
        payload: {},
      },
    ];
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    rpc.mockResolvedValue({ data: { ok: false, status: 'human_outcome_conflict' }, error: null });
    await call(load, fine.id);
    expect(writes.filter((row) => row.table === 'whatsapp_conversation_actions')).toEqual([]);

    writes.length = 0;
    rpc.mockResolvedValue({ data: { ok: true, status: 'reconciled' }, error: null });
    await call(load, fine.id);
    const closed = writes.filter((row) => row.table === 'whatsapp_conversation_actions');
    expect(closed).toHaveLength(1);
    expect(closed[0].payload).toMatchObject({ outcome: 'sold', target_id: 'inv-1' });
  });

  it('reports a proof-bridge transport failure instead of success', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } });
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'canonical_reconciliation_failure' });
  });
});

describe('generated transport', () => {
  it('api/*.js is exactly the build output of the canonical server implementation', () => {
    const output = execFileSync(
      'node',
      ['scripts/build-sales-intelligence-refresh-api.cjs', '--check'],
      {
        encoding: 'utf8',
      }
    );
    expect(output).toContain('PASS');
  });
});
