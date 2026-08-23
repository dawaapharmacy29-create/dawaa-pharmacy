import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestStatusLabel } from '../domain/status';
import { customerRequestBranchLabel } from '../domain/branch';

export interface CustomerRequestProductMetric {
  requestsCount: number;
  fulfilledCount: number;
  fulfillmentRate: number | null;
}

function ageText(hours: number) {
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 24) return `${Math.floor(hours)} س`;
  return `${Math.floor(hours / 24)} يوم`;
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function requestType(request: CustomerRequest) {
  const value = String(request.request_type || '').toLowerCase();
  if (value.includes('urgent')) return 'عاجل';
  if (value.includes('missing') || value.includes('shortage')) return 'صنف ناقص';
  if (value.includes('inquiry')) return 'استفسار';
  return 'عادي';
}

function customerClass(request: CustomerRequest) {
  const payload = request.source_payload || {};
  const value = String(request.customer_segment || payload.customer_segment || payload.segment || payload.customer_type || '').toLowerCase();
  if (/vip|very|مهم جدا/.test(value)) return 'مهم جدًا';
  if (/important|high|مهم/.test(value)) return 'مهم';
  return 'عادي';
}

export default function CustomerRequestsOperationsTable({
  rows,
  selectedId,
  onSelect,
  productMetrics = {},
}: {
  rows: CustomerRequest[];
  selectedId?: string | null;
  onSelect: (request: CustomerRequest) => void;
  productMetrics?: Record<string, CustomerRequestProductMetric>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]">
      <div className="overflow-x-auto">
        <table className="min-w-[1420px] w-full text-right text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--dawaa-theme-surface-2)] font-black text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="px-3 py-3">الصنف / الكود</th>
              <th className="px-3 py-3">العميل / الكود</th>
              <th className="px-3 py-3">التصنيف</th>
              <th className="px-3 py-3">الفرع</th>
              <th className="px-3 py-3">الدكتور المسجل</th>
              <th className="px-3 py-3">التسجيل / الموعد</th>
              <th className="px-3 py-3">معدل توفير الصنف</th>
              <th className="px-3 py-3">الحالة</th>
              <th className="px-3 py-3">العمر</th>
              <th className="px-3 py-3">الإجراء التالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dawaa-theme-border)]">
            {rows.map((request) => {
              const view = customerRequestOperationalView(request);
              const selected = selectedId === request.id;
              const metric = request.product_code ? productMetrics[String(request.product_code)] : undefined;
              return (
                <tr
                  key={request.id}
                  onClick={() => onSelect(request)}
                  className={`cursor-pointer align-top transition hover:bg-[var(--dawaa-theme-surface-2)] ${selected ? 'bg-[var(--dawaa-theme-accent-soft)]' : ''}`}
                >
                  <td className="px-3 py-3">
                    <div className="max-w-52 font-black leading-5 text-[var(--dawaa-theme-heading)]">{view.product.name || 'صنف غير محدد'}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">كود {view.product.code || 'غير مربوط'} · كمية {view.product.quantity}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="max-w-44 font-black text-[var(--dawaa-theme-heading)]">{view.customer.name || 'عميل غير مربوط'}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">كود {view.customer.code || 'غير مربوط'}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-primary)]">{customerClass(request)}</div>
                  </td>
                  <td className="px-3 py-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{requestType(request)}</div><div className={`mt-1 text-[10px] font-black ${request.urgency === 'urgent' || request.is_urgent ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-theme-muted)]'}`}>{request.urgency === 'urgent' || request.is_urgent ? 'عاجل' : request.urgency === 'high' ? 'مهم' : 'عادي'}</div></td>
                  <td className="px-3 py-3 font-black">{customerRequestBranchLabel(request.branch)}</td>
                  <td className="px-3 py-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{view.registrar.name || 'غير مربوط'}</div><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">{view.owner ? `المسئول: ${view.owner}` : 'بدون مسئول حالي'}</div></td>
                  <td className="px-3 py-3"><div className="whitespace-nowrap font-bold">{dateTime(request.requested_at || request.created_at)}</div><div className="mt-1 whitespace-nowrap text-[10px] text-[var(--dawaa-theme-muted)]">مطلوب: {request.needed_by_date ? dateTime(request.needed_by_date) : request.due_date ? dateTime(request.due_date) : 'غير محدد'}</div></td>
                  <td className="px-3 py-3">{metric ? <div><strong className={`text-sm ${Number(metric.fulfillmentRate || 0) >= 70 ? 'text-[var(--dawaa-status-success-text)]' : 'text-[var(--dawaa-status-warning-text)]'}`}>{Number(metric.fulfillmentRate || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%</strong><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">{metric.fulfilledCount}/{metric.requestsCount} خلال الفترة</div></div> : <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">لا توجد عينة كافية</span>}</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${view.overdue ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : 'border-[var(--dawaa-theme-border)]'}`}>{customerRequestStatusLabel(request.status)}</span></td>
                  <td className="px-3 py-3"><span className={view.overdue ? 'font-black text-[var(--dawaa-status-danger-text)]' : 'font-black'}>{ageText(view.ageHours)}</span></td>
                  <td className="px-3 py-3"><span className="font-black text-[var(--dawaa-theme-primary)]">{view.primaryAction.label}</span><div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">اضغط للفتح والتنفيذ</div></td>
                </tr>
              );
            })}
            {!rows.length ? <tr><td colSpan={10} className="px-4 py-12 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات مطابقة للفلاتر الحالية</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
