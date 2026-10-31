import { useEffect, useState } from 'react';
import { CalendarCheck2, Loader2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  AGENDA_ITEM_LABELS, agendaComplianceSummary, agendaErrorMessage, loadAgendaCompliance,
  type AgendaComplianceDay,
} from '@/lib/branchManagerAgenda';

const BRANCH_LABELS = { shokry: 'فرع شكري', elshamy: 'فرع الشامي' } as const;
const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeLabel = (value: string | null) =>
  value ? new Date(value).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }) : '—';

/** «التزام المديرين بقائمة اليوم»: each branch's cycle days, for the general manager and branches manager. */
export function AgendaCompliancePanel({ branch }: { branch: string | null }) {
  const [data, setData] = useState<{ cycle_start: string; today: string; days: AgendaComplianceDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAgendaCompliance(branch).then((result) => { setData(result); setError(null); })
      .catch((err) => setError(agendaErrorMessage(err)));
  }, [branch]);

  const branches = data ? (['shokry', 'elshamy'] as const).filter((key) => data.days.some((day) => day.branch === key)) : [];

  return (
    <Panel className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="dawaa-icon-tile p-3"><CalendarCheck2 className="h-5 w-5" /></div>
        <div>
          <h2 className="dawaa-title text-lg">التزام المديرين بقائمة اليوم</h2>
          <p className="dawaa-caption mt-1 text-xs font-bold">
            {data ? `الدورة من ${dayLabel(data.cycle_start)} · لفة الفرع 3 بنود كل يوم` : 'من علامات مدير الفرع على القائمة'}
          </p>
        </div>
      </div>
      {!data && !error ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      {error ? <p className="text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {data && branches.map((key) => {
          const days = data.days.filter((day) => day.branch === key);
          const summary = agendaComplianceSummary(days, data.today);
          return (
            <details key={key} className="dawaa-theme-border rounded-2xl border p-3" open={branches.length === 1}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-black">
                {BRANCH_LABELS[key]}
                <span className={`dawaa-badge ${summary.full === summary.past ? 'dawaa-badge--success' : 'dawaa-badge--warning'} rounded-full px-2 py-0.5 text-xs`}>
                  {summary.full} من {summary.past} يوم كامل
                </span>
                {summary.issues ? <span className="dawaa-badge dawaa-badge--danger rounded-full px-2 py-0.5 text-xs">{summary.issues} ملاحظة</span> : null}
              </summary>
              <table className="mt-2 w-full text-xs font-bold">
                <thead className="dawaa-caption">
                  <tr><th className="text-start">اليوم</th><th>لفة الفرع</th><th>كل العلامات</th><th>أول علامة</th><th className="text-start">مين</th></tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.day} className="dawaa-theme-border border-t align-top">
                      <td className="py-1">{dayLabel(day.day)}{day.day === data.today ? ' (النهارده)' : ''}</td>
                      <td className="text-center">{day.checks_done}/{day.checks_total}</td>
                      <td className="text-center">{day.marked}</td>
                      <td className="text-center">{timeLabel(day.first_marked_at)}</td>
                      <td>
                        {day.marked_by ?? '—'}
                        {day.issues.map((issue, index) => (
                          <div key={index} className="text-[var(--dawaa-status-warning-text)]">
                            ⚠ {AGENDA_ITEM_LABELS[issue.item]?.title ?? issue.item}: {issue.note}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
