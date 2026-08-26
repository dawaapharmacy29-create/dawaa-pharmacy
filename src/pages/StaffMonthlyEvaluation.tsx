import { useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle2, Loader2, Save, Search, Send, Star, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';
import {
  evaluationProfileForRole,
  type StaffEvaluationSectionV3,
} from '@/lib/evaluations/staffEvaluationProfilesV3';
import { canonicalStaffRole, isManagerRole } from '@/lib/staff/staffRoleCapabilities';
import {
  getStaffPointsDashboardV3,
  type StaffPointsDashboardV3,
} from '@/lib/staff/staffPointsDashboardService';

type StaffRow = {
  id: string;
  name: string;
  role?: string | null;
  job_title?: string | null;
  branch?: string | null;
  status?: string | null;
  user_id?: string | null;
};

type EvaluationRow = Record<string, unknown>;

type Metrics = {
  review_count: number;
  review_average: number;
  completed_followups: number;
  followup_count: number;
  conversation_positive_points: number;
  conversation_negative_points: number;
  attendance_days: number;
  present_days: number;
  engine_version: number;
};

const EMPTY_METRICS: Metrics = {
  review_count: 0,
  review_average: 0,
  completed_followups: 0,
  followup_count: 0,
  conversation_positive_points: 0,
  conversation_negative_points: 0,
  attendance_days: 0,
  present_days: 0,
  engine_version: 3,
};

function monthStart(value: string) {
  return `${value}-01`;
}

function nextMonthStart(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function gradeFor(score: number) {
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج خطة تحسين';
}

function scoreColor(score: number) {
  if (score >= 90) return 'text-emerald-300';
  if (score >= 75) return 'text-cyan-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-rose-300';
}

function starMeaning(score: number) {
  return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'مقبول', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم';
}

function sectionPoints(item: StaffEvaluationSectionV3) {
  return Math.round(((item.score / 5) * item.weight) * 10) / 10;
}

function normalizeSavedSections(
  saved: unknown,
  fallback: StaffEvaluationSectionV3[]
): StaffEvaluationSectionV3[] {
  if (!Array.isArray(saved) || !saved.length) return fallback;
  return saved.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      key: String(row.key || ''),
      title: String(row.title || ''),
      description: String(row.description || ''),
      weight: safeNumber(row.weight),
      score: safeNumber(row.score),
      notes: String(row.notes || ''),
    };
  });
}

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  const actorRole = canonicalStaffRole(user?.role);
  const managerMode = isManagerRole(user?.role);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const globalScope = ['branches_manager', 'executive', 'admin'].includes(actorRole);

  const [branch, setBranch] = useState(globalScope ? 'فرع الشامي' : ownBranch);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [sections, setSections] = useState<StaffEvaluationSectionV3[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [pointsTruth, setPointsTruth] = useState<StaffPointsDashboardV3 | null>(null);
  const [strengthsText, setStrengthsText] = useState('');
  const [developmentText, setDevelopmentText] = useState('');
  const [managerNotes, setManagerNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => staff.find((item) => item.id === selectedId) || null,
    [selectedId, staff]
  );
  const profile = useMemo(
    () => evaluationProfileForRole(selected?.job_title || selected?.role),
    [selected?.job_title, selected?.role]
  );
  const isEditingSelf = Boolean(
    selected && (selected.id === user?.staffId || selected.id === user?.id)
  );
  const canEdit = managerMode && !isEditingSelf;
  const overallScore = useMemo(
    () => Math.round(sections.reduce((sum, item) => sum + (item.score / 5) * item.weight, 0) * 10) / 10,
    [sections]
  );
  const grade = gradeFor(overallScore);

  useEffect(() => {
    const loadStaff = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_safe', {
          p_actor_id: user.id,
          p_branch: globalScope ? branch : null,
        });
        if (error) throw error;
        const rows = (data || []) as StaffRow[];
        setStaff(rows);
        const own = rows.find((row) => row.id === user?.staffId || row.id === user?.id || row.name === user?.name);
        if (!managerMode && own) setSelectedId(own.id);
        else if (!selectedId && rows[0]) setSelectedId(rows[0].id);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'تعذر تحميل الموظفين');
      } finally {
        setLoading(false);
      }
    };
    void loadStaff();
  }, [branch, globalScope, managerMode, selectedId, user]);

  useEffect(() => {
    if (!selectedId || !user?.id || !selected) return;
    const loadEvaluation = async () => {
      setLoading(true);
      try {
        const endDate = nextMonthStart(month);
        const monthCycle = month;
        const [savedResult, reviewResult, followupResult, attendanceResult, pointsResult] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_safe', {
            p_actor_id: user.id,
            p_staff_id: selectedId,
            p_month: monthStart(month),
          }),
          supabase
            .from('conversation_sales_reviews')
            .select('total_score,final_score,doctor_points_impact,point_impact,created_at')
            .eq('staff_id', selectedId)
            .gte('created_at', monthStart(month))
            .lt('created_at', endDate)
            .limit(500),
          supabase
            .from('daily_followups')
            .select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id')
            .or(`assigned_staff_id.eq.${selectedId},requested_by_staff_id.eq.${selectedId}`)
            .gte('created_at', monthStart(month))
            .lt('created_at', endDate)
            .limit(1000),
          readAttendanceRange({ staffId: selectedId, startDate: monthStart(month), endDateExclusive: endDate, limit: 100 }),
          getStaffPointsDashboardV3(selectedId, monthCycle).catch(() => null),
        ]);

        if (savedResult.error) throw savedResult.error;
        if (attendanceResult.status === 'unavailable') throw new Error(attendanceResult.error);

        const reviewRows = reviewResult.data || [];
        const followupRows = followupResult.data || [];
        const attendanceRows = attendanceResult.rows;
        const reviewAverage = reviewRows.length
          ? reviewRows.reduce((sum: number, row: Record<string, unknown>) => sum + safeNumber(row.final_score || row.total_score), 0) / reviewRows.length
          : 0;
        const completedFollowups = followupRows.filter((row: Record<string, unknown>) =>
          row.completed_at || /completed|مكتمل|تم/.test(String(row.status || row.followup_status || ''))
        ).length;
        const impacts = reviewRows.map((row: Record<string, unknown>) => safeNumber(row.doctor_points_impact ?? row.point_impact));
        const positive = impacts.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
        const negative = impacts.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
        const presentDays = attendanceRows.filter((row: Record<string, unknown>) => /present|حاضر|late|متأخر/i.test(String(row.status || ''))).length;

        setMetrics({
          review_count: reviewRows.length,
          review_average: Math.round(reviewAverage * 10) / 10,
          completed_followups: completedFollowups,
          followup_count: followupRows.length,
          conversation_positive_points: positive,
          conversation_negative_points: negative,
          attendance_days: attendanceRows.length,
          present_days: presentDays,
          engine_version: 3,
        });
        setPointsTruth(pointsResult);

        const saved = savedResult.data as EvaluationRow | null;
        const freshSections = evaluationProfileForRole(selected.job_title || selected.role).sections;
        if (saved) {
          setEvaluationId(String(saved.id || ''));
          setSections(normalizeSavedSections(saved.sections, freshSections));
          setStrengthsText(Array.isArray(saved.strengths) ? saved.strengths.map(String).join('\n') : '');
          setDevelopmentText(Array.isArray(saved.development_points) ? saved.development_points.map(String).join('\n') : '');
          setManagerNotes(String(saved.manager_notes || ''));
          setStatus(String(saved.status || 'draft'));
        } else {
          setEvaluationId(null);
          setSections(freshSections);
          setStrengthsText('');
          setDevelopmentText('');
          setManagerNotes('');
          setStatus('draft');
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'تعذر تحميل التقييم');
      } finally {
        setLoading(false);
      }
    };
    void loadEvaluation();
  }, [month, selected, selectedId, user?.id]);

  function updateSection(key: string, patch: Partial<StaffEvaluationSectionV3>) {
    setSections((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function save(nextStatus = status) {
    if (!selected || !user?.id) return;
    if (isEditingSelf) {
      toast.error('لا يمكنك اعتماد أو تعديل تقييمك الشهري لنفسك.');
      return;
    }
    if (managerMode && sections.some((item) => item.score === 0)) {
      toast.error('يجب تقييم كل المحاور قبل الاعتماد');
      return;
    }

    setSaving(true);
    try {
      const strengths = strengthsText.split('\n').map((item) => item.trim()).filter(Boolean);
      const developmentPoints = developmentText.split('\n').map((item) => item.trim()).filter(Boolean);
      const payload = {
        staff_id: selected.id,
        staff_name: selected.name,
        staff_role: selected.job_title || selected.role,
        branch: selected.branch || branch,
        evaluation_month: monthStart(month),
        evaluator_id: user.id,
        evaluator_name: user.name || 'المدير',
        evaluator_role: user.role || null,
        sections,
        metrics_snapshot: {
          ...metrics,
          evaluation_engine_version: 3,
          canonical_role: profile.role,
          points_truth: pointsTruth ? {
            month_cycle: pointsTruth.month_cycle,
            starting_points: pointsTruth.starting_points,
            final_points: pointsTruth.final_points,
            reward_points: pointsTruth.reward_points,
            deduction_points: pointsTruth.deduction_points,
            profile_configured: pointsTruth.profile_configured,
            final_incentive_egp: pointsTruth.final_incentive_egp,
          } : null,
        },
        strengths,
        development_points: developmentPoints,
        manager_notes: managerNotes,
        overall_score: overallScore,
        grade,
        // V3 principle: evaluation quality never creates a second monetary truth.
        suggested_incentive: null,
        approved_incentive: null,
        points_delta: 0,
        status: nextStatus,
        sent_at: nextStatus === 'sent' ? new Date().toISOString() : null,
      };

      const { data, error } = await supabase.rpc('save_staff_monthly_evaluation_safe', {
        p_actor_id: user.id,
        p_payload: payload,
      });
      if (error) throw error;
      setEvaluationId(String(data || evaluationId || ''));
      setStatus(nextStatus);

      if (nextStatus === 'sent') {
        await createStaffNotification({
          recipientStaffId: selected.id,
          title: 'تم إرسال تقييمك الشهري',
          message: `تقييم شهر ${month}: ${overallScore}/100 - ${grade}. الحافز المالي يُحسب من نظام النقاط المركزي.`,
          type: 'staff_monthly_evaluation',
          entityType: 'staff_monthly_evaluation',
          entityId: String(data || evaluationId || ''),
          actionUrl: '/staff-dashboard',
        }).catch(() => null);
      }
      toast.success(nextStatus === 'sent' ? 'تم إرسال التقييم للموظف' : 'تم حفظ التقييم');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'فشل حفظ التقييم');
    } finally {
      setSaving(false);
    }
  }

  const filteredStaff = staff.filter((item) => item.name.includes(search));
  const canonicalIncentive = pointsTruth?.final_incentive_egp;

  return (
    <div className="min-h-screen space-y-5 bg-slate-950 p-4 text-white" dir="rtl">
      <section className="rounded-3xl border border-cyan-300/20 bg-gradient-to-l from-cyan-950/50 to-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black"><UserCheck className="text-cyan-300" /> التقييم الشهري للموظفين</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold text-slate-300">
              تقييم جودة وتطوير حسب مسار الوظيفة. الدرجة من 100 مستقلة عن مبلغ الحافز؛ المبلغ النهائي يأتي فقط من Points Truth + Compensation Profile.
            </p>
          </div>
          <div className="flex gap-2">
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="input-dark" />
            {managerMode && canViewAllBranches(user) ? (
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className="input-dark">
                <option>فرع الشامي</option><option>فرع شكري</option>
              </select>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الموظف" className="input-dark w-full pr-10" />
          </div>
          <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto">
            {filteredStaff.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl border p-3 text-right ${selectedId === item.id ? 'border-cyan-300/60 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="font-black">{item.name}</div>
                <div className="mt-1 text-xs text-slate-400">{item.job_title || item.role} · {item.branch}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-4">
          {loading ? (
            <div className="rounded-3xl border border-white/10 p-10 text-center"><Loader2 className="mx-auto animate-spin" /> جاري التحميل...</div>
          ) : selected ? (
            <>
              <section className="rounded-3xl border border-cyan-300/20 bg-cyan-400/5 p-4">
                <div className="font-black text-cyan-100">{profile.label}: {profile.mission}</div>
                <div className="mt-2 text-xs font-bold text-slate-400">المحاور التالية خاصة بالدور: {selected.job_title || selected.role || 'غير محدد'}.</div>
              </section>

              <section className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">نتيجة التقييم</div><div className={`mt-1 text-3xl font-black ${scoreColor(overallScore)}`}>{overallScore}/100</div></div>
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">التقدير</div><div className="mt-1 text-xl font-black">{grade}</div></div>
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">النقاط الحالية</div><div className="mt-1 text-xl font-black text-cyan-300">{pointsTruth ? `${pointsTruth.final_points} / ${pointsTruth.target_points}` : '—'}</div></div>
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-4"><div className="text-xs text-slate-400">حافز الأداء المركزي</div><div className="mt-1 text-xl font-black text-emerald-300">{canonicalIncentive == null ? 'غير محدد' : `${canonicalIncentive.toLocaleString('ar-EG')} جنيه`}</div></div>
              </section>

              {!pointsTruth?.profile_configured ? (
                <section className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm font-bold text-amber-100">
                  لا يوجد Compensation Profile مالي مكتمل لهذا الموظف؛ لذلك لا يتم توليد أو اقتراح مبلغ مالي من التقييم الشهري.
                </section>
              ) : null}

              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
                <h2 className="font-black">بيانات تشغيلية مساعدة للتقييم</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(metrics).filter(([key]) => key !== 'engine_version').map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-white/[0.04] p-3 text-sm font-bold"><span className="text-slate-400">{key.replaceAll('_', ' ')}:</span> {value}</div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-amber-300/25 bg-amber-500/5 p-4">
                <h2 className="font-black text-amber-200">قاعدة الفصل بين التقييم والحافز</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  التقييم الشهري يقيس جودة العمل ويحدد نقاط القوة وخطة التحسين. لا يحسب مبلغًا مستقلًا ولا يستطيع تجاوز محرك النقاط. المكافآت والخصومات التشغيلية تدخل الـLedger من أحداثها الأصلية، والحافز بالجنيه يخرج من Compensation Profile والمصدر المركزي فقط.
                </p>
              </section>

              <section className="space-y-3">
                {sections.map((item) => {
                  const earned = sectionPoints(item);
                  return (
                    <article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="max-w-3xl">
                          <h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">الوزن: {item.weight}</span></h3>
                          <p className="mt-1 text-xs leading-6 text-slate-400">{item.description}</p>
                        </div>
                        <div className="min-w-[230px]">
                          <div className="flex justify-end gap-1">
                            {[1, 2, 3, 4, 5].map((score) => (
                              <button type="button" aria-label={`اختيار ${score} نجوم`} disabled={!canEdit} key={score} onClick={() => updateSection(item.key, { score })} className="rounded-lg p-1 transition hover:bg-amber-400/10 disabled:cursor-default">
                                <Star className={score <= item.score ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} size={27} />
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-center text-sm font-black text-cyan-100">
                            {item.score ? `${item.score} نجوم — ${starMeaning(item.score)} — ${earned} من ${item.weight}` : `لم يتم التقييم — 0 من ${item.weight}`}
                          </div>
                        </div>
                      </div>
                      <textarea disabled={!canEdit} value={item.notes} onChange={(event) => updateSection(item.key, { notes: event.target.value })} rows={2} placeholder="ملاحظة واضحة على هذا المحور" className="input-dark mt-3 w-full disabled:opacity-70" />
                    </article>
                  );
                })}
              </section>

              <section className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><h3 className="font-black text-emerald-200">نقاط القوة</h3><textarea disabled={!canEdit} rows={6} value={strengthsText} onChange={(event) => setStrengthsText(event.target.value)} placeholder="كل نقطة في سطر" className="input-dark mt-3 w-full disabled:opacity-70" /></div>
                <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><h3 className="font-black text-amber-200">خطة التطوير</h3><textarea disabled={!canEdit} rows={6} value={developmentText} onChange={(event) => setDevelopmentText(event.target.value)} placeholder="كل خطوة تطوير في سطر" className="input-dark mt-3 w-full disabled:opacity-70" /></div>
                <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><h3 className="font-black text-cyan-200">ملاحظات المدير</h3><textarea disabled={!canEdit} rows={6} value={managerNotes} onChange={(event) => setManagerNotes(event.target.value)} className="input-dark mt-3 w-full disabled:opacity-70" /></div>
              </section>

              <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-300"><CheckCircle2 className="text-cyan-300" size={18} /> الحالة: {status} · المحرك: V3</div>
                {canEdit ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={() => void save('draft')} className="btn-secondary inline-flex items-center gap-2"><Save size={16} /> حفظ</button>
                    <button type="button" disabled={saving} onClick={() => void save('sent')} className="btn-primary inline-flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} إرسال للموظف</button>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-slate-500">اختر موظفًا لعرض تقييمه.</div>
          )}
        </main>
      </div>
    </div>
  );
}
