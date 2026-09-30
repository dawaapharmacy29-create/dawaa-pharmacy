import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';

type SalesCriterionKey = 'sales_closing' | 'cross_sell_upsell';

export interface SalesCriterionAssessment {
  key: SalesCriterionKey;
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  productKeys?: string[];
}

export interface ConversationEvaluationSales {
  version: 'conversation-evaluation-sales-v1';
  caseId: string;
  items: SalesCriterionAssessment[];
}

const criteria = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

function make(
  key: SalesCriterionKey,
  option: string | null,
  status: SalesCriterionAssessment['status'],
  confidence: number,
  reason: string,
  evidenceMessageIds: string[],
  productKeys: string[] = []
): SalesCriterionAssessment {
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
    productKeys,
  };
}

function assessClosing(view: CaseIntelligenceView): SalesCriterionAssessment {
  const salesApplicable =
    view.interaction.caseType === 'sales_opportunity' ||
    view.sale.isSaleCountable ||
    view.basket.versions.length > 0;

  if (!salesApplicable) {
    return make(
      'sales_closing',
      null,
      'not_applicable',
      100,
      'لا توجد فرصة بيع فعلية في هذا التفاعل.',
      []
    );
  }

  if (view.sale.outcome === 'sale_proven' && view.sale.isSaleCountable) {
    const strongConversationClose =
      view.basket.confirmed ||
      view.sale.summaryPresented ||
      (view.sale.customerConfirmed && view.sale.staffConfirmed);

    if (strongConversationClose) {
      return make(
        'sales_closing',
        'clear_order',
        'assessed',
        98,
        'البيع مثبت، والمحادثة نفسها تحتوي تأكيد/تلخيص واضح للطلب؛ لذلك نجاح البيع مدعوم بسلوك إغلاق واضح وليس بالفاتورة وحدها.',
        [...view.sale.confirmationMessageIds, ...view.evidenceSummary.evidenceMessageIds]
      );
    }

    return make(
      'sales_closing',
      'helped',
      'assessed',
      94,
      'البيع مثبت بفاتورة موثوقة، لكن لا يوجد دليل محادثة كافٍ على تلخيص/تأكيد كامل للطلب؛ لذلك لا تُمنح الدرجة الكاملة لمجرد وجود الفاتورة.',
      [...view.sale.confirmationMessageIds, ...view.lostOpportunity.evidenceMessageIds]
    );
  }

  if (
    (view.lostOpportunity.reason === 'staff_no_response' || view.lostOpportunity.reason === 'slow_response') &&
    view.lostOpportunity.responsibility === 'staff'
  ) {
    return make(
      'sales_closing',
      'missed',
      'assessed',
      96,
      'فرصة البيع تعثرت بسبب مسؤولية مثبتة على الموظف في الرد/الاستجابة، وفق Lost Opportunity canonical.',
      view.lostOpportunity.evidenceMessageIds
    );
  }

  if (view.lostOpportunity.state === 'open' || view.lostOpportunity.state === 'recoverable') {
    if (view.lostOpportunity.waitingOn === 'customer') {
      return make(
        'sales_closing',
        'helped',
        'assessed',
        90,
        'الموظف دفع الطلب إلى نقطة أصبح القرار فيها عند العميل؛ الفرصة ما زالت مفتوحة/قابلة للاسترجاع وليست فرصة ضائعة على الموظف.',
        view.lostOpportunity.evidenceMessageIds
      );
    }
    if (view.lostOpportunity.waitingOn === 'staff') {
      return make(
        'sales_closing',
        'passive',
        'assessed',
        90,
        'الفرصة ما زالت تحتاج خطوة من الموظف ولم يظهر إغلاق أو متابعة كافية داخل هذا التفاعل.',
        view.lostOpportunity.evidenceMessageIds
      );
    }
  }

  if (view.basket.versions.length > 0 || view.basket.activeItems.length > 0) {
    return make(
      'sales_closing',
      'helped',
      'assessed',
      85,
      'تم بناء سلة/طلب فعلي، لكن البيع لم يثبت بعد؛ يتم تقييم إدارة القرار بشكل إيجابي دون ادعاء إغلاق نهائي.',
      view.evidenceSummary.evidenceMessageIds
    );
  }

  if (view.coachingEvidence.staffReplied && view.need.primaryNeed) {
    return make(
      'sales_closing',
      'passive',
      'assessed',
      78,
      'يوجد احتياج وفرصة بيع ورد من الموظف، لكن لا يوجد دليل كافٍ على انتقال فعلي نحو طلب أو قرار واضح.',
      view.need.evidenceMessageIds
    );
  }

  return make(
    'sales_closing',
    null,
    'insufficient_evidence',
    55,
    'لا توجد أدلة كافية للحكم العادل على جودة إغلاق البيع.',
    view.evidenceSummary.evidenceMessageIds
  );
}

function assessCrossSell(view: CaseIntelligenceView): SalesCriterionAssessment {
  const offeredExtra = view.products.filter(
    (product) =>
      product.roles.includes('offered') &&
      !product.roles.includes('requested') &&
      !product.roles.includes('alternative')
  );

  if (!offeredExtra.length) {
    return make(
      'cross_sell_upsell',
      null,
      'not_applicable',
      100,
      'لم يتم رصد اقتراح إضافي فعلي خارج طلب العميل؛ لا يتم افتراض أن هناك فرصة Cross-sell مهدرة.',
      []
    );
  }

  const accepted = offeredExtra.filter(
    (product) =>
      product.inFinalBasket ||
      product.roles.includes('accepted') ||
      product.roles.includes('final_basket')
  );

  if (accepted.length) {
    const ids = offeredExtra.flatMap((product) =>
      view.need.products.find((needProduct) => needProduct.key === product.productKey)?.evidenceMessageIds ?? []
    );
    return make(
      'cross_sell_upsell',
      'useful',
      'assessed',
      92,
      'تم رصد اقتراح إضافي من الموظف خارج الطلب الأصلي، ودخل الاقتراح السلة/تم قبوله. هذا حكم على نجاح الاقتراح تجاريًا فقط، وليس على ملاءمته الطبية.',
      ids,
      accepted.map((product) => product.productKey)
    );
  }

  const ids = offeredExtra.flatMap((product) =>
    view.need.products.find((needProduct) => needProduct.key === product.productKey)?.evidenceMessageIds ?? []
  );
  return make(
    'cross_sell_upsell',
    'partial',
    'assessed',
    82,
    'تم رصد اقتراح إضافي فعلي، لكن لا يوجد دليل أنه دخل السلة أو تم قبوله؛ تُحسب محاولة جزئية فقط ولا يُفترض نجاحها.',
    ids,
    offeredExtra.map((product) => product.productKey)
  );
}

export function analyzeConversationEvaluationSales(view: CaseIntelligenceView): ConversationEvaluationSales {
  const contract = buildConversationEvaluationEvidence(view);
  const readiness = new Map(contract.criteria.map((item) => [item.key, item.readiness]));

  const items = [assessClosing(view), assessCrossSell(view)].map((item) => {
    const gate = readiness.get(item.key);
    if (gate === 'not_applicable' && item.status !== 'not_applicable') {
      return make(item.key, null, 'not_applicable', 100, 'البند غير منطبق وفق عقد الأدلة.', []);
    }
    return item;
  });

  return {
    version: 'conversation-evaluation-sales-v1',
    caseId: view.caseId,
    items,
  };
}
