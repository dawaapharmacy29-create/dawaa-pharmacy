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
    // Regression (found via the Phase G.2 real-data re-validation): each session's own interaction
    // numbering restarts at 0, so without a session-qualifier the two cases would collide on the
    // SAME caseId ("conv:interaction:0") — corrupting anything keyed by caseId (competingSelections,
    // batch reporting). Must be genuinely unique per derived case.
    expect(result.caseAnalyses[0].caseId).not.toBe(result.caseAnalyses[1].caseId);
  });

  it('3b. caseIds stay unique across 3+ sessions of the same conversation, not just 2', () => {
    const raw = `[9/1/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/1/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/1/26, 9:02:00 AM] Customer: ايوه تمام
[9/1/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال
[9/5/26, 9:00:00 AM] Customer: عايز 3 علبة زوركال
[9/5/26, 9:01:00 AM] You: حضرتك تأمر بـ:
3 علبة زوركال
إجمالي الحساب 300 جنيه
هل الطلب كده كامل؟
[9/5/26, 9:02:00 AM] Customer: ايوه تمام
[9/5/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال
[9/10/26, 9:00:00 AM] Customer: عايز شامبو
[9/10/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 قطعة شامبو
إجمالي الحساب 90 جنيه
هل الطلب كده كامل؟
[9/10/26, 9:02:00 AM] Customer: ايوه تمام
[9/10/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw, resolveInvoiceCandidates: () => [] }));
    expect(result.sessionsProcessed).toBe(3);
    expect(result.caseAnalyses).toHaveLength(3);
    const caseIds = result.caseAnalyses.map((a) => a.caseId);
    expect(new Set(caseIds).size).toBe(3);
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

describe('Protocol Applicability + Historical Closure (Sales Intelligence Phase G.1) — Golden Cases', () => {
  it('1. information-only conversation -> protocol not applicable, no protocol exceptions', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('not_applicable');
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('2. real-data pattern — a proactive service follow-up message (no product/price at all) -> not_applicable', () => {
    // Real conversation id 26d5a57d-8098-499d-b72a-668cab8c4109 (Phase G shadow sample), trimmed to text-only content.
    const raw = `[9/12/26, 3:49:54 PM] You: مساء الخير يا فندم، حبيت أطمن على حضرتك وأتابع معاك أخبار المنتج معاك إيه؟
[9/12/26, 3:55:17 PM] You: تمام يا فندم إن شاء الله يعجب حضرتك`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_applicable');
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('3. real-data pattern — price/availability inquiry only ("ده موجود" / "لحظات اشوفه") -> not_reached, no missing-total violation', () => {
    const raw = `[9/12/26, 9:51:32 PM] Customer: ده موجود
[9/12/26, 9:52:36 PM] You: لحظات اشوفه لحضرتك
[9/12/26, 10:36:37 PM] You: حضرتك تحب نبتعه باذن الله`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_reached');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(false);
  });

  it('4. availability inquiry then the customer never replies again -> not_reached', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عندكم فيتامين د موجود؟
[9/15/26, 9:01:00 AM] You: موجود باذن الله يا فندم`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_reached');
  });

  it('5. basket building then abandonment (an item mentioned, no summary, conversation stops) -> not_reached', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 3 علب انتينال
[9/15/26, 9:01:00 AM] You: تمام يا فندم، متاح`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_reached');
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('6. an order-closing stage genuinely reached (final summary presented) -> applicable', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('applicable');
  });

  it('7. applicable + the full 4-step protocol actually followed -> compliant, no protocol exceptions', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c7', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('compliant');
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('8. applicable + a genuinely missing total -> non_compliant, final_total_missing fires as a real finding', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c8', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('non_compliant');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(true);
  });

  it('9. a pre-policy case (case timing before the configured effective date) -> not_enforced, never flagged as a staff violation', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-c9',
        protocolPolicyEffectiveAt: '2027-01-01T00:00:00.000Z',
        resolveInvoiceCandidates: () => [],
      })
    ).caseAnalyses[0];
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('not_enforced');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(false);
  });

  it('10. a post-policy equivalent case (case timing on/after the effective date) -> evaluated for real', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-c10',
        protocolPolicyEffectiveAt: '2026-01-01T00:00:00.000Z',
        resolveInvoiceCandidates: () => [],
      })
    ).caseAnalyses[0];
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('non_compliant');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(true);
  });

  it('11. historical organic closure without a formal final summary is still reported (strongly_inferred) AND now correctly makes the case applicable (Phase G.2)', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
    expect(a.commercialConfirmation.currentState).not.toBe('commercial_confirmation_complete');
    // Phase G.2 calibration: a formal Phase C summary was never presented, but strong organic
    // closure evidence (clear acceptance + clear staff fulfillment intent) alone is sufficient for
    // applicability — a formal summary is a COMPLIANCE step, never an applicability prerequisite.
    expect(a.protocolAssessment.applicability).toBe('applicable');
  });

  it('12. a clear organic acceptance linked to one basket produces strongly_inferred closure at the pipeline level', () => {
    const raw = `[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
  });

  it('13. an ambiguous acceptance across multiple unresolved products stays weakly_inferred and needs human review, at the pipeline level', () => {
    const raw = `[9/14/26, 1:00:00 AM] Customer: عايز 3 علب انتينال
[9/14/26, 1:01:00 AM] You: تمام
[9/14/26, 1:02:00 AM] Customer: وعايز 2 علبة ستريبتوكين كمان
[9/14/26, 1:03:00 AM] Customer: تمام ابعته
[9/14/26, 1:04:00 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('weakly_inferred');
    expect(a.historicalClosure.needsHumanReview).toBe(true);
  });

  it('14. staff fulfillment intent immediately after a clear customer acceptance is captured as strongly_inferred', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.historicalClosure.customerAcceptanceDetected).toBe(true);
    expect(a.historicalClosure.staffFulfillmentIntentDetected).toBe(true);
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
  });

  it('15. strong historical organic closure does NOT by itself attribute an invoice — Phase D still requires real invoice evidence', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c15', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
    expect(a.attribution.hasAttributedInvoice).toBe(false);
    expect(a.attribution.attributionLevel).toBe('unknown');
  });

  it('16. protocol exceptions are absent when applicability is not_applicable, even if humanReviewReasons exist elsewhere', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_applicable');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'confirmation_protocol_incomplete')).toBe(false);
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'staff_final_confirmation_missing')).toBe(false);
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(false);
  });

  it('17. protocol exceptions are absent when applicability is not_reached, even though missingProtocolSteps is non-empty structurally', () => {
    const raw = `[9/12/26, 9:51:32 PM] Customer: ده موجود
[9/12/26, 9:52:36 PM] You: لحظات اشوفه لحضرتك`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('not_reached');
    expect(a.protocolAssessment.protocolCompliant).toBe(false);
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('18. historical closure and protocol compliance can legitimately disagree: strongly_inferred organic closure, applicable, but the FORMAL 4-step steps were never followed', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c18', protocolPolicyEffectiveAt: '2026-01-01T00:00:00.000Z', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    // Real customer commercial closure was strong (a real order-closing moment happened), but the
    // FORMAL 4-step protocol steps (summary/total/confirmation) were never followed — both facts
    // are true simultaneously; neither overrides the other. With the policy actually enforced for
    // this case's timing, that gap is a real, reportable non-compliance finding.
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
    expect(a.protocolAssessment.applicability).toBe('applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('non_compliant');
  });

  it('19. Phase G.2: strong historical closure PRE-policy -> not_enforced, zero protocol exceptions, even though the case is now applicable', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c19', protocolPolicyEffectiveAt: null, resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('strongly_inferred');
    expect(a.protocolAssessment.applicability).toBe('applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('not_enforced');
    expect(a.integrityAssessment.exceptions.filter((e) => e.stage === 'basket_confirmation')).toEqual([]);
  });

  it('20. Phase G.2: the SAME closure evaluated POST-policy (an effective date already in the past) -> non_compliant, a real finding', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'cust-c20', protocolPolicyEffectiveAt: '2026-01-01T00:00:00.000Z', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(a.protocolAssessment.applicability).toBe('applicable');
    expect(a.integrityAssessment.protocolPolicyCompliance).toBe('non_compliant');
    expect(a.integrityAssessment.exceptions.some((e) => e.type === 'final_total_missing')).toBe(true);
  });

  it('21. Phase G.2: policy effective date never alters the historical closure classification itself', () => {
    const raw = `[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`;
    const notEnforced = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'c', protocolPolicyEffectiveAt: null, resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    const enforced = runSalesIntelligencePipeline(
      baseInput({ rawWhatsAppExportText: raw, customerIdHint: 'c', protocolPolicyEffectiveAt: '2020-01-01T00:00:00.000Z', resolveInvoiceCandidates: () => [] })
    ).caseAnalyses[0];
    expect(notEnforced.historicalClosure.closureLevel).toBe(enforced.historicalClosure.closureLevel);
    expect(notEnforced.protocolAssessment.applicability).toBe(enforced.protocolAssessment.applicability);
    // Only compliance differs based on the policy date — applicability and closure never do.
    expect(notEnforced.integrityAssessment.protocolPolicyCompliance).not.toBe(enforced.integrityAssessment.protocolPolicyCompliance);
  });

  it('22. Phase G.2: a weak/ambiguous organic acceptance across multiple unresolved products is never automatically applicable at the pipeline level', () => {
    const raw = `[9/14/26, 1:00:00 AM] Customer: عايز 3 علب انتينال
[9/14/26, 1:01:00 AM] You: تمام
[9/14/26, 1:02:00 AM] Customer: وعايز 2 علبة ستريبتوكين كمان
[9/14/26, 1:03:00 AM] Customer: تمام ابعته
[9/14/26, 1:04:00 AM] You: تم الارسال`;
    const a = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw })).caseAnalyses[0];
    expect(a.historicalClosure.closureLevel).toBe('weakly_inferred');
    expect(a.protocolAssessment.applicability).not.toBe('applicable');
  });
});
