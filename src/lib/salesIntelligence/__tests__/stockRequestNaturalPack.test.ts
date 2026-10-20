import {describe,expect,it} from 'vitest';
import {runSalesIntelligencePipeline} from '../salesIntelligencePipeline';
import {buildCanonicalProduct,countNormalizedNames} from '../pharmacyProducts/canonicalProduct';
import {buildPharmacyProductIndex,resolveProductMention} from '../pharmacyProducts/pharmacyProductResolverV2';
import {normalizePharmacyText} from '../pharmacyProducts/pharmacyNormalization';
import {classifyCustomerTimingRequestV32} from '../../whatsappSemanticSignalsV32';
const rows=[
 {id:'11111111-1111-4111-8111-111111111111',name:'CATAFLAM 50MG 20TAB',product_code:'101'},
 {id:'22222222-2222-4222-8222-222222222222',name:'CATAFLAM 25MG 20TAB',product_code:'102'},
 {id:'33333333-3333-4333-8333-333333333333',name:'CATAFLAM 3AMP',product_code:'103'},
].map(row=>({...row,normalized_name:row.name.toLowerCase(),category:null,price:null,source:'synthetic'}));
const counts=countNormalizedNames(rows);
const index=buildPharmacyProductIndex(rows.map(row=>buildCanonicalProduct(row,counts,normalizePharmacyText)));
const trialText=`[10/20/26, 5:00:00 AM] Customer: السلام عليكم، عندكم كاتفلام 50 مجم أقراص؟ عايز علبة واحدة 20 قرص.
[10/20/26, 5:00:30 AM] You: كتافلام 50 مجم 20 قرص غير متوفر حاليًا.
[10/20/26, 5:01:00 AM] Customer: تمام، سجل لي طلب علبة واحدة كاتفلام 50 مجم أقراص، وكلمني أول ما يتوفر. مش عايز بديل دلوقتي.
[10/20/26, 5:01:30 AM] You: هنراجع طلب توفير كتافلام 50 مجم أقراص ونتواصل أول ما يتوفر.
[10/20/26, 5:02:00 AM] Customer: شكرًا، هنتظر تواصلكم.`;
describe('natural pack stock request',()=>{
 it('keeps one named pack and one stock-triggered contact without a generic callback',()=>{
  const out=runSalesIntelligencePipeline({conversationId:'synthetic-stock',rawWhatsAppExportText:trialText,customerIdHint:'44444444-4444-4444-8444-444444444444',customerIdentityStatus:'resolved',branchNameRawHint:'فرع شكري',productIndex:index,resolveInvoiceCandidates:()=>[]});
  const a=out.caseAnalyses[0];
  expect(a.customerNeed.products).toHaveLength(1);
  expect(a.customerNeed.products[0]).toMatchObject({productId:rows[0].id,requestedQuantity:1,availability:'unavailable'});
  expect(a.customerNeed.products[0].roles).not.toContain('alternative');
  expect(a.customerNeed.needDeclined).toBe(false);
  expect(a.customerRequestAssessment?.decision).toBe('qualified');
  expect(a.customerRequestAssessment?.requests.filter(r=>r.status==='qualified')).toHaveLength(1);
  expect(a.followUp.opportunities.filter(o=>o.status==='actionable')).toHaveLength(1);
  expect(a.followUp.opportunities[0]).toMatchObject({duePolicy:'when_in_stock',productId:rows[0].id});
  expect(a.salesOutcome.isSaleCountable).toBe(false);
 });
 it.each([
  ['عايز علبة واحدة.',1],['محتاج علبتين.',2],['محتاج علبتين 20 قرص.',2],
 ])('takes the product from the availability question when the quantity phrase names none: %s',(tail,qty)=>{
  const text=trialText.replace('عايز علبة واحدة 20 قرص.',String(tail)).replace('سجل لي طلب علبة واحدة','سجل لي طلب');
  const a=runSalesIntelligencePipeline({conversationId:'synthetic-tail',rawWhatsAppExportText:text,customerIdHint:'44444444-4444-4444-8444-444444444444',customerIdentityStatus:'resolved',branchNameRawHint:'فرع شكري',productIndex:index,resolveInvoiceCandidates:()=>[]}).caseAnalyses[0];
  expect(a.customerNeed.products).toHaveLength(1);
  expect(a.customerNeed.products[0]).toMatchObject({productId:rows[0].id,requestedQuantity:qty,availability:'unavailable'});
  expect(a.customerRequestAssessment?.requests.filter(r=>r.status==='qualified')).toHaveLength(1);
  expect(a.followUp.opportunities.filter(o=>o.status==='actionable')).toHaveLength(1);
 });
 it('never invents a product from a bare quantity without an availability question',()=>{
  const text='[10/20/26, 5:00:00 AM] Customer: محتاج علبتين.\n[10/20/26, 5:00:30 AM] You: من أي صنف؟';
  const a=runSalesIntelligencePipeline({conversationId:'synthetic-bare',rawWhatsAppExportText:text,customerIdHint:'44444444-4444-4444-8444-444444444444',customerIdentityStatus:'resolved',branchNameRawHint:'فرع شكري',productIndex:index,resolveInvoiceCandidates:()=>[]}).caseAnalyses[0];
  expect(a.customerNeed.products.filter(p=>p.productId)).toHaveLength(0);
 });
 it.each(['كلمني أول ما يتوفر','اتصل بيا اول ما الصنف يتوفر'])('preserves stock timing: %s',text=>expect(classifyCustomerTimingRequestV32(text)?.when).toBe('when_in_stock'));
 it('does not confuse an activity ending with stock arrival',()=>expect(classifyCustomerTimingRequestV32('كلمني أول ما اخلص الاجتماع')?.when).not.toBe('when_in_stock'));
 it.each(['كاتفلام 25 مجم أقراص','كتافلام 25 مجم أقراص'])('keeps strength discrimination: %s',phrase=>expect(resolveProductMention(phrase,index).selected?.product.productId).toBe(rows[1].id));
 it('does not resolve a bare brand to a guessed strength',()=>expect(resolveProductMention('كتافلام',index).ambiguous).toBe(true));
});
