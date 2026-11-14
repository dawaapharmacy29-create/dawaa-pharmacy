import { AlertTriangle, CalendarClock, Landmark } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { DUE_SOON_DAYS, type CashPlan } from '@/lib/purchaseReview/ledger';
import { count, money, shortBranch, weekdayLabel } from './shared';

// The cash the suppliers will ask for, set against the cash actually in the treasury.

export default function CashPanel({
  plan,
  treasury,
  treasuryError,
  today,
}: {
  plan: CashPlan;
  treasury: number | null;
  treasuryError: string | null;
  today: string;
}) {
  const needNow = plan.overdue + plan.dueSoon;
  const gap = treasury == null ? null : treasury - needNow;
  const afterAll = treasury == null ? null : treasury - plan.owed;
  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="h-5 w-5 text-[var(--dawaa-status-info-text)]" />
        <h2 className="dawaa-title text-lg">الكاش: إحنا فين؟</h2>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Box label="كاش الخزنة دلوقتي" note={treasuryError ?? 'من التقارير المجمعة'}>
          {treasury == null ? '—' : money(treasury)}
        </Box>
        <Box
          label={`مطلوب للموردين لحد ${count(DUE_SOON_DAYS)} أيام`}
          note={plan.overdue ? `منهم ${money(plan.overdue)} متأخر` : 'مفيش متأخر'}
          tone={plan.overdue ? 'danger' : 'warning'}
        >
          {money(needNow)}
        </Box>
        <Box
          label={gap == null ? 'الفرق' : gap >= 0 ? 'فاضل بعد الدفع' : 'ناقص عشان ندفع'}
          note={
            afterAll == null
              ? undefined
              : `بعد كل اللي علينا (${money(plan.owed)}): ${afterAll >= 0 ? 'فاضل' : 'ناقص'} ${money(Math.abs(afterAll))}`
          }
          tone={gap == null ? undefined : gap >= 0 ? 'success' : 'danger'}
        >
          {gap == null ? '—' : money(Math.abs(gap))}
        </Box>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold md:grid-cols-4">
        <Mini label="متأخر" value={plan.overdue} bad={plan.overdue > 0} />
        <Mini label={`مستحق في ${count(DUE_SOON_DAYS)} أيام`} value={plan.dueSoon} />
        <Mini label="اتقفل ومستني ميعاده" value={plan.later} />
        <Mini label="شغّال الشهر ده (لسه بيكبر)" value={plan.running} />
      </div>
      {plan.credits > 0.5 ? (
        <p className="mt-2 text-xs font-black text-[var(--dawaa-status-success-text)]">
          لينا عند موردين {money(plan.credits)} (دفعنا أكتر من فواتيرهم)
        </p>
      ) : null}

      <div className="mt-4">
        <p className="dawaa-caption mb-2 flex items-center gap-1 text-xs font-black">
          <CalendarClock className="h-4 w-4" /> مواعيد الدفع الجاية
        </p>
        {plan.calendar.length ? (
          <ul className="space-y-2">
            {plan.calendar.map((c) => (
              <li
                key={c.due}
                className="dawaa-theme-border rounded-xl border p-2.5 text-xs font-bold"
                style={{ background: 'var(--dawaa-theme-surface)' }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                    {c.due === today ? 'النهارده' : weekdayLabel(c.due)}
                  </span>
                  <span className="text-base font-black tabular-nums">{money(c.amount)}</span>
                </div>
                <p className="dawaa-caption mt-1 leading-relaxed">
                  {c.suppliers.slice(0, 6).map((s, i) => (
                    <span key={`${s.name}-${s.branch}`}>
                      {i ? ' · ' : ''}
                      <span className={s.overdue ? 'text-[var(--dawaa-status-danger-text)]' : ''}>
                        {s.overdue ? <AlertTriangle className="inline h-3 w-3" /> : null} {s.name} (
                        {shortBranch(s.branch)}) {money(s.amount)}
                        {s.running ? ' لحد دلوقتي' : ''}
                      </span>
                    </span>
                  ))}
                  {c.suppliers.length > 6 ? ` · و${count(c.suppliers.length - 6)} تانيين` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dawaa-caption text-xs font-bold">مفيش فواتير آجل مقفولة مستنية دفع</p>
        )}
      </div>
    </Panel>
  );
}

function Box({
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
      className="rounded-2xl p-3"
      style={{
        background: tone ? `var(--dawaa-status-${tone}-bg)` : 'var(--dawaa-theme-surface-raised)',
      }}
    >
      <p className="dawaa-caption text-[11px] font-black">{label}</p>
      <p
        className="text-2xl font-black tabular-nums"
        style={{ color: tone ? `var(--dawaa-status-${tone}-text)` : 'var(--dawaa-theme-heading)' }}
      >
        {children}
      </p>
      {note ? <p className="dawaa-caption text-[11px] font-bold">{note}</p> : null}
    </div>
  );
}

function Mini({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="dawaa-theme-border rounded-xl border px-2.5 py-1.5">
      <p className="dawaa-caption truncate text-[10px] font-black">{label}</p>
      <p
        className="text-base font-black tabular-nums"
        style={{ color: bad ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-heading)' }}
      >
        {money(value)}
      </p>
    </div>
  );
}
