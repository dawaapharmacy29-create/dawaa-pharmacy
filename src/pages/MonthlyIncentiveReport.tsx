import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, DollarSign, Loader2, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { supabase } from '@/lib/supabase';
import {
  currentEvaluationCycleLabel,
  evaluationCycleRangeFromLabel,
  latestClosedEvaluationCycleLabel,
} from '@/lib/evaluations/monthlyEvaluationCycle';
import { fetchEmployeeTransactionsForStaff } from '@/services/employeeTransactionService';
import { Panel, SectionTitle, KpiCard, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';

const ALLOWED_ROLES = ['general_manager', 'admin', 'executive_manager', 'branches_manager'];

type StaffPointsSummaryRow = {
  staff_id: string;
  staff_name: string;
  staff_role: string | null;
  branch: string | null;
  reward_points: number;
  deduction_points: number;
  final_points: number;
  progress_pct: number;
  points_incentive_egp: number | null;
  evaluation_multiplier_pct: number | null;
  competition_bonus_egp: number | null;
  final_incentive_egp: number | null;
  max_incentive_egp: number | null;
  profile_configured: boolean;
  evaluation_status: string | null;
  evaluation_score: number | null;
  payroll_finalized: boolean;
};

type SourceBreakdownRow = {
  source: string;
  points: number;
  count: number;
};

const SOURCE_LABELS: Record<string, string> = {
  conversation_evaluation: 'تقييم المحادثات',
  doctor_customer_service_evaluation: 'تقييم خدمة العملاء للدكتور',
  monthly_evaluation_critical_gate: 'مخالفة حرجة — أثر نقاط قديم قبل V4',
  followup_logged: 'تسجيل طلب متابعة',
  followup_completed: 'إتمام متابعة من خدمة العملاء',
  followup_purchase: 'شراء العميل بعد المتابعة',
  stagnant_medicine_dispense: 'بيع صنف راكد',
  customer_request_registered: 'تسجيل طلب عميل',
  customer_request_achieved: 'تحقيق طلب عميل',
  assistant_checklist_settlement: 'تسوية تشيك ليست المساعد',
  target_achievement_settlement: 'تحقيق تارجت',
  invoice_quality_vs_branch_baseline: 'جودة فاتورة مقابل متوسط الفرع',
  penalty_incentive: 'خصم حافز',
};

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] || source;
}

function roleLabel(role: string | null) {
  if (!role) return '—';
  return role;
}

export default function MonthlyIncentiveReport() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const canView = ALLOWED_ROLES.includes(role);

  const [cycleLabel, setCycleLabel] = useState(() => latestClosedEvaluationCycleLabel());
  const cycleRange = useMemo(() => evaluationCycleRangeFromLabel(cycleLabel), [cycleLabel]);
  const activeCycleLabel = currentEvaluationCycleLabel();
  const latestClosedCycleLabel = latestClosedEvaluationCycleLabel();
  const [branchFilter, setBranchFilter] = useState<'الكل' | 'فرع الشامي' | 'فرع شكري'>('الكل');
  const [rows, setRows] = useState<StaffPointsSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, SourceBreakdownRow[]>>({});
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError('');
    void supabase
      .rpc('get_staff_points_manager_summary_v4', {
        p_month_cycle: cycleLabel,
        p_branch: branchFilter === 'الكل' ? null : branchFilter,
      })
      .then((result) => {
        if (result.error) {
          setError(result.error.message);
          setRows([]);
        } else {
          setRows((result.data || []) as StaffPointsSummaryRow[]);
        }
        setLoading(false);
      });
  }, [canView, cycleLabel, branchFilter]);

  async function toggleExpand(staffId: string) {
    if (expandedId === staffId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(staffId);
    if (breakdown[staffId]) return;
    setBreakdownLoading(true);
    const result = await fetchEmployeeTransactionsForStaff(staffId);
    const grouped = new Map<string, SourceBreakdownRow>();
    for (const row of (result.data || []) as { source: string | null; points_delta: number | null; month_cycle: string | null; status: string | null }[]) {
      if (row.month_cycle !== cycleLabel || row.status !== 'active') continue;
      const key = row.source || 'غير محدد';
      const existing = grouped.get(key) || { source: key, points: 0, count: 0 };
      existing.points += Number(row.points_delta || 0);
      existing.count += 1;
      grouped.set(key, existing);
    }
    setBreakdown((prev) => ({ ...prev, [staffId]: Array.from(grouped.values()).sort((a, b) => b.points - a.points) }));
    setBreakdownLoading(false);
  }

  if (!canView) {
    return (
      <div dir="rtl" className="p-6 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        هذا التقرير متاح للمدير العام ومدير الفروع فقط.
      </div>
    );
  }

  const rawPointsIncentiveTotal = rows.reduce((sum, row) => sum + Number(row.points_incentive_egp || 0), 0);
  const approvedFinalTotal = rows.reduce(
    (sum, row) => sum + (row.evaluation_multiplier_pct == null ? 0 : Number(row.final_incentive_egp || 0)),
    0
  );
  const configuredCount = rows.filter((row) => row.profile_configured).length;
  const missingProfileCount = rows.length - configuredCount;
  const pendingEvaluationCount = rows.filter((row) => row.profile_configured && row.evaluation_multiplier_pct == null).length;
  const sortedRows = [...rows].sort(
    (a, b) => Number(b.final_incentive_egp ?? b.points_incentive_egp ?? 0) - Number(a.final_incentive_egp ?? a.points_incentive_egp ?? 0)
  );

  return (
    <div dir="rtl" className="min-h-screen space-y-4 p-4" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              <Wallet style={{ color: 'var(--dawaa-theme-primary-strong)' }} /> التقرير الشهري للحوافز والنقاط
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
              التقرير يفصل بوضوح بين حافز النقاط قبل التقييم، نسبة التقييم الشهري المعتمدة، والبونص، ثم الحافز بعد التقييم. لو التقييم غير معتمد لن نعرض الرقم الخام على أنه حافز نهائي.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <button
                type="button"
                onClick={() => setCycleLabel(latestClosedCycleLabel)}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === latestClosedCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                آخر دورة مكتملة
              </button>
              <button
                type="button"
                onClick={() => setCycleLabel(activeCycleLabel)}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === activeCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة الجارية
              </button>
            </div>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value as typeof branchFilter)} className="input-dark w-auto">
              <option value="الكل">كل الفروع</option>
              <option value="فرع الشامي">فرع الشامي</option>
              <option value="فرع شكري">فرع شكري</option>
            </select>
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
          فترة الدورة: {cycleRange.displayLabel}
        </div>
      </Panel>

      {error ? (
        <Panel className="p-4" style={{ background: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>{error}</p>
        </Panel>
      ) : null}

      {loading ? (
        <Panel className="p-10 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></Panel>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <KpiCard title="حافز النقاط قبل التقييم" value={`${Math.round(rawPointsIncentiveTotal).toLocaleString('ar-EG')} جنيه`} subtitle="ليس رقم الصرف النهائي" icon={<TrendingUp size={20} />} tone="cyan" />
            <KpiCard title="بعد تقييم معتمد" value={`${Math.round(approvedFinalTotal).toLocaleString('ar-EG')} جنيه`} subtitle="فقط الصفوف التي لها multiplier معتمد" icon={<DollarSign size={20} />} tone="green" />
            <KpiCard title="في انتظار التقييم" value={String(pendingEvaluationCount)} subtitle="لن يظهر لهم رقم نهائي مؤكد" icon={<Users size={20} />} tone={pendingEvaluationCount ? 'amber' : 'green'} />
            <KpiCard title="بدون ملف تعويض" value={String(missingProfileCount)} subtitle={missingProfileCount ? 'لا يوجد مبلغ مالي محسوب لهم' : `${configuredCount} ملف مالي مكتمل`} icon={<Wallet size={20} />} tone={missingProfileCount ? 'red' : 'green'} />
          </section>

          <Panel className="p-4">
            <SectionTitle title="تفاصيل كل موظف" subtitle="اضغط على أي صف لعرض مصدر النقاط بالتفصيل" />
            {sortedRows.length === 0 ? (
              <EmptyState label="مفيش موظفين مطابقين لهذا الفلتر." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <table className="w-full min-w-[1080px] text-sm">
                  <thead>
                    <tr className="text-right text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      <th className="p-2 font-bold">الموظف</th>
                      <th className="p-2 font-bold">مكافآت</th>
                      <th className="p-2 font-bold">خصومات</th>
                      <th className="p-2 font-bold">الصافي</th>
                      <th className="p-2 font-bold">نسبة الإنجاز</th>
                      <th className="p-2 font-bold">قبل التقييم</th>
                      <th className="p-2 font-bold">نسبة التقييم</th>
                      <th className="p-2 font-bold">بعد التقييم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <Fragment key={row.staff_id}>
                        <tr
                          className="cursor-pointer border-t"
                          style={{ borderColor: 'var(--dawaa-theme-border)' }}
                          onClick={() => void toggleExpand(row.staff_id)}
                        >
                          <td className="p-2">
                            <div className="flex items-center gap-1.5 font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>
                              <ChevronDown size={14} className={expandedId === row.staff_id ? 'rotate-180 transition-transform' : 'transition-transform'} style={{ color: 'var(--dawaa-theme-muted)' }} />
                              {row.staff_name}
                            </div>
                            <div className="mr-5 flex flex-wrap items-center gap-1 text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              <span>{roleLabel(row.staff_role)} · {row.branch || '—'}</span>
                              {row.payroll_finalized ? <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-1.5 py-0.5 text-[var(--dawaa-status-success-text)]">راتب مجمّد</span> : null}
                            </div>
                          </td>
                          <td className="p-2 font-bold" style={{ color: 'var(--dawaa-status-success-text)' }}>+{row.reward_points}</td>
                          <td className="p-2 font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>-{row.deduction_points}</td>
                          <td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.final_points}</td>
                          <td className="p-2 font-bold" style={{ color: row.progress_pct >= 80 ? 'var(--dawaa-status-success-text)' : row.progress_pct >= 40 ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-status-danger-text)' }}>{Math.round(row.progress_pct)}%</td>
                          <td className="p-2 font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {row.profile_configured && row.points_incentive_egp != null ? `${Math.round(row.points_incentive_egp).toLocaleString('ar-EG')} ج` : 'غير محدد'}
                          </td>
                          <td className="p-2 font-black" style={{ color: row.evaluation_multiplier_pct == null ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-primary-strong)' }}>
                            {row.evaluation_multiplier_pct == null ? 'في انتظار الاعتماد' : `${row.evaluation_multiplier_pct}%`}
                          </td>
                          <td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
                            {!row.profile_configured
                              ? 'غير محدد'
                              : row.evaluation_multiplier_pct == null
                                ? 'غير نهائي'
                                : `${Math.round(Number(row.final_incentive_egp || 0)).toLocaleString('ar-EG')} ج`}
                          </td>
                        </tr>
                        {expandedId === row.staff_id ? (
                          <tr style={{ borderColor: 'var(--dawaa-theme-border)' }} className="border-t">
                            <td colSpan={8} className="p-3" style={{ background: 'var(--dawaa-theme-soft)' }}>
                              {breakdownLoading && !breakdown[row.staff_id] ? (
                                <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}><Loader2 size={14} className="animate-spin" /> جاري تحميل التفاصيل...</div>
                              ) : (breakdown[row.staff_id] || []).length === 0 ? (
                                <p className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>مفيش أي معاملة نقاط مسجّلة لهذا الموظف في هذه الدورة حتى الآن.</p>
                              ) : (
                                <div className="space-y-3">
                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <MiniBox label="درجة التقييم" value={row.evaluation_score == null ? '—' : `${row.evaluation_score}/100`} tone="cyan" />
                                    <MiniBox label="بونص المنافسة" value={row.competition_bonus_egp == null ? '—' : `${Math.round(row.competition_bonus_egp).toLocaleString('ar-EG')} ج`} tone="green" />
                                    <MiniBox label="حالة التقييم" value={row.evaluation_multiplier_pct == null ? 'في انتظار اعتماد نهائي' : row.evaluation_status || 'معتمد ماليًا'} tone={row.evaluation_multiplier_pct == null ? 'amber' : 'green'} />
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                  {(breakdown[row.staff_id] || []).map((item) => (
                                    <MiniBox
                                      key={item.source}
                                      label={`${sourceLabel(item.source)} (${item.count})`}
                                      value={`${item.points > 0 ? '+' : ''}${item.points}`}
                                      tone={item.points >= 0 ? 'green' : 'red'}
                                    />
                                  ))}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
