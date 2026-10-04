from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor not unique in {path}: count={text.count(old)}')
    p.write_text(text.replace(old, new), encoding='utf-8')


replace_exact(
    'src/lib/salesIntelligence/financialSettlementEngine.ts',
    "    if (amountMatch === 'near_match') ruleIds.push('financial_settlement.near_amount_requires_review');\n    if (amountMatch === 'not_available') ruleIds.push('financial_settlement.amount_not_reconciled');",
    "    if (amountMatch === 'near_match') {\n      needsHumanReview = true;\n      ruleIds.push('financial_settlement.near_amount_requires_review');\n    }\n    // A real announced-vs-invoice mismatch is financially material even when the proof/receipt\n    // sequence is still incomplete. Keep it pending (not contradicted until the full sequence\n    // exists), but never let the discrepancy pass without human review.\n    if (amountMatch === 'different' && attributionStrong) {\n      needsHumanReview = true;\n      ruleIds.push('financial_settlement.payment_amount_conflicts_with_selected_invoice');\n    }\n    if (amountMatch === 'not_available') ruleIds.push('financial_settlement.amount_not_reconciled');"
)

replace_exact(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "    rawAttribution.needsHumanReview ||\n    basketInvoiceMatch.needsHumanReview ||\n    (!isGenuinelyInformationOnly && integrityAssessment.needsHumanReview) ||",
    "    rawAttribution.needsHumanReview ||\n    basketInvoiceMatch.needsHumanReview ||\n    financialSettlement.needsHumanReview ||\n    (!isGenuinelyInformationOnly && integrityAssessment.needsHumanReview) ||"
)

replace_exact(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "      ...rawAttribution.humanReviewReasons,\n      ...basketInvoiceMatch.humanReviewReasons,\n      ...(isGenuinelyInformationOnly ? [] : integrityAssessment.humanReviewReasons),",
    "      ...rawAttribution.humanReviewReasons,\n      ...basketInvoiceMatch.humanReviewReasons,\n      ...(financialSettlement.needsHumanReview ? financialSettlement.ruleIds : []),\n      ...(isGenuinelyInformationOnly ? [] : integrityAssessment.humanReviewReasons),"
)

replace_exact(
    'src/lib/salesIntelligence/qa/labels.ts',
    "  final_total_missing: 'لم يُعلن الموظف إجمالي حساب صريح (دلالة إجرائية فقط)',\n  staff_final_confirmation_missing: 'لا يوجد تأكيد نهائي موثّق من الموظف (دلالة إجرائية فقط)',",
    "  final_total_missing: 'لم يُعلن الموظف إجمالي حساب صريح (دلالة إجرائية فقط)',\n  'financial_settlement.payment_amount_conflicts_with_selected_invoice': 'مبلغ التسوية لا يطابق قيمة الفاتورة المختارة — يحتاج مراجعة مالية',\n  'financial_settlement.near_amount_requires_review': 'مبلغ التسوية قريب من قيمة الفاتورة لكنه غير مطابق تمامًا — يحتاج مراجعة مالية',\n  'financial_settlement.customer_identity_not_resolved': 'هوية العميل غير محسومة بما يكفي لاعتماد التسوية المالية',\n  staff_final_confirmation_missing: 'لا يوجد تأكيد نهائي موثّق من الموظف (دلالة إجرائية فقط)',"
)

replace_exact(
    'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts',
    "import { deriveSegmentedCases } from '@/lib/salesIntelligence/salesIntelligencePipeline';",
    "import { deriveSegmentedCases, runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';"
)

anchor = """  it('does not treat payment-continuation messages as multiple independent customer requests', () => {\n"""
insert = """  it('requires human review for a near payment/invoice amount match instead of auto-closing it', () => {\n    const messages = parseWhatsAppExport(RAW).map((m: any) => ({ id: m.id, sender: m.sender, role: m.sender === 'You' ? 'staff' : 'customer', text: m.text, timestamp: m.timestamp, isMeaningful: !/image omitted/i.test(m.text) }));\n    const result = deriveFinancialSettlementAssessment({\n      caseId: 'case-1', messages: messages as any, attribution: attribution(),\n      selectedInvoiceRow: { id: 'inv-74884', invoice_number: '74884', net_amount: 779 },\n      customerIdentityStatus: 'resolved',\n    });\n    expect(result.status).toBe('pending');\n    expect(result.amountMatch).toBe('near_match');\n    expect(result.needsHumanReview).toBe(true);\n    expect(result.ruleIds).toContain('financial_settlement.near_amount_requires_review');\n  });\n\n  it('propagates a financial amount contradiction into the case-level review gate', () => {\n    const result = runSalesIntelligencePipeline({\n      conversationId: 'ibrahim-financial-conflict',\n      rawWhatsAppExportText: RAW,\n      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',\n      customerIdHint: 'cust-3643',\n      customerPhoneHint: '01016891940',\n      customerCodeHint: '3643',\n      customerNameHint: 'ابراهيم الصياد',\n      customerIdentityStatus: 'resolved',\n      branchNameRawHint: 'فرع شكري',\n      trustedInvoiceId: 'inv-74884',\n      trustedInvoiceNumber: '74884',\n      resolveInvoiceCandidates: () => [{\n        id: 'inv-74884',\n        invoice_number: '74884',\n        customer_id: 'cust-3643',\n        customer_code: '3643',\n        customer_name: 'ابراهيم الصياد',\n        customer_phone: '01016891940',\n        branch_name: 'فرع شكري',\n        invoice_datetime: '2026-09-27T18:06:00.000Z',\n        close_datetime: '2026-09-28T00:11:00.000Z',\n        net_amount: 700,\n      }],\n    });\n    expect(result.caseAnalyses).toHaveLength(1);\n    const analysis = result.caseAnalyses[0];\n    expect(analysis.financialSettlement?.status).toBe('contradicted');\n    expect(analysis.needsHumanReview).toBe(true);\n    expect(analysis.humanReviewReasons).toContain('financial_settlement.payment_amount_conflicts_with_selected_invoice');\n    expect(analysis.caseIntelligence.review.required).toBe(true);\n  });\n\n"""
replace_exact(
    'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts',
    anchor,
    insert + anchor
)

print('financial governance V15 hardening patch applied')
