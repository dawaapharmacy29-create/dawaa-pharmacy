from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly 1 match, got {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Canonical vocab: operationally closed but not yet Sale-Proof proven is neither open nor won.
replace_once(
    'src/lib/salesIntelligence/types.ts',
    "export type LostOpportunityState = 'won' | 'open' | 'recoverable' | 'lost' | 'no_commercial_opportunity' | 'unknown';",
    "export type LostOpportunityState = 'won' | 'closed_order_unproven' | 'open' | 'recoverable' | 'lost' | 'no_commercial_opportunity' | 'unknown';",
)
replace_once(
    'src/lib/salesIntelligence/types.ts',
    "  | 'weak_evidence'\n  | 'covered_by_specific_follow_up';",
    "  | 'weak_evidence'\n  | 'financially_settled'\n  | 'covered_by_specific_follow_up';",
)
replace_once(
    'src/lib/salesIntelligence/types.ts',
    "  | 'customer_confirmed'\n  | 'awaiting_invoice'\n  | 'sale_proven'",
    "  | 'customer_confirmed'\n  | 'awaiting_invoice'\n  | 'financially_settled'\n  | 'sale_proven'",
)

# 2) Commercial journey: settlement is a first-class closed operational state, not awaiting invoice.
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  CustomerNeedModel,\n  EvidenceRef,",
    "  CustomerNeedModel,\n  EvidenceRef,\n  FinancialSettlementAssessment,",
)
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  commercialConfirmation: CommercialConfirmationAssessment;\n  salesOutcome: CanonicalSalesOutcomeAssessment;",
    "  commercialConfirmation: CommercialConfirmationAssessment;\n  salesOutcome: CanonicalSalesOutcomeAssessment;\n  financialSettlement?: FinancialSettlementAssessment | null;",
)
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  'customer_confirmed',\n  'awaiting_invoice',\n  'sale_proven',",
    "  'customer_confirmed',\n  'awaiting_invoice',\n  'financially_settled',\n  'sale_proven',",
)
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  const declined = input.salesOutcome.outcome === 'customer_rejected' || input.customerNeed.needDeclined;",
    "  const declined = input.salesOutcome.outcome === 'customer_rejected' || input.customerNeed.needDeclined;\n  const financiallySettled =\n    input.financialSettlement?.status === 'settled' &&\n    input.salesOutcome.outcome === 'order_confirmed_unproven' &&\n    input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven');",
)
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === 'order_confirmed_unproven') {\n    reached.add('awaiting_invoice');\n  }\n  input.commercialConfirmation.primaryMessageIds.forEach((id) => evidenceIds.add(id));",
    "  if (financiallySettled) {\n    reached.add('financially_settled');\n    input.financialSettlement?.primaryMessageIds.forEach((id) => evidenceIds.add(id));\n  } else if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === 'order_confirmed_unproven') {\n    reached.add('awaiting_invoice');\n  }\n  input.commercialConfirmation.primaryMessageIds.forEach((id) => evidenceIds.add(id));",
)
replace_once(
    'src/lib/salesIntelligence/commercialJourneyStateMachine.ts',
    "  } else if (declined) {\n    currentState = 'customer_declined';",
    "  } else if (financiallySettled) {\n    currentState = 'financially_settled';\n    reasonCodes.push('journey.financial_settlement_closed_order_sale_proof_pending');\n    confidence = {\n      level: 'strongly_inferred',\n      score: Math.max(0.95, input.financialSettlement?.confidence.score ?? 0),\n      ruleIds: [reasonCodes[0]],\n      evidence: input.financialSettlement?.confidence.evidence ?? [],\n    };\n  } else if (declined) {\n    currentState = 'customer_declined';",
)

# 3) Lost opportunity: settled order is closed, but deliberately NOT `won` until Sale Proof is proven.
replace_once(
    'src/lib/salesIntelligence/lostOpportunityEngine.ts',
    "  if (salesOutcome.outcome === 'sale_proven') {\n    // Rule 1: Sale Proof is the only route to `won`; product-level losses are still reported below.\n    v = verdict('won', null, 'none', null, 'proven', 1, 'won.canonical_sale_proven', []);\n  } else if (!hasCommercialNeed) {",
    "  if (salesOutcome.outcome === 'sale_proven') {\n    // Rule 1: Sale Proof is the only route to `won`; product-level losses are still reported below.\n    v = verdict('won', null, 'none', null, 'proven', 1, 'won.canonical_sale_proven', []);\n  } else if (\n    salesOutcome.outcome === 'order_confirmed_unproven' &&\n    journeyState.currentState === 'financially_settled'\n  ) {\n    // The order is operationally closed by exact invoice-backed payment settlement. This is NOT\n    // `won`: official sale/revenue counting still belongs exclusively to canonical Sale Proof.\n    v = verdict(\n      'closed_order_unproven',\n      null,\n      'none',\n      null,\n      'strongly_inferred',\n      0.95,\n      'closed.financial_settlement_sale_proof_pending',\n      journeyState.evidenceMessageIds\n    );\n  } else if (!hasCommercialNeed) {",
)

# 4) Follow-up: a financially settled order has no recovery follow-up merely because Sale Proof is pending.
replace_once(
    'src/lib/salesIntelligence/followUpOpportunityEngine.ts',
    "  if (salesOutcome.outcome === 'information_only' || lostOpportunity.state === 'no_commercial_opportunity') {\n    return {\n      caseId,\n      decision: 'not_needed',\n      opportunities: [],\n      notNeededReason: salesOutcome.outcome === 'information_only' ? 'information_only' : 'no_customer_need',\n    };\n  }",
    "  if (\n    salesOutcome.outcome === 'information_only' ||\n    lostOpportunity.state === 'no_commercial_opportunity' ||\n    lostOpportunity.state === 'closed_order_unproven'\n  ) {\n    return {\n      caseId,\n      decision: 'not_needed',\n      opportunities: [],\n      notNeededReason:\n        salesOutcome.outcome === 'information_only'\n          ? 'information_only'\n          : lostOpportunity.state === 'closed_order_unproven'\n            ? 'financially_settled'\n            : 'no_customer_need',\n    };\n  }",
)

# 5) Pipeline: project operational truth consistently while keeping Sale/Revenue count gates unchanged.
replace_once(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  const journeyState = deriveCommercialJourneyState({\n    caseId: conversationCase.caseId,\n    messages: scopedMessages,\n    customerNeed,\n    commercialConfirmation,\n    salesOutcome,\n  });",
    "  const operationallySettled =\n    financialSettlement.status === 'settled' &&\n    salesOutcome.outcome === 'order_confirmed_unproven';\n  const effectiveConversationCase: ConversationCase = operationallySettled\n    ? { ...conversationCase, status: 'invoiced' }\n    : conversationCase;\n\n  const journeyState = deriveCommercialJourneyState({\n    caseId: conversationCase.caseId,\n    messages: scopedMessages,\n    customerNeed,\n    commercialConfirmation,\n    salesOutcome,\n    financialSettlement,\n  });",
)
replace_once(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  const followUp = deriveFollowUpOpportunities({\n    conversationCase,",
    "  const followUp = deriveFollowUpOpportunities({\n    conversationCase: effectiveConversationCase,",
)
replace_once(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "  } else if (salesOutcome.outcome === 'sale_proven') {\n    // Transaction truth outranks a missing text-derived basket. A photo/voice export can leave the\n    // conversation-side basket incomplete while the unique trusted invoice proves the sale.\n    status = 'analyzed';\n  } else if (evidenceCompleteness.overallEvidenceLevel === 'insufficient') {",
    "  } else if (salesOutcome.outcome === 'sale_proven') {\n    // Transaction truth outranks a missing text-derived basket. A photo/voice export can leave the\n    // conversation-side basket incomplete while the unique trusted invoice proves the sale.\n    status = 'analyzed';\n  } else if (operationallySettled) {\n    // Exact invoice-backed payment settlement gives a complete operational closure even when the\n    // chat missed a formal final-summary step. The missing protocol step remains visible in\n    // failureReasons/coaching, but it must not make the commercial journey look open or partial.\n    status = 'analyzed';\n  } else if (evidenceCompleteness.overallEvidenceLevel === 'insufficient') {",
)
replace_once(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "    conversationCase,\n    customerNeed,",
    "    conversationCase: effectiveConversationCase,\n    customerNeed,",
)

# 6) QA/read-model labels: make the new closed-but-unproven state explicit, never render raw codes.
replace_once(
    'src/lib/salesIntelligence/qa/caseIntelligencePresentation.ts',
    "      awaiting_invoice: 'في انتظار الفاتورة',\n      sale_proven: 'بيع مثبت',",
    "      awaiting_invoice: 'في انتظار الفاتورة',\n      financially_settled: 'تمت التسوية المالية — إثبات البيع الرسمي معلق',\n      sale_proven: 'بيع مثبت',",
)
replace_once(
    'src/lib/salesIntelligence/qa/caseIntelligencePresentation.ts',
    "      won: 'تم البيع',\n      open: 'مفتوحة',",
    "      won: 'تم البيع',\n      closed_order_unproven: 'الطلب مغلق ماليًا — البيع الرسمي غير مثبت',\n      open: 'مفتوحة',",
)
replace_once(
    'src/lib/salesIntelligence/qa/caseIntelligencePresentation.ts',
    "      weak_evidence: 'الأدلة غير كافية',\n      covered_by_specific_follow_up: 'مغطاة بمتابعة أدق',",
    "      weak_evidence: 'الأدلة غير كافية',\n      financially_settled: 'الطلب تمت تسويته ماليًا ولا يحتاج متابعة استرداد',\n      covered_by_specific_follow_up: 'مغطاة بمتابعة أدق',",
)
replace_once(
    'src/lib/salesIntelligence/qa/labels.ts',
    "  customer_confirmed: 'تأكيد العميل تم',\n};",
    "  customer_confirmed: 'تأكيد العميل تم',\n  sent_for_fulfillment: 'تم الإرسال للتنفيذ',\n  invoiced: 'تمت الفوترة / التسوية المالية',\n  delivered: 'تم التسليم',\n  lost: 'فرصة ضائعة',\n  cancelled: 'ملغى',\n};",
)

# 7) Conversation-evaluation readiness: financially settled is a completed interaction, not open.
replace_once(
    'src/lib/salesIntelligence/conversationEvaluationClosing.ts',
    "  if(['sale_proven','awaiting_invoice','customer_declined','information_only'].includes(view.journey.currentState)) return true;",
    "  if(['sale_proven','financially_settled','awaiting_invoice','customer_declined','information_only'].includes(view.journey.currentState)) return true;",
)
replace_once(
    'src/lib/salesIntelligence/conversationEvaluationEvidence.ts',
    "        ['sale_proven', 'awaiting_invoice', 'customer_declined', 'information_only'].includes(view.journey.currentState) ||",
    "        ['sale_proven', 'financially_settled', 'awaiting_invoice', 'customer_declined', 'information_only'].includes(view.journey.currentState) ||",
)

# 8) Semantic version: force a real refresh of existing V15 rows.
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "// v15 (2026-10-04): invoice-backed financial settlement closes transfer-paid orders without",
    "// v16 (2026-10-04): settled-order truth alignment. Exact invoice-backed payment settlement now\n// projects consistently as case=invoiced, journey=financially_settled, lostOpportunity=closed_order_unproven,\n// pipeline=analyzed, while Sale/Revenue remain uncounted until canonical Sale Proof is proven.\n// v15 (2026-10-04): invoice-backed financial settlement closes transfer-paid orders without",
)
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "export const PIPELINE_VERSION = 'sales-intelligence-v15';",
    "export const PIPELINE_VERSION = 'sales-intelligence-v16';",
)

# 9) Regression tests — Ibrahim must be financially closed everywhere, never promoted to official revenue.
test_path = 'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts'
replace_once(
    test_path,
    "import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';",
    "import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';\nimport { deriveCommercialJourneyState } from '@/lib/salesIntelligence/commercialJourneyStateMachine';\nimport { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';",
)
insert_before = "  it('closes the order commercially without promoting statistical invoice evidence to proven revenue', () => {"
new_test = """  it('aligns settled-order journey and lost-opportunity truth without calling it a proven sale', () => {\n    const salesOutcome = {\n      caseId: 'case-1',\n      outcome: 'order_confirmed_unproven',\n      saleProofState: 'strongly_supported',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: true,\n      needsHumanReview: false,\n      reasonCodes: ['outcome.financial_settlement_closed_sale_not_proven'],\n    } as any;\n    const settlement = {\n      status: 'settled',\n      primaryMessageIds: ['payment-context', 'amount', 'proof', 'receipt'],\n      confidence: { level: 'strongly_inferred', score: 0.95, ruleIds: ['financial_settlement.exact_invoice_amount'], evidence: [] },\n      needsHumanReview: false,\n    } as any;\n    const customerNeed = {\n      caseId: 'case-1',\n      primaryNeed: 'علبتين لبن',\n      primaryNeedMessageId: 'need-1',\n      products: [{ key: 'لبن', productNameRaw: 'لبن', roles: ['requested', 'final_basket'], alternatives: [], evidenceMessageIds: ['need-1'] }],\n      unlinkedAvailability: [],\n      unlinkedAlternatives: [],\n      objections: [],\n      unresolvedNeed: true,\n      needDeclined: false,\n      needDeclineMessageIds: [],\n      evidenceMessageIds: ['need-1'],\n      confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },\n      needsHumanReview: false,\n      humanReviewReasons: [],\n    } as any;\n    const commercial = {\n      currentState: 'basket_in_progress',\n      summaryPresented: false,\n      customerConfirmed: false,\n      staffConfirmed: false,\n      primaryMessageIds: [],\n    } as any;\n\n    const journey = deriveCommercialJourneyState({\n      caseId: 'case-1',\n      messages: [],\n      customerNeed,\n      commercialConfirmation: commercial,\n      salesOutcome,\n      financialSettlement: settlement,\n    });\n    expect(journey.currentState).toBe('financially_settled');\n    expect(journey.reasonCodes).toContain('journey.financial_settlement_closed_order_sale_proof_pending');\n\n    const lost = deriveLostOpportunity({\n      caseId: 'case-1',\n      messages: [],\n      customerNeed,\n      unavailableDemand: [],\n      commercialConfirmation: commercial,\n      journeyState: journey,\n      salesOutcome,\n    });\n    expect(lost.state).toBe('closed_order_unproven');\n    expect(lost.waitingOn).toBeNull();\n    expect(lost.recoverability).toBe('none');\n    expect(salesOutcome.isSaleCountable).toBe(false);\n    expect(salesOutcome.isRevenueCountable).toBe(false);\n  });\n\n  it('projects Ibrahim exact transfer settlement as invoiced/analyzed/closed without erasing the final-summary coaching gap', () => {\n    const result = runSalesIntelligencePipeline({\n      conversationId: 'ibrahim-v16',\n      rawWhatsAppExportText: RAW,\n      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',\n      customerIdHint: 'cust-3643',\n      customerPhoneHint: '01016891940',\n      customerCodeHint: '3643',\n      customerNameHint: 'ابراهيم الصياد',\n      customerIdentityStatus: 'resolved',\n      branchNameRawHint: 'فرع شكري',\n      legacyMatchedInvoiceId: 'inv-74884',\n      legacyMatchedInvoiceNumber: '74884',\n      resolveInvoiceCandidates: () => [{\n        id: 'inv-74884',\n        invoice_number: '74884',\n        customer_id: 'cust-3643',\n        customer_code: '3643',\n        customer_name: 'ابراهيم الصياد',\n        customer_phone: '01016891940',\n        branch_name: 'فرع شكري',\n        invoice_datetime: '2026-09-27T18:06:00.000Z',\n        close_datetime: '2026-09-28T00:11:00.000Z',\n        net_amount: 778,\n      }],\n    });\n    expect(result.caseAnalyses).toHaveLength(1);\n    const analysis = result.caseAnalyses[0];\n    expect(analysis.financialSettlement?.status).toBe('settled');\n    expect(analysis.salesOutcome.outcome).toBe('order_confirmed_unproven');\n    expect(analysis.salesOutcome.isSaleCountable).toBe(false);\n    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);\n    expect(analysis.conversationCase.status).toBe('invoiced');\n    expect(analysis.status).toBe('analyzed');\n    expect(analysis.journeyState.currentState).toBe('financially_settled');\n    expect(analysis.lostOpportunity.state).toBe('closed_order_unproven');\n    expect(analysis.lostOpportunity.waitingOn).toBeNull();\n    expect(analysis.followUp.decision).toBe('not_needed');\n    expect(analysis.followUp.notNeededReason).toBe('financially_settled');\n    expect(analysis.failureReasons).toContain('final_summary_missing');\n    expect(analysis.needsHumanReview).toBe(false);\n  });\n\n"""
replace_once(test_path, insert_before, new_test + insert_before)

print('V16 settled-order truth alignment applied successfully.')
