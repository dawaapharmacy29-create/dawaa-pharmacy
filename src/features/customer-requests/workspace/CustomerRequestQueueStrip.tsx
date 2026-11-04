import type { CustomerRequestCommandSummary, CustomerRequestQuickFilter } from '../data';

type Tone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

type QueueItem = {
  key: string;
  label: string;
  count: number | null;
  filter: CustomerRequestQuickFilter;
  tone: Tone;
};

const TONE: Record<Tone, string> = {
  danger:
    'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
  warning:
    'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
  success:
    'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]',
  info: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
  neutral:
    'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-heading)]',
};

/** The work queues first (colored like Dawaa Bills cards), then the day / history filters as small chips. */
export function customerRequestQueues(summary: CustomerRequestCommandSummary) {
  const work: QueueItem[] = [
    { key: 'attention', label: 'يحتاج إجراء', count: Number(summary.attention || 0), filter: 'attention', tone: 'warning' },
    { key: 'urgent', label: 'عاجل', count: Number(summary.urgent || 0), filter: 'urgent', tone: 'danger' },
    { key: 'ready', label: 'جاهز للتواصل', count: Number(summary.ready || 0), filter: 'ready', tone: 'success' },
    { key: 'followup', label: 'متابعة مستحقة', count: Number(summary.followup_due || 0), filter: 'followup_due', tone: 'info' },
    { key: 'unassigned', label: 'بدون مسئول', count: Number(summary.unassigned || 0), filter: 'unassigned', tone: 'warning' },
  ];
  const more: QueueItem[] = [
    { key: 'today', label: 'اليوم', count: Number(summary.today || 0), filter: 'today', tone: 'neutral' },
    { key: 'yesterday', label: 'أمس', count: null, filter: 'yesterday', tone: 'neutral' },
    { key: 'overdue', label: 'متأخر', count: Number(summary.overdue || 0), filter: 'overdue', tone: 'neutral' },
    { key: 'shortage', label: 'النواقص', count: Number(summary.moved_to_shortage || summary.not_available || 0), filter: 'shortage', tone: 'neutral' },
    { key: 'completed', label: 'تمت', count: Number(summary.delivered || 0), filter: 'completed', tone: 'neutral' },
  ];
  return { work, more };
}

export default function CustomerRequestQueueStrip({
  summary,
  activeFilter,
  onSelect,
}: {
  summary: CustomerRequestCommandSummary;
  activeFilter?: CustomerRequestQuickFilter;
  onSelect: (filter: CustomerRequestQuickFilter) => void;
}) {
  const { work, more } = customerRequestQueues(summary);
  const ring = (item: QueueItem) =>
    activeFilter === item.filter ? 'ring-2 ring-[var(--dawaa-theme-accent-border)] ring-offset-1' : '';

  return (
    <div className="space-y-2" aria-label="قوائم تشغيل طلبات العملاء">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {work.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={activeFilter === item.filter}
            onClick={() => onSelect(item.filter)}
            className={`rounded-2xl border px-3 py-2.5 text-right transition hover:opacity-90 ${item.count ? TONE[item.tone] : TONE.neutral} ${item.count ? '' : 'opacity-60'} ${ring(item)}`}
          >
            <span className="block text-[11px] font-black">{item.label}</span>
            <strong className="mt-0.5 block text-2xl font-black">{(item.count ?? 0).toLocaleString('ar-EG')}</strong>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {more.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={activeFilter === item.filter}
            onClick={() => onSelect(item.filter)}
            className={`rounded-full border px-3 py-1 text-[11px] font-black transition ${TONE.neutral} ${ring(item)}`}
          >
            {item.label}
            {item.count == null ? null : <span className="mr-1 text-[var(--dawaa-theme-primary)]">{item.count.toLocaleString('ar-EG')}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
