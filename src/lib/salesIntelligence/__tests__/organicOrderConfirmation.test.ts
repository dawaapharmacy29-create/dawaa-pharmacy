import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { isOrderTotalQuestionOnly } from '../orderTotalLanguage';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../../whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '../../whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '../caseBasketEngine';

const prefix = `[11/13/26, 4:53:38 AM] Customer: <image omitted>
[11/13/26, 4:53:40 AM] You: أهلا بحضرتك مع حضرتك د صيدلي
[11/13/26, 4:53:45 AM] Customer: لو سمحت الرشته دي بكام
[11/13/26, 4:54:08 AM] You: 178ج ان شاء الله
[11/13/26, 4:55:59 AM] You: ابعتهم لحضرتك؟
[11/13/26, 5:59:54 AM] Customer: ايوا يا دكتور
[11/13/26, 6:00:33 AM] Customer: وعايزة لزقة ميلاكريست بتاع النوم
[11/13/26, 6:00:43 AM] Customer: كدا كام احول لحضرتك انستا باي
[11/13/26, 6:01:48 AM] You: من عنيا حاضر
[11/13/26, 6:01:49 AM] You: لحظة
[11/13/26, 6:02:32 AM] You: 183ج ان شاء الله`;
function analyze(raw: string) {
  return runSalesIntelligencePipeline({ conversationId:'synthetic', rawWhatsAppExportText:raw, resolveInvoiceCandidates:()=>[] }).caseAnalyses;
}
describe('organic order confirmation remains independent of formal recap, invoice and delivery', () => {
  it('a new total accepted after an add-on, then dispatch, confirms the current order without a formal recap', () => {
    const cases=analyze(prefix+`
[11/13/26, 6:02:39 AM] Customer: حاضر
[11/13/26, 6:03:16 AM] Customer: <image omitted>
[11/13/26, 6:03:58 AM] You: من عنيا حاضر اكتب لحضرتك عليهم
[11/13/26, 6:06:03 AM] You: بعتهم لحضرتك`);
    expect(cases).toHaveLength(1);
    const c=cases[0];
    expect(c.conversationCase.caseType).not.toBe('mixed');
    expect(c.commercialConfirmation).toMatchObject({customerConfirmed:true,staffConfirmed:true,summaryPresented:false,currentState:'commercial_confirmation_complete'});
    expect(c.salesOutcome).toMatchObject({isOrderConfirmed:true,isSaleCountable:false});
    expect(c.evidenceCompleteness.fulfillmentEvidenceAvailable).toBe(false);
    expect(c.caseIntelligence.sale.financialSettlement.receiptAcknowledged).toBe(false);
  });
  it.each(['شكرا هفكر','هو دا شامل التوصيل؟','مش عايزة الطلب'])('does not treat %s as customer acceptance', reply => {
    const c=analyze(prefix+`\n[11/13/26, 6:02:39 AM] Customer: ${reply}\n[11/13/26, 6:06:03 AM] You: بعتهم لحضرتك`)[0];
    expect(c.commercialConfirmation.customerConfirmed).toBe(false);
    expect(c.commercialConfirmation.staffConfirmed).toBe(false);
  });
  it('a per-item price and bare acknowledgment are not a total-linked order confirmation', () => {
    const c=analyze(`[11/13/26, 6:00:00 AM] Customer: عايز شريط باراسيتامول\n[11/13/26, 6:01:00 AM] You: متوفر بسعر 90 جنيه\n[11/13/26, 6:02:00 AM] Customer: تمام\n[11/13/26, 6:03:00 AM] You: تم الارسال`)[0];
    expect(c.commercialConfirmation.customerConfirmed).toBe(false);
    expect(c.commercialConfirmation.staffConfirmed).toBe(false);
  });
  it('a new product edit after acceptance invalidates that version confirmation', () => {
    const all=analyze(prefix+`\n[11/13/26, 6:02:39 AM] Customer: حاضر\n[11/13/26, 6:03:00 AM] Customer: عايز شريط باراسيتامول\n[11/13/26, 6:06:03 AM] You: بعتهم لحضرتك`);
    const c=all[all.length-1];
    expect(all).toHaveLength(2);
    expect(all[0].commercialConfirmation.customerConfirmed).toBe(true);
    expect(c.commercialConfirmation.customerConfirmed).toBe(false);
    expect(c.commercialConfirmation.staffConfirmed).toBe(false);
  });
  it('also invalidates an edit when the basket owner receives one unsplit case scope', () => {
    const raw=prefix+`\n[11/13/26, 6:02:39 AM] Customer: حاضر\n[11/13/26, 6:03:00 AM] Customer: عايز شريط باراسيتامول\n[11/13/26, 6:06:03 AM] You: بعتهم لحضرتك`;
    const messages=buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw),120)[0]).messages;
    const result=buildCaseBaskets('single-case',messages);
    expect(result.baskets.length).toBeGreaterThan(1);
    expect(result.baskets.at(-1)?.confirmedByCustomerAt).toBeNull();
    expect(result.baskets.at(-1)?.confirmedAt).toBeNull();
  });
  it.each(['ما بعتهمش لحضرتك','هبعتهم لحضرتك بعدين','مش جاري الارسال'])('does not call %s a completed staff confirmation', text => {
    const c=analyze(prefix+`\n[11/13/26, 6:02:39 AM] Customer: حاضر\n[11/13/26, 6:06:03 AM] You: ${text}`)[0];
    expect(c.commercialConfirmation.staffConfirmed).toBe(false);
  });
  it('a cancellation after acceptance is not reopened by a dispatch statement', () => {
    const c=analyze(prefix+`\n[11/13/26, 6:02:39 AM] Customer: حاضر\n[11/13/26, 6:03:00 AM] Customer: مش عايز الطلب\n[11/13/26, 6:06:03 AM] You: بعتهم لحضرتك`)[0];
    expect(c.commercialConfirmation.currentState).toBe('rejected');
  });
  it('a question containing another explicit purchase request remains a request', () => {
    expect(isOrderTotalQuestionOnly('كدا كام احول لحضرتك انستا باي')).toBe(true);
    expect(isOrderTotalQuestionOnly('عايز شريط تاني والحساب كام')).toBe(false);
  });
});
