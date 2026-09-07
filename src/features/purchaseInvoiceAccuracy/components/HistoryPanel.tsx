import { Loader2 } from 'lucide-react';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import type { ReviewRow } from '../types';
import { OUTCOME_CONFIG } from '../ui';

type Props = {
  rows: ReviewRow[];
  totalLoaded: number;
  loading: boolean;
  error: boolean;
  historicalSearchActive: boolean;
  historyLoaded: boolean;
  onRetry: () => void;
};

export function HistoryPanel({ rows, totalLoaded, loading, error, historicalSearchActive, historyLoaded, onRetry }: Props) {
  return (
    <Panel className="p-4">
      <SectionTitle title={`آخر المراجعات (${rows.length})`} subtitle={historicalSearchActive ? 'نتائج البحث تشمل السجل التاريخي المطابق' : undefined} />
      {loading && !historicalSearchActive ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : error && !historicalSearchActive ? (
        <EmptyState label="تعذّر تحميل السجل" error onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState label={historyLoaded && totalLoaded === 0 ? 'لسه مفيش مراجعات مسجّلة' : 'مفيش مراجعات مطابقة للبحث والفلاتر الحالية'} />
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((row) => {
            const cfg = OUTCOME_CONFIG[row.outcome];
            return (
              <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.staff_name}</p>
                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}>
                    {cfg.label} ({row.points > 0 ? '+' : ''}{row.points})
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                  {row.review_date} {row.branch ? `— ${row.branch}` : ''} {row.invoice_reference ? `— فاتورة ${row.invoice_reference}` : ''}
                </p>
                {row.reviewed_by_name ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>المراجع: {row.reviewed_by_name}</p> : null}
                {row.notes ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{row.notes}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
