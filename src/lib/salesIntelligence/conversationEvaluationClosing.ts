import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';

export interface ClosingCriterionAssessment {
  key: 'closing_message';
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

export interface ConversationEvaluationClosing {
  version: 'conversation-evaluation-closing-v1';
  caseId: string;
  item: ClosingCriterionAssessment;
}

const criterion=REVIEW_CRITERIA.find((item)=>item.key==='closing_message');
if(!criterion) throw new Error('Missing closing_message criterion');

const OFFICIAL_CLOSING_RX =
  /(?:(?:نتشرف|تشرفنا)[^\n]{0,60}(?:بخدم|خدمت)[^\n]{0,40}(?:24|٢٤|أي\s*وقت|اى\s*وقت|اي\s*وقت)|صيدليات?\s*دواء[^\n]{0,60}(?:تحت\s*(?:أمر|امر)|نتشرف|في\s*خدمت)|(?:نتشرف|تشرفنا)\s*بخدم(?:ة|ه)\s*حضرتك\s*(?:دائم|في\s*أي\s*وقت)?)/i;

const RESPECTFUL_CLOSING_RX =
  /(?:تحت\s*(?:أمر|امر)\s*حضرتك|تحت\s*امرك|شكر(?:ا|ًا)\s*(?:لحضرتك|لتواصلك)|العفو\s*(?:يا\s*فندم)?|نتشرف\s*بخدم(?:ة|ه)\s*حضرتك|تشرفنا\s*(?:بخدمت|بالكلام)|في\s*أي\s*وقت\s*(?:يا\s*فندم)?)/i;

const CUSTOMER_COURTESY_RX =
  /^(?:شكرا|شكرًا|متشكر|تسلم|تسلمي|ربنا\s*يكرمك|جزاك\s*الله\s*خيرا|تمام|ماشي|حاضر|اوكي|أوكي|ok|العفو|الله\s*يخليك|شكرا\s*يا\s*دكتور)[\s🌷🌸✨💚🙏!.،]*$/iu;

const NEW_REQUEST_RX =
  /(?:عايز|عاوزه|عايزة|محتاج|ممكن|ينفع|بكام|سعر|موجود|متوفر|ابعت|ابعث|هات|هاتلي|لو\s*سمحت|سؤال|استفسار|كمان)/i;

function make(
  option:string|null,
  status:ClosingCriterionAssessment['status'],
  confidence:number,
  reason:string,
  evidenceMessageIds:string[]
):ClosingCriterionAssessment{
  const choice=option?criterion!.choices.find((item)=>item.value===option)??null:null;
  return{
    key:'closing_message',
    label:criterion!.label,
    status,
    selectedOption:option,
    selectedLabel:status==='not_applicable'
      ?'غير منطبق على المحادثة'
      :status==='insufficient_evidence'
        ?'الدليل غير كافٍ للحكم'
        :choice?.label||'تم التقييم',
    pointsEarned:status==='assessed'?choice?.pointsEarned??null:null,
    maxPoints:criterion!.maxPoints,
    confidence,
    reason,
    evidenceMessageIds:Array.from(new Set(evidenceMessageIds.filter(Boolean))),
  };
}

function ordered(view:CaseIntelligenceView){
  return view.interaction.messages
    .filter((message)=>message.meaningful && (message.role==='staff'||message.role==='customer'))
    .slice()
    .sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
}

function completed(view:CaseIntelligenceView):boolean{
  if(['sale_proven','awaiting_invoice','customer_declined','information_only'].includes(view.journey.currentState)) return true;
  return view.lostOpportunity.state==='lost' && view.lostOpportunity.recoverability==='none';
}

function candidateStillAtEnd(
  messages:ReturnType<typeof ordered>,
  candidateIndex:number
):boolean{
  const after=messages.slice(candidateIndex+1);
  return !after.some(
    (message)=>
      message.role==='customer' &&
      !CUSTOMER_COURTESY_RX.test(message.text.trim()) &&
      NEW_REQUEST_RX.test(message.text)
  );
}

export function analyzeConversationEvaluationClosing(
  view:CaseIntelligenceView
):ConversationEvaluationClosing{
  const contract=buildConversationEvaluationEvidence(view);
  const gate=contract.criteria.find((item)=>item.key==='closing_message');

  if(gate?.readiness==='not_applicable'||!completed(view)){
    return{
      version:'conversation-evaluation-closing-v1',
      caseId:view.caseId,
      item:make(
        null,
        'not_applicable',
        100,
        'التفاعل ما زال مفتوحًا أو في انتظار خطوة تجارية؛ لا يجوز خصم رسالة ختام قبل أن تنتهي المحادثة فعلًا.',
        []
      ),
    };
  }

  if(view.review.required && view.journey.currentState==='unknown'){
    return{
      version:'conversation-evaluation-closing-v1',
      caseId:view.caseId,
      item:make(
        null,
        'insufficient_evidence',
        60,
        'نهاية التفاعل نفسها غير محسومة؛ لا يوجد خصم آلي على الختام.',
        view.evidenceSummary.evidenceMessageIds.slice(-3)
      ),
    };
  }

  const messages=ordered(view);
  const staffCandidates=messages
    .map((message,index)=>({message,index}))
    .filter(({message})=>message.role==='staff')
    .filter(({index})=>index>=Math.max(0,messages.length-5));

  const official=[...staffCandidates].reverse().find(
    ({message,index})=>OFFICIAL_CLOSING_RX.test(message.text) && candidateStillAtEnd(messages,index)
  );
  if(official){
    return{
      version:'conversation-evaluation-closing-v1',
      caseId:view.caseId,
      item:make(
        'official',
        'assessed',
        98,
        'تم رصد رسالة ختام رسمية قرب نهاية التفاعل وبعد اكتمال المسار، ولم يفتح العميل بعدها طلبًا جديدًا.',
        [official.message.id]
      ),
    };
  }

  const respectful=[...staffCandidates].reverse().find(
    ({message,index})=>RESPECTFUL_CLOSING_RX.test(message.text) && candidateStillAtEnd(messages,index)
  );
  if(respectful){
    return{
      version:'conversation-evaluation-closing-v1',
      caseId:view.caseId,
      item:make(
        'respectful',
        'assessed',
        95,
        'تم رصد ختام محترم قرب نهاية التفاعل، لكنه لا يطابق عناصر الختام الرسمي الكاملة.',
        [respectful.message.id]
      ),
    };
  }

  const last=messages[messages.length-1]??null;
  const unanswered=view.coachingEvidence.unansweredRequestMessageIds;
  if(
    last?.role==='customer' &&
    NEW_REQUEST_RX.test(last.text) &&
    !CUSTOMER_COURTESY_RX.test(last.text.trim()) &&
    unanswered.includes(last.id)
  ){
    return{
      version:'conversation-evaluation-closing-v1',
      caseId:view.caseId,
      item:make(
        'left_open',
        'assessed',
        98,
        'الحالة مصنفة منتهية لكن آخر طلب عميل ظل بلا رد؛ هذه ليست مجرد رسالة ختام ناقصة بل ترك للمحادثة مفتوحة.',
        [last.id]
      ),
    };
  }

  return{
    version:'conversation-evaluation-closing-v1',
    caseId:view.caseId,
    item:make(
      'none_completed',
      'assessed',
      94,
      'المحادثة وصلت لنهاية فعلية، ولم يتم رصد رسالة ختام محترمة قرب النهاية.',
      messages.slice(-3).map((message)=>message.id)
    ),
  };
}
