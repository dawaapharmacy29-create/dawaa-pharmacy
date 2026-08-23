import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestStatusLabel } from '../domain/status';
import { customerRequestBranchLabel } from '../domain/branch';

function ageText(hours: number) {
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 24) return `${Math.floor(hours)} س`;
  return `${Math.floor(hours / 24)} يوم`;
}

export default function CustomerRequestsOperationsTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: CustomerRequest[];
  selectedId?: string | null;
  onSelect: (request: CustomerRequest) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-[var(--dawaa-theme-surface-2)] text-xs font-black text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="px-3 py-3">الصنف</th>
              <th className="px-3 py-3">العميل</th>
              <th className="px-3 py-3">الفرع</th>
              <th className="px-3 py-3">المرحلة</th>
              <th className="px-3 py-3">المسئول</th>
              <th className="px-3 py-3">العمر</th>
              <th className="px-3 py-3">الإجراء التالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dawaa-theme-border)]">
            {rows.map((request) => {
              const view = customerRequestOperationalView(request);
              const selected = selectedId === request.id;
              return (
                <tr
                  key={request.id}
                  onClick={() => onSelect(request)}
                  className={`cursor-pointer transition hover:bg-[var(--dawaa-theme-surface-2)] ${
                    selected ? 'bg-[var(--dawaa-theme-accent-soft)]' : ''
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="font-black text-[var(--dawaa-theme-heading)]">{view.product.name || 'صنف غير محدد'}</div>
                    <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{view.product.code || 'بدون كود صنف'} · الكمية {view.product.quantity}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-bold text-[var(--dawaa-theme-heading)]">{view.customer.name || 'عميل غير مربوط'}</div>
                    <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{view.customer.code || 'بدون كود عميل'}</div>
                  </td>
                  <td className="px-3 py-3 font-bold">{customerRequestBranchLabel(request.branch)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-xs font-bold">
                      {customerRequestStatusLabel(request.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3">{view.owner || 'غير مسند'}</td>
                  <td className="px-3 py-3">
                    <span className={view.overdue ? 'font-black text-[var(--dawaa-status-danger-text)]' : ''}>{ageText(view.ageHours)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-black text-[var(--dawaa-theme-primary)]">{view.primaryAction.label}</span>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-bold text-[var(--dawaa-theme-muted)]">
                  لا توجد طلبات مطابقة للفلاتر الحالية
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
