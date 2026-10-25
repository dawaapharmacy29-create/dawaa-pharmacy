// Regression: a follow-up raised for one case of a conversation (customer-service outreach) was
// closed as "sold" by the invoice of a sibling order case, with an invoice older than the
// follow-up itself. The guard and the complaint-context writer must stay case- and time-scoped.
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import {
  evaluateFollowupPurchaseClosure,
  FOLLOWUP_PURCHASE_CLOSURE_LABELS,
  resolveActionCaseId,
} from '../followupPurchaseClosureGuard';
import { enrichComplaintFollowupContext } from '../../refresh/canonicalRefreshService';

const SOURCE = 'source-ee4f';
const SERVICE_CASE = {
  caseId: `${SOURCE}:interaction:0:session:0`,
  messageIds: ['1790495647000-0-You', '1790504063000-1-Customer'],
};
const ORDER_CASE = {
  caseId: `${SOURCE}:interaction:0:session:2`,
  messageIds: ['1790546187000-4-Customer', '1790546329000-5-You'],
};
const CASES = [SERVICE_CASE, ORDER_CASE];

describe('resolveActionCaseId', () => {
  it('resolves a canonical payload case id only when it is a case of this conversation', () => {
    expect(resolveActionCaseId({ payloadCaseId: ORDER_CASE.caseId }, CASES)).toEqual({
      caseId: ORDER_CASE.caseId,
      basis: 'payload_case_id',
    });
    expect(resolveActionCaseId({ payloadCaseId: 'other:case' }, CASES).caseId).toBeNull();
  });
  it('maps a legacy case anchor to its case by message time, whatever the parser index', () => {
    // Legacy V22 anchors and evidence use a different message index than the analysis ids.
    expect(resolveActionCaseId({ evidence: ['case:1790495647000-0'] }, CASES).caseId).toBe(
      SERVICE_CASE.caseId
    );
    expect(resolveActionCaseId({ evidence: ['1790495647000-1-You'] }, CASES).caseId).toBe(
      SERVICE_CASE.caseId
    );
  });
  it('fails closed for missing or multi-case evidence', () => {
    expect(resolveActionCaseId({ evidence: [] }, CASES)).toEqual({
      caseId: null,
      basis: 'unresolved',
    });
    expect(resolveActionCaseId({ evidence: ['case:1790000000000-0'] }, CASES)).toEqual({
      caseId: null,
      basis: 'unresolved',
    });
    expect(
      resolveActionCaseId({ evidence: ['case:1790495647000-0', '1790546187000-4-Customer'] }, CASES)
    ).toEqual({ caseId: null, basis: 'ambiguous' });
  });
});

describe('evaluateFollowupPurchaseClosure', () => {
  const followup = {
    sourceId: SOURCE,
    createdAt: '2026-09-28T05:18:05.097Z',
    caseId: SERVICE_CASE.caseId,
  };

  it('same customer, other case of the same conversation: never closes', () => {
    const decision = evaluateFollowupPurchaseClosure({
      followup,
      purchase: { sourceId: SOURCE, caseId: ORDER_CASE.caseId, invoiceAt: '2026-09-29T10:00:00Z' },
    });
    expect(decision).toEqual({ allowed: false, reason: 'purchase_from_another_case' });
  });
  it('purchase older than the follow-up: never closes, even in the same case', () => {
    // The live b50f4b70 shape: invoice 74938 at 2026-09-27 22:06Z, follow-up created 2026-09-28 05:18Z.
    for (const caseId of [SERVICE_CASE.caseId, ORDER_CASE.caseId]) {
      const decision = evaluateFollowupPurchaseClosure({
        followup,
        purchase: { sourceId: SOURCE, caseId, invoiceAt: '2026-09-27T22:06:00Z' },
      });
      expect(decision).toEqual({ allowed: false, reason: 'purchase_precedes_followup' });
    }
  });
  it('later purchase from the same case closes', () => {
    expect(
      evaluateFollowupPurchaseClosure({
        followup,
        purchase: {
          sourceId: SOURCE,
          caseId: SERVICE_CASE.caseId,
          invoiceAt: '2026-09-28T09:00:00Z',
        },
      })
    ).toEqual({ allowed: true, reason: 'same_case_purchase_after_followup' });
  });
  it('later purchase in another conversation closes; unknown scope or time never does', () => {
    expect(
      evaluateFollowupPurchaseClosure({
        followup,
        purchase: {
          sourceId: 'source-later',
          caseId: 'source-later:interaction:0:session:0',
          invoiceAt: '2026-10-02T09:00:00Z',
        },
      }).allowed
    ).toBe(true);
    expect(
      evaluateFollowupPurchaseClosure({
        followup: { ...followup, caseId: null },
        purchase: {
          sourceId: SOURCE,
          caseId: SERVICE_CASE.caseId,
          invoiceAt: '2026-09-28T09:00:00Z',
        },
      }).reason
    ).toBe('followup_case_unresolved');
    expect(
      evaluateFollowupPurchaseClosure({
        followup,
        purchase: { sourceId: SOURCE, caseId: SERVICE_CASE.caseId, invoiceAt: null },
      }).reason
    ).toBe('purchase_time_unknown');
    expect(
      evaluateFollowupPurchaseClosure({
        followup: { ...followup, createdAt: null },
        purchase: {
          sourceId: SOURCE,
          caseId: SERVICE_CASE.caseId,
          invoiceAt: '2026-09-28T09:00:00Z',
        },
      }).reason
    ).toBe('followup_time_unknown');
  });
  it('has an Arabic label for every reason', () => {
    for (const label of Object.values(FOLLOWUP_PURCHASE_CLOSURE_LABELS))
      expect(label).toMatch(/[؀-ۿ]/);
  });
});

describe('complaint follow-up delivery context is case scoped', () => {
  function serviceFor(actions: any[]) {
    const writes: Array<{ id: unknown; payload: any }> = [];
    const service = {
      from(table: string) {
        let patch: any = null;
        let id: unknown = null;
        const chain: any = {
          select: () => chain,
          in: () => chain,
          eq: (key: string, value: unknown) => {
            if (key === 'id') id = value;
            return chain;
          },
          update: (value: any) => {
            patch = value;
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: 'invoice-74938',
                invoice_number: '74938',
                branch: 'فرع شكري',
                invoice_datetime: '2026-09-27T22:06:00Z',
              },
              error: null,
            }),
          then: (resolve: any) => {
            if (patch) {
              writes.push({ id, payload: patch.payload });
              return Promise.resolve({ error: null }).then(resolve);
            }
            if (table === 'whatsapp_conversation_actions')
              return Promise.resolve({ data: actions, error: null }).then(resolve);
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return chain;
      },
    };
    return { service, writes };
  }
  const analyses = [
    {
      caseId: SERVICE_CASE.caseId,
      caseIntelligence: { interaction: { messageIds: SERVICE_CASE.messageIds } },
      attribution: { attributionLevel: 'unknown', selectedInvoiceId: null },
    },
    {
      caseId: ORDER_CASE.caseId,
      caseIntelligence: { interaction: { messageIds: ORDER_CASE.messageIds } },
      attribution: { attributionLevel: 'proven', selectedInvoiceId: 'invoice-74938' },
    },
  ];

  it('does not attach the order case invoice to the customer-service complaint (b50f4b70 shape)', async () => {
    const { service, writes } = serviceFor([
      {
        id: 'b50f4b70',
        status: 'ready',
        action_type: 'complaint_followup',
        payload: {},
        evidence: ['case:1790495647000-0'],
      },
    ]);
    const result = await enrichComplaintFollowupContext(service, { id: SOURCE }, analyses);
    expect(result.enrichedComplaintActions).toBe(0);
    expect(writes).toHaveLength(0);
  });
  it('attaches the invoice of the complaint own case, and skips unscoped legacy actions', async () => {
    const { service, writes } = serviceFor([
      {
        id: 'order-complaint',
        status: 'ready',
        action_type: 'complaint_followup',
        payload: { caseId: ORDER_CASE.caseId },
        evidence: [],
      },
      {
        id: 'unscoped',
        status: 'ready',
        action_type: 'complaint_followup',
        payload: {},
        evidence: [],
      },
    ]);
    const result = await enrichComplaintFollowupContext(service, { id: SOURCE }, analyses);
    expect(result.enrichedComplaintActions).toBe(1);
    expect(writes).toEqual([expect.objectContaining({ id: 'order-complaint' })]);
    expect(writes[0].payload.delivery_context).toMatchObject({
      invoice_number: '74938',
      case_id: ORDER_CASE.caseId,
      review_required: true,
    });
  });
});
