import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, TrendingUp, TrendingDown, Save, Send, ExternalLink, Star } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import {
  EVALUATION_CRITERIA,
  computeWeightedCriterionScores,
  EVALUATION_TYPE_LABELS,
  computeTotalScore,
  criterionChecklistKeys,
  type EvaluationType,
  type WeeklyAutoMetrics,
} from '@/lib/evaluations/managerEvaluationCriteria';
import {
  fetchManagerEvaluationSubjects,
  fetchWeeklyAutoMetricsFast,
  weekBoundsOf,
  previousWeekOf,
  saveWeeklyEvaluation,
  fetchEvaluationHistory,
  fetchWeeklyChecklistCompletion,
  type ManagerWeeklyEvaluation,
  type ManagerEvaluationSubject,
} from '@/lib/evaluations/managerEvaluationService';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';
import { ManagerMonthlyPerformanceReport } from '@/components/evaluations/ManagerMonthlyPerformanceReport';

const EVALUATOR_ROLES_BY_TYPE: Record<EvaluationType, string[]> = {
  branch_manager: ['general_manager', 'executive_manager', 'branches_manager'],
  branches_manager: ['general_manager'],
  customer_service: ['general_manager', 'executive_manager', 'branches_manager'],
};

const SYSTEM_PERFORMANCE_WEIGHT = 0.8;
const MANAGER_JUDGMENT_WEIGHT = 0.2;

function scoreTone(score: number) {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-red-300';
}

function formatDate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function incentiveCycleBounds(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = d.getDate() >= 26
    ? new Date(d.getFullYear(), d.getMonth(), 26)
    : new Date(d.getFullYear(), d.getMonth() - 1, 26);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
  return { start: formatDate(start), end: formatDate(end) };
}

function previousIncentiveCycle(periodStart: string) {
  const start = new Date(`${periodStart}T12:00:00`);
  const previousAnchor = new Date(start.getFullYear(), start.getMonth() - 1, 26);
  return incentiveCycleBounds(previousAnchor);
}

function clampManagerScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

export default function WeeklyManagerEvaluation() {
  const { type } = useParams<{ type: EvaluationType }>();
  const evaluationType = (type && EVALUATION_CRITERIA[type as EvaluationType] ? type : 'branch_manager') as EvaluationType;
  const isMonthlyIncentiveEvaluation = evaluationType === 'branch_manager' || evaluationType === 'customer_service';
  const { user } = useAuth();
  const evaluatorRole = normalizeRole(user?.role);
  const canEvaluate = EVALUATOR_ROLES_BY_TYPE[evaluationType].includes(evaluatorRole);
  const evaluatorStaffId = String(user?.staffId || user?.id || '');
  const allowManagerJudgment = isMonthlyIncentiveEvaluation && ['branches_manager', 'general_manager', 'executive_manager'].includes(evaluatorRole);

  const [subjectChoices, setSubjectChoices] = useState<ManagerEvaluationSubject[]>([]);
  const [subjectStaffId, setSubjectStaffId] = useState('');
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const subject = useMemo(
    () => subjectChoices.find((item) => item.id === subjectStaffId) || null,
    [subjectChoices, subjectStaffId]
  );

  const [periodStart, setPeriodStart] = useState(() =>
    isMonthlyIncentiveEvaluation ? incentiveCycleBounds(new Date()).start : weekBoundsOf(new Date()).start
  );
  const [selectedBranch, setSelectedBranch] = useState<'فرع شكري' | 'فرع الشامي'>('فرع شكري');
  const periodEnd = useMemo(() => {
    if (isMonthlyIncentiveEvaluation) return incentiveCycleBounds(new Date(`${periodStart}T12:00:00`)).end;
    return weekBoundsOf(new Date(`${periodStart}T12:00:00`)).end;
  }, [isMonthlyIncentiveEvaluation, periodStart]);

  const [currentMetrics, setCurrentMetrics] = useState<WeeklyAutoMetrics | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState<WeeklyAutoMetrics | null>(null);
  const [checklistRates, setChecklistRates] = useState<Record<string, number>>({});
  const [manualScores, setManualScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ week_start: string; total_score: number; status: string }>>([]);

  const branchForMetrics = evaluationType === 'branches_manager' ? selectedBranch : subject?.branch || null;
  const criteria = EVALUATION_CRITERIA[evaluationType];

  useEffect(() => {
    setPeriodStart(isMonthlyIncentiveEvaluation ? incentiveCycleBounds(new Date()).start : weekBoundsOf(new Date()).start);
  }, [isMonthlyIncentiveEvaluation, evaluationType]);

  useEffect(() => {
    setManualScores({});
    setNote('');
  }, [subjectStaffId, periodStart, evaluationType, branchForMetrics]);

  useEffect(() => {
    if (!canEvaluate || !user?.id) return;
    let cancelled = false;
    setSubjectsLoading(true);
    setError('');
    fetchManagerEvaluationSubjects(String(user.id), evaluationType)
      .then((rows) => {
        if (cancelled) return;
        setSubjectChoices(rows);
        setSubjectStaffId((current) => {
          if (current && rows.some((row) => row.id === current)) return current;
          return rows[0]?.id || '';
        });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة التقييم'))
      .finally(() => !cancelled && setSubjectsLoading(false));
    return () => { cancelled = true; };
  }, [canEvaluate, evaluationType, user?.id]);

  useEffect(() => {
    if (!subjectStaffId || !user?.id || !branchForMetrics) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setCurrentMetrics(null);
    setPreviousMetrics(null);
    const previous = isMonthlyIncentiveEvaluation
      ? previousIncentiveCycle(periodStart)
      : previousWeekOf(periodStart);

    Promise.all([
      fetchWeeklyAutoMetricsFast(String(user.id), evaluationType, branchForMetrics, periodStart, periodEnd),
      fetchWeeklyAutoMetricsFast(String(user.id), evaluationType, branchForMetrics, previous.start, previous.end),
      fetchWeeklyChecklistCompletion(subjectStaffId, periodStart, periodEnd, branchForMetrics),
    ])
      .then(([cur, prevMetrics, checklist]) => {
        if (cancelled) return;
        setCurrentMetrics(cur);
        setPreviousMetrics(prevMetrics);
        setChecklistRates(checklist);
        setLoading(false);
        void fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics)
          .then((hist) => {
            if (!cancelled) setHistory(hist as Array<{ week_start: string; total_score: number; status: string }>);
          })
          .catch(() => {
            if (!cancelled) setHistory([]);
          });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [subjectStaffId, periodStart, periodEnd, evaluationType, branchForMetrics, user?.id, isMonthlyIncentiveEvaluation]);

  const objectiveScore = useMemo(() => {
    if (!currentMetrics) return 0;
    return computeTotalScore(evaluationType, currentMetrics, previousMetrics, {}, checklistRates);
  }, [evaluationType, currentMetrics, previousMetrics, checklistRates]);

  const weightedCriteria = useMemo(() => currentMetrics
    ? computeWeightedCriterionScores(evaluationType, currentMetrics, previousMetrics, {}, checklistRates)
    : [], [evaluationType, currentMetrics, previousMetrics, checklistRates]);

  const manualCompletedCount = criteria.filter((criterion) => Number.isFinite(manualScores[criterion.key])).length;
  const managerJudgmentComplete = !allowManagerJudgment || manualCompletedCount === criteria.length;
  const managerJudgmentScore = useMemo(() => {
    if (!allowManagerJudgment || !criteria.length) return 0;
    const scored = criteria.filter((criterion) => Number.isFinite(manualScores[criterion.key]));
    const scoredWeight = scored.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (!scoredWeight) return 0;
    const weighted = scored.reduce(
      (sum, criterion) => sum + clampManagerScore(manualScores[criterion.key]) * criterion.weight * 10,
      0
    );
    return Math.round((weighted / scoredWeight) * 10) / 10;
  }, [allowManagerJudgment, criteria, manualScores]);

  const totalScore = useMemo(() => {
    if (!allowManagerJudgment || !managerJudgmentComplete) return objectiveScore;
    return Math.round((objectiveScore * SYSTEM_PERFORMANCE_WEIGHT + managerJudgmentScore * MANAGER_JUDGMENT_WEIGHT) * 10) / 10;
  }, [allowManagerJudgment, managerJudgmentComplete, objectiveScore, managerJudgmentScore]);

  const handleManualScore = (criterionKey: string, value: string) => {
    if (value === '') {
      setManualScores((current) => {
        const next = { ...current };
        delete next[criterionKey];
        return next;
      });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setManualScores((current) => ({ ...current, [criterionKey]: clampManagerScore(parsed) }));
  };

  const handleSave = async (status: 'draft' | 'submitted') => {
    if (!subjectStaffId || !currentMetrics) return;
    if (!canEvaluate || String(subjectStaffId) === evaluatorStaffId) {
      setError('لا يمكن اعتماد هذا التقييم: يجب أن يكون المُقيِّم مديرًا أعلى ومختلفًا عن الشخص المُقيَّم.');
      return;
    }
    if (status === 'submitted' && allowManagerJudgment && !managerJudgmentComplete) {
      setError(`أكمل تقييم مدير الفروع لكل البنود قبل الاعتماد النهائي (${manualCompletedCount}/${criteria.length}).`);
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
        week_start: periodStart,
        week_end: periodEnd,
        auto_metrics: currentMetrics,
        manual_scores: manualScores,
        manual_note: note || null,
        total_score: totalScore,
        status,
      };
      await saveWeeklyEvaluation(payload);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'success',
          message: status === 'submitted'
            ? (isMonthlyIncentiveEvaluation ? 'تم اعتماد تقييم دورة الحافز الشهرية' : 'تم اعتماد التقييم')
            : 'تم حفظ المسودة',
        },
      }));
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
          <h1 className="text-xl font-black text-white">
            {EVALUATION_TYPE_LABELS[evaluationType]}
            {isMonthlyIncentiveEvaluation ? ' — تقييم شهري للحافز' : ''}
          </h1>
          <p className="text-sm text-slate-400">
            {allowManagerJudgment
              ? 'التقييم النهائي يجمع 80% من الأداء الموثق داخل التطبيق + 20% تقييم مدير الفروع لكل بند.'
              : isMonthlyIncentiveEvaluation
                ? 'تقييم واحد معتمد لكل دورة 26→25، مبني على بيانات التطبيق والمهام الموثقة خلال الدورة.'
                : 'نموذج أسبوعي موضوعي مبني على بيانات التطبيق والمهام الموثقة.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input-dark" value={subjectStaffId} onChange={(e) => setSubjectStaffId(e.target.value)} disabled={subjectsLoading}>
          <option value="">{subjectsLoading ? 'جارٍ تحميل الأشخاص...' : 'اختر الشخص المُقيَّم'}</option>
          {subjectChoices.map((s) => (
            <option key={s.id} value={s.id}>{s.name} {s.branch ? `— ${s.branch}` : ''}</option>
          ))}
        </select>
        {evaluationType === 'branches_manager' && (
          <select className="input-dark" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value as 'فرع شكري' | 'فرع الشامي')}>
            <option value="فرع شكري">تقييم فرع شكري</option>
            <option value="فرع الشامي">تقييم فرع الشامي</option>
          </select>
        )}
        <input
          type="date"
          className="input-dark"
          value={periodStart}
          onChange={(e) => {
            const chosen = new Date(`${e.target.value}T12:00:00`);
            setPeriodStart(isMonthlyIncentiveEvaluation ? incentiveCycleBounds(chosen).start : weekBoundsOf(chosen).start);
          }}
        />
        <span className="flex items-center text-xs text-slate-400">
          {isMonthlyIncentiveEvaluation ? 'دورة الحافز' : 'الأسبوع'}: {periodStart} إلى {periodEnd}
        </span>
      </div>

      {!subjectsLoading && subjectChoices.length === 0 && <p className="text-sm text-amber-300">لا يوجد مدير نشط وصالح للتقييم في هذا المسار.</p>}
      {loading && <p className="text-sm text-slate-400">جارٍ تحميل بيانات التقييم...</p>}
      {error && <p className="rounded-xl border border-red-500/20 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}

      {currentMetrics && !loading && (
        <>
          <div className={`grid gap-3 ${allowManagerJudgment ? 'md:grid-cols-3' : ''}`}>
            <div className="stat-card">
              <div className="text-sm text-slate-400">أداء التطبيق والمهام {allowManagerJudgment ? '(80%)' : ''}</div>
              <div className={`text-4xl font-black ${scoreTone(objectiveScore)}`}>{objectiveScore}<span className="text-lg text-slate-500"> / 100</span></div>
            </div>
            {allowManagerJudgment && (
              <>
                <div className="stat-card">
                  <div className="flex items-center gap-2 text-sm text-slate-400"><Star className="h-4 w-4" /> تقييم مدير الفروع (20%)</div>
                  <div className={`text-4xl font-black ${scoreTone(managerJudgmentScore)}`}>{managerJudgmentScore}<span className="text-lg text-slate-500"> / 100</span></div>
                  <div className="mt-1 text-xs text-slate-500">تم تقييم {manualCompletedCount} من {criteria.length} بند</div>
                </div>
                <div className="stat-card">
                  <div className="text-sm text-slate-400">الدرجة النهائية للحافز</div>
                  <div className={`text-4xl font-black ${scoreTone(totalScore)}`}>{totalScore}<span className="text-lg text-slate-500"> / 100</span></div>
                  {!managerJudgmentComplete && <div className="mt-1 text-xs text-amber-300">تكتمل الدرجة النهائية بعد تقييم كل البنود.</div>}
                </div>
              </>
            )}
          </div>

          <ManagerLiveIncentiveCard evaluationType={evaluationType} staffId={subjectStaffId} branch={branchForMetrics} />
          <ManagerMonthlyPerformanceReport evaluationType={evaluationType} staffId={subjectStaffId} branch={branchForMetrics} />

          <div className="grid gap-3 md:grid-cols-2">
            {criteria.map((criterion) => {
              const weighted = weightedCriteria.find((row) => row.criterion.key === criterion.key);
              const systemScore10 = weighted?.score10 ?? 0;
              const autoScore = criterion.mode === 'auto' && criterion.autoScore
                ? criterion.autoScore(currentMetrics, previousMetrics)
                : null;
              const checklistKeys = criterionChecklistKeys(criterion);
              const checklistScore = criterion.mode === 'checklist' && checklistKeys.length
                ? checklistKeys.reduce((sum, k) => sum + (checklistRates[k] ?? 0), 0) / checklistKeys.length / 10
                : null;
              const manualScore = manualScores[criterion.key];
              const combinedCriterionScore = Number.isFinite(manualScore)
                ? Math.round((systemScore10 * SYSTEM_PERFORMANCE_WEIGHT + clampManagerScore(manualScore) * MANAGER_JUDGMENT_WEIGHT) * 10) / 10
                : null;

              return (
                <div key={criterion.key} className="stat-card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-black text-white">{criterion.label}</span>
                    <span className="whitespace-nowrap text-xs font-bold text-slate-400">وزن {Math.round(criterion.weight * 100)}%</span>
                  </div>
                  {criterion.hint && <p className="text-xs text-slate-500">{criterion.hint}</p>}
                  {criterion.sourceRoute && (
                    <Link to={criterion.sourceRoute} className="inline-flex items-center gap-1 text-xs font-bold text-teal-300 hover:text-teal-200">
                      <ExternalLink className="h-3 w-3" /> فتح مصدر البيانات: {criterion.sourceLabel || 'التفاصيل'}
                    </Link>
                  )}

                  <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                    <div className="text-[11px] font-bold text-slate-500">درجة الأداء الموثق</div>
                    {criterion.mode === 'auto' ? (
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black ${scoreTone((autoScore || 0) * 10)}`}>{(autoScore || 0).toFixed(1)} / 10</span>
                        {previousMetrics && ((autoScore || 0) >= 5 ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />)}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black ${scoreTone((checklistScore || 0) * 10)}`}>{(checklistScore || 0).toFixed(1)} / 10</span>
                        <span className="text-xs text-slate-500">من إنجاز المهام خلال {isMonthlyIncentiveEvaluation ? 'الدورة' : 'الأسبوع'}</span>
                      </div>
                    )}
                  </div>

                  {allowManagerJudgment && (
                    <div className="rounded-xl border border-teal-500/15 bg-teal-950/10 p-3">
                      <label className="mb-2 block text-xs font-black text-teal-200">تقييم مدير الفروع لهذا البند</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.5"
                          value={Number.isFinite(manualScore) ? manualScore : ''}
                          onChange={(e) => handleManualScore(criterion.key, e.target.value)}
                          placeholder="0 - 10"
                          className="input-dark w-28"
                        />
                        <span className="text-xs text-slate-400">من 10</span>
                        {combinedCriterionScore !== null && (
                          <span className="mr-auto text-xs font-bold text-white">المجمّع: {combinedCriterionScore.toFixed(1)} / 10</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="stat-card space-y-2">
            <div className="text-sm text-slate-400">أرقام مرجعية لـ{isMonthlyIncentiveEvaluation ? 'لدورة' : 'لأسبوع'}</div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><span className="text-slate-500">المبيعات: </span><span className="font-bold text-white">{currentMetrics.sales_total.toLocaleString('ar-EG')} ج.م</span></div>
              <div><span className="text-slate-500">متابعات: </span><span className="font-bold text-white">{currentMetrics.followups_total}</span></div>
              <div><span className="text-slate-500">منتهية بدون رد: </span><span className="font-bold text-red-300">{currentMetrics.followups_expired}</span></div>
              <div><span className="text-slate-500">نسبة الاحتفاظ بـ VIP: </span><span className="font-bold text-white">{currentMetrics.vip_retention_rate ?? '—'}%</span></div>
              <div><span className="text-slate-500">طلبات العملاء: </span><span className="font-bold text-white">{currentMetrics.customer_requests_total ?? 0}</span></div>
              <div><span className="text-slate-500">طلبات متأخرة: </span><span className="font-bold text-red-300">{currentMetrics.customer_requests_overdue ?? 0}</span></div>
              <div><span className="text-slate-500">قيمة شراء بعد المتابعة: </span><span className="font-bold text-emerald-300">{(currentMetrics.followups_purchase_amount ?? 0).toLocaleString('ar-EG')} ج.م</span></div>
              <div><span className="text-slate-500">تكويد الفواتير: </span><span className="font-bold text-white">{currentMetrics.sales_coding_rate ?? '—'}%</span></div>
            </div>
          </div>

          <div className="stat-card space-y-2">
            <label className="text-sm font-bold text-white">ملاحظة مدير الفروع على التقييم</label>
            <textarea
              className="input-dark min-h-[100px] w-full"
              placeholder="اكتب نقاط القوة، الملاحظات، أو المطلوب تحسينه خلال الدورة القادمة..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => handleSave('draft')} className="flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2 font-black text-white disabled:opacity-50">
              <Save className="h-4 w-4" /> حفظ كمسودة
            </button>
            <button type="button" disabled={saving} onClick={() => handleSave('submitted')} className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50">
              <Send className="h-4 w-4" /> {isMonthlyIncentiveEvaluation ? 'اعتماد تقييم الدورة' : 'اعتماد التقييم'}
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
