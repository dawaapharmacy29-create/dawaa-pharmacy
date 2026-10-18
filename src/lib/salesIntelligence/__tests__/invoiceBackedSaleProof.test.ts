import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
// Anonymized live failure: imported product invoice 173 minutes after the case, no chat total.
const CUSTOMER = '00000000-0000-4000-8000-000000000101';
const PRODUCT = '00000000-0000-4000-8000-000000000102';
const rows: RawProductRow[] = [{id: PRODUCT, name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', product_code: '70271', normalized_name: 'isis teen derm gel sensitive 250ml', category: null, price: 675, source: 'synthetic_regression'}];
const index = buildPharmacyProductIndex(rows.map(row => buildCanonicalProduct(row, countNormalizedNames(rows), normalizePharmacyText)));
const invoice = {id: 'synthetic-invoice', invoice_number: 'SYN-1', customer_id: CUSTOMER, customer_code: '17701', customer_name: 'عميل تجريبي', branch: 'فرع شكري', invoice_datetime: '2026-09-15T22:23:00Z', amount: 675, staff_id: 'invoice-seller'};
function analyze(overrides: Partial<SalesIntelligencePipelineInput> = {}) {
 const result = runSalesIntelligencePipeline({
  conversationId: 'synthetic-invoice-proof', customerIdHint: CUSTOMER, customerCodeHint: '17701', customerNameHint: 'عميل تجريبي', customerIdentityStatus: 'resolved', branchNameRawHint: 'فرع شكري', productIndex: index,
  rawWhatsAppExportText: '[9/15/26, 9:30:55 PM] Customer: Isis teenderm gel for sensitive skin بديل الغسول\n[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم\n[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك؟\n[9/15/26, 9:42:30 PM] Customer: اه ابعته\n[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك\n[9/15/26, 10:28:27 PM] Customer: حضرتك بعت الاوردر\n[9/15/26, 10:30:18 PM] You: المندوب في الطريق لحضرتك',
  resolveInvoiceCandidates: () => [invoice],
  itemEvidenceProvider: {getItemsForInvoice: () => [{productId: PRODUCT, productNameRaw: rows[0].name, quantity: 1, lineTotal: 675}]}, ...overrides,
 });
 expect(result.caseAnalyses).toHaveLength(1);
 return result.caseAnalyses[0];
}
describe('invoice-backed canonical sale proof', () => {
 it('proves the transaction while preserving missing conversation protocol facts', () => {
  const a = analyze();
  expect(a.salesOutcome.saleProofState).toBe('proven');
  expect(a.attribution.selectedInvoiceId).toBe(invoice.id);
  expect(a.salesOutcome.outcome).toBe('sale_proven');
  expect(a.salesOutcome.isRevenueCountable).toBe(true);
  expect(a.commercialConfirmation.announcedTotalPresent).toBe(false);
  expect(a.commercialConfirmation.staffConfirmed).toBe(false);
 });
 it('does not prove two competing matching invoices', () => {
  expect(analyze({resolveInvoiceCandidates: () => [invoice, {...invoice, id: 'another', invoice_number: 'SYN-2'}]}).salesOutcome.saleProofState).not.toBe('proven');
 });
 it.each([
  ['different customer', {customer_id: 'another-customer'}], ['different branch', {branch: 'فرع الشامي'}],
  ['outside bounded window', {invoice_datetime: '2026-09-16T04:00:00Z'}],
  ['before the conversation', {invoice_datetime: '2026-09-15T15:00:00Z'}], ['missing canonical customer', {customer_id: null}],
 ])('does not automatically prove %s', (_, change) => {
  expect(analyze({resolveInvoiceCandidates: () => [{...invoice, ...change}]}).salesOutcome.saleProofState).not.toBe('proven');
 });
 it('does not trust a legacy match without imported lines', () => {
  expect(analyze({legacyMatchedInvoiceId: invoice.id, itemEvidenceProvider: {getItemsForInvoice: () => 'unavailable'}}).salesOutcome.saleProofState).not.toBe('proven');
 });
 it('does not prove a different invoice product', () => {
  expect(analyze({itemEvidenceProvider: {getItemsForInvoice: () => [{productId: 'other', productNameRaw: 'OTHER PRODUCT', quantity: 1, lineTotal: 675}]}}).salesOutcome.saleProofState).not.toBe('proven');
 });
 it('blocks unresolved customer identity', () => {
  expect(analyze({customerIdentityStatus: 'unresolved'}).salesOutcome.isRevenueCountable).toBe(false);
 });
 it('keeps invoice proof separate from staff protocol review', () => {
  const a = analyze();
  expect(a.salesOutcome.isSaleCountable).toBe(true);
  expect(a.humanReviewReasons).toContain('final_total_missing');
  expect(a.caseIntelligence.coachingEvidence.protocolCompliant).toBe(false);
 });
 it('does not prove a known quantity mismatch', () => {
  const a = analyze({rawWhatsAppExportText: '[9/15/26, 9:30:55 PM] Customer: عايز 2 علبة ISIS TEEN DERM GEL SENSITIVE 250ML\n[9/15/26, 9:32:09 PM] You: موجود'});
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('retry preserves canonical invoice identity', () => {
  expect(analyze().attribution.selectedInvoiceId).toBe(analyze().attribution.selectedInvoiceId);
 });
});
