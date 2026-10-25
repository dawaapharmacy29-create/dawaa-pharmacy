import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';

const CATALOG_ROWS: RawProductRow[] = [
  { id: '6fb1480c-936b-452b-9c42-8d364782e2af', name: 'GAST-REG 100MG 30 TAB', product_code: '58009', normalized_name: 'gast reg 100mg 30 tab', category: null, price: 72, source: 'catalog_import' },
  { id: '0b7a430f-7023-4d79-846f-128ea4c1fec2', name: 'GAST-REG 200 MG 20 TAB', product_code: '21304', normalized_name: 'gast reg 200 mg 20 tab', category: null, price: 14.4, source: 'catalog_import' },
  { id: '48b9373a-5a06-4fba-8fc8-de159e21894b', name: 'GAST-REG 200 MG 30 TAB', product_code: '57353', normalized_name: 'gast reg 200 mg 30 tab', category: null, price: 84, source: 'catalog_import' },
  { id: '65ccef56-825a-4c31-93c8-a3bdaffd0488', name: 'GAST-REG 50MG 3AMP', product_code: '40049', normalized_name: 'gast reg 50mg 3amp', category: null, price: 33, source: 'catalog_import' },
  { id: '334d0058-8daf-4dbd-ab1a-83cb8d1966af', name: 'GAST-REG SYRUP', product_code: '4620', normalized_name: 'gast reg syrup', category: null, price: 33, source: 'catalog_import' },
];
const counts = countNormalizedNames(CATALOG_ROWS);
const INDEX = buildPharmacyProductIndex(
  CATALOG_ROWS.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText))
);



const PRODUCT = '65ccef56-825a-4c31-93c8-a3bdaffd0488';
const STAFF = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
type Turn = [speaker: 'customer' | 'staff' | 'staff2', text: string];
function analyze(turns: Turn[], resolved = true) {
 const raw = turns.map(([role,text],i)=>`10/18/2026, 1:${String(i).padStart(2,'0')} AM - ${role==='staff'?'د سارة':role==='staff2'?'د مريم':'العميل'}: ${text}`).join('\n');
 const run = runSalesIntelligencePipeline({conversationId:'synthetic-semantic-matrix',rawWhatsAppExportText:raw, customerIdHint:resolved?CUSTOMER:null,customerIdentityStatus:resolved?'resolved':'unresolved',branchNameRawHint:'فرع شكري',staffIdBySender:{'د سارة':STAFF,'د مريم':'00000000-0000-4000-8000-000000000003'},resolveInvoiceCandidates:()=>[],productIndex:INDEX});
 expect(run.caseAnalyses).toHaveLength(1);
 return run.caseAnalyses[0];
}
const need: Turn = ['customer','محتاج علبة جاست ريج 50 مج 3 أمبول'];
const unavailable: Turn = ['staff','مع حضرتك د سارة من فرع شكري. جاست ريج 50 مج 3 أمبول غير متوفر حاليًا'];
const active = (a: ReturnType<typeof analyze>)=>a.followUp.opportunities.filter(o=>o.status==='actionable');

describe('synthetic canonical decision matrix — no database writes',()=>{
 it('resolves the requested dosage form without confusing tablets and ampoules',()=>{
  const a=analyze([need,['staff','هراجع لحضرتك التوفر']]);
  expect(a.customerNeed.products.map(p=>p.productId)).toEqual([PRODUCT]);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
 });
 it('does not turn quantity-only wording into a second product',()=>{
  const a=analyze([need,unavailable,['customer','سجلي طلب توفير جاست ريج أمبول علبة واحدة، ولما يتوفر عرفيني. مش عايز بديل.']]);
  expect(a.customerNeed.products).toHaveLength(1);
  expect(a.customerNeed.products[0].requestedQuantity).toBe(1);
 });
 it('does not classify refusing a substitute as rejecting the original product',()=>{
  const a=analyze([need,unavailable,['customer','مش عايز بديل، هستنى جاست ريج']]);
  expect(a.customerNeed.objections.some(o=>o.category==='product_fit')).toBe(false);
  expect(a.customerNeed.needDeclined).toBe(false);
 });
 it('keeps a real product-fit objection',()=>{
  const a=analyze([need,['staff','موجود'],['customer','جاست ريج مش مناسب ليا']]);
  expect(a.customerNeed.objections.some(o=>o.category==='product_fit')).toBe(true);
 });
 it('does not qualify a pending stock check as confirmed shortage',()=>{
  const a=analyze([need,['staff','هراجع لحضرتك التوفر']]);
  expect(a.customerRequestAssessment?.requests.some(r=>r.status==='qualified')).toBe(false);
  expect(active(a).some(o=>o.reason==='stock_check_pending')).toBe(true);
 });
 it('qualifies an explicitly named unavailable product with a resolved customer and branch',()=>{
  const a=analyze([need,unavailable,['customer','لما يتوفر عرفيني']]);
  expect(a.customerRequestAssessment?.requests.some(r=>r.status==='qualified' && r.productId===PRODUCT)).toBe(true);
 });
 it('does not qualify a request when the customer identity is unresolved',()=>{
  const a=analyze([need,unavailable,['customer','لما يتوفر عرفيني']],false);
  expect(a.customerRequestAssessment?.requests.some(r=>r.status==='qualified')).toBe(false);
  expect(a.followUp.opportunities.some(o=>o.status==='blocked')).toBe(true);
 });
 it('final cancellation suppresses commercial follow-up',()=>{
  const a=analyze([need,unavailable,['customer','خلاص الغي الطلب مش محتاجه']]);
  expect(a.customerNeed.needDeclined).toBe(true);
  expect(active(a)).toHaveLength(0);
 });
 it('a customer waiting for stock still has an actionable follow-up',()=>{
  const a=analyze([need,unavailable,['customer','هستنى لما يتوفر بلغيني']]);
  expect(active(a).some(o=>o.reason==='customer_asked_to_wait')).toBe(true);
 });
 it('an apology is a recovery attempt, not complaint resolution',()=>{
  const a=analyze([need,['customer','عندي شكوى محدش رد عليا على طلبي'],['staff','بنعتذر لحضرتك هراجع المشكلة'],['customer','لسه مستني الحل']]);
  expect(a.complaintAssessment?.state).toBe('recovery_attempted');
  expect(a.complaintAssessment?.resolutionMessageIds).toHaveLength(0);
 });
 it('a complaint without staff reply remains unresolved',()=>{
  const a=analyze([need,['customer','عندي شكوى الاوردر متأخر ومحدش بيرد']]);
  expect(a.complaintAssessment?.state).toBe('unresolved');
 });
 it('a thank-you is not a sale or invoice',()=>{
  const a=analyze([need,['staff','هراجع التوفر'],['customer','شكرا']]);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('order confirmation without invoice proof never counts revenue',()=>{
  const a=analyze([need,['staff','متوفر والسعر 33 جنيه'],['customer','تمام ابعتلي العلبة'],['staff','جاري الارسال']]);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('exact retry preserves product, request and follow-up identities',()=>{
  const turns:Turn[]=[need,unavailable,['customer','لما يتوفر عرفيني']];
  const a=analyze(turns),b=analyze(turns);
  expect(b.customerNeed.products).toEqual(a.customerNeed.products);
  expect(b.customerRequestAssessment).toEqual(a.customerRequestAssessment);
  expect(b.followUp).toEqual(a.followUp);
 });
 it('does not invent employee attribution for a customer-only request',()=>{
  const a=analyze([need]);
  expect(a.followUp.opportunities.every(o=>o.assignedStaffId===null)).toBe(true);
 });
 it('retains an explicit timed staff promise despite an unrelated later reply',()=>{
  const a=analyze([need,unavailable,['customer','لما يتوفر عرفيني'],['staff','هتابع مع حضرتك اليوم الساعة 10 صباحًا بنتيجة التوفير'],['customer','عندي شكوى من تأخير الرد'],['staff','بنعتذر لحضرتك']]);
  expect(active(a).some(o=>o.assignedStaffId===STAFF && o.dueAt==='2026-10-18T07:00:00.000Z')).toBe(true);
 });
 it('resolves an explicit tomorrow afternoon promise in Cairo time',()=>{
  const a=analyze([need,['staff','هكلم حضرتك بكرة الساعة 4 مساءً']]);
  expect(active(a).some(o=>o.assignedStaffId===STAFF && o.dueAt==='2026-10-19T13:00:00.000Z')).toBe(true);
 });
 it('does not guess AM/PM for an ambiguous promised hour',()=>{
  const a=analyze([need,['staff','هتابع مع حضرتك الساعة 10']]);
  expect(active(a).every(o=>o.duePolicy!=='customer_requested_time' || o.dueAt===null)).toBe(true);
 });
 it('a negated promise does not establish a timed callback',()=>{
  const a=analyze([need,['staff','مش هتابع مع حضرتك اليوم الساعة 10 صباحًا']]);
  expect(active(a).some(o=>o.reason==='staff_promised_check')).toBe(false);
 });
 it('keeps two genuinely different dosage forms separate',()=>{
  const a=analyze([['customer','محتاج علبة جاست ريج 50 مج 3 أمبول و علبة جاست ريج 100 مج 30 قرص'],['staff','هراجع التوفر']]);
  expect(new Set(a.customerNeed.products.map(p=>p.productId)).size).toBe(2);
 });
 it('price questions alone do not prove a purchase or revenue',()=>{
  const a=analyze([['customer','جاست ريج أمبول بكام؟'],['staff','33 جنيه']]);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('customer correction does not create a new follow-up operation identity',()=>{
  const turns:Turn[]=[need,unavailable,['customer','لما يتوفر عرفيني']];
  const a=analyze(turns,true), b=analyze(turns,false);
  expect(a.followUp.opportunities.map(o=>o.followUpKey)).toEqual(b.followUp.opportunities.map(o=>o.followUpKey));
 });

 it('preserves confirmed shortage while staff checks another stock source',()=>{
  const a=analyze([need,unavailable,['customer','سجلي طلب توفير جاست ريج أمبول علبة واحدة، ولما يتوفر عرفيني. مش عايز بديل.'],['staff','هراجع المخزن وهتابع مع حضرتك اليوم الساعة 10 صباحًا بنتيجة التوفير'],['customer','عندي شكوى من تأخير الرد على طلبي السابق'],['staff','بنعتذر لحضرتك هراجع المشكلة'],['customer','المشكلة لسه ما اتحلتش، هستنى التوفير والمتابعة']]);
  expect(a.customerNeed.products).toHaveLength(1);
  expect(a.customerNeed.products[0].availability).toBe('unavailable');
  expect(a.customerRequestAssessment?.decision).toBe('qualified');
  expect(a.complaintAssessment?.state).toBe('recovery_attempted');
  expect(active(a).some(o=>o.assignedStaffId===STAFF && o.dueAt==='2026-10-18T07:00:00.000Z')).toBe(true);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('a later explicit stock result replaces the earlier shortage',()=>{
  const a=analyze([need,unavailable,['customer','لما يتوفر عرفيني'],['staff','جاست ريج 50 مج 3 أمبول متوفر حاليًا']]);
  expect(a.customerNeed.products[0].availability).toBe('available');
  expect(a.customerRequestAssessment?.requests.some(r=>r.status==='qualified')).toBe(false);
 });
 it('matches shortened staff wording via a unique strong catalog identity',()=>{
  const a=analyze([['customer','محتاج علبة جاست ريج 50 مج 3 أمبول من فرع شكري.'],['staff','جاست ريج أمبول غير متوفر عندنا حاليًا.'],['customer','لما يتوفر عرفيني']]);
  expect(a.customerNeed.products[0].availabilityEvidence[0].linkBasis).toBe('product_named_in_message');
  expect(a.customerRequestAssessment?.requests.some(r=>r.status==='qualified')).toBe(true);
 });
 it('keeps the promised callback with its actual author after another employee replies',()=>{
  const a=analyze([need,['staff','هكلم حضرتك اليوم الساعة 10 صباحًا'],['staff2','تحت أمر حضرتك']]);
  expect(active(a).some(o=>o.assignedStaffId===STAFF && o.dueAt==='2026-10-18T07:00:00.000Z')).toBe(true);
 });
 it('explicit completion can close the scheduled callback',()=>{
  const a=analyze([need,['staff','هكلم حضرتك اليوم الساعة 10 صباحًا'],['staff','تم التواصل مع حضرتك وبلغت حضرتك بالنتيجة']]);
  expect(active(a).some(o=>o.reason==='staff_promised_check')).toBe(false);
 });
 it('Arabic clock digits and noon resolve without machine timezone assumptions',()=>{
  const a=analyze([need,['staff','هكلم حضرتك اليوم الساعة ١٢ مساءً']]);
  expect(active(a).some(o=>o.dueAt==='2026-10-18T09:00:00.000Z')).toBe(true);
 });
 it('invalid clock readings never establish an exact appointment',()=>{
  const a=analyze([need,['staff','هتابع مع حضرتك اليوم الساعة 25 صباحًا']]);
  expect(active(a).every(o=>o.duePolicy!=='customer_requested_time')).toBe(true);
 });
 it('a catalog code remains a product identifier rather than a quantity word',()=>{
  const a=analyze([['customer','40049'],['staff','هراجع التوفر']]);
  expect(a.customerNeed.products.some(p=>p.productId===PRODUCT)).toBe(true);
 });
 it('does not turn an unavailable photo into invoice-backed revenue',()=>{
  const a=analyze([['customer','<Media omitted>'],['staff','هراجع الصورة']]);
  expect(a.salesOutcome.isSaleCountable).toBe(false);
  expect(a.salesOutcome.isRevenueCountable).toBe(false);
 });
 it('a complaint is resolved only when closure evidence actually appears',()=>{
  const a=analyze([need,['customer','عندي شكوى الاوردر اتأخر'],['staff','بنعتذر لحضرتك تابعنا مع المندوب'],['customer','تمام المشكلة اتحلت شكرًا']]);
  expect(a.complaintAssessment?.state).toBe('resolved');
  expect(a.complaintAssessment?.resolutionMessageIds.length).toBeGreaterThan(0);
 });

 it('a corrected explicit appointment replaces the earlier time without a duplicate obligation',()=>{
  const a=analyze([need,['staff','هكلم حضرتك اليوم الساعة 10 صباحًا'],['staff','تصحيح الموعد هكلم حضرتك اليوم الساعة 11 صباحًا']]);
  const callbacks=active(a).filter(o=>o.reason==='staff_promised_check');
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0].dueAt).toBe('2026-10-18T08:00:00.000Z');
 });

});
