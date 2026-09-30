import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';

type RecoveryCriterionKey = 'angry_customer' | 'order_delay_handling';

export interface RecoveryCriterionAssessment {
  key: RecoveryCriterionKey;
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
}

export interface ConversationEvaluationServiceRecovery {
  version: 'conversation-evaluation-service-recovery-v1';
  caseId: string;
  items: RecoveryCriterionAssessment[];
}

const criteria = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

const COMPLAINT_RX =
  /(?:زعلان|متضايق|غاضب|شكوى|مشكله|مشكلة|مش\s*راضي|سيئ|وحش|خدمة\s*وحشه|خدمة\s*سيئه|كل\s*مرة|كل\s*مره|بشتكي|ليه\s*كده)/i;
const APOLOGY_RX = /(?:متاسف|متأسف|آسف|اسف|بنعتذر|نعتذر|حقك\s*علينا|معلش)/i;
const SOLUTION_RX =
  /(?:هحل|هنحل|هنبدل|هبدل|هنرجع|هرجع\s*المبلغ|هتابع|هنابع|هراجع|هكلم|هنكلم|هنبعت|هتبعت|هنوفر|جاري\s*المتابعه|جاري\s*المتابعة|اتحل|تم\s*الحل|تم\s*التواصل)/i;
const HOSTILE_RX =
  /(?:لو\s*مش\s*عاجبك|مش\s*مشكلتي|مش\s*شغلي|بلاش\s*زن|ما\s*تزنش|انت\s*غلطان|إنت\s*غلطان|روح\s*اشتكي|اخرس|اخرسي)/i;

const ORDER_CONTEXT_RX = /(?:اوردر|أوردر|الاوردر|الأوردر|طلب|المندوب|توصيل|دليفري)/i;
const DELAY_RX = /(?:اتأخر|اتاخر|متأخر|متاخر|تأخير|تاخير|لسه|فين|مجاش|ماجاش|موصلش|ماوصلش|هييجي\s*امتى|هيوصل\s*امتى)/i;
const STAFF_DELAY_NOTICE_RX =
  /(?:(?:الطلب|الاوردر|الأوردر|المندوب|التوصيل)[^\n]{0,40}(?:ه?يتأخر|متأخر|في\s*تأخير|فيه\s*تأخير)|(?:في|فيه)\s*تأخير[^\n]{0,30}(?:الطلب|الاوردر|المندوب|التوصيل))/i;
const ETA_RX =
  /(?:خلال\s*\d+\s*(?:دقيقه|دقيقة|دقائق|ساعه|ساعة|ساعات)|نص\s*ساعه|نصف\s*ساعه|هيوصل\s*(?:خلال|في)|هيكون\s*عند\s*حضرتك|موعد\s*جديد)/i;
const RESOLUTION_RX =
  /(?:خرج\s*(?:مع|ل)\s*المندوب|في\s*الطريق|جاري\s*الارسال|جاري\s*الإرسال|تم\s*الارسال|تم\s*الإرسال|وصل|تم\s*التواصل|اتحل|تم\s*الحل)/i;
const CANCEL_RX =
  /(?:الغ(?:ي|ى)\s*(?:الطلب|الاوردر)|مش\s*عايزه|مش\s*عايز|خلاص\s*مش\s*محتاج|هجيب\s*من\s*مكان\s*تاني)/i;

function make(
  key: RecoveryCriterionKey,
  option: string | null,
  status: RecoveryCriterionAssessment['status'],
  confidence: number,
  reason: string,
  evidenceMessageIds: string[]
): RecoveryCriterionAssessment {
  const criterion = criteria.get(key);
  if (!criterion) throw new Error(`Missing criterion ${key}`);
  const choice = option ? criterion.choices.find((item) => item.value === option) ?? null : null;
  return {
    key,
    label: criterion.label,
    status,
    selectedOption: option,
    selectedLabel:
      status === 'not_applicable'
        ? 'غير منطبق على المحادثة'
        : status === 'insufficient_evidence'
          ? 'الدليل غير كافٍ للحكم'
          : choice?.label || 'تم التقييم',
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    maxPoints: criterion.maxPoints,
    confidence,
    reason,
    evidenceMessageIds: Array.from(new Set(evidenceMessageIds.filter(Boolean))),
  };
}

function ordered(view: CaseIntelligenceView) {
  return view.interaction.messages.slice().sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
}

function firstAfter(
  messages: ReturnType<typeof ordered>,
  index: number,
  role: 'staff'|'customer',
  predicate?: (text:string)=>boolean
) {
  return messages.slice(index+1).find((message) =>
    message.role===role &&
    message.meaningful &&
    (!predicate || predicate(message.text))
  ) || null;
}

function assessComplaint(view: CaseIntelligenceView): RecoveryCriterionAssessment {
  const messages=ordered(view);
  const complaintIndex=messages.findIndex(
    (message)=>message.role==='customer' && message.meaningful && COMPLAINT_RX.test(message.text)
  );

  if(complaintIndex<0){
    return make('angry_customer',null,'not_applicable',100,'لا توجد شكوى/غضب صريح يمكن تقييم طريقة التعامل معه.',[]);
  }

  const complaint=messages[complaintIndex];
  const laterStaff=messages.slice(complaintIndex+1).filter((m)=>m.role==='staff'&&m.meaningful);
  if(!laterStaff.length){
    return make(
      'angry_customer',
      'ignored',
      'assessed',
      98,
      'العميل عبّر عن شكوى/عدم رضا ولم يظهر رد موظف لاحق داخل نفس التفاعل.',
      [complaint.id]
    );
  }

  const hostile=laterStaff.find((m)=>HOSTILE_RX.test(m.text));
  if(hostile){
    return make(
      'angry_customer',
      'inappropriate',
      'assessed',
      99,
      'ظهر رد غير لائق صريح بعد شكوى العميل.',
      [complaint.id,hostile.id]
    );
  }

  const apology=laterStaff.find((m)=>APOLOGY_RX.test(m.text));
  const solution=laterStaff.find((m)=>SOLUTION_RX.test(m.text));
  const resolved=laterStaff.find((m)=>RESOLUTION_RX.test(m.text));

  if(apology && solution && resolved){
    return make(
      'angry_customer',
      'solved',
      'assessed',
      96,
      'تم رصد اعتذار واضح ثم إجراء/حل ثم دليل لاحق على تنفيذ أو إغلاق المشكلة.',
      [complaint.id,apology.id,solution.id,resolved.id]
    );
  }

  if(apology && solution){
    return make(
      'angry_customer',
      'good',
      'assessed',
      92,
      'تم احتواء الشكوى باعتذار وإجراء واضح، لكن لا يوجد دليل كافٍ داخل التفاعل على إغلاق المشكلة نهائيًا.',
      [complaint.id,apology.id,solution.id]
    );
  }

  if(apology || solution){
    return make(
      'angry_customer',
      'medium',
      'assessed',
      84,
      'يوجد تفاعل إيجابي جزئي مع الشكوى، لكن عناصر الاحتواء/الحل غير مكتملة.',
      [complaint.id,...[apology?.id,solution?.id].filter(Boolean) as string[]]
    );
  }

  return make(
    'angry_customer',
    'medium',
    'assessed',
    76,
    'تم الرد على العميل، لكن لا يوجد اعتذار أو حل واضح يمكن إثباته من النص المتاح.',
    [complaint.id,laterStaff[0].id]
  );
}

function assessDelay(view: CaseIntelligenceView): RecoveryCriterionAssessment {
  const messages=ordered(view);
  const customerDelayIndex=messages.findIndex(
    (message)=>message.role==='customer' && message.meaningful && ORDER_CONTEXT_RX.test(message.text) && DELAY_RX.test(message.text)
  );

  const proactiveNoticeIndex=messages.findIndex(
    (message)=>message.role==='staff' && message.meaningful && STAFF_DELAY_NOTICE_RX.test(message.text)
  );

  if(customerDelayIndex<0 && proactiveNoticeIndex<0){
    return make(
      'order_delay_handling',
      null,
      'not_applicable',
      100,
      'لا يوجد تأخير أوردر/توصيل مثبت نصيًا داخل هذا التفاعل.',
      []
    );
  }

  const anchorIndex=customerDelayIndex>=0?customerDelayIndex:proactiveNoticeIndex;
  const anchor=messages[anchorIndex];
  const laterStaff=messages.slice(anchorIndex+1).filter((m)=>m.role==='staff'&&m.meaningful);
  const apology=(anchor.role==='staff'&&APOLOGY_RX.test(anchor.text))
    ? anchor
    : laterStaff.find((m)=>APOLOGY_RX.test(m.text)) || null;
  const eta=(anchor.role==='staff'&&ETA_RX.test(anchor.text))
    ? anchor
    : laterStaff.find((m)=>ETA_RX.test(m.text)) || null;
  const resolution=laterStaff.find((m)=>RESOLUTION_RX.test(m.text)) || null;

  const cancelled=messages.slice(anchorIndex+1).find(
    (m)=>m.role==='customer'&&m.meaningful&&CANCEL_RX.test(m.text)
  );

  if(cancelled && view.lostOpportunity.reason==='delivery_issue'){
    return make(
      'order_delay_handling',
      'lost_customer',
      'assessed',
      98,
      'العميل ألغى/ترك الطلب بعد سياق تأخير توصيل، وLost Opportunity ربط الخسارة بمشكلة الدليفري. التقييم هنا لطريقة المتابعة لا لسبب التأخير نفسه.',
      [anchor.id,cancelled.id,...view.lostOpportunity.evidenceMessageIds]
    );
  }

  if(proactiveNoticeIndex>=0 && apology && eta && resolution){
    return make(
      'order_delay_handling',
      view.lostOpportunity.responsibility==='delivery' || view.lostOpportunity.responsibility==='inventory'
        ? 'outside_reason_handled'
        : 'handled_full',
      'assessed',
      97,
      'تم إبلاغ العميل بالتأخير، والاعتذار، وإعطاء توقيت/توقع جديد، ثم ظهرت متابعة حتى التنفيذ. لا يتم تحميل الموظف سببًا تشغيليًا خارج إرادته.',
      [messages[proactiveNoticeIndex].id,apology.id,eta.id,resolution.id]
    );
  }

  if((proactiveNoticeIndex>=0 || laterStaff.length>0) && eta){
    return make(
      'order_delay_handling',
      'informed_only',
      'assessed',
      90,
      'تم إبلاغ العميل/الرد عليه مع وقت أو توقع جديد، لكن لا يوجد دليل كامل على متابعة التنفيذ حتى النهاية.',
      [anchor.id,eta.id,...(apology?[apology.id]:[])]
    );
  }

  if(customerDelayIndex>=0 && apology){
    return make(
      'order_delay_handling',
      'late_apology',
      'assessed',
      92,
      'الاعتذار ظهر بعد أن سأل العميل أو اشتكى من التأخير، بدون وقت جديد/متابعة كاملة مثبتة.',
      [anchor.id,apology.id]
    );
  }

  if(customerDelayIndex>=0 && !laterStaff.length){
    return make(
      'order_delay_handling',
      'not_informed',
      'assessed',
      99,
      'العميل سأل/اشتكى من تأخير الأوردر ولم يظهر رد لاحق يبلغه بالحالة أو وقت جديد.',
      [anchor.id]
    );
  }

  return make(
    'order_delay_handling',
    'informed_only',
    'assessed',
    78,
    'يوجد تعامل مع التأخير لكنه غير مكتمل بما يكفي لإثبات متابعة كاملة.',
    [anchor.id,...laterStaff.slice(0,2).map((m)=>m.id)]
  );
}

export function analyzeConversationEvaluationServiceRecovery(
  view: CaseIntelligenceView
): ConversationEvaluationServiceRecovery {
  return {
    version:'conversation-evaluation-service-recovery-v1',
    caseId:view.caseId,
    items:[assessComplaint(view),assessDelay(view)],
  };
}
