import {
  buildCustomerIdentity,
  cleanCustomerDisplayName,
  getCustomerActivityState,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupCore';
import {
  getFollowupDataIssues,
  getFollowupDataQualityStatus,
  type FollowupQualityInput,
} from '@/lib/customerFollowupDataQuality';
import {
  isArchivedHistoryFollowup,
  isCancelledHistoryFollowup,
  isCompletedHistoryFollowup,
  isOpenFollowup,
  readFollowupResult,
} from '@/lib/customerServiceFollowupStatus';

type Row = Record<string, unknown>;

function value(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') return candidate;
  }
  return '';
}

function number(row: Row, ...keys: string[]) {
  const parsed = Number(value(row, ...keys));
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildFollowupExportRow(row: Row, exportedAt = new Date()) {
  const customerId = String(value(row, 'customer_id'));
  const customerCode = String(value(row, 'customer_code'));
  const originalName = String(value(row, 'customer_name', 'name'));
  const rawPhone = String(value(row, 'customer_phone', 'phone'));
  const normalizedPhone = normalizeEgyptianPhone(rawPhone);
  const result = readFollowupResult(row);
  const lastPurchase = String(value(row, 'last_purchase_date'));
  const activity = getCustomerActivityState(lastPurchase || null, exportedAt);
  const completed = isCompletedHistoryFollowup(row);
  const cancelled = isCancelledHistoryFollowup(row);
  const archived = isArchivedHistoryFollowup(row);
  const open = isOpenFollowup(row);
  const requestedBy = resolveRequestedBy(row);
  const qualityInput: FollowupQualityInput = {
    customerId,
    customerCode,
    phone: normalizedPhone,
    rawPhone,
    name: originalName,
    branch: String(value(row, 'branch')),
    branchNeedsReview: row.branch_needs_review,
    requestedBy,
    reason: String(value(row, 'followup_reason', 'request_details', 'notes')),
    result,
    nextFollowupDate: String(value(row, 'next_followup_date')),
    lastPurchase,
    source: String(value(row, 'request_source', 'source')),
    salesLoaded: row.sales_loaded === undefined ? null : Boolean(row.sales_loaded),
    customerLinked: Boolean(customerId || customerCode),
    openRequestCount: Number(value(row, 'open_request_count') || 1),
    appearsInCompleted: Boolean(row.appears_in_completed),
    completed,
  };
  const issues = getFollowupDataIssues(qualityInput);

  return {
    'معرف المتابعة': String(value(row, 'id', 'followup_id', 'linked_followup_id')),
    'معرف عنصر القائمة اليومية': String(value(row, 'queue_item_id')),
    'معرف العميل': customerId,
    'مفتاح هوية العميل': buildCustomerIdentity({ customerId, customerCode, phone: rawPhone, name: originalName }),
    'اسم العميل': cleanCustomerDisplayName(originalName),
    'الاسم الأصلي': originalName,
    'كود العميل': customerCode,
    'الهاتف الخام': rawPhone,
    'الهاتف الموحد': normalizedPhone,
    'صلاحية الهاتف': isValidEgyptianMobile(normalizedPhone) ? 'صالح' : 'غير صالح',
    'الفرع': String(value(row, 'branch')),
    'دليل الفرع': String(value(row, 'branch_evidence')),
    'تعارض الفرع': row.branch_needs_review ? 'نعم' : 'لا',
    'المصدر': String(value(row, 'request_source', 'source')),
    'نوع المتابعة': String(value(row, 'request_type', 'followup_type')),
    'الأولوية': String(value(row, 'priority')),
    'درجة الأولوية': number(row, 'priority_score'),
    'سبب الأولوية': String(value(row, 'priority_reason')),
    'مقدم الطلب': requestedBy,
    'معرف مقدم الطلب': String(value(row, 'requested_by_staff_id')),
    'المسؤول الحالي': String(value(row, 'responsible_name', 'assigned_to')),
    'معرف المسؤول': String(value(row, 'assigned_to_staff_id', 'assigned_staff_id')),
    'سبب المتابعة': String(value(row, 'followup_reason', 'request_details', 'notes')),
    'حالة المتابعة': result,
    'حالة قائمة اليوم': String(value(row, 'queue_status')),
    'هل مفتوحة': open ? 'نعم' : 'لا',
    'هل مكتملة': completed ? 'نعم' : 'لا',
    'هل ملغاة': cancelled ? 'نعم' : 'لا',
    'هل مؤرشفة': archived ? 'نعم' : 'لا',
    'عدد الطلبات المفتوحة': Number(value(row, 'open_request_count') || 1),
    'معرفات الطلبات المرتبطة': String(value(row, 'related_request_ids')),
    'مقدمو الطلبات المرتبطون': String(value(row, 'related_requesters')),
    'تاريخ إنشاء أقدم طلب': String(value(row, 'oldest_request_at', 'created_at')),
    'تاريخ إنشاء أحدث طلب': String(value(row, 'newest_request_at', 'created_at')),
    'أول محاولة': String(value(row, 'first_attempt_at')),
    'آخر محاولة': String(value(row, 'last_attempt_at')),
    'عدد المحاولات': Number(value(row, 'attempt_count') || 0),
    'الموعد القادم': String(value(row, 'next_followup_date')),
    'آخر شراء': lastPurchase,
    'عدد الأيام منذ آخر شراء': activity.daysSinceLastPurchase,
    'حالة النشاط': activity.label,
    'المتوسط الشهري': number(row, 'avg_monthly', 'average_monthly_purchase_count'),
    'متوسط الفاتورة': number(row, 'avg_invoice'),
    'إجمالي المشتريات': number(row, 'total_spent'),
    'عدد الفواتير': number(row, 'invoices_count'),
    'حالة تحميل بيانات المبيعات': row.sales_loaded === false ? 'غير محملة' : 'محملة أو غير محددة',
    'وقت الإتمام': String(value(row, 'completed_at', 'closed_at')),
    'النتيجة': result,
    'ملخص المتابعة': String(value(row, 'followup_summary', 'evaluation_summary')),
    'قيمة الشراء بعد المتابعة': number(row, 'purchase_amount'),
    'رقم الفاتورة': String(value(row, 'purchase_invoice_no')),
    'رضا العميل': String(value(row, 'customer_satisfaction')),
    'تقييم الجودة': number(row, 'quality_rating', 'evaluation_score'),
    'تحتاج مديرًا': row.needs_manager ? 'نعم' : 'لا',
    'حالة جودة البيانات': getFollowupDataQualityStatus(qualityInput),
    'عدد مشكلات البيانات': issues.length,
    'مشكلات البيانات': issues.join(' | '),
    'تاريخ التصدير': exportedAt.toISOString(),
  };
}

export function buildFollowupExportRows(rows: Row[], options: { openOnly?: boolean } = {}) {
  const selected = options.openOnly ? rows.filter(isOpenFollowup) : rows;
  return selected.map((row) => buildFollowupExportRow(row));
}
