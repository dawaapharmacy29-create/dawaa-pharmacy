import { describe, expect, it } from 'vitest';
import { deriveCanonicalComplaintAssessment } from '../complaintAssessmentEngine';
import { runSalesIntelligencePipeline, deriveSegmentedCases, segmentationInputFromPipelineInput, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';
import { classifyAvailabilityStatementV32, classifyCustomerTimingRequestV32 } from '@/lib/whatsappSemanticSignalsV32';

const chat = `[10/19/26, 9:00:00 AM] Customer: المندوب مكلمني الساعة 8
[10/19/26, 9:00:20 AM] Customer: واتصل بيا تاني الساعة 8.10
[10/19/26, 9:01:00 AM] Customer: ايه الطريقة السخيفة دي اللي بيتكلم بيها المندوب
[10/19/26, 9:02:00 AM] You: تسمحيلي اتصل على حضرتك؟
[10/19/26, 9:02:20 AM] Customer: عندي اجتماع
[10/19/26, 9:02:30 AM] Customer: بس اخلص
[10/19/26, 9:02:40 AM] Customer: الاجتماع
[10/19/26, 9:03:00 AM] You: بعتذر جدا وصعدت الموضوع للادارة
[10/19/26, 9:04:00 AM] Customer: شكرا بس خليه يبقى روحه طويلة شوية`;
function input(raw = chat): SalesIntelligencePipelineInput {
  return {conversationId:'synthetic-service-recovery',rawWhatsAppExportText:raw,
    customerIdHint:'synthetic-customer',customerIdentityStatus:'resolved',resolveInvoiceCandidates:()=>[]};
}
function analyze(raw = chat) { return runSalesIntelligencePipeline(input(raw)).caseAnalyses; }
describe('service recovery context and contact timing', () => {
  it('detects delivery conduct complaint and recovery without inventing resolution', () => {
    const a=analyze().find(a=>a.complaintAssessment?.state !== 'none');
    expect(a).toBeDefined();
    expect(a!.complaintAssessment!.state).toBe('recovery_attempted');
    expect(a!.complaintAssessment!.apologyMessageIds.length).toBeGreaterThan(0);
    expect(a!.complaintAssessment!.remedyAttemptMessageIds.length).toBeGreaterThan(0);
    expect(a!.complaintAssessment!.resolutionMessageIds).toEqual([]);
  });
  it('does not turn a neutral method question into a complaint', () => {
    expect(deriveCanonicalComplaintAssessment({caseId:'neutral',messages:[{id:'q',role:'customer',meaningful:true,text:'ايه طريقة استخدام الكريم؟'}]}).state).toBe('none');
  });
  it.each(['المندوب مكلمني الساعة 8','المندوب كلمني الساعة 8','واتصل بيا تاني الساعة 8.10','المندوب كلمني امبارح وعايز لبن','مش عايزة حد يكلمني'])('does not treat a past call report as a callback request: %s',text=>{
    expect(classifyCustomerTimingRequestV32(text)).toBeNull();
  });
  it.each(['كلمني بكرة','اتصل بيا بكرة','كلميني بعد يومين','عايز المندوب يكلمني','عايزة حد يكلمني','عايزة حضرتك تكلميني','المندوب كلمني امبارح وكلمني بكرة'])('preserves real callback requests: %s',text=>{
    expect(classifyCustomerTimingRequestV32(text)).not.toBeNull();
  });
  it.each(['هنتظر لما يكون متاح اننا نتواصل','في اقرب فرصة متاح اتصل على حضرتك'])('contact availability is not product stock: %s',text=>{
    expect(classifyAvailabilityStatementV32(text)).toBeNull();
  });
  it('preserves actual stock facts',()=>expect(classifyAvailabilityStatementV32('الصنف متاح')).toBe('available'));
  it('anchors a fragmented timing reply to the contact offer, not past courier calls',()=>{
    const a=analyze().find(a=>a.customerNeed.objections.some(o=>o.category==='timing'));
    expect(a).toBeDefined();
    expect(a!.customerNeed.objections.some(o=>o.category==='availability')).toBe(false);
    const callback=a!.followUp.opportunities.find(o=>o.reason==='callback_requested'&&o.status==='actionable');
    expect(callback).toBeDefined();
    expect(callback!.dueAt).toBeNull();
    expect(callback!.duePolicy).toBe('manual_schedule');
    const ids=new Set(callback!.evidenceMessageIds);
    const messages=deriveSegmentedCases(segmentationInputFromPipelineInput(input())).cases.flatMap(c=>c.scopedMessages);
    const delay=messages.find(m=>m.text==='بس اخلص')!;
    const offer=messages.find(m=>m.text==='تسمحيلي اتصل على حضرتك؟')!;
    expect(ids.has(delay.id)).toBe(true);
    expect(ids.has(offer.id)).toBe(true);
    for (const past of messages.filter(m=>m.text.startsWith('المندوب مكلمني')||m.text.startsWith('واتصل بيا'))) expect(ids.has(past.id)).toBe(false);
    expect(analyze().every(a=>a.caseIntelligence.sale.isSaleCountable===false)).toBe(true);
  });
  it('does not infer a callback from an unrelated standalone delay',()=>{
    const cases=analyze(`[10/19/26, 9:00:00 AM] Customer: بس اخلص الاجتماع`);
    expect(cases.flatMap(a=>a.followUp.opportunities).some(o=>o.reason==='callback_requested'&&o.status==='actionable')).toBe(false);
  });
  it.each([
    `[10/19/26, 9:00:00 AM] You: تسمحيلي اتصل على حضرتك؟
[10/19/26, 9:10:00 AM] Customer: بس اخلص الاجتماع`,
    `[10/19/26, 9:00:00 AM] You: تسمحيلي اتصل على حضرتك؟
[10/19/26, 9:00:30 AM] You: حضرتك طلبتي ايه من الصيدلية؟
[10/19/26, 9:01:00 AM] Customer: بس اخلص الاجتماع`,
  ])('does not carry a contact offer across an expired or unrelated context', raw=>{
    expect(analyze(raw).flatMap(a=>a.followUp.opportunities).some(o=>o.reason==='callback_requested'&&o.status==='actionable')).toBe(false);
  });
  it('preserves a real stock statement alongside a separate contact clause',()=>{
    expect(classifyAvailabilityStatementV32('الصنف متاح، نتواصل بكرة')).toBe('available');
    expect(classifyAvailabilityStatementV32('الصنف متاح اتصلوا احجزوا')).toBe('available');
  });
});

