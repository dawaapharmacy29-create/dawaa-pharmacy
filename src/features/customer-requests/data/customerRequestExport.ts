import { exportToExcel } from '@/lib/exportExcel';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestBranchLabel } from '../domain/branch';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestStatusLabel } from '../domain/status';
import { getCustomerRequestsPage, type CustomerRequestPageOptions } from './customerRequestsRepository';

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 5_000;

function cairoDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function customerClass(request: CustomerRequest) {
  const payload = request.source_payload || {};
  const value = String(
    request.customer_segment ||
      payload.customer_segment ||
      payload.segment ||
      payload.customer_type ||
      ''
  ).toLowerCase();
  if (/vip|very|مهم جدا/.test(value)) return 'مهم جدًا';
  if (/important|high|مهم/.test(value)) return 'مهم';
  return 'عادي';
}

function requestClass(request: CustomerRequest) {
  const type = String(request.request_type || '').toLowerCase();
  if (type.includes('urgent')) return 'طلب عاجل';
  if (type.includes('missing') || type.includes('shortage')) return 'صنف ناقص';
  if (type.includes('inquiry')) return 'استفسار';
  return 'طلب عادي';
}

function exportRow(request: CustomerRequest) {
  const view = customerRequestOperationalView(request);
  return {
    'رقم الطلب': request.id,
    'اسم العميل': view.customer.name || '',
    'كود العميل': view.customer.code || '',
    'هاتف العميل': view.customer.phone || '',
    'تصنيف العميل': customerClass(request),
    'اسم الصنف': view.product.name || '',
    'كود الصنف': view.product.code || '',
    'الكمية': view.product.quantity,
    'تصنيف الطلب': requestClass(request),
    'الأولوية': view.urgent ? 'عاجل' : String(request.urgency || request.priority || 'عادي'),
    'الفرع': customerRequestBranchLabel(request.branch),
    'الدكتور المسجل': view.registrar.name || '',
    'المسئول الحالي': view.owner || '',
    'الحالة': customerRequestStatusLabel(request.status),
    'الإجراء التالي': view.primaryAction.label,
    'وقت التسجيل': cairoDateTime(request.requested_at || request.created_at),
    'الموعد المطلوب': cairoDateTime(request.needed_by_date || request.due_date),
    'متأخر': view.overdue ? 'نعم' : 'لا',
    'عمر الطلب بالساعات': Math.round(view.ageHours * 10) / 10,
    'قناة الطلب': request.source_request_channel || '',
    'مصدر محتمل': request.supplier_hint || request.potential_source_text || '',
    'ملاحظات': request.doctor_notes || request.source_notes || '',
  };
}

export async function getCustomerRequestsForExport(
  filters: Omit<CustomerRequestPageOptions, 'page' | 'pageSize'>,
  maxRows = MAX_EXPORT_ROWS
) {
  const limit = Math.min(MAX_EXPORT_ROWS, Math.max(1, maxRows));
  const rows: CustomerRequest[] = [];
  let page = 1;
  let total = 0;

  do {
    const result = await getCustomerRequestsPage({ ...filters, page, pageSize: EXPORT_PAGE_SIZE });
    total = result.count;
    rows.push(...result.rows);
    page += 1;
    if (!result.rows.length) break;
  } while (rows.length < Math.min(total, limit));

  return {
    rows: rows.slice(0, limit),
    total,
    truncated: total > limit,
  };
}

export async function exportCustomerRequestsWorkspace(
  filters: Omit<CustomerRequestPageOptions, 'page' | 'pageSize'>
) {
  const result = await getCustomerRequestsForExport(filters);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  await exportToExcel(
    result.rows.map(exportRow),
    `طلبات_العملاء_${date}`,
    'طلبات العملاء'
  );
  return result;
}
