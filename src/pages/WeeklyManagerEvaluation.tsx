import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, TrendingUp, TrendingDown, Save, Send, ExternalLink } from 'lucide-react';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import {
  EVALUATION_CRITERIA,
  criterionHasData,
  computeWeightedCriterionScores,
  EVALUATION_TYPE_LABELS,
  computeTotalScore,
  criterionChecklistKeys,
  type EvaluationType,
  type WeeklyAutoMetrics,
} from '@/lib/evaluations/managerEvaluationCriteria';
import {
  fetchWeeklyAutoMetrics,
  weekBoundsOf,
  previousWeekOf,
  saveWeeklyEvaluation,
  fetchEvaluationHistory,
  fetchWeeklyChecklistCompletion,
  type ManagerWeeklyEvaluation,
} from '@/lib/evaluations/managerEvaluationService';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';
import { ManagerMonthlyPerformanceReport } from '@/components/evaluations/ManagerMonthlyPerformanceReport';

const SUBJECT_ROLE_BY_TYPE: Record<EvaluationType, string[]> = {
  branch_manager: ['branch_manager'],
  branches_manager: ['branches_manager'],
  customer_service: ['customer_service_manager'],
};

const EVALUATOR_ROLES_BY_TYPE: Record<EvaluationType, string[]> = {
  branch_manager: ['general_manager', 'executive_manager', 'branches_manager'],
  branches_manager: ['general_manager'],
  customer_service: ['general_manager', 'executive_manager', 'branches_manager'],
};

function scoreTone(score: number) {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-red-300';
}

export default function WeeklyManagerEvaluation() {
  const { type } = useParams<{ type: EvaluationType }>();
  const evaluationType = (type && EVALUATION_CRITERIA[type as EvaluationType] ? type : 'branch_manager') as EvaluationType;
  const { user } = useAuth();
  const evaluatorRole = normalizeRole(user?.role);
  const canEvaluate = EVALUATOR_ROLES_BY_TYPE[evaluationType].includes(evaluatorRole);
  const evaluatorStaffId = String(user?.staffId || user?.id || '');

  const { data: staff = [] } = useSupabaseQuery<StaffChoice & { role?: string; branch?: string }>({
    table: TABLES.staff,
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const { data: staffAccounts = [] } = useSupabaseQuery<{ staff_id: string; role: string }>({
    table: TABLES.staffAccounts,
    realtimeEnabled: false,
  });

  const eligibleRoles = SUBJECT_ROLE_BY_TYPE[evaluationType];
  const subjectChoices = useMemo(() => {
    const roleByStaffId = new Map(staffAccounts.map((sa) => [sa.staff_id, normalizeRole(sa.role)]));
    return mergeStaffChoices(staff).filter(
      (s) => eligibleRoles.includes(roleByStaffId.get(s.id) || '') && String(s.id) !== evaluatorStaffId
    );
  }, [staff, staffAccounts, eligibleRoles, evaluatorStaffId]);

  const [subjectStaffId, setSubjectStaffId] = useState('');
  const subject = useMemo(
    () => (staff as (StaffChoice & { branch?: string })[]).find((s) => s.id === subjectStaffId),
    [staff, subjectStaffId]
  );

  const [weekStart, setWeekStart] = useState(() => weekBoundsOf(new Date()).start);
  const [selectedBranch, setSelectedBranch] = useState<'فرع شكري' | 'فرع الشامي'>('فرع شكري');
  const weekEnd = useMemo(() => weekBoundsOf(new Date(weekStart)).end, [weekStart]);

  const [currentMetrics, setCurrentMetrics] = useState<WeeklyAutoMetrics | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState<WeeklyAutoMetrics | null>(null);
  const [checklistRates, setChecklistRates] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ week_start: string; total_score: number; status: string }>>([]);

  const branchForMetrics = evaluationType === 'branches_manager' ? selectedBranch : subject?.branch || null;

  useEffect(() => {
    if (!subjectStaffId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const prev = previousWeekOf(weekStart);
    Promise.all([
      fetchWeeklyAutoMetrics(evaluationType, branchForMetrics, weekStart, weekEnd),
      fetchWeeklyAutoMetrics(evaluationType, branchForMetrics, prev.start, prev.end),
      fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics),
      fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd, branchForMetrics),
    ])
      .then(([cur, prevMetrics, hist, checklist]) => {
        if (cancelled) return;
        setCurrentMetrics(cur);
        setPreviousMetrics(prevMetrics);
        setHistory(hist as Array<{ week_start: string; total_score: number; status: string }>);
        setChecklistRates(checklist);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [subjectStaffId, weekStart, weekEnd, evaluationType, branchForMetrics]);

  const criteria = EVALUATION_CRITERIA[evaluationType];
  const totalScore = useMemo(() => {
    if (!currentMetrics) return 0;
    return computeTotalScore(evaluationType, currentMetrics, previousMetrics, {}, checklistRates);
  }, [evaluationType, currentMetrics, previousMetrics, checklistRates]);
  const weightedCriteria = useMemo(() => currentMetrics
    ? computeWeightedCriterionScores(evaluationType, currentMetrics, previousMetrics, {}, checklistRates)
    : [], [evaluationType, currentMetrics, previousMetrics, checklistRates]);
  const availableCriteriaPercent = Math.round(weightedCriteria.filter((row) => row.included)
    .reduce((sum, row) => sum + row.originalWeight, 0) * 100);

  const handleSave = async (status: 'draft' | 'submitted') => {
    if (!subjectStaffId || !currentMetrics) return;
    if (!canEvaluate || String(subjectStaffId) === evaluatorStaffId) {
      setError('لا يمكن اعتماد هذا التقييم: يجب أن يكون المُقيِّم مديرًا أعلى ومختلفًا عن الشخص المُقيَّم.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: ManagerWeeklyEvaluation = {
        evaluation_type: evaluationType,
        subject_staff_id: subjectStaffId,
        subject_name: subject?.name || null,
        branch: branchForMetrics,
        evaluator_staff_id: evaluatorStaffId || null,
        evaluator_name: user?.name || null,
        week_start: weekStart,
        week_end: weekEnd,
        auto_metrics: currentMetrics,
        manual_scores: {},
        manual_note: note || null,
        total_score: totalScore,
        status,
      };
      await saveWeeklyEvaluation(payload);
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: { type: 'success', message: status === 'submitted' ? 'تم اعتماد التقييم' : 'تم حفظ المسودة' },
        })
      );
      const hist = await fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics);
      setHistory(hist as Array<{ week_start: string; total_score: number; status: string }>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (!canEvaluate) {
    return (
      <div dir="rtl" className="p-6 text-sm text-slate-400">
        ليس لديك مستوى الاعتماد المطلوب لهذا النوع من التقييم. تقييم مدير الفروع متاح للمدير العام فقط.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">{EVALUATION_TYPE_LABELS[evaluationType]}</h1>
          <p className="text-sm text-slate-400">نموذج أسبوعي موضوعي: كل بند محسوب من بيانات التطبيق أو مهمة موثقة، بدون درجات رأي شخصي.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input-dark" value={subjectStaffId} onChange={(e) => setSubjectStaffId(e.target.value)}>
          <option value="">اختر الشخص المُقيَّم</option>
          {subjectChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {evaluationType === 'branches_manager' && (
          <select className="input-dark" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value as 'فرع شكري' | 'فرع الشامي')}>
            <option value="فرع شكري">تقييم فرع شكري</option>
            <option value="فرع الشامي">تقييم فرع الشامي</option>
          </select>
        )}
        <input type="date" className="input-dark" value={weekStart} onChange={(e) => setWeekStart(weekBoundsOf(new Date(e.target.value)).start)} />
        <span className="flex items-center text-xs text-slate-400">الأسبوع: {weekStart} إلى {weekEnd}</span>
      </div>

      {!subjectStaffId && <p className="text-sm text-slate-400">اختار الشخص المُقيَّم للأسبوع الأول.</p>}
      {loading && <p className="text-sm text-slate-400">جارٍ تحميل البيانات...</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {currentMetrics && !loading && (
        <>
          <div className="stat-card flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">الدرجة الكلية</div>
              <div className={`text-4xl font-black ${scoreTone(totalScore)}`}>
                {totalScore}
                <span className="text-lg text-slate-500"> / 100</span>
              </div>
            </div>
            <span className={availableCriteriaPercent >= 80 ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{availableCriteriaPercent}% من أوزان البنود لها بيانات موثقة</span>
          </div>

          <ManagerLiveIncentiveCard
            evaluationType={evaluationType}
            staffId={subjectStaffId}
            branch={branchForMetrics}
          />

          <ManagerMonthlyPerformanceReport
            evaluationType={evaluationType}
            staffId={subjectStaffId}
            branch={branchForMetrics}
          />

          <div className="grid gap-3 md:grid-cols-2">
            {criteria.map((criterion) => {
              const hasData = criterionHasData(criterion, currentMetrics, checklistRates);
              const weighted = weightedCriteria.find((row) => row.criterion.key === criterion.key);
              const autoScore =
                criterion.mode === 'auto' && criterion.autoScore
                  ? criterion.autoScore(currentMetrics, previousMetrics)
                  : null;
              const checklistKeys = criterionChecklistKeys(criterion);
              const checklistScore =
                criterion.mode === 'checklist' && checklistKeys.length
                  ? checklistKeys.reduce((sum, k) => sum + (checklistRates[k] ?? 0), 0) / checklistKeys.length / 10
                  : null;
              return (
                <div key={criterion.key} className="stat-card space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-white">{criterion.label}</span>
                    <span className="text-xs font-bold text-slate-400">وزن {Math.round(criterion.weight * 100)}%{hasData && weighted && Math.abs(weighted.effectiveWeight - criterion.weight) > 0.001 ? ` ← فعلي ${Math.round(weighted.effectiveWeight * 100)}%` : ''}</span>
                  </div>
                  {criterion.hint && <p className="text-xs text-slate-500">{criterion.hint}</p>}
                  {criterion.sourceRoute && (
                    <Link to={criterion.sourceRoute} className="inline-flex items-center gap-1 text-xs font-bold text-teal-300 hover:text-teal-200">
                      <ExternalLink className="h-3 w-3" /> فتح مصدر البيانات: {criterion.sourceLabel || 'التفاصيل'}
                    </Link>
                  )}
                  {criterion.mode === 'auto' && (
                    <div className="flex items-center gap-2">
                      {!hasData ? <span className="rounded-full border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-xs font-bold text-amber-300">مستبعد لعدم اكتمال المصدر — لا صفر ولا درجة افتراضية</span> : <>
                      <span className={`text-2xl font-black ${scoreTone((autoScore || 0) * 10)}`}>
                        {(autoScore || 0).toFixed(1)} / 10
                      </span>
                      {previousMetrics && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          {(autoScore || 0) >= 5 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                        </span>
                      )}
                      </>}
                    </div>
                  )}
                  {criterion.mode === 'checklist' && (
                    <div className="flex items-center gap-2">
                      <span className={`text-2xl font-black ${scoreTone((checklistScore || 0) * 10)}`}>
                        {(checklistScore || 0).toFixed(1)} / 10
                      </span>
                      <span className="text-xs text-slate-500">
                        ({(checklistKeys.length
                          ? checklistKeys.reduce((sum, k) => sum + (checklistRates[k] ?? 0), 0) / checklistKeys.length
                          : 0
                        ).toFixed(0)}% من أيام الأسبوع مسجّلة كمكتملة في المهام اليومية)
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="stat-card space-y-2">
            <div className="text-sm text-slate-400">أرقام مرجعية للأسبوع</div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><span className="text-slate-500">المبيعات: </span><span className="font-bold text-white">{currentMetrics.sales_total.toLocaleString('ar-EG')} ج.م</span></div>
              <div><span className="text-slate-500">متابعات: </span><span className="font-bold text-white">{currentMetrics.followups_total}</span></div>
              <div><span className="text-slate-500">منتهية بدون رد: </span><span className="font-bold text-red-300">{currentMetrics.followups_expired}</span></div>
              <div><span className="text-slate-500">نسبة الاحتفاظ بـ VIP: </span><span className="font-bold text-white">{currentMetrics.vip_retention_rate ?? '—'}%</span></div>
              <div><span className="text-slate-500">طلبات العملاء: </span><span className="font-bold text-white">{currentMetrics.customer_requests_total ?? 0}</span></div>
              <div><span className="text-slate-500">طلبات متأخرة: </span><span className="font-bold text-red-300">{currentMetrics.customer_requests_overdue ?? 0}</span></div>
              <div><span className="text-slate-500">قيمة شراء بعد المتابعة: </span><span className="font-bold text-emerald-300">{(currentMetrics.followups_purchase_amount ?? 0).toLocaleString('ar-EG')} ج.م</span></div>
              <div><span className="text-slate-500">تكويد الفواتير: </span><span className="font-bold text-white">{currentMetrics.sales_coding_rate ?? '—'}%</span></div>
              <div><span className="text-slate-500">إنجاز القوائم اليومية: </span><span className="font-bold text-white">{currentMetrics.daily_queues_completion_rate ?? '—'}%{currentMetrics.daily_queues_total ? ` (${currentMetrics.daily_queues_handled ?? 0}/${currentMetrics.daily_queues_total})` : ''}</span></div>
            </div>
          </div>

          <div className="stat-card space-y-2">
            <label className="text-sm font-bold text-white">ملاحظة إدارية (للتوثيق فقط — لا تغيّر الدرجة أو الحافز)</label>
            <textarea
              className="input-dark w-full min-h-[100px]"
              placeholder="اكتب سياقًا أو إجراءً تصحيحيًا؛ الدرجة تظل محسوبة تلقائيًا..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave('draft')}
              className="flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2 font-black text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> حفظ كمسودة
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave('submitted')}
              className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> اعتماد التقييم
            </button>
          </div>

          {history.length > 0 && (
            <div className="stat-card space-y-2">
              <div className="text-sm font-black text-white">آخر التقييمات</div>
              {history.map((h) => (
                <div key={h.week_start} className="flex items-center justify-between border-b border-white/5 py-1.5 text-sm">
                  <span className="text-slate-400">{h.week_start}</span>
                  <span className={scoreTone(h.total_score)}>{h.total_score} / 100</span>
                  <span className="text-xs text-slate-500">{h.status === 'submitted' ? 'معتمد' : 'مسودة'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
