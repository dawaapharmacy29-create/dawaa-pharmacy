import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';

export interface OrderConfirmationCriterionAssessment {
  key: 'order_confirmation';
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  missingProtocolSteps: string[];
}

export interface ConversationEvaluationOrderConfirmation {
  version: 'conversation-evaluation-order-confirmation-v1';
  caseId: string;
  item: OrderConfirmationCriterionAssessment;
}

const criterion=REVIEW_CRITERIA.find((item)=>item.key==='order_confirmation');
if(!criterion) throw new Error('Missing order_confirmation criterion');

function make(
  option:string|null,
  status:OrderConfirmationCriterionAssessment['status'],
  confidence:number,
  reason:string,
  evidenceMessageIds:string[],
  missingProtocolSteps:string[]
):OrderConfirmationCriterionAssessment{
  const choice=option?criterion!.choices.find((item)=>item.value===option)??null:null;
  return{
    key:'order_confirmation',
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
    missingProtocolSteps,
  };
}

const STEP_LABELS:Record<string,string>={
  final_basket_summary:'تلخيص الطلب النهائي',
  announced_total:'إعلان الإجمالي',
  customer_final_confirmation:'تأكيد العميل',
  staff_final_confirmation:'التأكيد النهائي من الموظف',
};

function labels(steps:string[]):string{
  return steps.map((step)=>STEP_LABELS[step]||step).join('، ');
}

export function analyzeConversationEvaluationOrderConfirmation(
  view:CaseIntelligenceView
):ConversationEvaluationOrderConfirmation{
  const applicability=view.coachingEvidence.protocolApplicability;

  if(applicability==='not_applicable'||applicability==='not_reached'){
    return{
      version:'conversation-evaluation-order-confirmation-v1',
      caseId:view.caseId,
      item:make(
        null,
        'not_applicable',
        100,
        applicability==='not_reached'
          ?'المحادثة لم تصل لمرحلة إغلاق تجعل بروتوكول تأكيد الطلب واجب التطبيق؛ لا يوجد خصم.'
          :'هذه المحادثة ليست مسار طلب/إغلاق ينطبق عليه بروتوكول التأكيد.',
        [],
        []
      ),
    };
  }

  if(applicability==='unknown'||!applicability){
    // Old persisted views may not yet carry applicability; only assess when strong closing evidence exists.
    const hasClosingEvidence=view.basket.confirmed||view.sale.summaryPresented||view.sale.customerConfirmed||view.sale.staffConfirmed;
    if(!hasClosingEvidence){
      return{
        version:'conversation-evaluation-order-confirmation-v1',
        caseId:view.caseId,
        item:make(
          null,
          'insufficient_evidence',
          55,
          'لا يمكن إثبات أن بروتوكول تأكيد الطلب كان منطبقًا على هذه النسخة من الحالة؛ لا يوجد خصم تلقائي.',
          view.sale.confirmationMessageIds,
          view.coachingEvidence.missingProtocolSteps
        ),
      };
    }
  }

  const missing=view.coachingEvidence.missingProtocolSteps;
  const evidence=view.sale.confirmationMessageIds;

  if(view.coachingEvidence.protocolCompliant&&missing.length===0){
    return{
      version:'conversation-evaluation-order-confirmation-v1',
      caseId:view.caseId,
      item:make(
        'full',
        'assessed',
        99,
        'تم استيفاء خطوات تأكيد الطلب المطلوبة داخل المحادثة.',
        evidence,
        []
      ),
    };
  }

  const importantMissing=missing.includes('final_basket_summary')||missing.includes('customer_final_confirmation');
  if(importantMissing){
    return{
      version:'conversation-evaluation-order-confirmation-v1',
      caseId:view.caseId,
      item:make(
        'important_missing',
        'assessed',
        97,
        `البروتوكول منطبق لكن خطوة مهمة غير مثبتة: ${labels(missing)}. الفاتورة إن وجدت تثبت البيع ولا تعوض غياب تأكيد المحادثة.`,
        evidence,
        missing
      ),
    };
  }

  if(missing.length===1){
    return{
      version:'conversation-evaluation-order-confirmation-v1',
      caseId:view.caseId,
      item:make(
        'minor_missing',
        'assessed',
        96,
        `البروتوكول منطبق ويوجد نقص واحد فقط: ${labels(missing)}.`,
        evidence,
        missing
      ),
    };
  }

  if(missing.length>=2){
    return{
      version:'conversation-evaluation-order-confirmation-v1',
      caseId:view.caseId,
      item:make(
        'many_missing',
        'assessed',
        96,
        `البروتوكول منطبق لكن أكثر من خطوة غير مثبتة: ${labels(missing)}.`,
        evidence,
        missing
      ),
    };
  }

  return{
    version:'conversation-evaluation-order-confirmation-v1',
    caseId:view.caseId,
    item:make(
      null,
      'insufficient_evidence',
      50,
      'حالة تأكيد الطلب غير متسقة ولا تسمح بدرجة عادلة.',
      evidence,
      missing
    ),
  };
}
