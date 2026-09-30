import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import type {
  ConversationEvaluationSystemEvidenceSnapshot,
  MatchedSystemRow,
  CustomerRequestSystemRow,
  ExceptionalFollowupSystemRow,
} from './conversationEvaluationSystemEvidence';

type OperationalCriterionKey =
  | 'customer_request_registration'
  | 'exceptional_followup_recognition'
  | 'purchase_history_usage';

export interface OperationalCriterionAssessment {
  key: OperationalCriterionKey;
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  systemRecordIds: string[];
}

export interface ConversationEvaluationOperational {
  version: 'conversation-evaluation-operational-v1';
  caseId: string;
  items: OperationalCriterionAssessment[];
}

const criteria=new Map(REVIEW_CRITERIA.map((criterion)=>[criterion.key,criterion]));

function make(
  key:OperationalCriterionKey,
  option:string|null,
  status:OperationalCriterionAssessment['status'],
  confidence:number,
  reason:string,
  evidenceMessageIds:string[],
  systemRecordIds:string[]=[]
):OperationalCriterionAssessment{
  const criterion=criteria.get(key);
  if(!criterion) throw new Error(`Missing criterion ${key}`);
  const choice=option?criterion.choices.find((item)=>item.value===option)??null:null;
  return{
    key,label:criterion.label,status,selectedOption:option,
    selectedLabel:status==='not_applicable'
      ?'غير منطبق على المحادثة'
      :status==='insufficient_evidence'
        ?'الدليل غير كافٍ للحكم'
        :choice?.label||'تم التقييم',
    pointsEarned:status==='assessed'?choice?.pointsEarned??null:null,
    maxPoints:criterion.maxPoints,
    confidence,reason,
    evidenceMessageIds:Array.from(new Set(evidenceMessageIds.filter(Boolean))),
    systemRecordIds:Array.from(new Set(systemRecordIds.filter(Boolean))),
  };
}

function norm(value:unknown):string{
  return String(value??'').trim().toLowerCase()
    .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/[\u064B-\u065F]/g,'')
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ').trim();
}

function productNames(view:CaseIntelligenceView):string[]{
  return Array.from(new Set([
    ...view.unavailableDemand.map((d)=>d.requestedProductRaw),
    ...view.products.filter((p)=>p.roles.includes('requested')).map((p)=>p.productNameRaw),
  ].map(norm).filter((x)=>x.length>=3)));
}

function requestProductMatches(view:CaseIntelligenceView,row:CustomerRequestSystemRow):boolean|null{
  const names=productNames(view);
  if(!names.length) return null;
  const medicine=norm(row.medicine_name);
  if(!medicine) return false;
  return names.some((name)=>medicine.includes(name)||name.includes(medicine));
}

function registrationObligation(view:CaseIntelligenceView):boolean{
  const demandObligation=view.unavailableDemand.some((d)=>
    d.availabilityState==='check_pending' ||
    d.followUpCandidate ||
    d.followUpReason==='original_unavailable_no_alternative' ||
    d.followUpReason==='alternative_rejected' ||
    d.followUpReason==='availability_check_pending'
  );
  const followupObligation=view.followUp.opportunities.some((o)=>
    ['stock_unavailable','stock_check_pending','staff_promised_check','customer_asked_to_wait'].includes(o.reason)
  );
  return demandObligation||followupObligation;
}

function bestRequestMatch(
  view:CaseIntelligenceView,
  rows:MatchedSystemRow<CustomerRequestSystemRow>[]
):MatchedSystemRow<CustomerRequestSystemRow>|null{
  const candidates=rows.filter((match)=>{
    if(match.staffMatched===false) return false;
    const productMatch=requestProductMatches(view,match.row);
    return productMatch!==false;
  });
  return candidates.sort((a,b)=>{
    const aStaff=a.staffMatched===true?0:1;
    const bStaff=b.staffMatched===true?0:1;
    if(aStaff!==bStaff) return aStaff-bStaff;
    return Math.abs(a.minutesFromInteractionEnd??9999)-Math.abs(b.minutesFromInteractionEnd??9999);
  })[0]??null;
}

function requestCompleteness(row:CustomerRequestSystemRow){
  const importantMissing:string[]=[];
  const minorMissing:string[]=[];
  if(!row.medicine_name) importantMissing.push('الصنف');
  if(row.quantity==null||Number(row.quantity)<=0) importantMissing.push('الكمية');
  if(!row.branch) minorMissing.push('الفرع');
  if(!row.customer_code) minorMissing.push('كود العميل');
  if(!row.customer_phone) minorMissing.push('الهاتف');
  if(!row.due_date&&!row.next_action_at) minorMissing.push('موعد المتابعة');
  return{importantMissing,minorMissing};
}

function assessRegistration(
  view:CaseIntelligenceView,
  system:ConversationEvaluationSystemEvidenceSnapshot
):OperationalCriterionAssessment{
  if(!registrationObligation(view)){
    return make(
      'customer_request_registration',null,'not_applicable',100,
      'لا يوجد وعد توفير/نقص يحتاج تسجيل طلب تشغيلي في هذه المحادثة.',
      [],[]
    );
  }

  const evidenceIds=Array.from(new Set([
    ...view.unavailableDemand.flatMap((d)=>d.evidenceMessageIds),
    ...view.followUp.opportunities.flatMap((o)=>o.evidenceMessageIds),
  ]));

  const match=bestRequestMatch(view,system.customerRequests);
  if(!match){
    return make(
      'customer_request_registration','promised_not_registered','assessed',97,
      'يوجد احتياج/وعد يستلزم تسجيل طلب، ولم يوجد سجل نظام مطابق لنفس العميل والدكتور والتوقيت.',
      evidenceIds,[]
    );
  }

  if(match.staffMatched==null){
    return make(
      'customer_request_registration',null,'insufficient_evidence',70,
      'وُجد سجل طلب مطابق للعميل والتوقيت، لكن هوية من قام بالتسجيل غير كافية لنسبه للدكتور تلقائيًا.',
      evidenceIds,[match.row.id]
    );
  }

  const mins=match.minutesFromInteractionEnd;
  const complete=requestCompleteness(match.row);
  if(complete.importantMissing.length){
    return make(
      'customer_request_registration','wrong_or_incomplete','assessed',96,
      `السجل موجود لكن بيانات مؤثرة ناقصة: ${complete.importantMissing.join('، ')}.`,
      evidenceIds,[match.row.id]
    );
  }

  if(mins!=null&&mins>15){
    return make(
      'customer_request_registration','registered_late','assessed',94,
      `تم تسجيل الطلب بعد نهاية التفاعل بحوالي ${mins} دقيقة.`,
      evidenceIds,[match.row.id]
    );
  }

  if(complete.minorMissing.length){
    return make(
      'customer_request_registration','registered_minor_missing','assessed',94,
      `تم تسجيل الطلب في الوقت المناسب، مع نقص بسيط: ${complete.minorMissing.join('، ')}.`,
      evidenceIds,[match.row.id]
    );
  }

  return make(
    'customer_request_registration','registered_complete','assessed',98,
    'تم العثور على سجل طلب مطابق لنفس العميل والدكتور والتوقيت، وبياناته الأساسية مكتملة.',
    evidenceIds,[match.row.id]
  );
}

const EXCEPTIONAL_SIGNAL_RX =
  /(?:مريض\s*مزمن|مزمن|ضغط|سكر|قلب|غده|غدة|سيوله|سيولة|كل\s*شهر|شهري|باخد[هة]?\s*باستمرار|باخده\s*بانتظام|روشت(?:ة|ه)\s*جديد(?:ة|ه)|بدأت\s*علاج|بدات\s*علاج|الدكتور\s*غير\s*العلاج|متابعة\s*خاصة)/i;

function exceptionalSignalIds(view:CaseIntelligenceView):string[]{
  return view.interaction.messages
    .filter((m)=>m.meaningful&&EXCEPTIONAL_SIGNAL_RX.test(m.text))
    .map((m)=>m.id);
}

function bestExceptional(
  rows:MatchedSystemRow<ExceptionalFollowupSystemRow>[]
):MatchedSystemRow<ExceptionalFollowupSystemRow>|null{
  return rows
    .filter((match)=>match.staffMatched!==false)
    .sort((a,b)=>{
      const aStaff=a.staffMatched===true?0:1;
      const bStaff=b.staffMatched===true?0:1;
      if(aStaff!==bStaff) return aStaff-bStaff;
      return Math.abs(a.minutesFromInteractionEnd??9999)-Math.abs(b.minutesFromInteractionEnd??9999);
    })[0]??null;
}

function assessExceptional(
  view:CaseIntelligenceView,
  system:ConversationEvaluationSystemEvidenceSnapshot
):OperationalCriterionAssessment{
  const signalIds=exceptionalSignalIds(view);
  if(!signalIds.length){
    return make(
      'exceptional_followup_recognition',null,'not_applicable',100,
      'لا توجد إشارة واضحة في المحادثة لحالة استثنائية تستحق تسجيل متابعة خاصة.',
      [],[]
    );
  }

  const match=bestExceptional(system.exceptionalFollowups);
  if(!match){
    return make(
      'exceptional_followup_recognition','missed_opportunity','assessed',92,
      'تم رصد سبب واضح لمتابعة استثنائية، ولم يوجد طلب متابعة استثنائية مطابق في النظام خلال نافذة المحادثة.',
      signalIds,[]
    );
  }

  if(match.staffMatched==null){
    return make(
      'exceptional_followup_recognition',null,'insufficient_evidence',70,
      'وُجدت متابعة استثنائية للعميل، لكن لا يمكن نسب تسجيلها للدكتور بثقة من بيانات الموظف الحالية.',
      signalIds,[match.row.id]
    );
  }

  const detail=`${match.row.followup_reason??''} ${match.row.request_details??''} ${match.row.followup_summary??''}`.trim();
  const detailed=norm(detail).length>=20 && !/^(?:متابعه|متابعة|عميل مهم|حاله خاصه|حالة خاصة)$/.test(norm(detail));

  return make(
    'exceptional_followup_recognition',
    detailed?'registered_correctly':'registered_generic',
    'assessed',
    94,
    detailed
      ?'تم رصد الحالة وتسجيل متابعة استثنائية مرتبطة بنفس العميل والدكتور، مع سبب/تفاصيل مفيدة.'
      :'تم تسجيل متابعة استثنائية، لكن السبب المسجل عام وغير مفصل.',
    signalIds,[match.row.id]
  );
}

const HISTORY_RELEVANCE_RX =
  /(?:المرة\s*اللي\s*فاتت|المره\s*اللي\s*فاتت|اخر\s*مرة|آخر\s*مرة|زي\s*كل\s*مرة|زي\s*المرة\s*اللي\s*فاتت|نفس\s*اللي\s*كنت|الدواء\s*المعتاد|باخده\s*كل\s*شهر|باخده\s*باستمرار|كنت\s*باخد)/i;
const STAFF_HISTORY_USE_RX =
  /(?:المرة\s*اللي\s*فاتت|المره\s*اللي\s*فاتت|اخر\s*مرة|آخر\s*مرة|حضرتك\s*كنت|كنت\s*واخد|كنت\s*واخده|نفس\s*اللي\s*اخدت|تاريخ\s*الشراء|طلبت\s*قبل\s*كده)/i;
const HISTORY_ACTION_RX =
  /(?:نفس|ميعاد|موعد|نكمل|تكرر|نجدد|أفكرك|افكرك|ترشيح|مناسب|المعتاد)/i;

function assessPurchaseHistory(
  view:CaseIntelligenceView,
  system:ConversationEvaluationSystemEvidenceSnapshot
):OperationalCriterionAssessment{
  const relevant=view.interaction.messages.filter(
    (m)=>m.role==='customer'&&m.meaningful&&HISTORY_RELEVANCE_RX.test(m.text)
  );
  if(!relevant.length){
    return make(
      'purchase_history_usage',null,'not_applicable',100,
      'لا يوجد في المحادثة الحالية سياق واضح يجعل استخدام تاريخ الشراء السابق ضروريًا أو مفيدًا بشكل يمكن قياسه.',
      [],[]
    );
  }

  if(system.purchaseHistory.priorInvoiceCount===0){
    return make(
      'purchase_history_usage',null,'insufficient_evidence',100,
      'العميل أشار إلى شراء/استخدام سابق، لكن النظام لم يجد فاتورة سابقة موثوقة قبل بداية المحادثة؛ لا يوجد خصم.',
      relevant.map((m)=>m.id),[]
    );
  }

  const staff=view.interaction.messages.filter((m)=>m.role==='staff'&&m.meaningful);
  const used=staff.find((m)=>STAFF_HISTORY_USE_RX.test(m.text));
  if(used){
    const acted=HISTORY_ACTION_RX.test(used.text);
    return make(
      'purchase_history_usage',
      acted?'used_well':'used_partial',
      'assessed',
      acted?94:86,
      acted
        ?'المحادثة استدعت تاريخ الشراء، والنظام أكد وجود تاريخ سابق، والموظف استخدمه في الرد/الاستمرار مع العميل.'
        :'تمت الإشارة إلى الشراء السابق، لكن الاستفادة منه في الرد كانت محدودة.',
      [...relevant.map((m)=>m.id),used.id],
      system.purchaseHistory.invoices.slice(0,3).map((row)=>row.id)
    );
  }

  return make(
    'purchase_history_usage','ignored','assessed',90,
    'العميل ربط طلبه صراحة بتاريخ شراء سابق، والنظام أكد وجود تاريخ سابق، لكن ردود الموظف لم تستخدم هذا السياق.',
    relevant.map((m)=>m.id),
    system.purchaseHistory.invoices.slice(0,3).map((row)=>row.id)
  );
}

export function analyzeConversationEvaluationOperational(
  view:CaseIntelligenceView,
  system:ConversationEvaluationSystemEvidenceSnapshot
):ConversationEvaluationOperational{
  return{
    version:'conversation-evaluation-operational-v1',
    caseId:view.caseId,
    items:[
      assessRegistration(view,system),
      assessExceptional(view,system),
      assessPurchaseHistory(view,system),
    ],
  };
}
