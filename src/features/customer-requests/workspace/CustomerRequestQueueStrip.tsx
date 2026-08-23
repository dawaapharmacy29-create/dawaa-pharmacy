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
    { key: 'open', label: 'يحتاج إجراء', count: summary.open, filter: 'attention' },
    { key: 'urgent', label: 'عاجل', count: summary.urgent, filter: 'urgent' },
    { key: 'overdue', label: 'متأخر', count: summary.overdue, filter: 'overdue' },
    { key: 'ready', label: 'جاهز للتواصل', count: summary.ready, filter: 'attention' },
    { key: 'unassigned', label: 'بدون مسئول', count: summary.unassigned, filter: 'unassigned' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="قوائم تشغيل طلبات العملاء">
      {items.map((item) => {
        const active = activeFilter === item.filter;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.filter)}
            className={`rounded-2xl border px-3 py-3 text-right transition ${
              active
                ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]'
                : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] hover:border-[var(--dawaa-theme-accent-border)]'
            }`}
          >
            <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{item.label}</div>
            <div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{item.count}</div>
          </button>
        );
      })}
    </div>
  );
}
