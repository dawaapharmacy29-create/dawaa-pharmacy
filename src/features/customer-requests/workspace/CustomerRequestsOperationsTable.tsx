import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestStatusLabel, CUSTOMER_REQUEST_STAGE_LABELS } from '../domain/status';
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

function customerClass(request: CustomerRequest) {
  const value = String(request.customer_segment || '').toLowerCase();
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
    <div className="overflow-hidden rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-right text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--dawaa-theme-surface-2)] font-black text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="px-3 py-2.5">الصنف</th>
              <th className="px-3 py-2.5">العميل</th>
              <th className="px-3 py-2.5">المتابعة</th>
              <th className="px-3 py-2.5">الحالة</th>
              <th className="px-3 py-2.5">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dawaa-theme-border)]">
            {rows.map((request) => {
              const view = customerRequestOperationalView(request);
              const selected = selectedId === request.id;
              const metric = view.product.code ? productMetrics[view.product.code] : undefined;
              const urgent = request.urgency === 'urgent' || request.is_urgent;

              return (
                <tr
                  key={request.id}
                  onClick={() => onSelect(request)}
                  className={`cursor-pointer align-top transition hover:bg-[var(--dawaa-theme-surface-2)] ${selected ? 'bg-[var(--dawaa-theme-accent-soft)]' : ''}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="max-w-60 font-black leading-5 text-[var(--dawaa-theme-heading)]">{view.product.name || 'صنف غير محدد'}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                      <span>كود {view.product.code || 'غير مربوط'}</span>
                      <span>كمية {view.product.quantity}</span>
                      {metric?.fulfillmentRate !== null && metric?.fulfillmentRate !== undefined ? <span>توفير {metric.fulfillmentRate.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}%</span> : null}
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="max-w-48 font-black text-[var(--dawaa-theme-heading)]">{view.customer.name || 'عميل غير مربوط'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                      <span>كود {view.customer.code || 'غير مربوط'}</span>
                      <span>{customerRequestBranchLabel(request.branch)}</span>
                      <span className={urgent ? 'font-black text-[var(--dawaa-status-danger-text)]' : 'font-black text-[var(--dawaa-theme-primary)]'}>{urgent ? 'عاجل' : customerClass(request)}</span>
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="font-black text-[var(--dawaa-theme-heading)]">{view.registrar.name || 'غير مربوط'}</div>
                    <div className="mt-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{view.owner ? `المسئول: ${view.owner}` : 'بدون مسئول حالي'}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--dawaa-theme-muted)]">
                      <span>تسجيل: {dateTime(request.requested_at || request.created_at)}</span>
                      <span>موعد: {dateTime(view.dueAt)}</span>
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${view.overdue ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : 'border-[var(--dawaa-theme-border)]'}`}>{CUSTOMER_REQUEST_STAGE_LABELS[view.stage]}</span>
                      <span className={`text-[10px] font-black ${view.overdue ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-theme-muted)]'}`}>{ageText(view.ageHours)}</span>
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{customerRequestStatusLabel(request.status)}</div>
                  </td>

                  <td className="px-3 py-2.5">
                    <span className="font-black text-[var(--dawaa-theme-primary)]">{view.primaryAction.label}</span>
                    <div className="mt-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">اضغط للفتح والتنفيذ</div>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? <tr><td colSpan={5} className="px-4 py-10 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات مطابقة للفلاتر الحالية</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
