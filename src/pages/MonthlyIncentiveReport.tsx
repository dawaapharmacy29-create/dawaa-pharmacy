import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, DollarSign, Loader2, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { supabase } from '@/lib/supabase';
import {
  currentEvaluationCycleLabel,
  previousEvaluationCycleLabel,
  evaluationCycleRangeFromLabel,
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
  max_incentive_egp: number | null;
  profile_configured: boolean;
};

type SourceBreakdownRow = {
  source: string;
  points: number;
  count: number;
};

const SOURCE_LABELS: Record<string, string> = {
  conversation_evaluation: 'تقييم المحادثات',
  doctor_customer_service_evaluation: 'تقييم خدمة العملاء للدكتور',
  monthly_evaluation_critical_gate: 'مخالفة حرجة في التقييم الشهري',
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

  const [cycleLabel, setCycleLabel] = useState(() => currentEvaluationCycleLabel());
  const cycleRange = useMemo(() => evaluationCycleRangeFromLabel(cycleLabel), [cycleLabel]);
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
      .rpc('get_staff_points_manager_summary_v3', {
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

  const totalIncentive = rows.reduce((sum, row) => sum + Number(row.points_incentive_egp || 0), 0);
  const configuredCount = rows.filter((row) => row.profile_configured).length;
  const missingProfileCount = rows.length - configuredCount;
  const avgProgress = rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.progress_pct || 0), 0) / rows.length) : 0;
  const sortedRows = [...rows].sort((a, b) => Number(b.points_incentive_egp || 0) - Number(a.points_incentive_egp || 0));

  return (
    <div dir="rtl" className="min-h-screen space-y-4 p-4" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              <Wallet style={{ color: 'var(--dawaa-theme-primary-strong)' }} /> التقرير الشهري للحوافز والنقاط
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
              الحافز = صافي النقاط الحقيقية هذه الدورة (محادثات، طلبات عملاء، متابعات، رواكد...) × سعر النقطة، من غير سقف أعلى. هذا التقرير يعرض القيم الحية لحظة بلحظة.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <button
                type="button"
                onClick={() => setCycleLabel(previousEvaluationCycleLabel(currentEvaluationCycleLabel()))}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === previousEvaluationCycleLabel(currentEvaluationCycleLabel())
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة السابقة
              </button>
              <button
                type="button"
                onClick={() => setCycleLabel(currentEvaluationCycleLabel())}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === currentEvaluationCycleLabel()
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة الحالية
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
            <KpiCard title="إجمالي الحافز المتوقع" value={`${Math.round(totalIncentive).toLocaleString('ar-EG')} جنيه`} subtitle={`عبر ${rows.length} موظف`} icon={<DollarSign size={20} />} tone="green" />
            <KpiCard title="متوسط نسبة الإنجاز" value={`${avgProgress}%`} subtitle="مقارنة بالمرجع التقريبي لكل فئة" icon={<TrendingUp size={20} />} tone={avgProgress >= 80 ? 'green' : avgProgress >= 40 ? 'amber' : 'red'} />
            <KpiCard title="عدد الموظفين" value={String(rows.length)} subtitle={`${configuredCount} بملف تعويض مكتمل`} icon={<Users size={20} />} tone="cyan" />
            <KpiCard title="بدون ملف تعويض" value={String(missingProfileCount)} subtitle={missingProfileCount ? 'مفيش مبلغ مالي محسوب لهم' : 'كل الملفات مكتملة'} icon={<Wallet size={20} />} tone={missingProfileCount ? 'red' : 'green'} />
          </section>

          <Panel className="p-4">
            <SectionTitle title="تفاصيل كل موظف" subtitle="اضغط على أي صف لعرض مصدر النقاط بالتفصيل" />
            {sortedRows.length === 0 ? (
              <EmptyState label="مفيش موظفين مطابقين لهذا الفلتر." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="text-right text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      <th className="p-2 font-bold">الموظف</th>
                      <th className="p-2 font-bold">مكافآت</th>
                      <th className="p-2 font-bold">خصومات</th>
                      <th className="p-2 font-bold">الصافي</th>
                      <th className="p-2 font-bold">نسبة الإنجاز</th>
                      <th className="p-2 font-bold">الحافز</th>
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
                            <div className="mr-5 text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>{roleLabel(row.staff_role)} · {row.branch || '—'}</div>
                          </td>
                          <td className="p-2 font-bold" style={{ color: 'var(--dawaa-status-success-text)' }}>+{row.reward_points}</td>
                          <td className="p-2 font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>-{row.deduction_points}</td>
                          <td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.final_points}</td>
                          <td className="p-2 font-bold" style={{ color: row.progress_pct >= 80 ? 'var(--dawaa-status-success-text)' : row.progress_pct >= 40 ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-status-danger-text)' }}>{Math.round(row.progress_pct)}%</td>
                          <td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
                            {row.profile_configured && row.points_incentive_egp != null ? `${Math.round(row.points_incentive_egp).toLocaleString('ar-EG')} ج` : 'غير محدد'}
                          </td>
                        </tr>
                        {expandedId === row.staff_id ? (
                          <tr style={{ borderColor: 'var(--dawaa-theme-border)' }} className="border-t">
                            <td colSpan={6} className="p-3" style={{ background: 'var(--dawaa-theme-soft)' }}>
                              {breakdownLoading && !breakdown[row.staff_id] ? (
                                <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}><Loader2 size={14} className="animate-spin" /> جاري تحميل التفاصيل...</div>
                              ) : (breakdown[row.staff_id] || []).length === 0 ? (
                                <p className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>مفيش أي معاملة نقاط مسجّلة لهذا الموظف في هذه الدورة حتى الآن.</p>
                              ) : (
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
