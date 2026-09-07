import type { InventoryWeeklyProgressCard } from '@/lib/branchChecklistOperations';

function planLabel(state: InventoryWeeklyProgressCard['plan_state']) {
  if (state === 'missing_session') return 'لا توجد جلسة جرد للأسبوع';
  if (state === 'missing_list') return 'الجلسة موجودة — قائمة الأصناف غير مرفوعة';
  if (state === 'ready_not_started') return 'الخطة جاهزة — لم يبدأ الجرد';
  if (state === 'completed') return 'اكتمل جرد الأسبوع';
  return 'الجرد جارٍ';
}

function paceLabel(state: InventoryWeeklyProgressCard['pace_state']) {
  if (state === 'behind') return 'متأخر عن الخطة';
  if (state === 'ahead') return 'متقدم عن الخطة';
  if (state === 'on_track') return 'على الخطة';
  if (state === 'completed') return 'مكتمل';
  return 'لا يمكن قياس السرعة بعد';
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-2 text-center">
      <p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className="text-sm font-black text-[var(--dawaa-theme-heading)]">{value}</p>
    </div>
  );
}

export default function InventoryWeeklyProgressSection({ cards }: { cards: InventoryWeeklyProgressCard[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">تقدم الجرد الأسبوعي الفعلي</h2>
        <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">
          مصدر الأرقام هو جلسات الجرد وأصنافها الفعلية، وليس علامة الـChecklist. عدم تجهيز جلسة أو قائمة الجرد يظهر كمسئولية إدارية ولا يُحسب تقصيرًا على الموظف.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">
          لا توجد مسئوليات جرد أسبوعية في النطاق المحدد.
        </div>
      ) : null}

      {cards.map((card) => {
        const measurable = card.plan_state !== 'missing_session' && card.plan_state !== 'missing_list';
        const behind = card.pace_state === 'behind';
        const hasUnresolved = card.unresolved_discrepancies > 0;
        return (
          <article key={`${card.staff_id}-${card.branch}`} className="dawaa-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-black text-[var(--dawaa-theme-heading)]">{card.staff_name}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">
                  {card.branch} • {card.responsibility_count} نطاق جرد • {card.scheduled_workdays} أيام عمل هذا الأسبوع
                </p>
              </div>
              <span className={`dawaa-badge text-xs ${card.plan_state === 'completed' ? 'dawaa-badge--success' : behind || card.plan_state.startsWith('missing_') ? 'dawaa-badge--warning' : ''}`}>
                {planLabel(card.plan_state)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="جلسات الأسبوع" value={card.session_count} />
              <Metric label="إجمالي الأصناف" value={card.total_items} />
              <Metric label="تم جرده" value={card.counted_items} />
              <Metric label="المتبقي" value={card.remaining_items} />
              <Metric label="تم اليوم" value={card.counted_today} />
              <Metric label="نسبة الإنجاز" value={`${card.progress_pct}%`} />
              <Metric label="المتوقع حتى اليوم" value={`${card.expected_progress_pct}%`} />
              <Metric label="الفروق غير المراجعة" value={card.unresolved_discrepancies} />
            </div>

            {measurable ? (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-[var(--dawaa-theme-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--dawaa-theme-primary)] transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, card.progress_pct))}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
                  <span className={behind ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-theme-muted)]'}>{paceLabel(card.pace_state)}</span>
                  <span className="text-[var(--dawaa-theme-muted)]">الأسبوع: {card.week_start} ← {card.week_end}</span>
                </div>
              </div>
            ) : (
              <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">
                {card.plan_state === 'missing_session'
                  ? 'لم تُنشأ جلسة جرد لهذا الموظف خلال الأسبوع؛ لا يتم احتساب تأخر أو نقص إنجاز عليه.'
                  : 'جلسة الجرد موجودة لكن لا توجد أصناف داخلها حتى الآن؛ ارفع قائمة الأسبوع أولًا قبل قياس أداء الموظف.'}
              </div>
            )}

            {hasUnresolved ? (
              <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">
                يوجد {card.unresolved_discrepancies} فرق جرد غير مراجع من أصل {card.discrepancy_items} فروق. يجب إغلاق أسباب الفروق قبل اعتبار الجرد مكتملًا إداريًا.
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
