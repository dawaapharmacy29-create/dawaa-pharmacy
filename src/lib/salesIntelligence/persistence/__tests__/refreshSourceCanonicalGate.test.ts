import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end contract for the canonical refresh transport(s):
//   HTTP transport -> authenticate actor -> load source -> Canonical Source Gate
//   -> exactly one V22 case -> Sales Intelligence -> persist -> case-set reconcile
//   -> V44 proof bridge (only active-case proof writer).
// api/*.js is generated from server/*.ts; both must behave identically.

const CASE_SET_RECONCILE_RPC = 'sales_intelligence_reconcile_case_set_v2';
const CANONICAL_PROOF_WRITER_RPC = 'dawaa_reconcile_sales_intelligence_case_v22_v1';
const CANONICAL_FOLLOWUP_RECONCILE_RPC = 'dawaa_reconcile_canonical_followup_actions_v1';

const runBatchPersistence = vi.fn();
vi.mock('../batchPersistenceService', () => ({ runBatchPersistence }));

let sources: Record<string, any>[] = [];
let cases: Array<{ id: string; root_source_id: string; source_ids: string[] }> = [];
let loginSession: Record<string, unknown> | null = null;
let actions: Record<string, any>[] = [];
const writes: Array<{ table: string; op: string; payload: unknown }> = [];
const rpc = vi.fn();
const getUser = vi.fn();
// Verified-session authorization (server/sales-intelligence-refresh-authorization.ts) runs on the
// session-token client; the fixture actor is the session's own staff account with refresh
// permission and top management. Kept apart from `rpc` so writer-call counts stay exact.
const permissionRpc = vi.fn(async (name: string) => {
  if (name === 'dawaa_current_staff_account_id_strict') return { data: loginSession?.staff_account_id ?? null, error: null };
  if (name === 'dawaa_current_actor_can') return { data: true, error: null };
  if (name === 'dawaa_actor_is_top_management_v1') return { data: true, error: null };
  return { data: null, error: { message: `unexpected permission rpc: ${name}` } };
});

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
  createClient: (_url: string, _key: string, options?: { global?: { headers?: Record<string, string> } }) =>
    options?.global?.headers?.['x-dawaa-session-token']
      ? { from: (table: string) => query(table), rpc: permissionRpc, auth: { getUser } }
      : { from: (table: string) => query(table), rpc, auth: { getUser } },
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

function analysisUuid(caseId: string) {
  const hash = createHash('sha256').update(caseId).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

function analysis(outcome: string, saleProofState: string, attributionLevel: string) {
  return {
    conversationId: fine.id,
    caseId: `${fine.id}:interaction:0`,
    status: 'analyzed',
    // This fixture explicitly publishes no operational opportunities, rather than omitting the
    // canonical owner outputs and relying on swallowed projection errors.
    followUp: { opportunities: [] },
    complaintAssessment: { caseId: `${fine.id}:interaction:0`, state: 'none' },
    customerRequestAssessment: { caseId: `${fine.id}:interaction:0`, decision: 'not_needed', requests: [] },
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
    caseOutcomes: caseAnalyses.map((row) => ({ caseId: row.caseId, success: true, analysis: { analysisId: analysisUuid(row.caseId) } })),
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

function mockProofRpcResult(data: unknown, error: unknown = null) {
  rpc.mockImplementation(async (name: string) => {
    if (name === CASE_SET_RECONCILE_RPC) {
      return {
        data: { ok: true, status: 'reconciled', retiredCaseIds: [], reactivatedCaseIds: [] },
        error: null,
      };
    }
    if (name === CANONICAL_PROOF_WRITER_RPC) return { data, error };
    if (name === CANONICAL_FOLLOWUP_RECONCILE_RPC) {
      return {data:{ok:true,inserted:0,existing:0,updated:0,withdrawn:0},error:null};
    }
    return { data: null, error: { message: `unexpected rpc: ${name}` } };
  });
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
  // The handler builds its verified-session permission client from the anon key and fails closed
  // (503 missing_supabase_anon_key) without it.
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
  loginSession = {
    id: 'login-1',
    staff_account_id: 'staff-1',
    expires_at: '2999-01-01T00:00:00Z',
    revoked_at: null,
  };
  actions = [];
  writes.length = 0;
  rpc.mockReset();
  mockProofRpcResult({ ok: true, status: 'reconciled' });
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

describe('canonical refresh — lifecycle then single proof writer (server transport, writer mocked)', () => {
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

  it('reconciles the active case set before invoking the V44 writer and never writes V22 proof directly', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(200);
    expect(res.body.operationalProjection.errors).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(3, CANONICAL_FOLLOWUP_RECONCILE_RPC, {
      p_source_id: fine.id,
      p_analysis_ids: { [`${fine.id}:interaction:0`]: analysisUuid(`${fine.id}:interaction:0`) },
      p_rows: [],
    });
    expect(rpc).toHaveBeenNthCalledWith(1, CASE_SET_RECONCILE_RPC, {
      p_conversation_id: fine.id,
      p_active_case_ids: [`${fine.id}:interaction:0`],
      p_analysis_ids: { [`${fine.id}:interaction:0`]: analysisUuid(`${fine.id}:interaction:0`) },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, CANONICAL_PROOF_WRITER_RPC, {
      p_sales_case_id: `${fine.id}:interaction:0`,
    });
    expect(writes.filter((row) => row.table === 'whatsapp_customer_cases_v22')).toEqual([]);
  });

  it('delegates a non-proven outcome to the single writer (which may revoke) and never writes V22 directly', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('order_confirmed_unproven', 'strongly_supported', 'strongly_inferred')])
    );
    mockProofRpcResult({ ok: true, status: 'revoked' });
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(200);
    expect(res.body.operationalProjection.errors).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(3, CANONICAL_FOLLOWUP_RECONCILE_RPC, {
      p_source_id: fine.id,
      p_analysis_ids: { [`${fine.id}:interaction:0`]: analysisUuid(`${fine.id}:interaction:0`) },
      p_rows: [],
    });
    expect(rpc).toHaveBeenNthCalledWith(2, CANONICAL_PROOF_WRITER_RPC, {
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
    mockProofRpcResult({ ok: false, status: 'human_outcome_conflict' });
    await call(load, fine.id);
    expect(writes.filter((row) => row.table === 'whatsapp_conversation_actions')).toEqual([]);

    writes.length = 0;
    mockProofRpcResult({ ok: true, status: 'reconciled' });
    await call(load, fine.id);
    const closed = writes.filter((row) => row.table === 'whatsapp_conversation_actions');
    expect(closed).toHaveLength(1);
    // Since feca2250 the sale proof lives in payload.canonical_sale; execution owns target_* and
    // the reconciliation never overwrites them (see soldActionLineage.test.ts).
    expect(closed[0].payload).toMatchObject({ outcome: 'sold', payload: { canonical_sale: { invoice_id: 'inv-1' } } });
    expect(closed[0].payload).not.toHaveProperty('target_id');
    expect(closed[0].payload).not.toHaveProperty('target_table');
  });

  it('reports a proof-bridge transport failure instead of success', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    mockProofRpcResult(null, { message: 'rpc down' });
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'canonical_reconciliation_failure' });
  });

  it('stops before proof when the case-set boundary cannot be reconciled', async () => {
    runBatchPersistence.mockResolvedValue(
      batchResult([analysis('sale_proven', 'proven', 'proven')])
    );
    rpc.mockImplementation(async (name: string) => {
      if (name === CASE_SET_RECONCILE_RPC) {
        return { data: null, error: { message: 'case-set down' } };
      }
      return { data: { ok: true, status: 'reconciled' }, error: null };
    });
    const res = await call(load, fine.id);
    expect(res.statusCode).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('source-scoped publication after partial persistence', () => {
  async function refresh(rows: any[]) {
    const { runCanonicalSalesIntelligenceRefresh } = await import('../../refresh/canonicalRefreshService');
    return runCanonicalSalesIntelligenceRefresh({ from: query, rpc }, { sources: rows, dryRun: false });
  }
  function setupTwoSources() {
    const second = { ...fine, id: '22222222-2222-4222-8222-222222222222', source_filename: 'other.txt' };
    sources = [fine, second];
    cases = sources.map((s, i) => ({ id: `v22-${i}`, root_source_id: s.id, source_ids: [s.id] }));
    return second;
  }
  it('publishes an entirely successful source while another source is incomplete; no proof for incomplete cases', async () => {
    const second = setupTwoSources();
    const a = analysis('sale_proven', 'proven', 'proven');
    const b = { ...a, conversationId: second.id, caseId: `${second.id}:interaction:0` };
    const c = { ...b, caseId: `${second.id}:interaction:1` };
    const result = batchResult([a,b,c]);
    result.caseOutcomes[2].success = false;
    runBatchPersistence.mockResolvedValue(result);
    const out = await refresh(sources);
    expect(out.status).toBe('persistence_partial_failure');
    expect(out.caseSetReconciliation.map(r=>r.status)).toEqual(['reconciled','persistence_failed_pending_retry']);
    expect(rpc.mock.calls.filter(([name])=>name===CASE_SET_RECONCILE_RPC).map(([,args])=>args.p_conversation_id)).toEqual([fine.id]);
    expect(rpc.mock.calls.filter(([name])=>name===CANONICAL_PROOF_WRITER_RPC).map(([,args])=>args.p_sales_case_id)).toEqual([a.caseId]);
    expect(runBatchPersistence).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({deferPublication:true}));
  });
  it('missing persistence outcome is incomplete, never an empty successful source', async () => {
    setupTwoSources();
    const a = analysis('sale_proven','proven','proven');
    runBatchPersistence.mockResolvedValue({...batchResult([a]),caseOutcomes:[]});
    const out = await refresh([fine]);
    expect(out.status).toBe('persistence_partial_failure');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('isolates a reconciliation transport failure and still reconciles the other complete source', async () => {
    const second=setupTwoSources();
    const a=analysis('sale_proven','proven','proven');
    const b={...a,conversationId:second.id,caseId:`${second.id}:interaction:0`};
    runBatchPersistence.mockResolvedValue(batchResult([a,b]));
    rpc.mockImplementation(async(name,args)=>{
      if(name===CASE_SET_RECONCILE_RPC&&args.p_conversation_id===fine.id)throw new Error('transport down');
      return {data:{ok:true,status:'reconciled'},error:null};
    });
    const out=await refresh(sources);
    expect(out.status).toBe('case_set_reconciliation_failure');
    expect(out.caseSetReconciliation.map(r=>r.ok)).toEqual([false,true]);
    expect(out.canonicalReconciliation.map(r=>r.caseId)).toEqual([b.caseId]);
  });
  it('does not retire a consumed payment follower before its anchor is published, even if input order is reversed', async()=>{
    const follower={...fine,id:'22222222-2222-4222-8222-222222222222',raw_text:'[1/2/26, 1:00:00 PM] You: اتفضل رقم التحويل يا فندم 01028308235',conversation_started_at:'2026-01-02T13:00:00Z',conversation_ended_at:'2026-01-02T13:02:00Z'};
    sources=[follower,fine];
    cases=[{id:'anchor',root_source_id:fine.id,source_ids:[fine.id],journey_id:'j',customer_id:'customer-1',case_type:'order',order_intent:true},
      {id:'follower',root_source_id:follower.id,source_ids:[follower.id],journey_id:'j',customer_id:'customer-1',case_type:'followup'}] as any;
    runBatchPersistence.mockResolvedValue(batchResult([analysis('sale_proven','proven','proven')]));
    rpc.mockResolvedValue({data:null,error:{message:'anchor publication failed'}});
    const out=await refresh(sources);
    expect(out.caseSetReconciliation.map(r=>r.status)).toEqual(['rpc_error','dependency_pending_retry']);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_conversation_id).toBe(fine.id);
  });
  it('retries the complete full case set using stable staged analysis IDs', async () => {
    setupTwoSources();const a=analysis('sale_proven','proven','proven');
    const b={...a,caseId:`${fine.id}:interaction:1`};
    const first=batchResult([a,b]);first.caseOutcomes[1].success=false;
    runBatchPersistence.mockResolvedValueOnce(first).mockResolvedValueOnce(batchResult([a,b]));
    expect((await refresh([fine])).status).toBe('persistence_partial_failure');
    expect(rpc).not.toHaveBeenCalled();
    expect((await refresh([fine])).status).toBe('ok');
    expect(rpc.mock.calls[0][1]).toMatchObject({p_active_case_ids:[a.caseId,b.caseId],p_analysis_ids:{[a.caseId]:analysisUuid(a.caseId),[b.caseId]:analysisUuid(b.caseId)}});
  });
});

describe('Phase B controlled runtime smoke contracts', () => {
  async function refresh() {
    const { runCanonicalSalesIntelligenceRefresh } = await import('../../refresh/canonicalRefreshService');
    return runCanonicalSalesIntelligenceRefresh({ from: query, rpc }, { sources, dryRun: false });
  }
  beforeEach(() => {
    sources = [fine];
    cases = [{ id: 'case-1', root_source_id: fine.id, source_ids: [fine.id] }];
  });

  it('publishes an empty derived set and reconciles obsolete follow-up proposals without proof or direct writes', async () => {
    runBatchPersistence.mockResolvedValue(batchResult([]));
    const out = await refresh();
    expect(out.status).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(CASE_SET_RECONCILE_RPC, {
      p_conversation_id: fine.id, p_active_case_ids: [], p_analysis_ids: {},
    });
    expect(rpc).toHaveBeenNthCalledWith(2,CANONICAL_FOLLOWUP_RECONCILE_RPC,{
      p_source_id:fine.id,p_analysis_ids:{},p_rows:[],
    });
    expect(rpc).not.toHaveBeenCalledWith(CANONICAL_PROOF_WRITER_RPC,expect.anything());
    expect(out.operationalProjection.errors).toEqual([]);
    expect(out.operationalProjection.followups).toEqual({inserted:0,existing:0,skipped:0,updated:0,withdrawn:0});
    expect(out.conversationEvaluations).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('reports a missing follow-up lifecycle RPC without direct-write fallback or canonical truth changes', async () => {
    runBatchPersistence.mockResolvedValue(batchResult([]));
    rpc.mockImplementation(async(name:string) => name===CASE_SET_RECONCILE_RPC
      ? {data:{ok:true,status:'reconciled'},error:null}
      : {data:null,error:new Error('followup_rpc_unavailable')});
    const out=await refresh();
    expect(out.status).toBe('ok');
    expect(out.operationalProjection.errors).toEqual([
      'canonical_followup_projection_failed: followup_rpc_unavailable',
    ]);
    expect(writes).toEqual([]);
  });

  it.each([null, {}, [], 'reconciled', { ok: true }, { ok: false, status: 'reconciled' }])(
    'fails closed on malformed lifecycle reply %j before proof/evaluation/followers', async (data) => {
      runBatchPersistence.mockResolvedValue(batchResult([analysis('sale_proven', 'proven', 'proven')]));
      rpc.mockResolvedValue({ data, error: null });
      const out = await refresh();
      expect(out.status).toBe('case_set_reconciliation_failure');
      expect(out.caseSetReconciliation[0].ok).toBe(false);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(out.canonicalReconciliation).toEqual([]);
      expect(out.conversationEvaluations).toEqual([]);
      expect(writes).toEqual([]);
    }
  );

  it('does not publish when the successful persistence reply has no staged analysis ID', async () => {
    const result = batchResult([analysis('sale_proven', 'proven', 'proven')]);
    result.caseOutcomes[0].analysis.analysisId = '';
    runBatchPersistence.mockResolvedValue(result);
    const out = await refresh();
    expect(out.caseSetReconciliation[0].status).toBe('persistence_failed_pending_retry');
    expect(rpc).not.toHaveBeenCalled();
    expect(out.conversationEvaluations).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('releases a consumed payment follower only after its anchor publication succeeds', async () => {
    const follower = { ...fine, id: '22222222-2222-4222-8222-222222222222', raw_text: '[1/2/26, 1:00:00 PM] You: اتفضل رقم التحويل يا فندم 01028308235', conversation_started_at: '2026-01-02T13:00:00Z', conversation_ended_at: '2026-01-02T13:00:00Z' };
    sources = [follower, fine];
    cases = [
      { id: 'anchor', root_source_id: fine.id, source_ids: [fine.id], journey_id: 'j', customer_id: 'customer-1', case_type: 'order', order_intent: true },
      { id: 'follower', root_source_id: follower.id, source_ids: [follower.id], journey_id: 'j', customer_id: 'customer-1', case_type: 'followup' },
    ] as any;
    runBatchPersistence.mockResolvedValue(batchResult([analysis('sale_proven', 'proven', 'proven')]));
    const out = await refresh();
    expect(out.caseSetReconciliation.map((row) => [row.sourceId, row.ok])).toEqual([[fine.id, true], [follower.id, true]]);
    expect(rpc.mock.calls.filter(([name]) => name === CASE_SET_RECONCILE_RPC).map(([, args]) => args.p_conversation_id)).toEqual([fine.id, follower.id]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_active_case_ids: [], p_analysis_ids: {} });
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

