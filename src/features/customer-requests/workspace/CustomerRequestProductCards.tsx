import { CalendarDays, PackageSearch, UserRound } from 'lucide-react';
import { requestStatusLabel, type CustomerRequest } from '@/lib/api/customerRequests';
import type { CustomerRequestProductMetric } from './CustomerRequestsOperationsTable';

type Props = {
  rows: CustomerRequest[];
  selectedId?: string | null;
  onSelect: (request: CustomerRequest) => void;
  productMetrics?: Record<string, CustomerRequestProductMetric>;
};

const DATE_FORMATTER = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function branchLabel(value?: string | null) {
  const text = String(value || '').toLowerCase();
  if (text.includes('shokry') || text.includes('شكري')) return 'دواء شكري';
  if (text.includes('elshamy') || text.includes('shamy') || text.includes('الشامي')) return 'دواء الشامي';
  return value || 'غير محدد';
}

function responsibleName(request: CustomerRequest) {
  return request.primary_responsible_name
    || request.purchasing_assignee
    || request.source_assigned_employee
    || request.doctor_name
    || 'غير مسند';
}

function requestDate(request: CustomerRequest) {
  const raw = request.requested_at || request.created_at;
  if (!raw) return 'بدون تاريخ';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'بدون تاريخ';
  return DATE_FORMATTER.format(date);
}

export default function CustomerRequestProductCards({ rows, selectedId, onSelect, productMetrics = {} }: Props) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] px-4 py-10 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">
        لا توجد أصناف مطلوبة ضمن الفلاتر الحالية.
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((request) => {
        const productCode = String(request.product_code || '').trim();
        const metric = productCode ? productMetrics[productCode] : undefined;
        const isSelected = request.id === selectedId;
        const isUrgent = Boolean(request.is_urgent) || ['urgent', 'high'].includes(String(request.urgency || '').toLowerCase());
        const imageUrl = request.item_image_url || request.medicine_image_url || null;

        return (
          <button
            key={request.id}
            type="button"
            onClick={() => onSelect(request)}
            className={`group min-w-0 rounded-2xl border p-3 text-right transition hover:-translate-y-0.5 hover:border-[var(--dawaa-theme-accent-border)] hover:shadow-md ${
              isSelected
                ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]'
                : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]">
                {imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <PackageSearch size={20} className="text-[var(--dawaa-theme-primary)]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-[var(--dawaa-theme-heading)]">{request.medicine_name || 'صنف غير محدد'}</h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                      {productCode ? <span>كود {productCode}</span> : <span>بدون كود صنف</span>}
                      <span>·</span>
                      <span>الكمية {Number(request.quantity || 1).toLocaleString('ar-EG')}</span>
                    </div>
                  </div>
                  {isUrgent ? <span className="shrink-0 rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-2 py-0.5 text-[9px] font-black text-[var(--dawaa-status-danger-text)]">عاجل</span> : null}
                </div>

                <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2">
                  <div className="truncate text-xs font-black text-[var(--dawaa-theme-heading)]">{request.customer_name || 'عميل غير محدد'}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                    {request.customer_code ? <span>كود العميل {request.customer_code}</span> : null}
                    <span>{branchLabel(request.branch)}</span>
                  </div>
                </div>

                <div className="mt-2 space-y-1.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                  <div className="flex items-center gap-1.5"><CalendarDays size={12} /> <span>{requestDate(request)}</span></div>
                  <div className="flex min-w-0 items-center gap-1.5"><UserRound size={12} /> <span className="truncate">{responsibleName(request)}</span></div>
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--dawaa-theme-border)] pt-2.5">
              <span className="rounded-lg bg-[var(--dawaa-theme-surface-2)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-theme-heading)]">{requestStatusLabel(request.status)}</span>
              {metric ? (
                <span className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">
                  توفير الصنف {Number(metric.fulfillmentRate || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })}% · {Number(metric.requestsCount || 0).toLocaleString('ar-EG')} طلب
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
