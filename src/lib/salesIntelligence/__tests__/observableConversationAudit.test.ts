import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { classifyStaffCommitmentsV32 } from '@/lib/whatsappSemanticSignalsV32';

// Synthetic conversations only. These assert observable behaviour independently
// of a catalog mapping, formal basket recap, invoice proof or financial approval.
function run(turns: Array<[string,string]>) {
  const raw = turns.map(([sender,text], i) => `[9/15/26, 9:${String(Math.floor(i/2)).padStart(2,'0')}:${i%2?'20':'00'} AM] ${sender}: ${text}`).join('\n');
  return runSalesIntelligencePipeline({ conversationId:'synthetic-observable-audit', rawWhatsAppExportText:raw, resolveInvoiceCandidates:()=>[] }).caseAnalyses;
}
const opening = 'أهلًا وسهلًا بحضرتك\nنورتنا في صيدليات دواء\nمع حضرتك د تجريبي\nخدمة التوصيل متاحة على مدار ٢٤ ساعة';
const item = (analysis: ReturnType<typeof run>[number], key: string) => analyzeConversationEvaluation(analysis.caseIntelligence!).items.find(i=>i.key===key)!;

describe('observable conversation audit',()=>{
  it.each([
    'جاري الارسال\nنتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸',
    'صيدليات دواء تتشرف بخدمة حضرتك دائما 💚\nالأقرب إليك… ونهتم بصحتك دائمًا.',
    'العفو يا فندم نتشرف بخدمة حضرتك في اي وقت',
  ])('credits the actual closing without asserting a sale: %s', close=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['You','من عنيا حاضر'],['You',close]])[0];
    expect(item(a,'greeting')).toMatchObject({status:'assessed',pointsEarned:10});
    expect(item(a,'doctor_name')).toMatchObject({status:'assessed',pointsEarned:10});
    expect(item(a,'closing_message')).toMatchObject({status:'assessed',selectedOption:'official',pointsEarned:5});
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
    expect(a.caseIntelligence!.sale.proofState).not.toBe('proven');
  });

  it('preserves an official closing followed by extended thanks and a polite staff response',()=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['You','صيدليات دواء تتشرف بخدمة حضرتك دائما'],['Customer','شكرا يا دكتور على ذوقكم والله احسن ناس'],['You','العفو يا فندم احنا فخدمة حضرتك فاي وقت']])[0];
    expect(item(a,'closing_message')).toMatchObject({selectedOption:'official',pointsEarned:5});
  });

  it('does not credit a previous signature after an unanswered new question',()=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['You','نتشرف بخدمة حضرتك في أي وقت'],['Customer','هو الدواء ده يتاخد امتى؟']])[0];
    expect(item(a,'closing_message').pointsEarned).toBeNull();
  });

  it('does not turn a voice-led consultation into no need or a zero closing',()=>{
    const a=run([['Customer','<voice message omitted>'],['You',opening],['You','هو حاليا عنده اعراض ولا بيكمل جرعة العلاج؟'],['Customer','<voice message omitted>'],['You','هحتاج باقي التفاصيل للمراجعة']])[0];
    expect(item(a,'understanding')).toMatchObject({status:'insufficient_evidence',pointsEarned:null});
    expect(item(a,'closing_message').pointsEarned).toBeNull();
    expect(item(a,'dosage_explanation').reason).not.toContain('تم رصد شرح');
  });

  it('assesses a visible clarification in a text-only symptom conversation without inventing missing media',()=>{
    const a=run([['Customer','عايزة حاجة للسخونية والكحة'],['You',opening],['You','أبعت لحضرتك علب ولا شرايط؟'],['Customer','شرايط'],['You','من عنيا حاضر']])[0];
    expect(item(a,'understanding')).toMatchObject({status:'assessed',selectedOption:'acceptable',pointsEarned:7});
    expect(item(a,'understanding').reason).not.toMatch(/صورة|فويس|غير ظاهر/);
    expect(item(a,'consultation_quality').status).toBe('manual_review_required');
  });

  it('records a standalone order total without inventing a recap or full confirmation',()=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['Customer','ممكن اعرف الحساب'],['You','355ج ان شاء الله'],['Customer','تمام'],['You','جاري الارسال\nنتشرف بخدمة حضرتك ٢٤ ساعة']])[0];
    expect(a.caseIntelligence!.basket.announcedTotal).toBe(355);
    expect(a.commercialConfirmation.summaryPresented).toBe(false);
    expect(a.protocolAssessment.missingProtocolSteps).not.toContain('announced_total');
    expect(a.protocolAssessment.missingProtocolSteps).toContain('final_basket_summary');
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it.each([['سعرها كام','60ج'],['التوصيل كام','20ج']])('does not turn %s into a basket total', (question,amount)=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['Customer',question],['You',amount]])[0];
    expect(a.caseIntelligence!.basket.announcedTotal).toBeNull();
  });

  it.each([['بكام الشريطين','70ج بالتوصيل ان شاء الله',70],['كدا كام احول لحضرتك','183ج ان شاء الله',183]])(
    'recognizes an explicit total question %s without a formal recap', (question,amount,total)=>{
      const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['Customer',question],['You',amount]])[0];
      expect(a.caseIntelligence!.basket.announcedTotal).toBe(total);
      expect(a.commercialConfirmation.summaryPresented).toBe(false);
    }
  );

  it('retains the named addition after an attached conjunction',()=>{
    const a=run([['Customer','<image omitted>'],['You',opening],['Customer','وعايزة لزقة ميلاكريست بتاع النوم'],['You','من عنيا حاضر']])[0];
    expect(a.customerNeed.products.some(p=>p.productNameRaw==='لزقة ميلاكريست بتاع النوم')).toBe(true);
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it('retains the named parts of a request without inventing the item in an unread image',()=>{
    const a=run([['Customer','<image omitted> سلام عليكم عاوزه نوع الدوا الاولاني دا والمايه وسرنجه علاج'],['You',opening],['You','من عنيا حاضر']])[0];
    const names=a.customerNeed.products.map(p=>p.productNameRaw);
    expect(names).toContain('المايه');
    expect(names).toContain('سرنجه علاج');
    expect(names.some(name=>name.includes('الاولاني'))).toBe(false);
    expect(a.customerNeed.products.every(p=>p.requestedQuantity===null && p.productId===null)).toBe(true);
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it('retains a named price inquiry with unknown identity and quantity',()=>{
    const a=run([['Customer','هو الترمومتر الرقمي بكام'],['You',opening],['You','سعره 60ج']])[0];
    const p=a.customerNeed.products.find(p=>p.productNameRaw==='الترمومتر الرقمي');
    expect(p).toMatchObject({productId:null,requestedQuantity:null,finalQuantity:null});
    expect(p?.roles).not.toContain('accepted');
  });

  it('does not attach a politeness suffix to the product name',()=>{
    const a=run([['Customer','وعلبه كروماكس لو سمحت'],['You',opening]])[0];
    expect(a.customerNeed.products.map(p=>p.productNameRaw)).toContain('كروماكس');
    expect(a.customerNeed.products.some(p=>p.productNameRaw.includes('لو سمحت'))).toBe(false);
  });

  it('preserves named staff proposals without turning them into orders or extra selling',()=>{
    const a=run([['Customer','عايزة حاجة للسخونية والكحة'],['You',opening],
      ['You','من عنيا حاضر هبعت لحضرتك دواء ألف شراب للكحة ودواء باء اقراص'],
      ['Customer','في اقراص بدل الشراب؟'],['You','في دواء جيم اقراص']])[0];
    const offered=a.customerNeed.products.filter(p=>p.roles.includes('offered'));
    expect(offered.map(p=>p.productNameRaw)).toEqual(expect.arrayContaining(['دواء ألف شراب','دواء باء اقراص','دواء جيم اقراص']));
    expect(offered.every(p=>!p.roles.includes('accepted') && !p.roles.includes('final_basket') && p.productId===null)).toBe(true);
    expect(item(a,'cross_sell_upsell').status).toBe('not_applicable');
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it.each(['هبعت لحضرتك المندوب', 'موجود ان شاء الله', 'موجود عندنا', 'موجود يا فندم', 'متوفر يا دكتور', 'موجود دلوقتي', 'في دواء ألف اقراص؟'])(
    'does not invent a named offer from %s', text=>{
      const a=run([['Customer','محتاج استفسر'],['You',opening],['You',text]])[0];
      expect(a.customerNeed.products).toEqual([]);
    }
  );

  it('does not turn customer reassurance into an availability objection',()=>{
    const a=run([['Customer','عايزة علبة فيتامين سي'],['You',opening],['You','المندوب برا شوية'],['Customer','تمام مفيش مشكلة'],['You','نتشرف بخدمة حضرتك في أي وقت']])[0];
    expect(a.customerNeed.objections).toEqual([]);
    expect(a.caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it('scores an actual return after a bare wait request without creating a stock check',()=>{
    expect(classifyStaffCommitmentsV32('لحظة')).toMatchObject([{kind:'reply_back',ruleId:'commitment.explicit_wait_reply'}]);
    expect(classifyStaffCommitmentsV32('آخر لحظة')).toEqual([]);
    const a=run([['Customer','ممكن اعرف الحساب'],['You',opening],['You','لحظة'],['You','100ج ان شاء الله']])[0];
    expect(item(a,'followup_after_wait')).toMatchObject({status:'assessed',selectedOption:'within_5',pointsEarned:10});
    expect(a.unavailableDemand).toEqual([]);
  });
});
