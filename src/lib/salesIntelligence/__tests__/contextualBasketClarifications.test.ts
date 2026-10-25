import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '../caseBasketEngine';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';

const offer='ممكن ان شاء الله ناخد دواء ألفا اقراص مع دواء بيتا ناخدهم بالتبادل كل ٨ ساعات';
function chat(lines: string[]) { return lines.map((line,i)=>`[10/19/26, 9:${String(i).padStart(2,'0')}:00 AM] ${line}`).join('\n'); }
function basket(lines: string[]) {
 const understanding=buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(chat(lines)),120)[0]);
 const r=buildCaseBaskets('synthetic-context',understanding.messages);
 return {...r,items:r.baskets.length ? r.itemsByBasketId[r.baskets.at(-1)!.basketId] : []};
}
describe('contextual basket clarification',()=>{
 it('adds the two named recommendations only after an explicit plural order, without allocating ambiguous quantity',()=>{
  const r=basket([`You: ${offer}`,'Customer: تمام','Customer: عاوزة منهم شريطين']);
  expect(r.items.map(i=>i.productNameRaw)).toEqual(['دواء ألفا اقراص','دواء بيتا']);
  expect(r.items.map(i=>i.quantity)).toEqual([null,null]);
  expect(r.items.every(i=>i.confidence.evidence.flatMap(e=>e.messageIds??[]).length>=2)).toBe(true);
 });
 it.each(['تمام','لا شكرا','مش عايزة منهم','مش عاوزة منهم شريطين','عايزة اسأل بس'])('does not adopt recommendations from a non-order reply: %s',reply=>{
  expect(basket([`You: ${offer}`,`Customer: ${reply}`]).items).toHaveLength(0);
 });
 it('applies one strip each only when the reply selects a staff-offered quantity option',()=>{
  const r=basket([`You: ${offer}`,'Customer: عاوزة منهم شريطين','Customer: وعاوزة علبة صنف جاما','You: عنيا ان شاء الله شريطين وشريطين ولا شريط وشريط','Customer: شكرا يا دكتور','Customer: شريط وشريط']);
  const pair=r.items.filter(i=>i.productNameRaw.startsWith('دواء'));
  expect(pair.map(i=>i.quantity)).toEqual([1,1]);
  expect(r.items.find(i=>i.productNameRaw==='صنف جاما')?.quantity).toBe(1);
  expect(r.items).toHaveLength(3);
  expect(r.baskets).toHaveLength(2);
  expect(r.itemsByBasketId[r.baskets[0].basketId].filter(i=>i.productNameRaw.startsWith('دواء')).map(i=>i.quantity)).toEqual([null,null]);
 });
 it('does not allocate a pair after a new substantive request interrupts clarification',()=>{
  const r=basket([`You: ${offer}`,'Customer: عاوزة منهم شريطين','You: شريطين وشريطين ولا شريط وشريط','Customer: عايزة اسأل عن صنف تاني','Customer: شريط وشريط']);
  expect(r.items.filter(i=>i.productNameRaw.startsWith('دواء')).map(i=>i.quantity)).toEqual([null,null]);
 });
 it('projects accepted recommendation quantities through the full pipeline without claiming a sale',()=>{
  const r=runSalesIntelligencePipeline({conversationId:'synthetic-recommendation',rawWhatsAppExportText:chat([`You: ${offer}`,'Customer: تمام','Customer: عاوزة منهم شريطين','You: عنيا ان شاء الله شريطين وشريطين ولا شريط وشريط','Customer: تمام يادكتور شكرا لحضرتك🙏','Customer: شريط وشريط']),resolveInvoiceCandidates:()=>[]});
  const products=r.caseAnalyses.flatMap(a=>a.customerNeed.products).filter(p=>p.productNameRaw.startsWith('دواء'));
  expect(products).toHaveLength(2);
  expect(products.map(p=>p.finalQuantity)).toEqual([1,1]);
  expect(products.every(p=>p.roles.includes('accepted') && p.evidenceMessageIds.length>=4)).toBe(true);
  expect(r.caseAnalyses.every(a=>!a.caseIntelligence.sale.isSaleCountable)).toBe(true);
 });
 it('does not allocate a bare pair to multiple items without the clarification question',()=>{
  const r=basket([`You: ${offer}`,'Customer: عاوزة منهم شريطين','Customer: شريط وشريط']);
  expect(r.items.filter(i=>i.productNameRaw.startsWith('دواء')).map(i=>i.quantity)).toEqual([null,null]);
 });
 it('does not borrow an offer across an unrelated staff turn',()=>{
  const r=basket([`You: ${offer}`,'You: حضرتك محتاجة توصيل؟','Customer: عاوزة منهم شريطين']);
  expect(r.items.some(i=>i.productNameRaw.startsWith('دواء'))).toBe(false);
 });
 it('attaches a strength answer to the product asked about, preserving its quantity and original evidence',()=>{
  const r=basket(['Customer: عايزة شريط صنف ألفا','You: تركيز ايه يا فندم؟','Customer: 25']);
  expect(r.items).toHaveLength(1);
  expect(r.items[0].productNameRaw).toBe('صنف ألفا 25');
  expect(r.items[0].quantity).toBe(1);
  expect(r.items[0].confidence.evidence.flatMap(e=>e.messageIds??[])).toHaveLength(3);
 });
 it.each(['Customer: 25','You: الحساب كام؟\nCustomer: 25','You: تركيز ايه؟\nYou: تمام هراجع\nCustomer: 25'])('does not append unrelated numeric answers: %s',tail=>{
  const r=basket(['Customer: عايزة شريط صنف ألفا',...tail.split('\n')]);
  expect(r.items[0].productNameRaw).toBe('صنف ألفا');
 });
 it('does not replace an explicit existing strength from a contradictory bare answer',()=>{
  const r=basket(['Customer: عايزة شريط صنف ألفا 10','You: تركيز ايه؟','Customer: 25']);
  expect(r.items[0].productNameRaw).toBe('صنف ألفا 10');
  expect(r.items[0].resolutionStatus).toBe('contradicted');
 });
 it('does not guess which of two products in one message needs the strength',()=>{
  const r=basket(['Customer: عايزة شريط صنف ألفا وعلبة صنف بيتا','You: تركيز ايه؟','Customer: 25']);
  expect(r.items.every(i=>!i.productNameRaw.includes('25'))).toBe(true);
  expect(r.items.every(i=>i.resolutionStatus==='unknown')).toBe(true);
 });
 it('does not carry a strength question to an expired answer',()=>{
  const understanding=buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(`[10/19/26, 9:00:00 AM] Customer: عايزة شريط صنف ألفا
[10/19/26, 9:01:00 AM] You: تركيز ايه؟
[10/19/26, 9:20:00 AM] Customer: 25`),120)[0]);
  const r=buildCaseBaskets('expired',understanding.messages);
  expect(r.itemsByBasketId[r.baskets.at(-1)!.basketId][0].productNameRaw).toBe('صنف ألفا');
 });
 it('does not allocate a pair across three accepted recommendations',()=>{
  const r=basket(['You: ممكن ناخد دواء ألفا مع دواء بيتا مع دواء جاما','Customer: عاوزة منهم شريطين','You: شريطين وشريطين ولا شريط وشريط','Customer: شريط وشريط']);
  expect(r.items.filter(i=>i.productNameRaw.startsWith('دواء')).map(i=>i.quantity)).toEqual([null,null,null]);
 });
 it('does not create an extra version when the same clarification is repeated',()=>{
  const r=basket([`You: ${offer}`,'Customer: عاوزة منهم شريطين','You: شريطين وشريطين ولا شريط وشريط','Customer: شريط وشريط','Customer: شريط وشريط']);
  expect(r.baskets).toHaveLength(2);
  expect(r.items).toHaveLength(2);
  expect(r.items.map(i=>i.quantity)).toEqual([1,1]);
 });
 it('routes a contradictory strength answer to human review through the canonical pipeline',()=>{
  const r=runSalesIntelligencePipeline({conversationId:'synthetic-strength-conflict',rawWhatsAppExportText:chat(['Customer: عايزة شريط صنف ألفا 10','You: تركيز ايه؟','Customer: 25']),resolveInvoiceCandidates:()=>[]});
  expect(r.caseAnalyses[0].customerNeed.needsHumanReview).toBe(true);
  expect(r.caseAnalyses[0].caseIntelligence.sale.isSaleCountable).toBe(false);
 });
 it('keeps the named request and clarified strength as one canonical need, with no countable sale',()=>{
  const r=runSalesIntelligencePipeline({conversationId:'synthetic-strength',rawWhatsAppExportText:chat(['Customer: عايزة 1 شريط صنف ألفا','You: تركيز ايه؟','Customer: 25']),resolveInvoiceCandidates:()=>[]});
  const a=r.caseAnalyses[0];
  expect(a.customerNeed.products).toHaveLength(1);
  expect(a.customerNeed.products[0].productNameRaw).toBe('صنف ألفا 25');
  expect(a.caseIntelligence.sale.isSaleCountable).toBe(false);
 });
});
