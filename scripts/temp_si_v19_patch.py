from pathlib import Path

ROOT = Path('.')

def patch(path, old, new, count=1):
    p = ROOT / path
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} matches, found {actual} for selector: {old[:120]!r}')
    p.write_text(text.replace(old, new, count))

# 1) Types: explicit invoiced-but-not-sale-proven journey + follow-up suppression reason.
patch(
    'src/lib/salesIntelligence/types.ts',
    "  | 'awaiting_invoice'\n  | 'financially_settled'\n  | 'sale_proven'",
    "  | 'awaiting_invoice'\n  | 'invoiced_unproven'\n  | 'financially_settled'\n  | 'sale_proven'",
)
patch(
    'src/lib/salesIntelligence/types.ts',
    "  | 'weak_evidence'\n  | 'financially_settled'\n  | 'covered_by_specific_follow_up';",
    "  | 'weak_evidence'\n  | 'financially_settled'\n  | 'invoiced_unproven'\n  | 'covered_by_specific_follow_up';",
)

# 2) Canonical outcome: distinguish exact official invoice-backed closure from a merely confirmed order.
patch(
    'src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts',
    "  financialSettlement?: FinancialSettlementAssessment;\n  hasMeaningfulBasketItems: boolean;",
    "  financialSettlement?: FinancialSettlementAssessment;\n  /** Exact, clean, official invoice attribution + exact announced-total match after complete order confirmation. */\n  invoiceBackedOrderClosure?: boolean;\n  hasMeaningfulBasketItems: boolean;",
)
patch(
    'src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts',
    "    financialSettlement,\n    hasMeaningfulBasketItems,",
    "    financialSettlement,\n    invoiceBackedOrderClosure,\n    hasMeaningfulBasketItems,",
)
patch(
    'src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts',
    "  if (commercialConfirmation.currentState === 'commercial_confirmation_complete') {\n    return {\n      ...base,\n      outcome: 'order_confirmed_unproven',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: true,\n      reasonCodes: ['outcome.order_confirmed_without_proven_sale'],\n    };\n  }",
    "  if (invoiceBackedOrderClosure) {\n    return {\n      ...base,\n      outcome: 'order_confirmed_unproven',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: true,\n      reasonCodes: ['outcome.invoice_backed_order_closed_sale_not_proven'],\n    };\n  }\n\n  if (commercialConfirmation.currentState === 'commercial_confirmation_complete') {\n    return {\n      ...base,\n      outcome: 'order_confirmed_unproven',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: true,\n      reasonCodes: ['outcome.order_confirmed_without_proven_sale'],\n    };\n  }",
)

# 3) Journey state: a real selected invoice is not "awaiting invoice"; keep it distinct from paid/settled.
patch(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  'customer_confirmed',\n  'awaiting_invoice',\n  'financially_settled',",
    "  'customer_confirmed',\n  'awaiting_invoice',\n  'invoiced_unproven',\n  'financially_settled',",
)
patch(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  const financiallySettled =\n    input.financialSettlement?.status === 'settled' &&\n    input.salesOutcome.outcome === 'order_confirmed_unproven' &&\n    input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven');",
    "  const financiallySettled =\n    input.financialSettlement?.status === 'settled' &&\n    input.salesOutcome.outcome === 'order_confirmed_unproven' &&\n    input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven');\n  const invoiceBackedClosed =\n    input.salesOutcome.outcome === 'order_confirmed_unproven' &&\n    input.salesOutcome.reasonCodes.includes('outcome.invoice_backed_order_closed_sale_not_proven');\n  const operationallyClosed = financiallySettled || invoiceBackedClosed;",
)
patch(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  if (financiallySettled) {\n    reached.add('financially_settled');\n    input.financialSettlement?.primaryMessageIds.forEach((id) => evidenceIds.add(id));\n  } else if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === 'order_confirmed_unproven') {\n    reached.add('awaiting_invoice');\n  }",
    "  if (financiallySettled) {\n    reached.add('financially_settled');\n    input.financialSettlement?.primaryMessageIds.forEach((id) => evidenceIds.add(id));\n  } else if (invoiceBackedClosed) {\n    reached.add('invoiced_unproven');\n  } else if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === 'order_confirmed_unproven') {\n    reached.add('awaiting_invoice');\n  }",
)
patch(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  } else if (financiallySettled) {\n    currentState = 'financially_settled';\n    reasonCodes.push('journey.financial_settlement_closed_order_sale_proof_pending');\n    confidence = {\n      level: 'strongly_inferred',\n      score: Math.max(0.95, input.financialSettlement?.confidence.score ?? 0),\n      ruleIds: [reasonCodes[0]],\n      evidence: input.financialSettlement?.confidence.evidence ?? [],\n    };\n  } else if (declined) {",
    "  } else if (financiallySettled) {\n    currentState = 'financially_settled';\n    reasonCodes.push('journey.financial_settlement_closed_order_sale_proof_pending');\n    confidence = {\n      level: 'strongly_inferred',\n      score: Math.max(0.95, input.financialSettlement?.confidence.score ?? 0),\n      ruleIds: [reasonCodes[0]],\n      evidence: input.financialSettlement?.confidence.evidence ?? [],\n    };\n  } else if (invoiceBackedClosed) {\n    currentState = 'invoiced_unproven';\n    reasonCodes.push('journey.invoice_backed_order_closed_sale_proof_pending');\n    confidence = assess('strongly_inferred', 0.95, reasonCodes[0]);\n  } else if (declined) {",
)
patch(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "      input.salesOutcome.needsHumanReview ||\n      (input.salesOutcome.outcome !== 'sale_proven' && input.customerNeed.needsHumanReview) ||\n      input.salesOutcome.outcome === 'needs_review',",
    "      input.salesOutcome.needsHumanReview ||\n      (!operationallyClosed && input.salesOutcome.outcome !== 'sale_proven' && input.customerNeed.needsHumanReview) ||\n      input.salesOutcome.outcome === 'needs_review',",
)

# 4) Lost opportunity: invoiced confirmed orders are closed, even if Sale Proof remains unproven.
patch(
    'src/lib/salesIntelligence/lostOpportunityEngine.ts',
    "  } else if (\n    salesOutcome.outcome === 'order_confirmed_unproven' &&\n    journeyState.currentState === 'financially_settled'\n  ) {\n    // The order is operationally closed by exact invoice-backed payment settlement. This is NOT\n    // `won`: official sale/revenue counting still belongs exclusively to canonical Sale Proof.\n    v = verdict(\n      'closed_order_unproven',\n      null,\n      'none',\n      null,\n      'strongly_inferred',\n      0.95,\n      'closed.financial_settlement_sale_proof_pending',\n      journeyState.evidenceMessageIds\n    );",
    "  } else if (\n    salesOutcome.outcome === 'order_confirmed_unproven' &&\n    (journeyState.currentState === 'financially_settled' || journeyState.currentState === 'invoiced_unproven')\n  ) {\n    // The order is operationally closed by either exact invoice-backed payment settlement OR a\n    // clean official invoice whose amount exactly matches the completed confirmed order. This is\n    // NOT `won`: official sale/revenue counting still belongs exclusively to canonical Sale Proof.\n    v = verdict(\n      'closed_order_unproven',\n      null,\n      'none',\n      null,\n      'strongly_inferred',\n      0.95,\n      journeyState.currentState === 'financially_settled'\n        ? 'closed.financial_settlement_sale_proof_pending'\n        : 'closed.invoice_backed_order_sale_proof_pending',\n      journeyState.evidenceMessageIds\n    );",
)

# 5) Follow-up wording: closed by invoice is not the same thing as financially settled.
patch(
    'src/lib/salesIntelligence/followUpOpportunityEngine.ts',
    "          : lostOpportunity.state === 'closed_order_unproven'\n            ? 'financially_settled'\n            : 'no_customer_need',",
    "          : lostOpportunity.state === 'closed_order_unproven'\n            ? salesOutcome.reasonCodes.includes('outcome.invoice_backed_order_closed_sale_not_proven')\n              ? 'invoiced_unproven'\n              : 'financially_settled'\n            : 'no_customer_need',",
)

# 6) Pipeline: exact official invoice + exact announced total + clean attribution closes operationally.
patch(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  const reviewReasonsResolvedByProvenInvoice = new Set(['no_basket_state_for_case']);\n  const reviewReasonsResolvedByFinancialSettlement = new Set(['possible_unsegmented_multiple_requests']);",
    "  const reviewReasonsResolvedByProvenInvoice = new Set(['no_basket_state_for_case']);\n  const reviewReasonsResolvedByFinancialSettlement = new Set(['possible_unsegmented_multiple_requests']);\n  const invoiceBackedOrderClosure =\n    commercialConfirmation.currentState === 'commercial_confirmation_complete' &&\n    attribution.hasAttributedInvoice &&\n    attribution.isOfficialForStaffEvaluation &&\n    attribution.selectedCandidate?.announcedTotalMatch === 'exact' &&\n    attribution.contradictions.length === 0 &&\n    saleProof.state === 'strongly_supported';\n  const reviewReasonsResolvedByInvoiceBackedClosure = new Set([\n    'unresolved_product_identity',\n    'customer_need_product_context_ambiguous',\n  ]);",
)
patch(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  if (financialSettlement.status === 'settled') {\n    humanReviewReasons = humanReviewReasons.filter(\n      (reason) => !reviewReasonsResolvedByFinancialSettlement.has(reason)\n    );\n  }",
    "  if (financialSettlement.status === 'settled') {\n    humanReviewReasons = humanReviewReasons.filter(\n      (reason) => !reviewReasonsResolvedByFinancialSettlement.has(reason)\n    );\n  }\n  if (invoiceBackedOrderClosure) {\n    humanReviewReasons = humanReviewReasons.filter(\n      (reason) => !reviewReasonsResolvedByInvoiceBackedClosure.has(reason)\n    );\n  }",
)
patch(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "    saleProof,\n    financialSettlement,\n    hasMeaningfulBasketItems,",
    "    saleProof,\n    financialSettlement,\n    invoiceBackedOrderClosure,\n    hasMeaningfulBasketItems,",
)
patch(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  const operationallySettled =\n    financialSettlement.status === 'settled' &&\n    salesOutcome.outcome === 'order_confirmed_unproven';\n  const effectiveConversationCase: ConversationCase = operationallySettled\n    ? { ...conversationCase, status: 'invoiced' }\n    : conversationCase;",
    "  const operationallySettled =\n    financialSettlement.status === 'settled' &&\n    salesOutcome.outcome === 'order_confirmed_unproven';\n  const operationallyInvoiced =\n    invoiceBackedOrderClosure &&\n    salesOutcome.outcome === 'order_confirmed_unproven';\n  const operationallyClosed = operationallySettled || operationallyInvoiced;\n  const effectiveConversationCase: ConversationCase = operationallyClosed\n    ? { ...conversationCase, status: 'invoiced' }\n    : conversationCase;",
)
patch(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  } else if (operationallySettled) {\n    // Exact invoice-backed payment settlement gives a complete operational closure even when the\n    // chat missed a formal final-summary step. The missing protocol step remains visible in\n    // failureReasons/coaching, but it must not make the commercial journey look open or partial.\n    status = 'analyzed';",
    "  } else if (operationallyClosed) {\n    // Exact payment settlement OR a clean official invoice with an exact announced-total match\n    // gives a complete operational closure. Evidence limitations (e.g. media-only product identity)\n    // remain visible, but they must not reopen a confirmed invoiced order.\n    status = 'analyzed';",
)

# 7) Version bump: semantic state changed and must force a real reanalysis.
patch(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "// v18 (2026-10-04): unresolved media/deictic product identity is unavailable evidence, never a",
    "// v19 (2026-10-04): a complete confirmed order with clean official invoice attribution and an exact\n// announced-total match projects as invoiced_unproven/closed_order_unproven. Media-only product\n// identity remains an evidence limitation and never reopens an otherwise closed invoiced order.\n// v18 (2026-10-04): unresolved media/deictic product identity is unavailable evidence, never a",
)
patch(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "export const PIPELINE_VERSION = 'sales-intelligence-v18';",
    "export const PIPELINE_VERSION = 'sales-intelligence-v19';",
)

# 8) Regression tests: Mohamed invoice-backed closure + fail-closed amount mismatch.
test_path = ROOT / 'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts'
text = test_path.read_text()
insert = r'''

  it('projects Mohamed exact official invoice as invoiced_unproven without inventing product identity or proven revenue', () => {
    const raw = `[9/26/26, 9:46:29 PM] محمد الجندي 5179: <image omitted>
[9/26/26, 9:46:41 PM] محمد الجندي 5179: عايزه من دا 4
[9/26/26, 9:46:46 PM] You: أهلًا وسهلًا بحضرتك\nمع حضرتك د دنيا
[9/26/26, 9:47:16 PM] محمد الجندي 5179: [Forwarded] <audio omitted>
[9/26/26, 9:47:25 PM] محمد الجندي 5179: وعايزه العلاج دا
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا ان شاء الله؟
[9/26/26, 9:50:12 PM] محمد الجندي 5179: ايوا
[9/26/26, 9:50:25 PM] محمد الجندي 5179: كدا هيبقا كام
[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:50:51 PM] محمد الجندي 5179: تمام
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] محمد الجندي 5179: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`;
    const result = runSalesIntelligencePipeline({
      conversationId: 'mohamed-v19',
      rawWhatsAppExportText: raw,
      trustedConversationStartedAt: '2026-09-26T18:46:29.000Z',
      customerIdHint: 'cust-5179',
      customerPhoneHint: '01012808732',
      customerCodeHint: '5179',
      customerNameHint: 'محمد الجندي2',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [{
        id: 'inv-74720',
        invoice_number: '74720',
        customer_id: 'cust-5179',
        customer_code: '5179',
        customer_name: 'محمد الجندي2',
        customer_phone: '01012808732',
        branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-26T19:03:00.000Z',
        close_datetime: '2026-09-26T19:03:00.000Z',
        net_amount: 1579,
      }],
    });
    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    expect(analysis.commercialConfirmation.currentState).toBe('commercial_confirmation_complete');
    expect(analysis.activeBasket?.announcedTotal?.amount).toBe(1579);
    expect(analysis.attribution.selectedInvoiceNumber).toBe('74720');
    expect(analysis.attribution.isOfficialForStaffEvaluation).toBe(true);
    expect(analysis.salesOutcome.reasonCodes).toContain('outcome.invoice_backed_order_closed_sale_not_proven');
    expect(analysis.salesOutcome.isSaleCountable).toBe(false);
    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
    expect(analysis.conversationCase.status).toBe('invoiced');
    expect(analysis.journeyState.currentState).toBe('invoiced_unproven');
    expect(analysis.lostOpportunity.state).toBe('closed_order_unproven');
    expect(analysis.lostOpportunity.waitingOn).toBeNull();
    expect(analysis.followUp.decision).toBe('not_needed');
    expect(analysis.followUp.notNeededReason).toBe('invoiced_unproven');
    expect(analysis.failureReasons).toContain('product_identity_unresolved');
    expect(analysis.humanReviewReasons).not.toContain('unresolved_product_identity');
    expect(analysis.needsHumanReview).toBe(false);
    expect(analysis.status).toBe('analyzed');
  });

  it('does not close a confirmed order as invoiced_unproven when the announced total differs from the invoice', () => {
    const raw = `[9/26/26, 9:46:41 PM] محمد الجندي 5179: عايزه من دا 4
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا؟
[9/26/26, 9:50:12 PM] محمد الجندي 5179: ايوا
[9/26/26, 9:50:25 PM] محمد الجندي 5179: كدا هيبقا كام
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] محمد الجندي 5179: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`;
    const result = runSalesIntelligencePipeline({
      conversationId: 'mohamed-v19-mismatch',
      rawWhatsAppExportText: raw,
      trustedConversationStartedAt: '2026-09-26T18:46:41.000Z',
      customerIdHint: 'cust-5179',
      customerPhoneHint: '01012808732',
      customerCodeHint: '5179',
      customerNameHint: 'محمد الجندي2',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [{
        id: 'inv-wrong', invoice_number: 'wrong', customer_id: 'cust-5179', customer_code: '5179',
        customer_name: 'محمد الجندي2', customer_phone: '01012808732', branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-26T19:03:00.000Z', net_amount: 1700,
      }],
    });
    const analysis = result.caseAnalyses[0];
    expect(analysis.salesOutcome.reasonCodes).not.toContain('outcome.invoice_backed_order_closed_sale_not_proven');
    expect(analysis.journeyState.currentState).not.toBe('invoiced_unproven');
    expect(analysis.lostOpportunity.state).not.toBe('closed_order_unproven');
  });
'''
idx = text.rfind('\n});')
if idx < 0:
    raise SystemExit('test file: closing describe not found')
text = text[:idx] + insert + text[idx:]
test_path.write_text(text)

print('V19 invoice-backed closure patch applied')
