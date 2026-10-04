from pathlib import Path

ROOT = Path('.')

def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, got {count}')
    p.write_text(text.replace(old, new, 1))

def replace_all_count(path, old, new, minimum=1):
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'{path}: expected at least {minimum} occurrences, got {count}')
    p.write_text(text.replace(old, new))

# 1) Preserve the already-resolved review-source staff identity into SI.
replace_once(
    'src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts',
    "  'branch',\n  'matched_invoice_id',",
    "  'branch',\n  'staff_id',\n  'matched_invoice_id',",
)
replace_once(
    'src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts',
    "  branch?: string | null;\n  matched_invoice_id?: string | null;",
    "  branch?: string | null;\n  staff_id?: string | null;\n  matched_invoice_id?: string | null;",
)
replace_once(
    'src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts',
    "    branchNameRawHint: row.branch ?? null,\n    legacyMatchedInvoiceId:",
    "    branchNameRawHint: row.branch ?? null,\n    knownStaffIds: row.staff_id ? [String(row.staff_id)] : [],\n    legacyMatchedInvoiceId:",
)

# 2) Attribution: unresolved basket identity is unavailable evidence, never a negative product verdict.
replace_once(
    'src/lib/salesIntelligence/saleAttributionEngine.ts',
    "  IdentityConflictStatus,\n  ProductEvidenceAvailability,",
    "  IdentityConflictStatus,\n  ItemResolutionStatus,\n  ProductEvidenceAvailability,",
)
replace_once(
    'src/lib/salesIntelligence/saleAttributionEngine.ts',
    "  activeBasketItems: Array<{ productNameRaw: string; productId?: string | null; quantity: number | null }>;",
    "  activeBasketItems: Array<{ productNameRaw: string; productId?: string | null; quantity: number | null; resolutionStatus?: ItemResolutionStatus }>;",
)
old_product = """  const items = provider.getItemsForInvoice(getInvoiceRowId(row), getInvoiceRowNumber(row));
  if (items === 'unavailable' || ctx.activeBasketItems.length === 0) {
    return { productMatch: 'unavailable', quantityMatch: 'unavailable' };
  }

  const sellableItems = items.filter(
"""
new_product = """  const items = provider.getItemsForInvoice(getInvoiceRowId(row), getInvoiceRowNumber(row));
  const resolvableBasketItems = ctx.activeBasketItems.filter(
    (item) => !item.resolutionStatus || item.resolutionStatus === 'proven' || item.resolutionStatus === 'partially_proven'
  );
  // A media/deictic basket item whose identity is still unknown cannot contradict invoice lines.
  // It is an evidence gap: only resolved product identity is eligible for positive/negative item evidence.
  if (items === 'unavailable' || resolvableBasketItems.length === 0) {
    return { productMatch: 'unavailable', quantityMatch: 'unavailable' };
  }

  const sellableItems = items.filter(
"""
replace_once('src/lib/salesIntelligence/saleAttributionEngine.ts', old_product, new_product)
replace_once(
    'src/lib/salesIntelligence/saleAttributionEngine.ts',
    "  const matchedPairs = ctx.activeBasketItems\n    .map((basketItem) => {",
    "  const matchedPairs = resolvableBasketItems\n    .map((basketItem) => {",
)
replace_once(
    'src/lib/salesIntelligence/saleAttributionEngine.ts',
    "      basketItem: { productNameRaw: string; productId?: string | null; quantity: number | null };",
    "      basketItem: { productNameRaw: string; productId?: string | null; quantity: number | null; resolutionStatus?: ItemResolutionStatus };",
)

# 3) Carry resolution status through pipeline and persistence hashes/planning.
replace_once(
    'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
    "      productId: item.productId,\n      quantity: item.quantity,\n    })),",
    "      productId: item.productId,\n      quantity: item.quantity,\n      resolutionStatus: item.resolutionStatus,\n    })),",
)
replace_all_count(
    'src/lib/salesIntelligence/persistence/batchPersistenceService.ts',
    "          productNameRaw: item.productNameRaw,\n          productId: item.productId,\n          quantity: item.quantity,\n        })),",
    "          productNameRaw: item.productNameRaw,\n          productId: item.productId,\n          quantity: item.quantity,\n          resolutionStatus: item.resolutionStatus,\n        })),",
    minimum=2,
)

# 4) Matching: unknown product identity must not manufacture missing/extra contradictions.
old_unknown = """    if (item.resolutionStatus === 'unknown') {
      const candidates = invoiceGroupsByName.get(nameKey) ?? [];
      if (candidates.length === 0) {
        differences.push({
          type: 'missing_item',
          key: item.productNameRaw,
          before: item.quantity,
          after: null,
          explanation: 'none',
          evidence: [amountRef(`صنف بهوية غير محلولة من المحادثة (\"${item.productNameRaw}\") لا يقابله أي بند في الفاتورة.`)],
          confidence: assessment('weakly_inferred', 0.4, ['matching.item.missing.unresolved_identity'], []),
        });
      } else {
        unresolvedCount += 1;
        humanReviewReasons.push('unresolved_product_identity');
      }
      return;
    }
"""
new_unknown = """    if (item.resolutionStatus === 'unknown') {
      // Missing identity (image/voice/deictic reference) is not negative product evidence.
      // We cannot know which invoice line it corresponds to, so fail closed as unavailable/reviewable.
      unresolvedCount += 1;
      humanReviewReasons.push('unresolved_product_identity');
      return;
    }
"""
replace_once('src/lib/salesIntelligence/basketInvoiceMatchingEngine.ts', old_unknown, new_unknown)
replace_once(
    'src/lib/salesIntelligence/basketInvoiceMatchingEngine.ts',
    "  sellableInvoiceItems.forEach((invoiceItem) => {\n    const key = normalizeProductNameForMatch(invoiceItem.productNameRaw);",
    "  // If even one basket identity is unresolved, any unclaimed invoice line may be that hidden\n  // media/voice product. Never manufacture an 'extra item' contradiction from unknowable chat content.\n  if (unresolvedCount === 0) sellableInvoiceItems.forEach((invoiceItem) => {\n    const key = normalizeProductNameForMatch(invoiceItem.productNameRaw);",
)
replace_once(
    'src/lib/salesIntelligence/basketInvoiceMatchingEngine.ts',
    "  });\n\n  const missingCount = differences.filter((d) => d.type === 'missing_item').length;\n  const extraCount = differences.filter((d) => d.type === 'extra_item').length;\n  let itemMatch: FieldMatchStatus;\n  if (missingCount === 0 && extraCount === 0 && ambiguousCount === 0 && unresolvedCount === 0) itemMatch = 'exact';\n  else if (matchedPairs.length === 0) itemMatch = 'mismatch';\n  else itemMatch = 'partial';",
    "  });\n\n  const missingCount = differences.filter((d) => d.type === 'missing_item').length;\n  const extraCount = differences.filter((d) => d.type === 'extra_item').length;\n  let itemMatch: FieldMatchStatus;\n  if (missingCount === 0 && extraCount === 0 && ambiguousCount === 0 && unresolvedCount === 0) itemMatch = 'exact';\n  else if (unresolvedCount > 0 && missingCount === 0 && extraCount === 0 && ambiguousCount === 0 && matchedPairs.length === 0) itemMatch = 'insufficient_data';\n  else if (matchedPairs.length === 0) itemMatch = 'mismatch';\n  else itemMatch = 'partial';",
)

# 5) Version the semantic changes so real refresh cannot no-op on V17.
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "// v17 (2026-10-04): compact announced totals may bridge only short acknowledgement messages",
    "// v18 (2026-10-04): unresolved media/deictic product identity is unavailable evidence, never a\n// manufactured item contradiction; canonical review-source staff_id now reaches SI knownStaffIds.\n// v17 (2026-10-04): compact announced totals may bridge only short acknowledgement messages",
)
replace_once('src/lib/salesIntelligence/persistence/versions.ts', "export const PIPELINE_VERSION = 'sales-intelligence-v17';", "export const PIPELINE_VERSION = 'sales-intelligence-v18';")
replace_once('src/lib/salesIntelligence/persistence/versions.ts', "  attribution: 'attribution-v7-auto-code-name-time-items',", "  attribution: 'attribution-v8-unresolved-product-evidence-safe',")
replace_once('src/lib/salesIntelligence/persistence/versions.ts', "  matching: 'matching-v2-line-item-evidence',", "  matching: 'matching-v3-unresolved-product-evidence-safe',")

# 6) Regression tests: protect both the fail-closed media case and real known-product mismatch.
test_path = ROOT / 'src/lib/__tests__/salesIntelligenceEvidenceAvailability.test.ts'
test_path.write_text(r'''import { describe, expect, it } from 'vitest';
import {
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import { deriveBasketInvoiceMatch } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import { reviewSourceRowToBatchConversation } from '@/lib/salesIntelligence/persistence/reviewSourceBatchAdapter';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const confirmation: CommercialConfirmationAssessment = {
  caseId: 'mohamed-case', basketId: 'basket:1', basketVersion: 1,
  summaryPresented: true, customerConfirmed: true, staffConfirmed: true,
  announcedTotalPresent: true, modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete', primaryMessageIds: [], ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },
  needsHumanReview: false, humanReviewReasons: [],
};

const invoice74720 = {
  id: 'invoice-74720', invoice_number: '74720', customer_id: 'cust-5179',
  customer_code: '5179', customer_name: 'محمد الجندي(P500)', customer_phone: '01012808732',
  branch: 'فرع شكري', invoice_datetime: '2026-09-26T19:03:00.000Z', net_amount: 1579,
};

const provider: InvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => [
    { productNameRaw: 'BEBELAC EC MILK', quantity: 4, lineTotal: 1500 },
    { productNameRaw: 'FLAGYL SUSP', quantity: 1, lineTotal: 26 },
  ],
};

function total1579() {
  return { amount: 1579, currency: 'EGP' as const, messageId: 'total', staffId: null,
    announcedAt: '2026-09-26T18:56:48.000Z', basketVersion: 1, supersededByTotalId: null };
}

function baseCtx(item: CaseAttributionContext['activeBasketItems'][number]): CaseAttributionContext {
  return {
    caseId: 'mohamed-case', customerId: 'cust-5179', customerPhone: '01012808732',
    customerCode: '5179', customerName: 'محمد الجندي', branchNameRaw: 'فرع شكري',
    caseStartedAt: '2026-09-26T18:46:29.000Z', caseEndedAt: '2026-09-26T19:01:12.000Z',
    commercialConfirmation: confirmation, activeAnnouncedTotal: total1579(), activeBasketValue: null,
    activeBasketItems: [item], knownStaffIds: ['staff-donia'], legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null, trustedInvoiceId: null, trustedInvoiceNumber: null,
  };
}

function basket(item: any) {
  return {
    basketId: 'basket:1', caseId: 'mohamed-case', version: 1, status: 'confirmed' as const,
    createdAt: '2026-09-26T18:50:02.000Z', confirmedAt: '2026-09-26T19:01:12.000Z',
    confirmedByCustomerAt: '2026-09-26T18:50:12.000Z', staffId: null, announcedTotal: total1579(),
    sourceMessageIds: [], confidence: { level: 'strongly_inferred' as const, score: 0.9, ruleIds: [], evidence: [] },
    supersededByBasketId: null, item,
  };
}

describe('Sales Intelligence evidence availability hardening', () => {
  it('passes persisted SMART REVIEW staff_id into knownStaffIds', () => {
    const result = reviewSourceRowToBatchConversation({
      id: 'source-1', raw_text: 'x', conversation_started_at: '2026-09-26T18:46:29.000Z',
      customer_id: 'cust-5179', customer_phone: '01012808732', customer_name: 'محمد الجندي',
      customer_code: '5179', branch: 'فرع شكري', staff_id: 'staff-donia',
    });
    expect(result.knownStaffIds).toEqual(['staff-donia']);
  });

  it('treats unresolved media product identity as unavailable evidence, not a product contradiction', () => {
    const unresolved = { productNameRaw: 'عايزه من دا 4', productId: null, quantity: 4, resolutionStatus: 'unknown' as const };
    const attribution = deriveSaleAttributionAssessment(baseCtx(unresolved), [invoice74720], provider);
    expect(attribution.selectedInvoiceNumber).toBe('74720');
    expect(attribution.attributionLevel).toBe('strongly_inferred');
    expect(attribution.selectedCandidate?.productMatch).toBe('unavailable');

    const b = basket(unresolved);
    const match = deriveBasketInvoiceMatch({
      caseId: 'mohamed-case', baskets: [b],
      itemsByBasketId: { 'basket:1': [{
        itemId: 'i1', basketId: 'basket:1', productNameRaw: unresolved.productNameRaw,
        productId: null, quantity: 4, unit: null, unitPrice: null, lineTotal: null,
        sourceMessageId: 'm1', confidence: { level: 'unknown', score: 0.3, ruleIds: [], evidence: [] },
        resolutionStatus: 'unknown',
      }] },
      attribution, invoiceRow: invoice74720, itemEvidenceProvider: provider,
    });
    expect(match.totalMatch).toBe('exact');
    expect(match.itemMatch).toBe('insufficient_data');
    expect(match.quantityMatch).toBe('insufficient_data');
    expect(match.differences.some((d) => d.type === 'missing_item' || d.type === 'extra_item')).toBe(false);
    expect(match.humanReviewReasons).toContain('unresolved_product_identity');
  });

  it('keeps a genuinely resolved but different product as a real mismatch', () => {
    const known = { productNameRaw: 'KNOWN PRODUCT', productId: null, quantity: 1, resolutionStatus: 'proven' as const };
    const attribution = deriveSaleAttributionAssessment(baseCtx(known), [invoice74720], provider);
    expect(attribution.selectedCandidate?.productMatch).toBe('available_mismatch');
    expect(attribution.attributionLevel).toBe('weakly_inferred');

    const b = basket(known);
    const match = deriveBasketInvoiceMatch({
      caseId: 'mohamed-case', baskets: [b],
      itemsByBasketId: { 'basket:1': [{
        itemId: 'i2', basketId: 'basket:1', productNameRaw: known.productNameRaw,
        productId: null, quantity: 1, unit: null, unitPrice: null, lineTotal: null,
        sourceMessageId: 'm2', confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] },
        resolutionStatus: 'proven',
      }] },
      attribution, invoiceRow: invoice74720, itemEvidenceProvider: provider,
    });
    expect(match.itemMatch).toBe('mismatch');
    expect(match.differences.some((d) => d.type === 'missing_item')).toBe(true);
    expect(match.differences.some((d) => d.type === 'extra_item')).toBe(true);
  });
});
''')

replace_once(
    'scripts/run-tests.cjs',
    "  'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts',\n  'src/lib/__tests__/whatsappConversationUnderstandingV32.test.ts',",
    "  'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts',\n  'src/lib/__tests__/salesIntelligenceEvidenceAvailability.test.ts',\n  'src/lib/__tests__/whatsappConversationUnderstandingV32.test.ts',",
)

print('V18 patch applied')
