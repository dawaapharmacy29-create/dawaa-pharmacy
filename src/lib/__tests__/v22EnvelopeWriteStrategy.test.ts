// V22 envelope PERSISTENCE operation (not only the pure merge): INSERT for a new envelope,
// guarded UPDATE for an existing one, optimistic concurrency, server-owned truth preserved.
// The fake client enforces the Postgres contract that broke runtime: NOT NULL case_type/case_state
// are checked on the INSERT tuple, case_key is unique (23505), UPDATE ... WHERE updated_at = x.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  planV22EnvelopeWrite,
  writeV22Envelope,
  V22_ENVELOPE_MAX_WRITE_ATTEMPTS,
} from '@/lib/whatsappCustomerCasePersistenceV22';
import { decideV22Projection, type SiCaseProjectionFact } from '@/lib/salesIntelligence/refresh/v22SemanticProjection';
import {
  deriveWhatsAppFileProcessingState,
  shouldMarkWhatsAppFileProcessed,
  syncWatcherCaseGraph,
} from '@/lib/whatsappWatcherCaseGraphSync';

const NOT_NULL_NO_DEFAULT = ['case_key', 'root_source_id', 'case_type', 'case_state', 'started_at', 'last_event_at'];

function fakeDb(initial: Array<Record<string, any>> = []) {
  const rows = initial.map((row) => ({ ...row }));
  const ops: Array<{ op: string; payload?: any }> = [];
  let beforeUpdate: ((row: Record<string, any>) => void) | null = null;
  let seq = 0;
  const client = {
    rows,
    ops,
    /** Simulates a server writer changing the row between the browser read and its UPDATE. */
    onBeforeUpdate(fn: ((row: Record<string, any>) => void) | null) {
      beforeUpdate = fn;
    },
    from(table: string) {
      if (table !== 'whatsapp_customer_cases_v22') throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: Record<string, any> | null = null;
      const match = () => rows.filter((row) => filters.every(([k, v]) => row[k] === v));
      const run = () => {
        if (mode === 'insert') {
          ops.push({ op: 'insert', payload });
          const missing = NOT_NULL_NO_DEFAULT.filter((c) => payload![c] == null);
          if (missing.length) return { data: null, error: { code: '23502', message: `null value in column "${missing[0]}" violates not-null constraint` } };
          if (rows.some((row) => row.case_key === payload!.case_key)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          const row = { id: `v22-${++seq}`, ...payload };
          rows.push(row);
          return { data: { id: row.id }, error: null };
        }
        if (mode === 'update') {
          ops.push({ op: 'update', payload });
          if (beforeUpdate) for (const row of rows) beforeUpdate(row);
          const hit = match();
          for (const row of hit) Object.assign(row, payload);
          return { data: hit.map((row) => ({ id: row.id })), error: null };
        }
        return { data: match(), error: null };
      };
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
        insert: (row: Record<string, any>) => ((mode = 'insert'), (payload = row), chain),
        update: (patch: Record<string, any>) => ((mode = 'update'), (payload = patch), chain),
        upsert: () => {
          throw new Error('envelope writer must not use upsert');
        },
        maybeSingle: async () => {
          const result = run();
          return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
        },
        single: async () => run(),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return chain;
    },
  };
  return client;
}

// A fresh preliminary envelope exactly as the regex V22 engine builds it (A1 shape).
function envelope(overrides: Record<string, any> = {}) {
  return {
    case_key: 'v22:4b2f3e27:2026-10-06T06:00:00.000Z',
    root_source_id: '4b2f3e27',
    source_ids: ['4b2f3e27'],
    case_type: 'followup',
    case_state: 'awaiting_customer',
    started_at: '2026-10-06T06:00:00.000Z',
    last_event_at: '2026-10-06T06:01:00.000Z',
    order_intent: false,
    commercial_opportunity: false,
    proposed_outcome: 'awaiting_customer',
    outcome_confidence: 95,
    next_action: 'متابعة العميل إذا تجاوزت المهلة التشغيلية.',
    summary: 'متابعة',
    needs_human_review: false,
    case_json: { type: 'followup', v23: { proposedOutcome: { outcome: 'awaiting_customer' } } },
    created_by: 'rescanner',
    updated_at: '2026-10-08T09:00:00.000Z',
    ...overrides,
  };
}

function siFact(): SiCaseProjectionFact {
  return {
    salesCaseId: '4b2f3e27:interaction:0',
    analysisId: 'analysis-v22',
    pipelineVersion: 'sales-intelligence-v22',
    view: {
      need: { primaryNeed: 'جاست ريج أمبول', products: [{ roles: ['requested'] }] },
      sale: { outcome: 'open_opportunity', customerConfirmed: false },
      lostOpportunity: { state: 'open' },
      operationalDisposition: {
        version: 'case-operational-disposition-v1', caseId: 'si', state: 'action_required_pharmacy', waitingOn: 'pharmacy',
        actionOwner: 'pharmacy', assignedRole: 'branch_staff', assignedStaffId: 'noor', assignedStaffName: 'نور',
        nextBestAction: 'complete_stock_check_and_reply', decisiveFollowUpKey: 'fu', decisiveFollowUpReason: 'stock_check_pending',
        productKeys: [], productIds: [], commercialState: 'open', reasonCodes: ['r'], evidenceMessageIds: ['m'],
        confidence: { level: 'weakly_inferred', score: 0.7, ruleIds: [], evidence: [] },
      },
    } as any,
  };
}

/** Existing row after the canonical SI projection ran (what runtime A1 had). */
function projectedRow() {
  const base = { id: 'v22-a1', ...envelope({ created_by: 'original-creator', updated_at: '2026-10-08T05:06:52.000Z' }), confirmed_outcome: null };
  const decision = decideV22Projection(base as any, [siFact()], '2026-10-08T05:06:53.000Z');
  return { ...base, ...(decision.patch as any), updated_at: '2026-10-08T05:06:53.000Z' };
}

describe('V22 envelope write strategy', () => {
  it('A. brand-new V22 -> INSERT with the full required payload', async () => {
    const db = fakeDb();
    const result = await writeV22Envelope(db, envelope());
    expect(result.op).toBe('insert');
    expect(db.ops.map((o) => o.op)).toEqual(['insert']);
    expect(db.rows[0]).toMatchObject({ case_type: 'followup', case_state: 'awaiting_customer', root_source_id: '4b2f3e27' });
  });

  it('the old UPSERT payload of a projected row is exactly what Postgres rejects (runtime root cause)', () => {
    const plan = planV22EnvelopeWrite(projectedRow() as any, envelope());
    expect(plan.op).toBe('update');
    const patch = (plan as any).patch;
    // As an INSERT tuple this payload would violate NOT NULL — hence UPDATE, never INSERT/upsert.
    expect(patch.case_type).toBeUndefined();
    expect(patch.case_state).toBeUndefined();
  });

  it('B. existing V22 without canonical projection -> guarded UPDATE that may refresh preliminary columns', async () => {
    const db = fakeDb([{ id: 'v22-1', ...envelope({ case_state: 'open', created_by: 'creator', updated_at: 't0' }) }]);
    const result = await writeV22Envelope(db, envelope({ case_state: 'awaiting_customer' }));
    expect(result).toMatchObject({ op: 'update', id: 'v22-1', attempts: 1 });
    expect(db.ops.map((o) => o.op)).toEqual(['update']);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].case_state).toBe('awaiting_customer');
    expect(db.rows[0].created_by).toBe('creator');
    expect(db.ops[0].payload.case_key).toBeUndefined();
  });

  it('C. existing V22 WITH canonicalSemanticProjection -> UPDATE keeps projected columns, refreshes the preliminary snapshot', async () => {
    const row = projectedRow();
    const db = fakeDb([row]);
    const result = await writeV22Envelope(db, envelope({ summary: 'ملخص أولي جديد', case_json: { type: 'followup', v23: { fresh: true } } }));
    expect(result.op).toBe('update');
    expect(db.ops.some((o) => o.op === 'insert')).toBe(false);
    const saved = db.rows[0];
    for (const [column, value] of Object.entries({ case_type: 'order', case_state: 'awaiting_pharmacy', order_intent: true, commercial_opportunity: true, proposed_outcome: 'awaiting_pharmacy' })) {
      expect(saved[column]).toEqual(value);
    }
    expect(saved.case_json.canonicalSemanticProjection.analysisIds).toEqual(['analysis-v22']);
    expect(saved.case_json.canonicalSemanticProjection.preliminary.summary).toBe('ملخص أولي جديد');
    expect(saved.case_json.canonicalSemanticProjection.preliminary.case_type).toBe('followup');
    expect(saved.case_json.v23).toEqual({ fresh: true });
  });

  it('D. existing canonicalSaleProof -> a browser rescan cannot remove or downgrade it', async () => {
    const proof = { state: 'proven', salesCaseId: 'si-1', invoiceId: 'inv-1', analysisId: 'a1' };
    const row = { id: 'v22-p', ...envelope({ updated_at: 't0' }), proposed_outcome: 'verified_sale', outcome_confidence: 100, verified_invoice_id: 'inv-1', verified_revenue: 250, confirmed_outcome: 'verified_sale', outcome_reviewed_by: 'manager', case_json: { canonicalSaleProof: proof } };
    const db = fakeDb([row]);
    await writeV22Envelope(db, envelope());
    const saved = db.rows[0];
    expect(saved.case_json.canonicalSaleProof).toEqual(proof);
    expect(saved).toMatchObject({ proposed_outcome: 'verified_sale', outcome_confidence: 100, verified_invoice_id: 'inv-1', verified_revenue: 250, confirmed_outcome: 'verified_sale', outcome_reviewed_by: 'manager' });
    const patch = db.ops[0].payload;
    for (const field of ['proposed_outcome', 'outcome_confidence', 'verified_invoice_id', 'verified_revenue', 'confirmed_outcome', 'outcome_reviewed_by', 'outcome_reviewed_at', 'confirmed_lost_reason', 'responsibility_status']) {
      expect(field in patch).toBe(false);
    }
  });

  it('E. concurrent server update between read and update -> lose, re-read, re-merge, retry; newest server keys survive', async () => {
    const db = fakeDb([projectedRow()]);
    let fired = false;
    db.onBeforeUpdate((row) => {
      if (fired) return;
      fired = true;
      // The proof writer lands between our read and our UPDATE.
      row.case_json = { ...row.case_json, canonicalSaleProof: { state: 'proven', invoiceId: 'inv-new' } };
      row.updated_at = '2026-10-08T09:00:00.500Z';
    });
    const result = await writeV22Envelope(db, envelope());
    expect(result).toMatchObject({ op: 'update', attempts: 2 });
    const saved = db.rows[0];
    expect(saved.case_json.canonicalSaleProof).toEqual({ state: 'proven', invoiceId: 'inv-new' });
    expect(saved.case_json.canonicalSemanticProjection.analysisIds).toEqual(['analysis-v22']);
  });

  it('a writer that always loses the race fails after a finite number of attempts', async () => {
    const db = fakeDb([projectedRow()]);
    let n = 0;
    db.onBeforeUpdate((row) => {
      row.updated_at = `bumped-${++n}`;
    });
    let error: unknown = null;
    try {
      await writeV22Envelope(db, envelope());
    } catch (caught) {
      error = caught;
    }
    expect(String((error as Error)?.message)).toMatch(/v22_envelope_concurrent_update_retry_exhausted/);
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(V22_ENVELOPE_MAX_WRITE_ATTEMPTS);
  });

  it('an envelope created by another writer between read and insert is updated, not duplicated', async () => {
    const db = fakeDb();
    const original = db.from.bind(db);
    let raced = false;
    (db as any).from = (table: string) => {
      const chain = original(table);
      const insert = chain.insert;
      chain.insert = (row: Record<string, any>) => {
        if (!raced) {
          raced = true;
          db.rows.push({ id: 'v22-other', ...envelope({ updated_at: 't-other' }) });
        }
        return insert(row);
      };
      return chain;
    };
    const result = await writeV22Envelope(db, envelope());
    expect(result).toMatchObject({ op: 'update', id: 'v22-other', attempts: 2 });
    expect(db.rows).toHaveLength(1);
  });

  it('F. second identical reanalysis converges (projection stays unchanged, one row)', async () => {
    const db = fakeDb([projectedRow()]);
    await writeV22Envelope(db, envelope());
    const afterFirst = JSON.parse(JSON.stringify(db.rows[0]));
    const projection = decideV22Projection(db.rows[0] as any, [siFact()], '2026-10-09T00:00:00.000Z');
    expect(projection.status).toBe('unchanged');
    await writeV22Envelope(db, envelope());
    const { updated_at: _a, ...first } = afterFirst;
    const { updated_at: _b, ...second } = db.rows[0];
    expect(second).toEqual(first);
    expect(db.rows).toHaveLength(1);
    expect(decideV22Projection(db.rows[0] as any, [siFact()], '2026-10-10T00:00:00.000Z').status).toBe('unchanged');
  });
});

describe('V22 envelope write strategy — G. multi-case file with one conflicting case', () => {
  it('reports a partial case graph (not success), keeps the saved case usable, writes no duplicates', async () => {
    const db = fakeDb([projectedRow()]);
    db.onBeforeUpdate((row) => {
      if (row.id === 'v22-a1') row.updated_at = `bumped-${Math.random()}`;
    });
    const outcomes = await Promise.allSettled([
      writeV22Envelope(db, envelope()),
      writeV22Envelope(db, envelope({ case_key: 'v22:4b2f3e27:2026-10-06T08:00:00.000Z', started_at: '2026-10-06T08:00:00.000Z' })),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['rejected', 'fulfilled']);
    expect(db.rows).toHaveLength(2);

    const graph = await syncWatcherCaseGraph(
      {
        syncJourney: async () => null,
        syncCustomerCases: async () => ({ saved: 1, skipped: 0, failed: 1, failures: [{ caseId: 'case-1', message: 'v22_envelope_concurrent_update_retry_exhausted' }], savedSourceIds: ['src-2'] }),
      },
      { persistedSourceCount: 2, expectedCaseCount: 2 }
    );
    expect(graph.customerCase.status).toBe('partial');
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 2,
      savedSourceCount: 2,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: graph,
      salesIntelligence: {
        status: 'refreshed', reason: null, requestedSourceIds: ['src-2'],
        bySource: { 'src-2': { status: 'allowed', reason: null, saleProofState: 'not_proven' } },
        canonicalCases: [], conversationEvaluations: [], errors: [], authInvalid: false,
      },
    });
    expect(state.stages.case_graph_saved).toBe('partial');
    expect(state.stageDetails?.case_graph_saved).toBe('1/2');
    expect(state.stages.sales_intelligence_refreshed).toBe('done');
    expect(state.outcome).toBe('partial');
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(false);
  });

  it('a case graph with zero saved cases is failed, not partial', () => {
    const state = deriveWhatsAppFileProcessingState({
      parsed: true, expectedSourceCount: 1, savedSourceCount: 1, sourceErrors: [], identityErrors: [],
      caseGraph: { journey: { status: 'synced', error: null, warnings: [] }, customerCase: { status: 'failed', expected: 1, saved: 0, failed: 1, skipped: 0, errors: ['x'], savedSourceIds: [] } },
      salesIntelligence: null,
    });
    expect(state.stages.case_graph_saved).toBe('failed');
  });
});

describe('V22 envelope write strategy — architecture guard', () => {
  it('the browser envelope writer never upserts whatsapp_customer_cases_v22', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/whatsappCustomerCasePersistenceV22.ts'), 'utf8');
    const v22Writes = source.split("from('whatsapp_customer_cases_v22')").slice(1).map((chunk) => chunk.slice(0, 200));
    expect(v22Writes.some((chunk) => /\.upsert\(/.test(chunk))).toBe(false);
    expect(source).toMatch(/writeV22Envelope\(supabase, payload\)/);
  });
});
