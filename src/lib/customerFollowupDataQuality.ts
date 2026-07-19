import {
  buildCustomerIdentity,
  cleanCustomerDisplayName,
  getCustomerActivityState,
  isMeaningfulText,
  isOpenFollowupResult,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupCore';

export type FollowupQualityInput = {
  customerId?: string | null;
  customerCode?: string | null;
  phone?: string | null;
  rawPhone?: string | null;
  name?: string | null;
  branch?: string | null;
  branchNeedsReview?: boolean;
  requestedBy?: string | null;
  reason?: string | null;
  result?: string | null;
  nextFollowupDate?: string | null;
  lastPurchase?: string | null;
  source?: string | null;
  salesLoaded?: boolean | null;
  customerLinked?: boolean | null;
  openRequestCount?: number | null;
  appearsInCompleted?: boolean;
  completed?: boolean;
};

export type FollowupDataQualityStatus = 'complete' | 'warning' | 'critical';

const invalidNamePattern = /^(عميل غير مسجل|عميل الصيدلية|غير معروف|غير محدد|0)$/i;
const embeddedCodePattern = /(?:\(\s*p\s*\d+\s*\)|\bش\s*\d+\b|\+\+)/i;

export function getFollowupDataIssues(input: FollowupQualityInput) {
  const issues: string[] = [];
  const identity = buildCustomerIdentity({
    customerId: input.customerId,
    customerCode: input.customerCode,
    phone: input.phone || input.rawPhone,
    name: input.name,
  });
  const phone = normalizeEgyptianPhone(input.phone || input.rawPhone);
  const name = String(input.name || '').trim();
  const requestedBy = input.requestedBy || resolveRequestedBy({});
  const activity = getCustomerActivityState(input.lastPurchase);

  if (!isMeaningfulText(input.customerCode)) issues.push('كود العميل غير موجود');
  if (!isMeaningfulText(input.customerId)) issues.push('معرف العميل غير موجود');
  if (!phone) issues.push('رقم الهاتف غير موجود');
  else if (!isValidEgyptianMobile(phone)) issues.push('رقم الهاتف غير صالح');
  if (!isMeaningfulText(input.branch)) issues.push('الفرع غير محدد');
  if (input.branchNeedsReview) issues.push('بيانات الفرع متعارضة');
  if (!isMeaningfulText(requestedBy)) issues.push('مقدم الطلب غير محدد');
  if (!isMeaningfulText(input.reason)) issues.push('سبب المتابعة غير واضح');
  if (String(input.reason || '').trim() === '0') issues.push('سبب المتابعة يساوي 0');
  if (!input.completed && isOpenFollowupResult(input.result) && !input.nextFollowupDate && input.result !== 'الرقم غير صحيح') {
    issues.push('متابعة مفتوحة بدون موعد قادم');
  }
  if (/at_risk|مهدد|متوقف/i.test(String(input.source || '')) && !input.lastPurchase) {
    issues.push('آخر شراء غير موجود للحالة المهددة');
  }
  if (input.salesLoaded === false) issues.push('بيانات المبيعات غير محملة');
  if (input.customerLinked === false || identity === 'unknown') issues.push('ملف العميل غير مربوط');
  if (!name || invalidNamePattern.test(name) || cleanCustomerDisplayName(name) === 'عميل غير مسجل') {
    issues.push('اسم العميل غير صالح');
  }
  if (embeddedCodePattern.test(name)) issues.push('اسم العميل يحتوي كودًا أو ملاحظات داخل الاسم');
  if (Number(input.openRequestCount || 0) > 1) issues.push('أكثر من طلب مفتوح لنفس العميل');
  if (input.appearsInCompleted && !input.completed) issues.push('المتابعة موجودة في المطلوب والمكتمل معًا');
  if (/at_risk|مهدد/i.test(String(input.source || '')) && activity.isCertain && !activity.isAtRisk) {
    issues.push('تصنيف مهدد تم تصحيحه لوجود شراء حديث');
  }
  return [...new Set(issues)];
}

export function getFollowupDataQualityStatus(input: FollowupQualityInput): FollowupDataQualityStatus {
  const issues = getFollowupDataIssues(input);
  if (!issues.length) return 'complete';
  const critical = issues.some((issue) =>
    /اسم العميل غير صالح|ملف العميل غير مربوط|رقم الهاتف غير صالح|الفرع غير محدد|بيانات الفرع متعارضة/.test(issue)
  );
  return critical ? 'critical' : 'warning';
}
