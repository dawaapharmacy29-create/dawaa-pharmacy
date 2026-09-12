import type { CustomerRequestCommandSummary, CustomerRequestQuickFilter } from '../data';

type QueueItem = {
  key: string;
  label: string;
  count: number;
  filter: CustomerRequestQuickFilter;
};

export default function CustomerRequestQueueStrip({
  summary,
  activeFilter,
  onSelect,
}: {
  summary: CustomerRequestCommandSummary;
  activeFilter?: CustomerRequestQuickFilter;
  onSelect: (filter: CustomerRequestQuickFilter) => void;
}) {
  const items: QueueItem[] = [
    { key: 'attention', label: 'يحتاج إجراء', count: summary.attention, filter: 'attention' },
    { key: 'urgent', label: 'عاجل', count: summary.urgent, filter: 'urgent' },
    { key: 'overdue', label: 'متأخر', count: summary.overdue, filter: 'overdue' },
    { key: 'ready', label: 'جاهز للتواصل', count: summary.ready, filter: 'ready' },
    { key: 'followup', label: 'متابعة مستحقة', count: Number(summary.followup_due || 0), filter: 'followup_due' },
    { key: 'unassigned', label: 'بدون مسئول', count: summary.unassigned, filter: 'unassigned' },
  ];

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="قوائم تشغيل طلبات العملاء">
      {items.map((item) => {
        const active = activeFilter === item.filter;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.filter)}
            className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-right transition ${
              active
                ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] shadow-sm'
                : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] hover:border-[var(--dawaa-theme-accent-border)]'
            }`}
          >
            <span className="text-[11px] font-black text-[var(--dawaa-theme-heading)]">{item.label}</span>
            <strong className="min-w-6 rounded-md bg-[var(--dawaa-theme-surface-2)] px-1.5 py-0.5 text-center text-sm text-[var(--dawaa-theme-primary)]">{item.count.toLocaleString('ar-EG')}</strong>
          </button>
        );
      })}
    </div>
  );
}
