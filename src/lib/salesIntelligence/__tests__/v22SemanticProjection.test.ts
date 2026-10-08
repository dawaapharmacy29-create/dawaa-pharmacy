// SI -> V22 canonical semantic projection: deterministic multi-case aggregation, human/proof
// precedence, idempotency, and reanalysis convergence with the client envelope sync.
import { describe, expect, it } from 'vitest';
import {
  aggregateV22Projection,
  decideV22Projection,
  v22EnvelopeValue,
  type SiCaseProjectionFact,
  type V22ProjectionRow,
} from '../refresh/v22SemanticProjection';
import { mergeV22EnvelopePayload } from '../../whatsappCustomerCasePersistenceV22';
import type { CaseOperationalDisposition } from '../types';

function fact(id: string, state: CaseOperationalDisposition['state'], overrides: Record<string, any> = {}): SiCaseProjectionFact {
  const nba = state === 'action_required_pharmacy' ? 'complete_stock_check_and_reply' : state === 'awaiting_customer' ? 'check_customer_decision' : null;
  return {
    salesCaseId: id,
    analysisId: `analysis-${id}`,
    pipelineVersion: 'sales-intelligence-v21',
    view: {
      need: { primaryNeed: 'جاست ريج أمبول', products: [{ roles: ['requested'] }] },
      sale: { outcome: 'open_opportunity', customerConfirmed: false },
      lostOpportunity: { state: 'open' },
      operationalDisposition: {
        version: 'case-operational-disposition-v1',
        caseId: id,
        state,
        waitingOn: null,
        actionOwner: 'pharmacy',
        assignedRole: null,
        assignedStaffId: null,
        assignedStaffName: null,
        nextBestAction: nba,
        decisiveFollowUpKey: null,
        decisiveFollowUpReason: null,
        productKeys: [],
        productIds: [],
        commercialState: 'open',
        reasonCodes: [`r.${state}`],
        evidenceMessageIds: [`m-${id}`],
        confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
      },
      ...overrides,
    } as any,
  };
}

// A1 envelope as the regex V22 engine wrote it before SI.
function a1Row(overrides: Partial<V22ProjectionRow> = {}): V22ProjectionRow {
  return {
    id: 'v22-a1',
    case_json: { type: 'followup' },
    confirmed_outcome: null,
    updated_at: '2026-10-08T05:06:34.822Z',
    order_intent: false,
    commercial_opportunity: false,
    case_type: 'followup',
    case_state: 'awaiting_customer',
    proposed_outcome: 'awaiting_customer',
    outcome_confidence: 95,
    next_action: 'متابعة العميل إذا تجاوزت المهلة التشغيلية.',
    summary: 'متابعة',
    needs_human_review: false,
    ...overrides,
  };
}

const NOW = '2026-10-08T06:00:00.000Z';

describe('V22 semantic projection — A1', () => {
  it('projects the canonical meaning and records provenance + preliminary values', () => {
    const decision = decideV22Projection(a1Row(), [fact('si-1', 'action_required_pharmacy')], NOW);
    expect(decision.status).toBe('projected');
    expect(decision.patch).toMatchObject({
      order_intent: true,
      commercial_opportunity: true,
      case_type: 'order',
      case_state: 'awaiting_pharmacy',
      proposed_outcome: 'awaiting_pharmacy',
      next_action: 'إكمال مراجعة التوفر والرد على العميل.',
    });
    const projection = (decision.patch as any).case_json.canonicalSemanticProjection;
    expect(projection).toMatchObject({
      source: 'sales_intelligence',
      mode: 'direct',
      salesCaseIds: ['si-1'],
      analysisIds: ['analysis-si-1'],
      pipelineVersions: ['sales-intelligence-v21'],
      projectedAt: NOW,
    });
    expect(projection.preliminary).toMatchObject({ order_intent: false, case_type: 'followup', case_state: 'awaiting_customer', proposed_outcome: 'awaiting_customer' });
    expect((decision.patch as any).case_json.type).toBe('followup');
  });

  it('is idempotent: projecting the already projected row writes nothing', () => {
    const first = decideV22Projection(a1Row(), [fact('si-1', 'action_required_pharmacy')], NOW);
    const projectedRow = { ...a1Row(), ...(first.patch as any) };
    const second = decideV22Projection(projectedRow, [fact('si-1', 'action_required_pharmacy')], '2026-10-09T00:00:00.000Z');
    expect(second.status).toBe('unchanged');
    expect(second.patch).toBeNull();
  });

  it('envelope readers keep reading the preliminary values after projection (no SI feedback loop)', () => {
    const first = decideV22Projection(a1Row(), [fact('si-1', 'action_required_pharmacy')], NOW);
    const projectedRow = { ...a1Row(), ...(first.patch as any) };
    expect(projectedRow.case_type).toBe('order');
    expect(v22EnvelopeValue(projectedRow, 'case_type')).toBe('followup');
    expect(v22EnvelopeValue(projectedRow, 'order_intent')).toBe(false);
    expect(v22EnvelopeValue(a1Row(), 'case_type')).toBe('followup');
  });
});

describe('V22 semantic projection — human and proof precedence', () => {
  it('never overwrites human/reviewer/proof fields, and a confirmed outcome outranks the projection', () => {
    const row = a1Row({ confirmed_outcome: 'customer_reengaged', outcome_reviewed_by: 'manager', confirmed_lost_reason: 'x' } as any);
    const decision = decideV22Projection(row, [fact('si-1', 'action_required_pharmacy')], NOW);
    const patch = decision.patch as Record<string, unknown>;
    for (const field of ['confirmed_outcome', 'outcome_reviewed_by', 'outcome_reviewed_at', 'confirmed_lost_reason', 'verified_invoice_id', 'verified_revenue', 'responsibility_status']) {
      expect(field in patch).toBe(false);
    }
    expect('proposed_outcome' in patch).toBe(false);
    expect('case_state' in patch).toBe(false);
    expect((patch as any).case_json.canonicalSemanticProjection.reasonCodes).toContain('v22_projection.human_confirmed_outcome_outranks');
  });

  it('a proven canonical sale keeps proposed_outcome/outcome_confidence and canonicalSaleProof intact', () => {
    const proof = { state: 'proven', salesCaseId: 'si-1', invoiceId: 'inv-1' };
    const row = a1Row({ case_json: { canonicalSaleProof: proof }, proposed_outcome: 'verified_sale', outcome_confidence: 100 });
    const decision = decideV22Projection(row, [fact('si-1', 'awaiting_delivery', { sale: { outcome: 'sale_proven', customerConfirmed: true } })], NOW);
    const patch = decision.patch as any;
    expect('proposed_outcome' in patch).toBe(false);
    expect('outcome_confidence' in patch).toBe(false);
    expect(patch.case_json.canonicalSaleProof).toEqual(proof);
    expect(patch.case_state).toBe('confirmed_order');
  });
});

describe('V22 semantic projection — multi SI cases -> one V22 envelope', () => {
  it('several agreeing cases aggregate deterministically (order-independent)', () => {
    const a = aggregateV22Projection([fact('si-2', 'awaiting_customer'), fact('si-1', 'awaiting_customer')]);
    const b = aggregateV22Projection([fact('si-1', 'awaiting_customer'), fact('si-2', 'awaiting_customer')]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 'ok', mode: 'aggregate', values: { case_state: 'awaiting_customer', needs_human_review: false } });
  });

  it('a closed sibling does not conflict with one open case', () => {
    const result = aggregateV22Projection([fact('si-1', 'closed'), fact('si-2', 'action_required_pharmacy')]);
    expect(result).toMatchObject({ status: 'ok', mode: 'aggregate', values: { case_state: 'awaiting_pharmacy' } });
  });

  it('conflicting actionable states never guess: coarse open + needs human review', () => {
    const result = aggregateV22Projection([fact('si-1', 'action_required_pharmacy'), fact('si-2', 'awaiting_customer')]);
    expect(result).toMatchObject({ status: 'ok', mode: 'mixed', values: { case_state: 'open', proposed_outcome: 'followup_needed', needs_human_review: true } });
    expect((result as any).reasonCodes).toContain('v22_projection.mixed_operational_states');
  });

  it('an active SI case without a canonical disposition (older analysis) skips the projection', () => {
    const old = fact('si-2', 'awaiting_customer');
    delete (old.view as any).operationalDisposition;
    expect(aggregateV22Projection([fact('si-1', 'awaiting_customer'), old])).toEqual({ status: 'skipped', reason: 'incomplete_canonical_analyses' });
    expect(decideV22Projection(a1Row(), [], NOW)).toMatchObject({ status: 'skipped', reason: 'no_active_sales_intelligence_case' });
  });
});

describe('V22 envelope sync + projection — reanalysis converges', () => {
  const envelopePayload = {
    case_key: 'v22:src:2026-10-06T06:00:00.000Z',
    case_type: 'followup',
    case_state: 'awaiting_customer',
    order_intent: false,
    commercial_opportunity: false,
    proposed_outcome: 'awaiting_customer',
    outcome_confidence: 95,
    next_action: 'متابعة العميل إذا تجاوزت المهلة التشغيلية.',
    summary: 'متابعة',
    needs_human_review: false,
    case_json: { type: 'followup', v23: {} },
  };

  it('a re-scan keeps projected columns and server-owned case_json keys, refreshing only the preliminary snapshot', () => {
    const projected = { ...a1Row(), ...(decideV22Projection(a1Row(), [fact('si-1', 'action_required_pharmacy')], NOW).patch as any) };
    projected.case_json.canonicalSaleProof = { state: 'not_proven_marker' };
    const merged = mergeV22EnvelopePayload(envelopePayload, projected);
    expect('case_type' in merged).toBe(false);
    expect('case_state' in merged).toBe(false);
    expect('proposed_outcome' in merged).toBe(false);
    expect(merged.case_json.canonicalSaleProof).toEqual({ state: 'not_proven_marker' });
    expect(merged.case_json.canonicalSemanticProjection.preliminary.case_type).toBe('followup');
    expect(merged.case_json.v23).toEqual({});
  });

  it('envelope -> SI projection -> re-scan -> SI projection reaches the same final state', () => {
    const facts = [fact('si-1', 'action_required_pharmacy')];
    const first = { ...a1Row(), ...(decideV22Projection(a1Row(), facts, NOW).patch as any) };
    const rescanned = { ...first, ...mergeV22EnvelopePayload(envelopePayload, first) };
    const second = decideV22Projection(rescanned, facts, '2026-10-09T00:00:00.000Z');
    expect(second.status).toBe('unchanged');
    for (const column of ['order_intent', 'case_type', 'case_state', 'proposed_outcome', 'next_action']) {
      expect(rescanned[column]).toEqual(first[column]);
    }
  });

  it('first ingest (no existing row) writes the envelope as is', () => {
    expect(mergeV22EnvelopePayload(envelopePayload, null)).toEqual(envelopePayload);
  });

  it('a proven sale keeps proposed_outcome on re-scan', () => {
    const merged = mergeV22EnvelopePayload(envelopePayload, {
      case_json: { canonicalSaleProof: { state: 'proven' } },
      proposed_outcome: 'verified_sale',
    });
    expect('proposed_outcome' in merged).toBe(false);
    expect('outcome_confidence' in merged).toBe(false);
    expect(merged.case_json.canonicalSaleProof).toEqual({ state: 'proven' });
  });
});

describe('V22 semantic projection — I/O follower', () => {
  function fakeService(row: Record<string, any>, analyses: Array<Record<string, any>>, opts: { concurrentOnce?: boolean } = {}) {
    let concurrent = Boolean(opts.concurrentOnce);
    const updates: Array<Record<string, any>> = [];
    const service = {
      updates,
      from(table: string) {
        const filters: Array<[string, unknown, 'eq' | 'in']> = [];
        let patch: Record<string, any> | null = null;
        const rowsFor = () => {
          if (table === 'sales_intelligence_cases') return [{ case_id: 'si-1', source_case_id_v22: row.id, is_active: true }];
          if (table === 'sales_intelligence_case_analyses') return analyses;
          return [row];
        };
        const match = () =>
          rowsFor().filter((r: any) => filters.every(([k, v, op]) => (op === 'in' ? (v as unknown[]).includes(r[k]) : r[k] === v)));
        const chain: any = {
          select: () => chain,
          in: (k: string, v: unknown[]) => (filters.push([k, v, 'in']), chain),
          eq: (k: string, v: unknown) => (filters.push([k, v, 'eq']), chain),
          limit: () => chain,
          update: (p: Record<string, any>) => ((patch = p), chain),
          maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => void) => {
            if (patch) {
              if (concurrent) {
                concurrent = false;
                row.updated_at = 'changed-by-proof-writer';
                return resolve({ data: [], error: null });
              }
              const hit = match();
              for (const r of hit) Object.assign(r, patch);
              updates.push(patch);
              return resolve({ data: hit.map((r: any) => ({ id: r.id })), error: null });
            }
            resolve({ data: match(), error: null });
          },
        };
        return chain;
      },
    };
    return service;
  }

  const analysisRow = () => ({ analysis_id: 'analysis-si-1', case_id: 'si-1', pipeline_version: 'sales-intelligence-v21', is_current: true, case_intelligence: fact('si-1', 'action_required_pharmacy').view });

  it('projects once, retries once on a concurrent writer, and a second run writes nothing', async () => {
    const { projectCanonicalSemanticsToV22 } = await import('../refresh/v22SemanticProjection');
    const row = { ...a1Row() } as Record<string, any>;
    const service = fakeService(row, [analysisRow()], { concurrentOnce: true });
    const first = await projectCanonicalSemanticsToV22(service, ['v22-a1'], NOW);
    expect(first.map((r) => r.status)).toEqual(['projected']);
    expect(service.updates).toHaveLength(1);
    expect(row.case_state).toBe('awaiting_pharmacy');
    const second = await projectCanonicalSemanticsToV22(service, ['v22-a1'], '2026-10-09T00:00:00.000Z');
    expect(second.map((r) => r.status)).toEqual(['unchanged']);
    expect(service.updates).toHaveLength(1);
  });
});
