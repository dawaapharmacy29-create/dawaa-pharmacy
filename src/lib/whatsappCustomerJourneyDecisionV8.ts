export type JourneySource = {
  id: string;
  conversationStartedAt: Date;
  conversationEndedAt?: Date | null;
  primaryIntent?: string | null;
  outcome?: string | null;
  priority?: 'normal' | 'important' | 'urgent' | string | null;
  invoiceStatus?: string | null;
  invoiceValue?: number | null;
  followupRequired?: boolean | null;
  initiator?: 'customer' | 'pharmacy' | 'unknown' | string | null;
};

export type JourneyAction = {
  id: string;
  type: string;
  status: string;
  dueAt?: Date | null;
  reason?: string | null;
  productName?: string | null;
};

export type JourneyCycle = {
  verifiedRevenue: number;
  verifiedInvoiceCount: number;
  verifiedRevenueOver500: boolean;
};

export type JourneyDecision = {
  state:
    | 'urgent_complaint'
    | 'overdue_action'
    | 'pending_request'
    | 'recommendation_followup'
    | 'sale_pending_invoice'
    | 'post_purchase_followup'
    | 'recently_contacted'
    | 'healthy'
    | 'insufficient_context';
  shouldContact: boolean;
  urgency: 'urgent' | 'important' | 'normal' | 'none';
  reason: string;
  nextBestAction: string;
  suggestedDelayHours: number | null;
  evidenceSourceIds: string[];
  openActionIds: string[];
};

function hoursBetween(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / 36e5;
}

export function buildCustomerJourneyDecisionV8(input: {
  sources: JourneySource[];
  actions: JourneyAction[];
  cycle?: JourneyCycle | null;
  now?: Date;
}): JourneyDecision {
  const now = input.now || new Date();
  const sources = [...input.sources].sort((a,b) => a.conversationStartedAt.getTime() - b.conversationStartedAt.getTime());
  const latest = sources[sources.length - 1] || null;
  const openActions = input.actions.filter((a) => ['proposed','ready'].includes(a.status));
  const overdue = openActions.filter((a) => a.dueAt && a.dueAt.getTime() <= now.getTime());
  const urgentComplaint = [...sources].reverse().find((s) => s.outcome === 'complaint_unresolved' || (s.primaryIntent === 'complaint' && s.priority === 'urgent'));
  const pendingRequest = [...sources].reverse().find((s) => s.outcome === 'unresolved_request');
  const recommendation = [...sources].reverse().find((s) => s.primaryIntent === 'doctor_recommendation' || s.outcome === 'needs_followup');
  const salePendingInvoice = [...sources].reverse().find((s) => s.outcome === 'probable_sale' && s.invoiceStatus !== 'verified');
  const latestContactAt = latest?.conversationEndedAt || latest?.conversationStartedAt || null;
  const contactedRecently = latestContactAt ? hoursBetween(now, latestContactAt) < 18 : false;
  const cycle = input.cycle || null;

  if (urgentComplaint) {
    return {
      state: 'urgent_complaint', shouldContact: true, urgency: 'urgent', suggestedDelayHours: 0,
      reason: 'يوجد مسار شكوى غير محسوم في أحدث رحلة العميل.',
      nextBestAction: 'التواصل فورًا، حل سبب الشكوى، ثم تأكيد رضا العميل قبل إغلاق الحالة.',
      evidenceSourceIds: [urgentComplaint.id], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (overdue.length) {
    return {
      state: 'overdue_action', shouldContact: true, urgency: 'important', suggestedDelayHours: 0,
      reason: overdue[0].reason || 'يوجد إجراء خدمة عملاء مستحق ولم يُنفذ بعد.',
      nextBestAction: overdue[0].type === 'customer_request'
        ? 'راجع طلب العميل والصنف ثم أغلق مسار التوفر/البيع.'
        : 'نفّذ المتابعة المستحقة وسجل النتيجة على نفس رحلة العميل.',
      evidenceSourceIds: latest ? [latest.id] : [], openActionIds: overdue.map((a) => a.id),
    };
  }

  if (pendingRequest) {
    return {
      state: 'pending_request', shouldContact: !contactedRecently, urgency: 'important', suggestedDelayHours: contactedRecently ? 18 : 0,
      reason: 'العميل لديه طلب لم يظهر له بيع مؤكد أو رفض نهائي.',
      nextBestAction: contactedRecently
        ? 'لا ترسل رسالة جديدة الآن؛ انتظر حتى يمر وقت مناسب ثم تابع التوفر أو البديل.'
        : 'تابع توفر الصنف أو اعرض البديل المناسب ثم اربط النتيجة بالفاتورة.',
      evidenceSourceIds: [pendingRequest.id], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (salePendingInvoice) {
    return {
      state: 'sale_pending_invoice', shouldContact: false, urgency: 'none', suggestedDelayHours: null,
      reason: 'المحادثة تبدو مغلقة على بيع لكن الفاتورة لم تتأكد بعد.',
      nextBestAction: 'انتظر مطابقة ملف المبيعات أولًا؛ لا تعتبر العملية بيعًا ولا ترسل Follow-up شراء قبل الفاتورة.',
      evidenceSourceIds: [salePendingInvoice.id], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (recommendation) {
    const delay = contactedRecently ? 24 : 0;
    return {
      state: 'recommendation_followup', shouldContact: !contactedRecently, urgency: 'normal', suggestedDelayHours: delay,
      reason: 'يوجد ترشيح/استشارة تستحق متابعة النتيجة بعد الاستخدام.',
      nextBestAction: contactedRecently
        ? 'العميل تم التواصل معه قريبًا؛ أجّل المتابعة لتجنب الإزعاج.'
        : 'اسأل عن النتيجة والتحسن ومدى مناسبة الترشيح، بدون تحويل الرسالة إلى بيع مباشر.',
      evidenceSourceIds: [recommendation.id], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (cycle?.verifiedRevenueOver500 && cycle.verifiedInvoiceCount > 0) {
    if (contactedRecently) {
      return {
        state: 'recently_contacted', shouldContact: false, urgency: 'none', suggestedDelayHours: 24,
        reason: 'العميل مهم تجاريًا لكنه تم التواصل معه قريبًا.',
        nextBestAction: 'لا تبعت رسالة جديدة الآن؛ احتفظ به في قائمة رضا عملاء +500 بعد مرور وقت مناسب.',
        evidenceSourceIds: latest ? [latest.id] : [], openActionIds: openActions.map((a) => a.id),
      };
    }
    return {
      state: 'post_purchase_followup', shouldContact: true, urgency: 'normal', suggestedDelayHours: 0,
      reason: `مبيعات مؤكدة في السايكل بقيمة ${cycle.verifiedRevenue.toFixed(2)} ج وتستحق متابعة رضا محسوبة.`,
      nextBestAction: 'أرسل متابعة رضا مختصرة عن آخر تجربة، بدون عرض بيعي إلا لو العميل فتح احتياجًا جديدًا.',
      evidenceSourceIds: latest ? [latest.id] : [], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (contactedRecently) {
    return {
      state: 'recently_contacted', shouldContact: false, urgency: 'none', suggestedDelayHours: 18,
      reason: 'آخر تواصل مع العميل حديث ولا يوجد سبب عاجل لرسالة جديدة.',
      nextBestAction: 'لا تتواصل الآن إلا لو ظهر طلب أو شكوى أو موعد متابعة مستحق.',
      evidenceSourceIds: latest ? [latest.id] : [], openActionIds: openActions.map((a) => a.id),
    };
  }

  if (!sources.length) {
    return {
      state: 'insufficient_context', shouldContact: false, urgency: 'none', suggestedDelayHours: null,
      reason: 'لا توجد محادثات كافية لبناء قرار تواصل.',
      nextBestAction: 'انتظر دخول بيانات محادثة أو فاتورة أو متابعة موثقة.',
      evidenceSourceIds: [], openActionIds: openActions.map((a) => a.id),
    };
  }

  return {
    state: 'healthy', shouldContact: false, urgency: 'none', suggestedDelayHours: null,
    reason: 'رحلة العميل الحالية مستقرة ولا يوجد إجراء مثبت.',
    nextBestAction: 'لا ترسل رسالة تلقائيًا؛ استمر في المراقبة وربط أي طلب أو فاتورة أو متابعة جديدة.',
    evidenceSourceIds: latest ? [latest.id] : [], openActionIds: openActions.map((a) => a.id),
  };
}
