import type { CustomerRequestCommandSummary, CustomerRequestQuickFilter } from '../data';

type QueueItem = {
  key: string;
  label: string;
  hint: string;
  count: number | null;
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
    { key: 'today', label: 'اليوم', hint: 'طلبات اليوم', count: Number(summary.today || 0), filter: 'today' },
    { key: 'yesterday', label: 'أمس', hint: 'طلبات أمس', count: null, filter: 'yesterday' },
    { key: 'attention', label: 'يحتاج إجراء', hint: 'المفتوح حديثًا', count: summary.attention, filter: 'attention' },
    { key: 'urgent', label: 'عاجل', hint: 'أولوية قصوى', count: summary.urgent, filter: 'urgent' },
    { key: 'overdue', label: 'متأخر', hint: 'تجاوز SLA', count: summary.overdue, filter: 'overdue' },
    { key: 'ready', label: 'جاهز للتواصل', hint: 'الصنف متوفر', count: summary.ready, filter: 'ready' },
    { key: 'followup', label: 'متابعة مستحقة', hint: 'موعد التواصل حان', count: Number(summary.followup_due || 0), filter: 'followup_due' },
    { key: 'shortage', label: 'النواقص', hint: 'أصناف غير متوفرة', count: Number(summary.moved_to_shortage || summary.not_available || 0), filter: 'shortage' },
    { key: 'completed', label: 'تمت', hint: 'تم التسليم', count: Number(summary.delivered || 0), filter: 'completed' },
    { key: 'unassigned', label: 'بدون مسئول', hint: 'يحتاج إسناد', count: summary.unassigned, filter: 'unassigned' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-label="قوائم تشغيل طلبات العملاء">
      {items.map((item) => {
        const active = activeFilter === item.filter;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.filter)}
            className={`rounded-2xl border px-3 py-3 text-right transition ${
              active
                ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] shadow-sm'
                : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] hover:border-[var(--dawaa-theme-accent-border)]'
            }`}
          >
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-[var(--dawaa-theme-heading)]">{item.label}</span><strong className="text-xl text-[var(--dawaa-theme-primary)]">{item.count == null ? '—' : item.count.toLocaleString('ar-EG')}</strong></div>
            <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{item.hint}</div>
          </button>
        );
      })}
    </div>
  );
}
