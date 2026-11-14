import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { closingAbsenceAssessable, observableClosing } from './conversationClosingEvidence';

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

export function analyzeConversationEvaluationClosing(
  view:CaseIntelligenceView
):ConversationEvaluationClosing{
  const ending = observableClosing(view);
  if (ending) {
    return {
      version:'conversation-evaluation-closing-v1', caseId:view.caseId,
      item:make(ending.kind, 'assessed', 98,
        ending.kind === 'official'
          ? 'وردت رسالة ختام رسمية في نهاية التبادل المتاح. هذا تقييم لأسلوب الختام فقط، ولا يثبت البيع أو التسليم أو حل الشكوى.'
          : 'ورد ختام محترم في نهاية التبادل المتاح. لا يتحول إلى إثبات بيع أو إغلاق التزام تشغيلي.',
        [ending.messageId]),
    };
  }
  if (!closingAbsenceAssessable(view)) {
    const unknownEnd = view.journey.currentState === 'information_only';
    return {
      version:'conversation-evaluation-closing-v1', caseId:view.caseId,
      item:make(null, unknownEnd ? 'insufficient_evidence' : 'not_applicable', 90,
        unknownEnd
          ? 'لا توجد علامة صريحة تكفي لإثبات انتهاء الاستشارة؛ نهاية الملف أو تصنيف معلومات فقط لا يثبتان انتهاء الحوار، فلا يوجد خصم على الختام.'
          : 'لا توجد نهاية حوار مثبتة تسمح بالخصم على غياب الختام؛ التفاعل ما زال مفتوحًا أو ينتظر خطوة.', []),
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
