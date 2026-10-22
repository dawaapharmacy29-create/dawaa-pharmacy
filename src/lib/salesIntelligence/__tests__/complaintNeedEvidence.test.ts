import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';

function analyze(lines: string[]) {
  return runSalesIntelligencePipeline({conversationId:'11111111-1111-4111-8111-111111111111',
    rawWhatsAppExportText:lines.map((line,i)=>`[10/17/26, 10:${String(i).padStart(2,'0')}:00 AM] ${line}`).join('\n'),
    branchNameRawHint:'فرع شكري',resolveInvoiceCandidates:()=>[]});
}
describe('canonical complaint need evidence',()=>{
  it('uses the actual complaint rather than introductory courier call history',()=>{
    const result=analyze(['Customer: السلام عليكم','Customer: يعني المندوب اتصل بيا الساعة 9',
      'Customer: اي الطريقة السخيفة دي اللي بيتكلم بيها','You: حقك علينا هراجع بنفسي',
      'You: تسمحيلي اتصل على حضرتك؟','Customer: عندي درس','Customer: بس تخلص','Customer: الحصة']);
    const complaint=result.caseAnalyses.find(row=>row.complaintAssessment?.state==='recovery_attempted')!;
    expect(complaint).toBeTruthy();
    expect(complaint.customerNeed.primaryNeed).toBe('اي الطريقة السخيفة دي اللي بيتكلم بيها');
    expect(complaint.complaintAssessment!.complaintMessageIds).toContain(complaint.customerNeed.primaryNeedMessageId);
    expect(complaint.customerNeed.products).toEqual([]);
    expect(complaint.customerNeed.humanReviewReasons).not.toContain('customer_need_without_resolved_product_context');
    expect(complaint.salesOutcome.isSaleCountable).toBe(false);
    expect(complaint.customerRequestAssessment).toMatchObject({decision:'not_needed',requests:[]});
    expect(complaint.caseIntelligence.followUp.opportunities[0]).toMatchObject({reason:'callback_requested',dueAt:null,duePolicy:'manual_schedule'});
  });
  it('retains the commercial need when a real product request and complaint coexist',()=>{
    const result=analyze(['Customer: عايز 2 علبة فيتامين د','Customer: انا زعلان من مشكلة التوصيل','You: حقك علينا هتابع بنفسي']);
    const order=result.caseAnalyses.find(row=>row.customerNeed.products.length>0)!;
    expect(order.customerNeed.primaryNeed).toContain('فيتامين د');
    expect(order.salesOutcome.isSaleCountable).toBe(false);
  });
  it('does not fabricate a complaint need from an unrelated message',()=>{
    const result=analyze(['Customer: عندي صداع شديد','You: من امتى؟']);
    expect(result.caseAnalyses[0].customerNeed.primaryNeed).toBe('عندي صداع شديد');
  });
});
