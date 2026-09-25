import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCheck2, RefreshCw } from 'lucide-react';
import {
  getEmployeePayrollStatementV1,
  type EmployeePayrollStatementV1,
} from '@/lib/payroll/payrollStatementService';

type Tab = 'summary' | 'attendance' | 'time_off' | 'overtime' | 'transactions' | 'statement' | 'kpi';

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return num(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
}

function duration(value: unknown) {
  const minutes = Math.round(num(value) * 60);
  const hours = Math.floor(minutes / 60);
  const rest = Math.abs(minutes % 60);
  if (!hours) return rest.toLocaleString('ar-EG') + ' دقيقة';
  return rest
    ? hours.toLocaleString('ar-EG') + ':' + String(rest).padStart(2, '0') + ' ساعة'
    : hours.toLocaleString('ar-EG') + ' ساعة';
}

function dayName(value: string) {
  const date = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'Africa/Cairo' }).format(date);
}

function Stat(props: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
      <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{props.label}</div>
      <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{props.value}</div>
      {props.hint ? <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{props.hint}</div> : null}
    </div>
  );
}

export default function PayrollTransparencyPanel(props: { staffId: string; monthCycle: string }) {
  const [statement, setStatement] = useState<EmployeePayrollStatementV1 | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!props.staffId || !props.monthCycle) return;
    setLoading(true);
    setError('');
    try {
      setStatement(await getEmployeePayrollStatementV1(props.staffId, props.monthCycle));
    } catch (e) {
      setStatement(null);
      setError(e instanceof Error ? e.message : 'تعذر تحميل شفافية الدورة');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [props.staffId, props.monthCycle]);

  const approvedTimeOff = useMemo(
    () => statement?.time_off.requests.filter((row) => row.status === 'approved').length || 0,
    [statement]
  );

  if (loading && !statement) {
    return <div className="flex items-center justify-center rounded-3xl border p-8"><RefreshCw className="animate-spin text-teal-300" /></div>;
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">
        تعذر تحميل شفافية الدورة: {error}
        <button type="button" onClick={() => void load()} className="btn-secondary ms-3 !py-1 text-xs">إعادة المحاولة</button>
      </div>
    );
  }

  if (!statement) return null;

  const data = statement;
  const financial = statement.financial;
  const kpi = statement.kpi;
  const engine = data.payroll_engine;
  const attendance = data.attendance.summary;
  const overtime = data.overtime.summary;
  const missing = data.missing_punch.summary;
  const transactions = data.transactions.summary;
  const incentives = data.incentives;
  const earnings = financial.earnings;
  const adjustments = financial.adjustments;

  const tabs: Array<[Tab, string]> = [
    ['summary', 'ملخص الدورة'],
    ['attendance', 'الحضور'],
    ['time_off', 'الإجازات والأذونات'],
    ['overtime', 'الأوفر تايم'],
    ['transactions', 'الحوافز والخصومات'],
    ['statement', 'كشف الموظف'],
    ['kpi', 'الأداء وKPIs'],
  ];

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-teal-200"><FileCheck2 size={18} /> شفافية دورة الراتب V1</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            {data.staff.name} · {data.staff.branch || '-'} · {data.cycle.start} → {data.cycle.end}
          </div>
        </div>
        <div className={
          'rounded-full border px-3 py-1 text-xs font-black ' +
          (data.finalization.ready
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
            : 'border-amber-400/30 bg-amber-400/10 text-amber-200')
        }>
          {data.finalization.ready ? 'جاهز للإقفال المالي' : 'غير جاهز · ' + data.finalization.blockers.length.toLocaleString('ar-EG') + ' مانع'}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              'rounded-xl border px-3 py-2 text-xs font-black ' +
              (tab === id
                ? 'border-teal-400/50 bg-teal-400/10 text-teal-200'
                : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]')
            }
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary ms-auto !py-1.5 text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {tab === 'summary' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="الساعات المحتسبة للأساسي" value={duration(engine.base_payable_hours)} hint={'سعر الساعة: ' + money(engine.true_hourly_rate)} />
            <Stat label="الأساسي المحسوب" value={money(earnings?.base_salary ?? engine.base_salary_computed)} />
            <Stat label="أوفر تايم معتمد" value={duration(overtime.approved_hours)} hint={money(earnings?.approved_overtime ?? overtime.approved_amount)} />
            <Stat label="الحوافز الآلية" value={money(earnings?.automated_incentives_total ?? incentives.automated_incentives_total_egp)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="أيام حضور" value={num(attendance.worked_days).toLocaleString('ar-EG')} />
            <Stat label="إجازات/أذونات معتمدة" value={approvedTimeOff.toLocaleString('ar-EG')} />
            <Stat label="تأخير" value={num(attendance.late_minutes).toLocaleString('ar-EG') + ' دقيقة'} />
            <Stat label="خروج مبكر" value={num(attendance.early_leave_minutes).toLocaleString('ar-EG') + ' دقيقة'} />
            <Stat label="نسيان بصمة" value={num(missing.incidents).toLocaleString('ar-EG')} hint={'خصم فعلي: ' + money(missing.deduction_amount)} />
          </div>
          {(
            <div className="rounded-2xl border border-teal-400/20 bg-teal-400/5 p-3">
              <div className="text-xs font-black text-teal-200">المعادلة المالية الحالية — بدون تكرار الحوافز</div>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div>الأساسي: <b>{money(financial.earnings.base_salary)}</b></div>
                <div>الحوافز الآلية: <b>{money(financial.earnings.automated_incentives_total)}</b></div>
                <div>اللستة: <b>{money(financial.earnings.list_incentive)}</b></div>
                <div>OT المعتمد: <b>{money(financial.earnings.approved_overtime)}</b></div>
                <div>حوافز يدوية أخرى: <b>{money(financial.earnings.manual_other_incentives)}</b></div>
                <div>تسوية يدوية: <b>{money(financial.adjustments.manual_adjustment)}</b></div>
                <div>الخصومات: <b className="text-rose-300">-{money(financial.adjustments.deductions_total)}</b></div>
                <div>الصافي: <b className="text-emerald-300">{money(financial.display_net_salary)}</b></div>
              </div>
              <div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                حافز الأداء داخل إجمالي الحوافز الآلية مرة واحدة فقط. Monthly incentive الظاهر في المحرك مرجع تفسيري ولا يُجمع مرة ثانية.
              </div>
            </div>
          )}

          {!data.finalization.ready && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
              <div className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertTriangle size={16} /> موانع الإقفال</div>
              <div className="mt-2 space-y-1 text-xs text-amber-100">
                {data.finalization.blockers.map((item, index) => (
                  <div key={String(item.code || index) + '-' + index}>• {String(item.label || item.code || 'مراجعة مطلوبة')}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'attendance' && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-right text-xs">
            <thead><tr className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
              <th className="p-2">اليوم</th><th className="p-2">الحالة</th><th className="p-2">الساعات المحتسبة</th><th className="p-2">تأخير</th><th className="p-2">خروج مبكر</th>
            </tr></thead>
            <tbody>
              {data.attendance.days.map((row) => (
                <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)]/50">
                  <td className="p-2 font-black">{dayName(row.date)}<div className="text-[10px] text-[var(--dawaa-theme-muted)]">{row.date}</div></td>
                  <td className="p-2">{row.resolution_status || row.status || '-'}</td>
                  <td className="p-2 font-black">{duration(row.payroll_eligible_hours ?? row.candidate_hours)}</td>
                  <td className="p-2">{row.late_minutes.toLocaleString('ar-EG')} د</td>
                  <td className="p-2">{row.early_leave_minutes.toLocaleString('ar-EG')} د</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'time_off' && (
        <div className="mt-4 space-y-2">
          {data.time_off.requests.length ? data.time_off.requests.map((row) => (
            <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3 text-xs">
              <div className="flex items-center justify-between gap-2"><b>{row.label || row.kind}</b><span>{row.status}</span></div>
              <div className="mt-1 text-[var(--dawaa-theme-muted)]">{row.start_date} → {row.end_date}</div>
              {row.reason ? <div className="mt-1">{row.reason}</div> : null}
            </div>
          )) : <div className="p-6 text-center text-sm text-[var(--dawaa-theme-muted)]">لا توجد إجازات أو أذونات في هذه الدورة.</div>}
        </div>
      )}

      {tab === 'overtime' && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="إجمالي المرشح" value={duration(overtime.detected_hours)} />
            <Stat label="معتمد" value={duration(overtime.approved_hours)} hint={money(overtime.approved_amount)} />
            <Stat label="معلق" value={duration(overtime.pending_hours)} />
            <Stat label="مرفوض" value={duration(overtime.rejected_hours)} />
          </div>
          {data.overtime.cases.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3 text-xs">
              <b>{dayName(row.date)} · {row.date}</b><span>{duration(row.overtime_hours)}</span><span>{row.status === 'approved' ? money(row.overtime_amount) : '-'}</span><span>{row.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'statement' && financial && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
            <div className="text-base font-black text-[var(--dawaa-theme-heading)]">كشف راتب الموظف — معاينة شفافة</div>
            <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              {data.staff.name} · {data.cycle.start} → {data.cycle.end}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="ساعات أساسي" value={duration(engine.base_payable_hours)} hint={'× ' + money(engine.true_hourly_rate)} />
              <Stat label="الأساسي" value={money(financial.earnings.base_salary)} />
              <Stat label="إضافي معتمد" value={money(financial.earnings.approved_overtime)} hint={duration(overtime.approved_hours)} />
              <Stat label="الصافي الحالي" value={money(financial.display_net_salary)} hint={financial.frozen ? 'قيمة مجمدة' : 'Preview قبل الإقفال'} />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-xs">
              <div className="font-black text-emerald-200">المستحقات</div>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between"><span>الراتب الأساسي</span><b>{money(financial.earnings.base_salary)}</b></div>
                <div className="flex justify-between"><span>حوافز آلية</span><b>{money(financial.earnings.automated_incentives_total)}</b></div>
                <div className="flex justify-between"><span>حافز اللستة</span><b>{money(financial.earnings.list_incentive)}</b></div>
                <div className="flex justify-between"><span>Overtime معتمد</span><b>{money(financial.earnings.approved_overtime)}</b></div>
                <div className="flex justify-between"><span>حوافز أخرى يدوية</span><b>{money(financial.earnings.manual_other_incentives)}</b></div>
              </div>
            </div>
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-xs">
              <div className="font-black text-rose-200">الخصومات والتسويات</div>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between"><span>عجز / إكسبير</span><b>{money(financial.adjustments.expiry_shortage_deduction)}</b></div>
                <div className="flex justify-between"><span>خصم عام فرع</span><b>{money(financial.adjustments.branch_general_deduction)}</b></div>
                <div className="flex justify-between"><span>خصم فردي</span><b>{money(financial.adjustments.individual_deduction)}</b></div>
                <div className="flex justify-between"><span>خصومات أخرى</span><b>{money(financial.adjustments.other_deduction)}</b></div>
                <div className="flex justify-between"><span>تسوية يدوية (+/-)</span><b>{money(financial.adjustments.manual_adjustment)}</b></div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4 text-xs">
            <div className="font-black text-[var(--dawaa-theme-heading)]">رصيد الإجازة السنوية</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {data.annual_leave.balances.map((balance) => (
                <div key={balance.year} className="rounded-xl bg-[var(--dawaa-theme-bg-soft)] p-3">
                  <div className="font-black">{balance.year}</div>
                  {balance.configured ? (
                    <div className="mt-1 space-y-1">
                      <div>المتبقي: <b>{num(balance.balance).toLocaleString('ar-EG')} يوم</b></div>
                      <div>المستخدم: <b>{num(balance.used).toLocaleString('ar-EG')} يوم</b></div>
                      <div>المحجوز: <b>{num(balance.reserved).toLocaleString('ar-EG')} يوم</b></div>
                    </div>
                  ) : <div className="mt-1 text-amber-200">الرصيد غير مُهيأ</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4 text-xs">
            <div className="font-black text-[var(--dawaa-theme-heading)]">اتحسب / لم يتحسب</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl bg-emerald-400/5 p-3">
                <b className="text-emerald-200">اتحسب:</b> Attendance Truth المعتمد فقط · الأساسي {duration(engine.base_payable_hours)} · Overtime معتمد {duration(overtime.approved_hours)}.
              </div>
              <div className="rounded-xl bg-amber-400/5 p-3">
                <b className="text-amber-200">لم يتحسب بعد:</b> Overtime معلق {duration(overtime.pending_hours)} · حركات مالية معلقة {num(transactions.pending_rows).toLocaleString('ar-EG')}.
              </div>
              <div className="rounded-xl bg-slate-400/5 p-3">
                <b>لم يتحسب:</b> Overtime مرفوض {duration(overtime.rejected_hours)} · نقاط الأداء غير المالية لا تخصم جنيهات إلا بعد تحويلها لحافز/خصم مالي معتمد.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4 text-xs">
            <div className="font-black text-[var(--dawaa-theme-heading)]">ملخص الشفافية</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>أيام حضور: <b>{num(attendance.worked_days).toLocaleString('ar-EG')}</b></div>
              <div>إجازات/أذونات: <b>{approvedTimeOff.toLocaleString('ar-EG')}</b></div>
              <div>تأخير: <b>{num(attendance.late_minutes).toLocaleString('ar-EG')} دقيقة</b></div>
              <div>خروج مبكر: <b>{num(attendance.early_leave_minutes).toLocaleString('ar-EG')} دقيقة</b></div>
              <div>نسيان بصمة: <b>{num(missing.incidents).toLocaleString('ar-EG')}</b></div>
              <div>OT معتمد: <b>{duration(overtime.approved_hours)}</b></div>
              <div>OT معلق: <b>{duration(overtime.pending_hours)}</b></div>
              <div>OT مرفوض: <b>{duration(overtime.rejected_hours)}</b></div>
            </div>
            <div className="mt-3 rounded-xl bg-[var(--dawaa-theme-bg-soft)] p-3 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
              هذه معاينة قبل PDF النهائي. نقاط الأداء غير المالية تظهر في تبويب الحوافز والخصومات ولا تُعامل كخصم نقدي إلا إذا نتج عنها Amount مالي فعلي.
            </div>
          </div>
        </div>
      )}

      {tab === 'kpi' && kpi && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
              <div className="text-sm font-black text-[var(--dawaa-theme-heading)]">أداء الموظف</div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>نقاط مكافآت: <b>{num(kpi.staff_performance.reward_points).toLocaleString('ar-EG')}</b></div>
                <div>نقاط خصم: <b>{num(kpi.staff_performance.deduction_points).toLocaleString('ar-EG')}</b></div>
                <div>صافي النقاط: <b>{num(kpi.staff_performance.final_points).toLocaleString('ar-EG')}</b></div>
                <div>نسبة التقدم: <b>{num(kpi.staff_performance.progress_pct).toLocaleString('ar-EG')}%</b></div>
                <div>حافز النقاط: <b>{money(kpi.staff_performance.points_incentive_egp)}</b></div>
                <div>حافز نهائي: <b>{money(kpi.staff_performance.final_incentive_egp)}</b></div>
                <div>مكافآت معلقة: <b>{num(kpi.staff_performance.pending_reward_points).toLocaleString('ar-EG')}</b></div>
                <div>خصومات نقاط معلقة: <b>{num(kpi.staff_performance.pending_deduction_points).toLocaleString('ar-EG')}</b></div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
              <div className="text-sm font-black text-[var(--dawaa-theme-heading)]">أداء الفرع</div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>التارجت: <b>{money(kpi.branch_target.target_amount)}</b></div>
                <div>المبيعات: <b>{money(kpi.branch_target.sales_total)}</b></div>
                <div>تحقيق التارجت: <b>{num(kpi.branch_target.achievement_percent).toLocaleString('ar-EG')}%</b></div>
                <div>عدد الفواتير: <b>{num(kpi.branch_target.invoices_count).toLocaleString('ar-EG')}</b></div>
                <div>متوسط يومي: <b>{money(kpi.branch_target.avg_daily_sales)}</b></div>
                <div>المتبقي: <b>{money(kpi.branch_target.remaining_amount)}</b></div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
            <div className="text-sm font-black text-[var(--dawaa-theme-heading)]">مؤشرات الفرع خلال دورة الراتب</div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>صافي المبيعات: <b>{money(kpi.branch_kpis.sales_net_total)}</b></div>
              <div>عدد الفواتير: <b>{num(kpi.branch_kpis.invoices_count).toLocaleString('ar-EG')}</b></div>
              <div>متوسط الفاتورة: <b>{money(kpi.branch_kpis.avg_invoice)}</b></div>
              <div>العملاء: <b>{num(kpi.branch_kpis.unique_customers).toLocaleString('ar-EG')}</b></div>
            </div>
          </div>

          {!kpi.employee_sales_kpi.available && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-[11px] font-bold text-amber-100">
              مبيعات الموظف الفردية لم تُضف بعد إلى كشف الراتب لأننا لم نربطها بعقد Canonical واحد حتى الآن. لن نعرض رقمًا قد يتغير بسبب اختلاف أسماء البائع أو الـaliases.
            </div>
          )}
          <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
            مؤشرات الأداء سياق للشفافية. التأثير المالي يدخل الراتب فقط من خلال Incentive Truth المعتمدة.
          </div>
        </div>
      )}

      {tab === 'transactions' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="حركات فعالة/معتمدة" value={num(transactions.active_or_approved_rows).toLocaleString('ar-EG')} />
            <Stat label="حركات معلقة" value={num(transactions.pending_rows).toLocaleString('ar-EG')} />
            <Stat label="مبالغ فعالة/معتمدة" value={money(transactions.active_or_approved_amount)} />
            <Stat label="نقاط فعالة/معتمدة" value={num(transactions.active_or_approved_points).toLocaleString('ar-EG')} />
          </div>
          {data.transactions.items.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3 text-xs sm:grid-cols-4">
              <div><b>{row.title || row.source || row.type || 'حركة'}</b><div className="text-[var(--dawaa-theme-muted)]">{row.reason || '-'}</div></div>
              <div>الحالة: <b>{row.status || '-'}</b></div>
              <div>المبلغ: <b>{money(row.amount)}</b></div>
              <div>النقاط: <b>{row.points.toLocaleString('ar-EG')}</b></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
