import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSalesIntelligenceRuntimeContext,
  pipelineBaseInputFor,
  prepareSalesIntelligenceConversations,
} from '../runtimeContext';
import {
  buildCanonicalProduct,
  countNormalizedNames,
  type RawProductRow,
} from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import {
  buildInvoiceItemEvidenceProvider,
} from '../invoiceItemEvidenceRepository';
import {
  resolveExclusiveInvoiceClaims,
  mergeDeniedInvoiceMaps,
} from '../invoiceClaimResolution';
import { filterCandidatesToCaseWindow } from '../persistence/batchPersistenceService';
import {
  deriveCasesOnly,
  runSalesIntelligencePipeline,
  segmentationInputFromPipelineInput,
} from '../salesIntelligencePipeline';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import {
  parseWhatsAppExport,
  splitWhatsAppSessions,
} from '@/lib/whatsappConversationParser';
import {
  GOLDEN_CASE_1_INVOICES,
  GOLDEN_CASE_1_INVOICE_ITEMS,
} from './fixtures/goldenCase1/invoices';

const SOURCE_FILE_NAME = 'محمد الجندي 5179.zip';
const SOURCE_URL = new URL('./fixtures/goldenCase1/chat.txt', import.meta.url);
const RAW = readFileSync(SOURCE_URL, 'utf8');
const CUSTOMER = {
  id: 'golden-customer-5179',
  customer_code: '5179',
  name: 'محمد الجندي2',
  branch: 'فرع شكري',
  is_duplicate: false,
};
const STAFF = [
  { id: 'golden-staff-donia', name: 'د دنيا' },
  { id: 'golden-staff-shibl', name: 'د محمد شبل' },
  { id: 'golden-staff-omar', name: 'د/ عمر' },
  { id: 'golden-staff-wael', name: 'د وائل' },
].map((row) => ({
  ...row,
  branch: null,
  role: 'صيدلاني',
  username: null,
  status: 'active',
  active: true,
  source: 'staff' as const,
}));
const PEDICORT_ROW: RawProductRow = {
  id: '60bf9629-2e60-479f-a811-972da45ae836',
  name: 'PEDICORT FORTE SYRUP 100 ML',
  product_code: '67929',
  normalized_name: 'pedicort forte syrup 100 ml',
  category: null,
  price: null,
  source: 'catalog_import',
};
const PRODUCT_INDEX = buildPharmacyProductIndex([
  buildCanonicalProduct(
    PEDICORT_ROW,
    countNormalizedNames([PEDICORT_ROW]),
    normalizePharmacyText
  ),
]);

function clientReturningCustomer() {
  const result = { data: [CUSTOMER], error: null };
  const builder: any = {
    then: (resolve: (value: typeof result) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const query = new Proxy(builder, {
    get: (target, key) => (key in target ? target[key] : () => query),
  });
  return { from: () => query };
}

async function replay() {
  const messages = parseWhatsAppExport(RAW);
  const sourceHint = extractCustomerHintFromExportFileName(SOURCE_FILE_NAME);
  const canonicalSegmentation = segmentWhatsAppExportCanonical(messages, SOURCE_FILE_NAME);
  const context = buildSalesIntelligenceRuntimeContext({
    staffDirectory: STAFF,
    productIndex: PRODUCT_INDEX,
  });
  const [prepared] = await prepareSalesIntelligenceConversations(
    clientReturningCustomer(),
    [
      {
        conversationId: 'golden-case-1',
        rawWhatsAppExportText: RAW,
        customerCodeHint: sourceHint.codeHint,
        customerNameHint: CUSTOMER.name,
        branchNameRawHint: CUSTOMER.branch,
      },
    ],
    context
  );
  const base = pipelineBaseInputFor(prepared, context);
  const segmentation = deriveCasesOnly(segmentationInputFromPipelineInput(base));
  const deniedInvoiceIdsByCase = new Map<string, Set<string>>();
  const itemEvidenceProvider = buildInvoiceItemEvidenceProvider(
    GOLDEN_CASE_1_INVOICES,
    GOLDEN_CASE_1_INVOICE_ITEMS
  );

  const runPass = (competingSelections: Array<{ caseId: string; invoiceId: string }> = []) =>
    runSalesIntelligencePipeline({
      ...base,
      competingSelections,
      resolveInvoiceCandidates: (candidateContext) => {
        const denied = deniedInvoiceIdsByCase.get(candidateContext.caseId);
        const candidates = filterCandidatesToCaseWindow(
          GOLDEN_CASE_1_INVOICES,
          candidateContext
        );
        return denied?.size
          ? candidates.filter((candidate) => !denied.has(String(candidate.id)))
          : candidates;
      },
      itemEvidenceProvider,
    }).caseAnalyses;

  let analyses = runPass();
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const resolution = resolveExclusiveInvoiceClaims(analyses);
    const addedDenials = mergeDeniedInvoiceMaps(
      deniedInvoiceIdsByCase,
      resolution.deniedInvoiceIdsByCase
    );
    if (addedDenials === 0) break;
    analyses = runPass();
  }
  const finalResolution = resolveExclusiveInvoiceClaims(analyses);
  analyses = runPass(finalResolution.unresolvedCompetingSelections);

  const imageReferenceIndex = messages.findIndex((message) => message.text.trim() === 'ودا');
  const imageReference = messages[imageReferenceIndex];
  const previousHumanMessage = messages
    .slice(0, imageReferenceIndex)
    .filter((message) => message.direction !== 'system')
    .at(-1);
  const summary = analyses.map((analysis) => {
    const activeItems = analysis.activeBasket
      ? analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? []
      : [];
    return {
      caseId: analysis.caseId,
      selectedInvoiceId: analysis.attribution.selectedInvoiceId,
      selectedInvoiceNumber: analysis.attribution.selectedInvoiceNumber,
      candidates: analysis.invoiceCandidateIds,
      customerProducts: analysis.customerNeed.products.map((product) => ({
        productCode: product.productCode,
        canonicalName: product.canonicalName,
        requestedQuantity: product.requestedQuantity,
        finalQuantity: product.finalQuantity,
        evidenceMessageIds: product.evidenceMessageIds,
      })),
      activeItems: activeItems.map((item) => ({
        productCode: item.productCode,
        canonicalName: item.canonicalName,
        quantity: item.quantity,
      })),
      staff: analysis.caseIntelligence.staff.participants.map((participant) => ({
        sender: participant.sender,
        staffId: participant.staffId,
      })),
      selectedCandidate: analysis.attribution.selectedCandidate
        ? {
            staffMatch: analysis.attribution.selectedCandidate.staffMatch,
            productMatch: analysis.attribution.selectedCandidate.productMatch,
            quantityMatch: analysis.attribution.selectedCandidate.quantityMatch,
            directInvoiceLink: analysis.attribution.selectedCandidate.directInvoiceLink,
            ruleIds: analysis.attribution.selectedCandidate.ruleIds,
          }
        : null,
      saleProofState: analysis.salesOutcome.saleProofState,
      outcome: analysis.salesOutcome.outcome,
      isSaleCountable: analysis.salesOutcome.isSaleCountable,
      isRevenueCountable: analysis.salesOutcome.isRevenueCountable,
      isOrderConfirmed: analysis.salesOutcome.isOrderConfirmed,
      needsHumanReview: analysis.needsHumanReview,
    };
  });

  return {
    messages,
    sourceHint,
    canonicalSegmentation,
    prepared,
    segmentation,
    analyses,
    finalResolution,
    imageReference,
    previousHumanMessage,
    summary,
  };
}

describe('Golden Case #1 real-source regression', () => {
  it('replays canonical identity, segmentation, product, attribution and sale outcome deterministically', async () => {
    const first = await replay();
    const second = await replay();

    expect(first.sourceHint.codeHint).toBe('5179');
    expect(first.prepared.customerIdentityStatus).toBe('resolved');
    expect(first.prepared.customerIdHint).toBe(CUSTOMER.id);
    expect(first.prepared.customerNameHint).toBe('محمد الجندي2');
    expect(first.prepared.branchNameRawHint).toBe('فرع شكري');
    expect(first.messages).toHaveLength(68);
    expect(splitWhatsAppSessions(first.messages)).toHaveLength(3);
    expect(first.canonicalSegmentation.caseContexts.contexts).toHaveLength(2);
    expect(first.segmentation.cases).toHaveLength(5);
    expect(first.analyses).toHaveLength(5);

    const segment3 = first.analyses[2];
    const segment4 = first.analyses[3];
    const segment5 = first.analyses[4];

    expect(segment3.attribution.selectedInvoiceNumber).toBeNull();
    expect(segment4.attribution.selectedInvoiceNumber).toBe('74947');
    expect(segment5.attribution.selectedInvoiceNumber).toBe('74956');

    expect(
      segment4.caseIntelligence.staff.participants.find(
        (participant) => participant.sender === 'You'
      )?.staffId
    ).toBe('golden-staff-wael');
    expect(segment4.attribution.selectedCandidate?.staffMatch).toBe('same');
    expect(segment4.attribution.selectedCandidate?.productMatch).toBe('available_match');
    expect(segment4.attribution.selectedCandidate?.ruleIds).toContain(
      'attribution.trusted.automatic_customer_code_name_time_items_unique'
    );
    expect(segment4.attribution.selectedCandidate?.directInvoiceLink).toBe(true);
    expect(segment4.customerNeed.products).toContainEqual(
      expect.objectContaining({
        productCode: '67929',
        canonicalName: 'PEDICORT FORTE SYRUP 100 ML',
        requestedQuantity: null,
        finalQuantity: null,
      })
    );
    expect(
      (segment4.activeBasket
        ? segment4.itemsByBasketId[segment4.activeBasket.basketId] ?? []
        : [])
        .filter((item) => item.productCode === '67929')
    ).toEqual([expect.objectContaining({ quantity: null })]);
    expect(segment4.salesOutcome.saleProofState).toBe('proven');
    expect(segment4.salesOutcome.outcome).toBe('needs_review');
    expect(segment4.salesOutcome.isSaleCountable).toBe(false);
    expect(segment4.salesOutcome.isRevenueCountable).toBe(false);
    expect(segment4.salesOutcome.isOrderConfirmed).toBe(false);
    expect(
      segment4.salesOutcome.outcome === 'sale_proven' &&
        segment4.salesOutcome.isSaleCountable
        ? 1
        : 0
    ).toBe(0);

    expect(
      segment5.customerNeed.products.some((product) => product.productCode === '67929')
    ).toBe(false);
    expect(
      (segment5.activeBasket
        ? segment5.itemsByBasketId[segment5.activeBasket.basketId] ?? []
        : [])
        .some((item) => item.productCode === '67929')
    ).toBe(false);

    expect(first.imageReference.text.trim()).toBe('ودا');
    expect(first.previousHumanMessage?.kind).toBe('image');
    expect(segment4.needsHumanReview).toBe(true);
    const imageBoundProducts = segment4.customerNeed.products.filter((product) =>
      product.evidenceMessageIds.includes(first.imageReference.id)
    );
    expect(
      imageBoundProducts.every(
        (product) =>
          product.productId === null &&
          product.productCode === null &&
          product.canonicalName === null
      )
    ).toBe(true);

    const finalOwners = new Map<string, string[]>();
    for (const analysis of first.analyses) {
      const invoiceId = analysis.attribution.selectedInvoiceId;
      if (!invoiceId) continue;
      const owners = finalOwners.get(invoiceId) ?? [];
      owners.push(analysis.caseId);
      finalOwners.set(invoiceId, owners);
    }
    expect([...finalOwners.values()].every((owners) => owners.length === 1)).toBe(true);
    expect(first.finalResolution.unresolvedCompetingSelections).toEqual([]);
    expect(finalOwners.get(String(segment4.attribution.selectedInvoiceId))).toEqual([
      segment4.caseId,
    ]);
    expect(finalOwners.get(String(segment5.attribution.selectedInvoiceId))).toEqual([
      segment5.caseId,
    ]);

    expect(second.summary).toEqual(first.summary);
  });
});
