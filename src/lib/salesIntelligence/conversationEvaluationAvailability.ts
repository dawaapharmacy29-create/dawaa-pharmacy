import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView, UnavailableDemand } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';

export interface AvailabilityCriterionAssessment {
  key: 'unavailable_items';
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  demandKeys: string[];
}

export interface ConversationEvaluationAvailability {
  version: 'conversation-evaluation-availability-v1';
  caseId: string;
  item: AvailabilityCriterionAssessment;
}

const criterion = REVIEW_CRITERIA.find((item) => item.key === 'unavailable_items');
if (!criterion) throw new Error('Missing unavailable_items review criterion');

const EXPLANATION_RX =
  /(?:نفس\s*(?:المادة|التركيز|الاستخدام|الفعالية)|بديل[^\n]{0,50}(?:نفس|لأن|علشان|عشان|مناسب)|الفرق\s*(?:بين|انه|إنه)|يماثل|يعادل|بديل\s+له\s+في)/i;

function choicePoints(option: string): number {
  return criterion!.choices.find((choice) => choice.value === option)?.pointsEarned ?? 0;
}

function make(
  option: string | null,
  status: AvailabilityCriterionAssessment['status'],
  confidence: number,
  reason: string,
  evidenceMessageIds: string[],
  demandKeys: string[]
): AvailabilityCriterionAssessment {
  const choice = option ? criterion!.choices.find((item) => item.value === option) ?? null : null;
  return {
    key: 'unavailable_items',
    label: criterion!.label,
    status,
    selectedOption: option,
    selectedLabel:
      status === 'not_applicable'
        ? 'غير منطبق على المحادثة'
        : status === 'insufficient_evidence'
          ? 'الدليل غير كافٍ للحكم'
          : choice?.label || 'تم التقييم',
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    maxPoints: criterion!.maxPoints,
    confidence,
    reason,
    evidenceMessageIds: Array.from(new Set(evidenceMessageIds.filter(Boolean))),
    demandKeys,
  };
}

function staffEvidenceMessages(view: CaseIntelligenceView, demand: UnavailableDemand) {
  const ids = new Set(demand.evidenceMessageIds);
  return view.interaction.messages.filter(
    (message) => ids.has(message.id) && message.role === 'staff' && message.meaningful
  );
}

function hasOperationalHelp(view: CaseIntelligenceView, demand: UnavailableDemand): boolean {
  if (demand.availabilityState === 'check_pending') return true;
  if (demand.followUpCandidate) return true;
  return view.followUp.opportunities.some(
    (opportunity) =>
      opportunity.demandKey === demand.demandKey &&
      ['stock_check_pending', 'staff_promised_check', 'stock_unavailable', 'customer_asked_to_wait'].includes(opportunity.reason)
  );
}

function assessDemand(view: CaseIntelligenceView, demand: UnavailableDemand) {
  const staffMessages = staffEvidenceMessages(view, demand);
  if (demand.alternativeOffered) {
    const explained = staffMessages.some((message) => EXPLANATION_RX.test(message.text));
    return {
      option: explained ? 'alternative_explained' : 'alternative_no_explain',
      confidence: explained ? 93 : 96,
      reason: explained
        ? 'تم رصد عدم توفر الصنف، ثم عرض بديل مع شرح نصي للفرق/سبب الترشيح. الحكم هنا على أسلوب التعامل فقط، وليس على الملاءمة الطبية للبديل.'
        : 'تم رصد عدم توفر الصنف وعرض بديل، لكن لا يوجد شرح نصي كافٍ للفرق أو سبب الترشيح. لا يتم الحكم آليًا على الملاءمة الطبية للبديل.',
      evidence: demand.evidenceMessageIds,
      demandKey: demand.demandKey,
    };
  }

  if (hasOperationalHelp(view, demand)) {
    return {
      option: 'helped_without_alternative',
      confidence: 94,
      reason: demand.availabilityState === 'check_pending'
        ? 'الصنف كان قيد المراجعة/التحقق وتم فتح مسار متابعة بدل إنهاء العميل عند النقص.'
        : 'لم يظهر بديل، لكن تم رصد مساعدة فعلية بالتوفير أو المتابعة بدل الاكتفاء بعبارة "غير متوفر".',
      evidence: demand.evidenceMessageIds,
      demandKey: demand.demandKey,
    };
  }

  if (demand.availabilityState === 'unavailable') {
    return {
      option: 'unavailable_only',
      confidence: 95,
      reason: 'تم إبلاغ العميل بعدم توفر الصنف، ولم يظهر بديل أو مسار مساعدة/متابعة مرتبط بهذا النقص.',
      evidence: demand.evidenceMessageIds,
      demandKey: demand.demandKey,
    };
  }

  return null;
}

export function analyzeConversationEvaluationAvailability(
  view: CaseIntelligenceView
): ConversationEvaluationAvailability {
  const contract = buildConversationEvaluationEvidence(view);
  const gate = contract.criteria.find((item) => item.key === 'unavailable_items');

  if (gate?.readiness === 'not_applicable' || view.unavailableDemand.length === 0) {
    return {
      version: 'conversation-evaluation-availability-v1',
      caseId: view.caseId,
      item: make(
        null,
        'not_applicable',
        100,
        'لم يتم إثبات نقص/عدم توفر لصنف طلبه العميل داخل هذا التفاعل.',
        [],
        []
      ),
    };
  }

  const perDemand = view.unavailableDemand
    .map((demand) => assessDemand(view, demand))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!perDemand.length) {
    return {
      version: 'conversation-evaluation-availability-v1',
      caseId: view.caseId,
      item: make(
        null,
        'insufficient_evidence',
        55,
        'يوجد سياق توفر غير مكتمل، لكن لا توجد أدلة كافية لتحديد طريقة تعامل الموظف معه.',
        gate?.evidenceMessageIds ?? [],
        view.unavailableDemand.map((demand) => demand.demandKey)
      ),
    };
  }

  // Multiple unavailable products are judged by the weakest proven handling so one ignored shortage
  // cannot disappear behind another well-handled product.
  const worst = perDemand
    .slice()
    .sort((a, b) => choicePoints(a.option) - choicePoints(b.option))[0];

  return {
    version: 'conversation-evaluation-availability-v1',
    caseId: view.caseId,
    item: make(
      worst.option,
      'assessed',
      worst.confidence,
      perDemand.length > 1
        ? `${worst.reason} تم تقييم ${perDemand.length} أصناف ناقصة واعتماد أضعف تعامل مثبت.`
        : worst.reason,
      worst.evidence,
      perDemand.map((item) => item.demandKey)
    ),
  };
}
