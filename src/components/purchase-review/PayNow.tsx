import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { DUE_SOON_DAYS, type CashPlan, type PayItem } from '@/lib/purchaseReview/ledger';
import { count, dayLabel, money, shortBranch, weekdayLabel } from './shared';

// «المطلوب دفعه»: three numbers and who to pay this week, one row per supplier (both branches together).
// Suppliers under SMALL fold into one line so the big ones stay on top.

const SMALL = 5000;

export default function PayNow({
  plan,
  items,
  treasury,
  treasuryError,
  today,
  onOpenSupplier,
}: {
  plan: CashPlan;
  items: PayItem[];
  treasury: number | null;
  treasuryError: string | null;
  today: string;
  onOpenSupplier: (code: string) => void;
}) {
  const [showSmall, setShowSmall] = useState(false);
  const need = items.reduce((s, i) => s + i.amount, 0);
  const small = items.filter((i) => i.amount < SMALL);
  const shown = showSmall ? items : items.filter((i) => i.amount >= SMALL);
  const gap = treasury == null ? null : treasury - need;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Big label="في الخزنة دلوقتي" note={treasuryError ?? 'من التقارير المجمعة'}>
          {treasury == null ? '—' : money(treasury)}
        </Big>
        <Big
          label={`مطلوب تدفعه لحد ${count(DUE_SOON_DAYS)} أيام`}
          note={plan.overdue > 0.5 ? `منه ${money(plan.overdue)} متأخر` : 'مفيش متأخر'}
          tone={plan.overdue > 0.5 ? 'danger' : 'warning'}
        >
          {money(need)}
        </Big>
        <Big
          label={gap == null ? 'الفرق' : gap >= 0 ? 'هيفضل معاك' : 'ناقصك'}
          tone={gap == null ? undefined : gap >= 0 ? 'success' : 'danger'}
        >
          {gap == null ? '—' : money(Math.abs(gap))}
        </Big>
      </div>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="dawaa-title text-lg">ادفع لمين الأسبوع ده</h2>
          <p className="dawaa-caption text-xs font-bold">اضغط على المورد تشوف فواتيره ودفعاته</p>
        </div>
        {items.length ? (
          <ul className="space-y-1.5">
            {shown.map((i) => (
              <li key={i.code}>
                <button
                  type="button"
                  onClick={() => onOpenSupplier(i.code)}
                  className="dawaa-theme-border flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start"
                  style={{
                    background: i.overdue
                      ? 'var(--dawaa-status-danger-bg)'
                      : 'var(--dawaa-theme-surface)',
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-black">{i.name}</span>
                    <span className="dawaa-caption block text-[11px] font-bold">
                      {i.branches
                        .map((b) => `${shortBranch(b.branch)} ${money(b.amount)}`)
                        .join(' · ')}
                      {i.running ? ` · لسه بيتجمع لحد ${dayLabel(i.runningTo ?? today)}` : ''}
                    </span>
                    {i.credits.length ? (
                      <span className="block text-[11px] font-black text-[var(--dawaa-status-success-text)]">
                        {i.credits
                          .map((c) => `${shortBranch(c.branch)} طالع لينا ${money(c.amount)}`)
                          .join(' · ')}{' '}
                        · راجعها قبل ما تدفع
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`dawaa-badge ${i.overdue ? 'dawaa-badge--danger' : 'dawaa-badge--warning'} text-[11px]`}
                    >
                      {i.overdue ? (
                        <>
                          <AlertTriangle className="h-3 w-3" /> متأخر من {dayLabel(i.due)}
                        </>
                      ) : i.due === today ? (
                        'النهارده'
                      ) : (
                        weekdayLabel(i.due)
                      )}
                    </span>
                    <span className="text-base font-black tabular-nums">{money(i.amount)}</span>
                  </span>
                </button>
              </li>
            ))}
            {small.length && !showSmall ? (
              <li>
                <button
                  type="button"
                  onClick={() => setShowSmall(true)}
                  className="dawaa-theme-border flex w-full items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2 text-start text-xs font-bold"
                >
                  <span>
                    و{count(small.length)} موردين صغيرين (كل واحد أقل من {money(SMALL)})
                  </span>
                  <span className="text-sm font-black tabular-nums">
                    {money(small.reduce((s, i) => s + i.amount, 0))}
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="dawaa-caption text-sm font-bold">مفيش حاجة مستحقة الأسبوع ده ✓</p>
        )}
        <p className="dawaa-caption mt-3 text-xs font-bold">
          علينا كله {money(plan.owed)}
          {plan.running > 0.5 ? ` · منه ${money(plan.running)} فواتير الشهر ده لسه بتتجمع` : ''}
          {plan.later > 0.5 ? ` · و${money(plan.later)} ميعادها بعد الأسبوع ده` : ''}
        </p>
      </Panel>
    </div>
  );
}

function Big({
  label,
  note,
  tone,
  children,
}: {
  label: string;
  note?: string;
  tone?: 'danger' | 'warning' | 'success';
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: tone ? `var(--dawaa-status-${tone}-bg)` : 'var(--dawaa-theme-surface-raised)',
      }}
    >
      <p className="dawaa-caption text-xs font-black">{label}</p>
      <p
        className="text-3xl font-black tabular-nums"
        style={{ color: tone ? `var(--dawaa-status-${tone}-text)` : 'var(--dawaa-theme-heading)' }}
      >
        {children}
      </p>
      {note ? <p className="dawaa-caption text-xs font-bold">{note}</p> : null}
    </div>
  );
}
