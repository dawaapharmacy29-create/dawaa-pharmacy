import { AlertTriangle, Eye, Loader2 } from 'lucide-react';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import type { StaffDirectoryOption } from '@/lib/staffDirectorySearch';
import type { Outcome, QueueRow } from '../types';
import { TRANSACTION_TYPE_LABEL } from '../types';
import { OUTCOME_CONFIG, OUTCOME_ORDER } from '../ui';

type StaffOption = StaffDirectoryOption;

type Props = {
  rows: QueueRow[];
  totalLoaded: number;
  loading: boolean;
  error: boolean;
  historicalSearchActive: boolean;
  actingRowId: string | null;
  resolvingId: string | null;
  resolveSearch: string;
  resolveOptions: StaffOption[];
  pickedStaffByRow: Record<string, StaffOption>;
  onRetry: () => void;
  onOpenDetails: (row: QueueRow) => void;
  onClassify: (row: QueueRow, staffId: string, outcome: Outcome) => void;
  onStartResolving: (rowId: string) => void;
  onResolveSearchChange: (value: string) => void;
  onAssignStaff: (row: QueueRow, staff: StaffOption) => void;
};

export function QueuePanel({
  rows,
  totalLoaded,
  loading,
  error,
  historicalSearchActive,
  actingRowId,
  resolvingId,
  resolveSearch,
  resolveOptions,
  pickedStaffByRow,
  onRetry,
  onOpenDetails,
  onClassify,
  onStartResolving,
  onResolveSearchChange,
  onAssignStaff,
}: Props) {
  return (
    <Panel className="p-4">
      <SectionTitle
        title={`فواتير Base44 محتاجة تصنيف (${rows.length})`}
        subtitle={historicalSearchActive ? 'البحث يشمل السجلات التاريخية المطابقة' : 'متسحبة تلقائي من الدورة الحالية'}
      />
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : error ? (
        <EmptyState label="تعذّر تحميل قائمة Base44" error onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState label={totalLoaded === 0 ? 'مفيش فواتير محتاجة تصنيف دلوقتي' : 'مفيش فواتير مطابقة للبحث والفلاتر الحالية'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const resolvedStaff = row.entered_by_staff_id
              ? { id: row.entered_by_staff_id, name: row.entered_by_staff_name || '', branch: row.branch }
              : pickedStaffByRow[row.id] || null;

            return (
              <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.system_invoice_number ? `فاتورة ${row.system_invoice_number}` : row.base44_id}</p>
                    <button type="button" onClick={() => onOpenDetails(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-[var(--dawaa-theme-soft)]" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary)' }} title="عرض تفاصيل الفاتورة" aria-label="عرض تفاصيل الفاتورة">
                      <Eye size={16} />
                    </button>
                  </div>
                  <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{row.branch} — {row.invoice_date} — {TRANSACTION_TYPE_LABEL[row.transaction_type || ''] || row.transaction_type}</span>
                </div>
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{row.total_value != null ? `${row.total_value} جنيه` : ''}</p>

                {resolvedStaff ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-text)' }}>دخلها: {resolvedStaff.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {OUTCOME_ORDER.map((key) => {
                        const cfg = OUTCOME_CONFIG[key];
                        return (
                          <button key={key} type="button" disabled={actingRowId === row.id} onClick={() => onClassify(row, resolvedStaff.id, key)} className="rounded-lg border py-2 text-xs font-black" style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}>
                            {cfg.label} ({cfg.points > 0 ? '+' : ''}{cfg.points})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : resolvingId === row.id ? (
                  <div className="mt-3 space-y-1">
                    <input type="text" className="input-dark w-full text-sm" placeholder="اكتب اسم الموظف اللي دخلها فعلاً..." value={resolveSearch} onChange={(event) => onResolveSearchChange(event.target.value)} autoFocus />
                    {resolveOptions.length > 0 ? (
                      <div className="space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                        {resolveOptions.map((staff) => (
                          <button key={staff.id} type="button" disabled={actingRowId === row.id} onClick={() => onAssignStaff(row, staff)} className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)] disabled:opacity-60">
                            <span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{staff.name}</span><span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{staff.branch}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button type="button" onClick={() => onStartResolving(row.id)} className="mt-3 flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                    <AlertTriangle size={14} />{row.entered_by_raw ? `"${row.entered_by_raw}" مش معروف — اختار مين ده` : 'مسجّلش اسم — اختار مين دخلها'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
