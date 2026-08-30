import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  currentEvaluationCycleLabel,
  previousEvaluationCycleLabel,
} from '@/lib/evaluations/monthlyEvaluationCycle';
import {
  type MonthlyPerformance360Report,
  type ReportSourceStatus,
} from '@/lib/reports/monthlyPerformance360Service';
import { loadScopedMonthlyPerformance360 } from '@/lib/reports/monthlyPerformance360ScopedService';

function money(value: number) {
  return `${Math.round(value).toLocaleString('ar-EG')} ج`;
}

function percent(value: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

function statusLabel(status: ReportSourceStatus) {
  if (status === 'available') return 'متاح';
  if (status === 'partial') return 'جزئي';
  return 'غير متاح';
}

function StatusBadge({ status }: { status: ReportSourceStatus }) {
  const className = status === 'available'
    ? 'dawaa-badge dawaa-badge--success'
    : status === 'partial'
      ? 'dawaa-badge dawaa-badge--warning'
      : 'dawaa-badge dawaa-badge--danger';
  return <span className={`${className} text-[11px]`}>{statusLabel(status)}</span>;
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-4">
      <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className="mt-2 text-xl font-black text-[var(--dawaa-theme-heading)]">{value}</p>
      {note ? <p className="mt-1 text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">{note}</p> : null}
    </div>
  );
}

async function exportExcel(report: MonthlyPerformance360Report) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const overview = [
    { البيان: 'الموظف', القيمة: report.employee.name },
    { البيان: 'الدور', القيمة: report.employee.role },
    { البيان: 'الفرع', القيمة: report.employee.branch },
    { البيان: 'الدورة', القيمة: report.cycle.displayLabel },
    { البيان: 'الدرجة المركبة', القيمة: report.overall.score ?? 'غير مكتملة' },
    { البيان: 'التقدير', القيمة: report.overall.grade },
    { البيان: 'تغطية البيانات', القيمة: `${report.overall.coveragePct}%` },
    { البيان: 'إجمالي المبيعات', القيمة: report.sales.totalSales },
    { البيان: 'عدد الفواتير', القيمة: report.sales.invoiceCount },
    { البيان: 'متوسط الفاتورة', القيمة: report.sales.averageInvoice },
    { البيان: 'نقاط نهاية الدورة', القيمة: report.points.dashboard?.final_points ?? 'غير متاح' },
    { البيان: 'حافز النقاط', القيمة: report.points.dashboard?.final_incentive_egp ?? 'غير متاح' },
  ];
  const overviewSheet = XLSX.utils.json_to_sheet(overview);
  overviewSheet['!cols'] = [{ wch: 28 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'الملخص');

  const pillarRows = report.pillars.map((pillar) => ({
    المحور: pillar.label,
    الوزن: pillar.weight,
    الدرجة: pillar.score ?? 'غير متاح',
    حالة_المصدر: statusLabel(pillar.status),
    التفاصيل: pillar.detail,
  }));
  const pillarSheet = XLSX.utils.json_to_sheet(pillarRows);
  pillarSheet['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(workbook, pillarSheet, 'المحاور');

  if (report.points.dashboard?.source_breakdown?.length) {
    const sourceSheet = XLSX.utils.json_to_sheet(report.points.dashboard.source_breakdown.map((row) => ({
      المصدر: row.source,
      النقاط: row.points,
      عدد_الأحداث: row.events,
    })));
    XLSX.utils.book_append_sheet(workbook, sourceSheet, 'مصادر النقاط');
  }

  if (report.warnings.length) {
    const warningSheet = XLSX.utils.json_to_sheet(report.warnings.map((warning) => ({ تنبيه: warning })));
    warningSheet['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, warningSheet, 'جودة البيانات');
  }

  XLSX.writeFile(workbook, `تقرير_360_${report.employee.name}_${report.cycle.label}.xlsx`);
}

export default function MonthlyPerformanceReport360() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [staff, setStaff] = useState<{ id: string; name: string; branch?: string | null; role?: string | null }[]>([]);
  const [staffId, setStaffId] = useState(searchParams.get('staffId') || '');
  const [cycleLabel, setCycleLabel] = useState(searchParams.get('cycle') || currentEvaluationCycleLabel());
  const [report, setReport] = useState<MonthlyPerformance360Report | null>(null);
  const [loading, setLoading] = useState(false);

  const cycles = useMemo(() => {
    const values: string[] = [];
    let label = currentEvaluationCycleLabel();
    for (let index = 0; index < 7; index += 1) {
      values.push(label);
      label = previousEvaluationCycleLabel(label);
    }
    return values;
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const loadStaff = async () => {
      const { data, error } = await supabase.rpc('list_staff_for_monthly_performance_360_safe', {
        p_actor_id: user.id,
      });
      if (cancelled) return;
      if (error) {
        setStaff([]);
        setStaffId('');
        toast.error(`تعذر تحميل نطاق تقرير 360°: ${error.message}`);
        return;
      }
      const rows = ((data || []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id || ''),
        name: String(row.name || 'موظف'),
        branch: row.branch == null ? null : String(row.branch),
        role: row.role == null ? null : String(row.role),
      })).filter((row) => row.id);
      setStaff(rows);
      setStaffId((current) => rows.some((row) => row.id === current) ? current : (rows[0]?.id || ''));
    };
    void loadStaff();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (staffId) next.set('staffId', staffId);
    if (cycleLabel) next.set('cycle', cycleLabel);
    setSearchParams(next, { replace: true });
  }, [cycleLabel, setSearchParams, staffId]);

  async function loadReport() {
    if (!user?.id || !staffId || !cycleLabel) return;
    setLoading(true);
    try {
      const result = await loadScopedMonthlyPerformance360({ actorId: user.id, staffId, cycleLabel });
      setReport(result);
    } catch (error) {
      setReport(null);
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل تقرير 360°');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
    // loadReport intentionally depends on the selected identifiers only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, cycleLabel, user?.id]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24" dir="rtl">
      <div className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={22} className="text-[var(--dawaa-theme-primary)]" />
              <h1 className="dawaa-title text-xl">تقرير الأداء الشهري 360°</h1>
            </div>
            <p className="dawaa-caption mt-2 text-sm font-semibold">درجة شفافة من مصادر فعلية فقط؛ أي بيانات ناقصة تظهر كغير متاحة ولا تحصل على نقاط افتراضية.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[520px]">
            <label className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
              الموظف
              <select className="dawaa-input mt-1 w-full px-3 py-2" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                {staff.map((item) => <option key={item.id} value={item.id}>{item.name}{item.branch ? ` — ${item.branch}` : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
              الدورة
              <select className="dawaa-input mt-1 w-full px-3 py-2" value={cycleLabel} onChange={(event) => setCycleLabel(event.target.value)}>
                {cycles.map((cycle) => <option key={cycle} value={cycle}>{cycle}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="dawaa-card flex items-center justify-center gap-3 py-16"><Loader2 className="animate-spin" /> جاري تجميع مصادر التقرير...</div>
      ) : !report ? (
        <div className="dawaa-card dawaa-card--soft p-8 text-center">
          <UserRound className="mx-auto text-[var(--dawaa-theme-muted)]" />
          <p className="mt-3 font-bold text-[var(--dawaa-theme-muted)]">اختر موظفًا ودورة لعرض التقرير.</p>
        </div>
      ) : (
        <>
          <div className="dawaa-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">{report.employee.name}</h2>
                <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{report.employee.role} • {report.employee.branch} • {report.cycle.displayLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="dawaa-button dawaa-button--secondary flex items-center gap-2" onClick={() => void loadReport()}><RefreshCw size={15} /> تحديث</button>
                <button className="dawaa-button dawaa-button--secondary flex items-center gap-2" onClick={() => window.print()}><FileText size={15} /> طباعة / PDF</button>
                <button className="dawaa-button dawaa-button--primary flex items-center gap-2" onClick={() => void exportExcel(report)}><Download size={15} /> Excel</button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MetricCard label="الدرجة المركبة" value={report.overall.score == null ? 'غير مكتملة' : `${report.overall.score}/100`} note={report.overall.grade} />
              <MetricCard label="تغطية مصادر الدرجة" value={`${report.overall.coveragePct}%`} note="البيانات الناقصة لا تُمنح درجات افتراضية" />
              <MetricCard label="حافز النقاط" value={report.points.dashboard?.final_incentive_egp == null ? 'غير متاح' : money(report.points.dashboard.final_incentive_egp)} note={report.points.dashboard ? `${report.points.dashboard.final_points} نقطة` : undefined} />
            </div>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="المبيعات" value={money(report.sales.totalSales)} note={`${report.sales.invoiceCount} فاتورة`} />
            <MetricCard label="متوسط الفاتورة" value={money(report.sales.averageInvoice)} note={`${report.sales.customersHandled} عميل فريد`} />
            <MetricCard label="ربط كود العميل" value={percent(report.sales.linkingRate)} note={`${report.sales.linkedInvoices}/${report.sales.invoiceCount} فاتورة`} />
            <MetricCard label="تقييم المحادثات" value={percent(report.conversations.averageScore)} note={`${report.conversations.count} مراجعة`} />
            <MetricCard label="المتابعات" value={percent(report.followups.completionRate)} note={`${report.followups.completed}/${report.followups.total} مكتملة`} />
            <MetricCard label="الحضور المسجل" value={`${report.attendance.presentDays}/${report.attendance.recordedDays}`} note={report.attendance.note} />
            <MetricCard label="تقييم المدير" value={percent(report.managerEvaluation.score)} />
            <MetricCard label="تقدم النقاط" value={report.points.dashboard ? `${report.points.dashboard.progress_pct.toFixed(1)}%` : '—'} note={report.points.dashboard ? `${report.points.dashboard.reward_points} مكافآت / ${report.points.dashboard.deduction_points} خصومات` : undefined} />
          </section>

          <section className="dawaa-card p-5">
            <h2 className="font-black text-[var(--dawaa-theme-heading)]">محاور الدرجة المركبة</h2>
            <div className="mt-4 space-y-3">
              {report.pillars.map((pillar) => (
                <div key={pillar.key} className="dawaa-card dawaa-card--soft p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-[var(--dawaa-theme-heading)]">{pillar.label} <span className="text-xs text-[var(--dawaa-theme-muted)]">({pillar.weight}%)</span></p>
                      <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">{pillar.detail}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={pillar.status} />
                      <span className="text-lg font-black">{pillar.score == null ? '—' : `${pillar.score.toFixed(1)}`}</span>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--dawaa-theme-border)]">
                    <div className="h-full rounded-full bg-[var(--dawaa-theme-primary)]" style={{ width: `${pillar.score ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {report.points.dashboard?.source_breakdown?.length ? (
            <section className="dawaa-card p-5">
              <h2 className="font-black text-[var(--dawaa-theme-heading)]">مصادر حركة النقاط</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {report.points.dashboard.source_breakdown.map((source) => (
                  <div key={source.source} className="dawaa-card dawaa-card--soft p-3">
                    <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{source.source}</p>
                    <p className="mt-1 font-black">{source.points > 0 ? '+' : ''}{source.points} نقطة • {source.events} حدث</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {report.warnings.length ? (
            <section className="dawaa-alert dawaa-alert--warning p-4">
              <h2 className="font-black">ملاحظات جودة البيانات</h2>
              <ul className="mt-2 list-disc space-y-1 pr-5 text-xs font-semibold">
                {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}