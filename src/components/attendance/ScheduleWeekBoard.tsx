import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Stethoscope, Truck } from 'lucide-react';
import { DAYS_AR } from '@/lib/constants';
import {
  resolveScheduleCell,
  type ScheduleActualDay,
  type ScheduleCell,
  type ScheduleCellKind,
  type SchedulePlanDay,
} from '@/lib/hr/scheduleActualCell';

export type ScheduleBoardEmployee = { id: string; name: string; role: string; branch: string };

const CELL_TONE: Record<ScheduleCellKind, string> = {
  present: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  planned: 'border-[#2d4063] bg-white/[0.03] text-slate-300',
  off: 'border-slate-500/20 bg-slate-500/10 text-slate-400',
  checkout_only_on_off: 'border-slate-500/20 bg-slate-500/10 text-slate-400',
  leave: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  worked_on_off: 'border-amber-400/50 bg-amber-500/15 text-amber-200',
  missing_punch: 'border-orange-400/40 bg-orange-500/10 text-orange-200',
  no_punch: 'border-red-400/50 bg-red-500/15 text-red-200',
  no_data: 'border-dashed border-slate-500/40 text-slate-500',
  unscheduled: 'border-dashed border-slate-500/40 text-slate-500',
};

const LEGEND: Array<[ScheduleCellKind, string]> = [
  ['present', 'حضر'],
  ['planned', 'مخطط'],
  ['off', 'راحة'],
  ['leave', 'إجازة معتمدة'],
  ['worked_on_off', 'حضر في يوم راحته أو إجازته'],
  ['missing_punch', 'بصمة ناقصة'],
  ['no_punch', 'لم يبصم'],
];

function CellView({ cell }: { cell: ScheduleCell }) {
  const showActual = cell.actualIn || cell.actualOut;
  return (
    <div className={`mx-auto flex min-h-[58px] w-full max-w-[118px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1 text-[11px] leading-4 ${CELL_TONE[cell.kind]}`}>
      <span className="font-bold">{cell.label}</span>
      {showActual ? (
        <span className="num font-bold" dir="ltr">{cell.actualIn || '--:--'} → {cell.actualOut || '--:--'}</span>
      ) : null}
      {cell.plan ? <span className="num text-[10px] opacity-70" dir="ltr">{cell.plan}</span> : null}
      {cell.changedByDate ? <span className="text-[10px] font-bold text-amber-300">تعديل بتاريخ</span> : null}
    </div>
  );
}

export default function ScheduleWeekBoard(props: {
  employees: ScheduleBoardEmployee[];
  weekDates: string[];
  today: string;
  planFor: (employee: ScheduleBoardEmployee, day: string) => SchedulePlanDay;
  actuals: Map<string, ScheduleActualDay>;
  actualsAvailable: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  canGoNext: boolean;
}) {
  const { employees, weekDates, today, planFor, actuals, actualsAvailable } = props;

  const groups = useMemo(() => {
    const map = new Map<string, ScheduleBoardEmployee[]>();
    for (const employee of employees) {
      map.set(employee.branch, [...(map.get(employee.branch) || []), employee]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [employees]);

  const cellFor = (employee: ScheduleBoardEmployee, index: number) =>
    resolveScheduleCell({
      date: weekDates[index],
      today,
      plan: planFor(employee, DAYS_AR[index]),
      actual: actuals.get(`${employee.id}::${weekDates[index]}`) || null,
      actualsAvailable,
    });

  return (
    <section className="overflow-hidden rounded-2xl border border-[#2d4063] bg-[#1B2B4B]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#2d4063] p-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="الأسبوع السابق" onClick={props.onPreviousWeek} className="rounded-lg border border-[#2d4063] p-1.5 text-slate-300 hover:border-teal-500/30"><ChevronRight size={16} /></button>
          <span className="num px-2 text-xs font-bold text-white" dir="ltr">{weekDates[0]} → {weekDates[6]}</span>
          <button type="button" aria-label="الأسبوع التالي" disabled={!props.canGoNext} onClick={props.onNextWeek} className="rounded-lg border border-[#2d4063] p-1.5 text-slate-300 hover:border-teal-500/30 disabled:opacity-30"><ChevronLeft size={16} /></button>
        </div>
        <div className="mr-auto flex flex-wrap gap-1.5">
          {LEGEND.map(([kind, label]) => (
            <span key={kind} className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${CELL_TONE[kind]}`}>{label}</span>
          ))}
        </div>
      </div>

      <div className="hidden max-h-[75vh] overflow-auto md:block">
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky right-0 z-30 min-w-[150px] border-b border-[#2d4063] bg-[#152235] px-3 py-2 text-right text-xs font-semibold text-slate-400">الموظف</th>
              {DAYS_AR.map((day, index) => (
                <th key={day} className={`min-w-[122px] border-b border-[#2d4063] bg-[#152235] px-1 py-2 text-center text-xs font-semibold ${weekDates[index] === today ? 'text-teal-300' : 'text-slate-400'}`}>
                  {day}
                  <div className="num text-[10px] font-normal opacity-70">{weekDates[index].slice(5)}</div>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(([branch, rows]) => (
            <tbody key={branch}>
              <tr><td colSpan={8} className="bg-white/[0.04] px-3 py-1.5 text-xs font-black text-teal-300">{branch} · {rows.length}</td></tr>
              {rows.map((employee) => (
                <tr key={employee.id}>
                  <td className="sticky right-0 z-10 border-b border-[#2d4063]/50 bg-[#1B2B4B] px-3 py-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      {/صيدل|pharmacist/i.test(employee.role) && <Stethoscope size={13} className="text-teal-300" />}
                      {/توصيل|delivery/i.test(employee.role) && <Truck size={13} className="text-amber-300" />}
                      {employee.name}
                    </div>
                  </td>
                  {DAYS_AR.map((day, index) => (
                    <td key={day} className={`border-b border-[#2d4063]/50 p-1 ${weekDates[index] === today ? 'bg-teal-500/[0.06]' : ''}`}>
                      <CellView cell={cellFor(employee, index)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="space-y-3 p-3 md:hidden">
        {employees.map((employee) => (
          <div key={employee.id} className="rounded-xl border border-[#2d4063] p-3">
            <div className="mb-2 text-sm font-bold text-white">{employee.name} <span className="text-xs font-normal text-slate-400">· {employee.branch}</span></div>
            <div className="grid grid-cols-2 gap-1.5">
              {DAYS_AR.map((day, index) => (
                <div key={day}>
                  <div className={`mb-0.5 text-center text-[10px] ${weekDates[index] === today ? 'text-teal-300' : 'text-slate-400'}`}>{day}</div>
                  <CellView cell={cellFor(employee, index)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {employees.length === 0 && <div className="py-12 text-center text-slate-400">لا يوجد موظفون نشطون</div>}
    </section>
  );
}
