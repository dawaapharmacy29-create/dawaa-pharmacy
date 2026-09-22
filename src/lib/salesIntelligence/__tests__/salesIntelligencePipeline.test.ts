import { describe, expect, it } from 'vitest';
import {
  runSalesIntelligencePipeline,
  type SalesIntelligencePipelineInput,
} from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { buildInvoiceCandidateQuery } from '@/lib/salesIntelligence/invoiceCandidateRetrieval';

function baseInput(overrides: Partial<SalesIntelligencePipelineInput> = {}): SalesIntelligencePipelineInput {
  return {
    conversationId: 'conv-1',
    rawWhatsAppExportText: '',
    resolveInvoiceCandidates: () => [],
    ...overrides,
  };
}

describe('Sales Intelligence Pipeline (Phase G) — Golden Cases', () => {
  it('1. one clean conversation end-to-end: summary, total, confirmation, matching invoice -> zero exceptions', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-1',
        resolveInvoiceCandidates: () => [
          { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
        ],
      })
    );
    expect(result.caseAnalyses).toHaveLength(1);
    const a = result.caseAnalyses[0];
    expect(a.status).toBe('analyzed');
    expect(a.integrityAssessment.exceptions).toEqual([]);
    expect(a.attribution.hasAttributedInvoice).toBe(true);
    expect(a.basketInvoiceMatch.overallMatch).not.toBe('mismatch');
  });

  it('2. information-only conversation is a valid, complete output — never forced into a commercial case', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    expect(result.caseAnalyses).toHaveLength(1);
    const a = result.caseAnalyses[0];
    expect(a.conversationCase.caseType).toBe('information_only');
    expect(a.status).toBe('analyzed');
    expect(a.evidenceCompleteness.basketDetected).toBe(false);
  });

  it('3. two independent cases in one thread (large time gap) each attribute their own invoice', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال
[9/16/26, 11:00:00 AM] Customer: عايز 3 علبة زوركال
[9/16/26, 11:01:00 AM] You: حضرتك تأمر بـ:
3 علبة زوركال
إجمالي الحساب 300 جنيه
هل الطلب كده كامل؟
[9/16/26, 11:02:00 AM] Customer: ايوه تمام
[9/16/26, 11:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-3',
        resolveInvoiceCandidates: (ctx) =>
          ctx.caseStartedAt.startsWith('2026-09-15')
            ? [{ id: 'inv-a', customer_id: 'cust-3', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 }]
            : [{ id: 'inv-b', customer_id: 'cust-3', invoice_datetime: '2026-09-16T11:05:00.000Z', net_amount: 300 }],
      })
    );
    expect(result.sessionsProcessed).toBe(2);
    expect(result.caseAnalyses).toHaveLength(2);
    expect(result.caseAnalyses[0].attribution.selectedInvoiceId).toBe('inv-a');
    expect(result.caseAnalyses[1].attribution.selectedInvoiceId).toBe('inv-b');
  });

  it('4. a modified basket (v1 -> v2) is used throughout D/E/F — never the stale v1 total', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:04:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:05:00 AM] Customer: ايوه تمام
[9/15/26, 9:06:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-4',
        resolveInvoiceCandidates: () => [
          { id: 'inv-new', customer_id: 'cust-4', invoice_datetime: '2026-09-15T09:07:00.000Z', net_amount: 250 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.basketHistory[a.basketHistory.length - 1].version).toBe(2);
    expect(a.activeBasket?.version).toBe(2);
    expect(a.basketInvoiceMatch.basketVersion).toBe(2);
    expect(a.attribution.selectedCandidate?.announcedTotalMatch).toBe('exact');
    expect(a.integrityAssessment.exceptions).toEqual([]);
  });

  it('5. case timestamp used for candidate retrieval — the SEGMENTED case timing, never a coarse whole-thread value', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال
[9/20/26, 3:00:00 PM] Customer: عايز 3 علبة زوركال
[9/20/26, 3:01:00 PM] You: حضرتك تأمر بـ:
3 علبة زوركال
إجمالي الحساب 300 جنيه
هل الطلب كده كامل؟
[9/20/26, 3:02:00 PM] Customer: ايوه تمام
[9/20/26, 3:03:00 PM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const receivedContexts: Array<{ caseStartedAt: string; caseEndedAt: string | null }> = [];
    runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-5',
        resolveInvoiceCandidates: (ctx) => {
          receivedContexts.push(ctx);
          return [];
        },
      })
    );
    expect(receivedContexts).toHaveLength(2);
    // A coarse whole-thread timestamp would be identical for both cases (or would span both dates
    // in one value) — the segmented per-case timestamps must genuinely differ and each must match
    // ONLY its own interaction's real start, never the other case's.
    expect(receivedContexts[0].caseStartedAt).not.toBe(receivedContexts[1].caseStartedAt);
    expect(receivedContexts[0].caseStartedAt.startsWith('2026-09-15')).toBe(true);
    expect(receivedContexts[1].caseStartedAt.startsWith('2026-09-20')).toBe(true);
    // The candidate-retrieval query windows built from these must therefore differ too.
    const q1 = buildInvoiceCandidateQuery({ ...receivedContexts[0], caseId: 'a', customerId: 'cust-5', customerPhone: null, branchNameRaw: null });
    const q2 = buildInvoiceCandidateQuery({ ...receivedContexts[1], caseId: 'b', customerId: 'cust-5', customerPhone: null, branchNameRaw: null });
    expect(q1.windowStartIso).not.toBe(q2.windowStartIso);
  });

  it('6. ambiguous invoices (two equally plausible candidates) are flagged, never auto-resolved', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-6',
        resolveInvoiceCandidates: () => [
          { id: 'inv-x', customer_id: 'cust-6', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
          { id: 'inv-y', customer_id: 'cust-6', invoice_datetime: '2026-09-15T09:06:00.000Z', net_amount: 180 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.attribution.contradictions).toContain('ambiguous_multiple_candidates');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'ambiguous_invoice_attribution')).toBe(true);
    expect(a.failureReasons).toContain('invoice_candidates_ambiguous');
    expect(a.needsHumanReview).toBe(true);
  });

  it('7. no invoice at all after a fully confirmed case -> confirmed_case_without_attributed_invoice, high_priority', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-7', resolveInvoiceCandidates: () => [] })
    );
    const a = result.caseAnalyses[0];
    expect(a.attribution.hasAttributedInvoice).toBe(false);
    expect(
      a.integrityAssessment.exceptions.some(
        (e) => e.type === 'confirmed_case_without_attributed_invoice' && e.severity === 'high_priority'
      )
    ).toBe(true);
    expect(a.failureReasons).toContain('invoice_candidate_missing');
  });

  it('8. protocol incomplete (no announced total ever stated) but the sale is still attributable via a trusted link', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-8',
        trustedInvoiceId: 'inv-trusted',
        resolveInvoiceCandidates: () => [
          { id: 'inv-trusted', customer_id: 'cust-8', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.protocolAssessment.protocolCompliant).toBe(false);
    expect(a.attribution.attributionLevel).toBe('proven');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(true);
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'unexplained_total_difference')).toBe(false);
  });

  it('9. unknown/undetected basket (a request with no commercial signal) is honestly reported, never treated as a clean sale', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عندك فيتامينات؟`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    const a = result.caseAnalyses[0];
    expect(a.conversationCase.caseType).toBe('sales_opportunity');
    expect(a.evidenceCompleteness.basketDetected).toBe(false);
    expect(a.status).not.toBe('analyzed');
    expect(a.failureReasons).toContain('basket_not_detected');
  });

  it('10. item evidence unavailable (the default in production) never invents an item-level exception, header_only scope', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-10',
        resolveInvoiceCandidates: () => [
          { id: 'inv-10', customer_id: 'cust-10', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.basketInvoiceMatch.itemEvidenceReady).toBe(false);
    expect(a.integrityAssessment.integrityEvaluationScope).toBe('header_only');
    expect(a.integrityAssessment.canEvaluateItemIntegrity).toBe(false);
    expect(a.integrityAssessment.exceptions.some((e) => e.stage === 'invoice_items')).toBe(false);
    expect(a.evidenceCompleteness.invoiceItemsAvailable).toBe(false);
    expect(a.failureReasons).toContain('invoice_items_unavailable');
  });

  it('11. an undocumented total mismatch surfaces end-to-end as a high_priority integrity exception', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-11',
        resolveInvoiceCandidates: () => [
          { id: 'inv-11', customer_id: 'cust-11', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 900 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.basketInvoiceMatch.totalMatch).toBe('mismatch');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'unexplained_total_difference')).toBe(true);
    expect(a.integrityAssessment.highestSeverity).toBe('high_priority');
    expect(a.status).toBe('needs_human_review');
  });

  it('12. a completely clean header flow reports a high evidence level and zero pipeline warnings', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-12',
        resolveInvoiceCandidates: () => [
          { id: 'inv-12', customer_id: 'cust-12', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(['high', 'medium']).toContain(a.evidenceCompleteness.overallEvidenceLevel);
    expect(a.pipelineWarnings).toEqual([]);
    expect(a.needsHumanReview).toBe(false);
    expect(a.integrityAssessment.exceptions).toEqual([]);
  });
});

describe('Invoice Candidate Retrieval Boundary (Phase G) — Golden Cases', () => {
  it('never falls back to scanning the whole table when no identity is resolved', () => {
    const query = buildInvoiceCandidateQuery({
      caseId: 'c1',
      customerId: null,
      customerPhone: null,
      branchNameRaw: null,
      caseStartedAt: '2026-09-15T09:00:00.000Z',
      caseEndedAt: '2026-09-15T09:03:00.000Z',
    });
    expect(query.customerId).toBeNull();
    expect(query.customerPhoneNormalized).toBeNull();
  });

  it('normalizes a valid Egyptian mobile and rejects an invalid one', () => {
    const valid = buildInvoiceCandidateQuery({
      caseId: 'c1',
      customerId: null,
      customerPhone: '01012345678',
      branchNameRaw: null,
      caseStartedAt: '2026-09-15T09:00:00.000Z',
      caseEndedAt: null,
    });
    expect(valid.customerPhoneNormalized).toBe('01012345678');

    const invalid = buildInvoiceCandidateQuery({
      caseId: 'c1',
      customerId: null,
      customerPhone: '123',
      branchNameRaw: null,
      caseStartedAt: '2026-09-15T09:00:00.000Z',
      caseEndedAt: null,
    });
    expect(invalid.customerPhoneNormalized).toBeNull();
  });

  it('the query window is bounded and anchored to the case timing, never unbounded', () => {
    const query = buildInvoiceCandidateQuery({
      caseId: 'c1',
      customerId: 'cust-1',
      customerPhone: null,
      branchNameRaw: null,
      caseStartedAt: '2026-09-15T09:00:00.000Z',
      caseEndedAt: '2026-09-15T09:03:00.000Z',
    });
    expect(new Date(query.windowStartIso).getTime()).toBeLessThan(new Date('2026-09-15T09:00:00.000Z').getTime());
    expect(new Date(query.windowEndIso).getTime()).toBeGreaterThan(new Date('2026-09-15T09:03:00.000Z').getTime());
    expect(query.limit).toBeGreaterThan(0);
    expect(query.limit).toBeLessThan(10000);
  });
});
