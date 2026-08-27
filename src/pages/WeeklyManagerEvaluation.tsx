import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ClipboardList, TrendingUp, TrendingDown, Save, Send, ExternalLink, Star,
  FileDown, Share2, ChevronDown, ChevronUp,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
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
  type ManagerEvaluationHistoryRecord,
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

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Number.isFinite(Number(v)))
      .map(([k, v]) => [k, Number(v)])
  );
}

async function buildEvaluationPdf(
  record: ManagerEvaluationHistoryRecord,
  criteria: typeof EVALUATION_CRITERIA[EvaluationType]
) {
  const metrics = (record.auto_metrics || {}) as WeeklyAutoMetrics & Record<string, unknown>;
  const systemScores = numericRecord(metrics.__criterion_system_scores);
  const combinedScores = numericRecord(metrics.__criterion_combined_scores);
  const objectiveScore = Number(metrics.__objective_score ?? record.total_score ?? 0);
  const managerScore = Number(metrics.__manager_judgment_score ?? 0);
  const manualScores = numericRecord(record.manual_scores);
  const typeLabel = EVALUATION_TYPE_LABELS[record.evaluation_type];
  const rows = criteria.map((criterion) => {
    const system = systemScores[criterion.key];
    const manual = manualScores[criterion.key];
    const combined = combinedScores[criterion.key];
    return `
      <tr>
        <td>${escapeHtml(criterion.label)}</td>
        <td>${Number.isFinite(system) ? `${system.toFixed(1)} / 10` : '—'}</td>
        <td>${Number.isFinite(manual) ? `${manual.toFixed(1)} / 10` : '—'}</td>
        <td>${Number.isFinite(combined) ? `${combined.toFixed(1)} / 10` : '—'}</td>
        <td>${Math.round(criterion.weight * 100)}%</td>
      </tr>`;
  }).join('');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;color:#111827;z-index:-1;';
  host.innerHTML = `
    <div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;padding:38px;line-height:1.6;background:#fff;color:#111827">
      <div style="border-bottom:3px solid #0f766e;padding-bottom:14px;margin-bottom:18px">
        <div style="font-size:25px;font-weight:800;color:#0f766e">صيدليات دواء - تقرير تقييم الأداء</div>
        <div style="font-size:18px;font-weight:700;margin-top:6px">${escapeHtml(typeLabel)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px">
        <tr><td style="font-weight:700">الموظف</td><td>${escapeHtml(record.subject_name || '')}</td><td style="font-weight:700">الفرع</td><td>${escapeHtml(record.branch || '')}</td></tr>
        <tr><td style="font-weight:700">الدورة</td><td>${escapeHtml(record.week_start)} إلى ${escapeHtml(record.week_end)}</td><td style="font-weight:700">المقيّم</td><td>${escapeHtml(record.evaluator_name || '')}</td></tr>
        <tr><td style="font-weight:700">الحالة</td><td>${record.status === 'submitted' ? 'معتمد' : 'مسودة'}</td><td style="font-weight:700">تاريخ الاعتماد</td><td>${escapeHtml(record.submitted_at ? new Date(record.submitted_at).toLocaleString('ar-EG') : '—')}</td></tr>
      </table>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:12px;text-align:center"><div style="font-size:12px;color:#6b7280">أداء النظام (80%)</div><div style="font-size:24px;font-weight:800">${objectiveScore.toFixed(1)} / 100</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:12px;text-align:center"><div style="font-size:12px;color:#6b7280">تقييم مدير الفروع (20%)</div><div style="font-size:24px;font-weight:800">${managerScore.toFixed(1)} / 100</div></div>
        <div style="border:2px solid #0f766e;border-radius:10px;padding:12px;text-align:center"><div style="font-size:12px;color:#0f766e">الدرجة النهائية</div><div style="font-size:26px;font-weight:900;color:#0f766e">${Number(record.total_score || 0).toFixed(1)} / 100</div></div>
      </div>
      <div style="font-size:16px;font-weight:800;margin:16px 0 8px">تفاصيل البنود</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f0fdfa"><th>البند</th><th>النظام</th><th>مدير الفروع</th><th>المجمّع</th><th>الوزن</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:20px;border:1px solid #d1d5db;border-radius:10px;padding:14px;min-height:70px">
        <div style="font-weight:800;margin-bottom:5px">ملاحظات مدير الفروع</div>
        <div style="white-space:pre-wrap">${escapeHtml(record.manual_note || 'لا توجد ملاحظات مسجلة.')}</div>
      </div>
      <div style="margin-top:22px;font-size:10px;color:#6b7280;text-align:center">تم إنشاء التقرير من نظام Dawaa Pharmacy - سجل تقييم معتمد داخل قاعدة البيانات</div>
    </div>`;
  host.querySelectorAll('td,th').forEach((el) => {
    (el as HTMLElement).style.border = '1px solid #d1d5db';
    (el as HTMLElement).style.padding = '8px';
    (el as HTMLElement).style.textAlign = 'right';
  });
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 190;
    const pageHeight = 277;
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png', 1);
    let heightLeft = imgHeight;
    let position = 10;
    pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = 10 - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const safeName = String(record.subject_name || 'employee').replace(/[\\/:*?"<>|]/g, '-');
    const fileName = `تقييم-${safeName}-${record.week_start}-${record.week_end}.pdf`;
    return { pdf, fileName };
  } finally {
    host.remove();
  }
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
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ManagerEvaluationHistoryRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

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
        setSubjectStaffId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
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
    const previous = isMonthlyIncentiveEvaluation ? previousIncentiveCycle(periodStart) : previousWeekOf(periodStart);

    Promise.all([
      fetchWeeklyAutoMetricsFast(String(user.id), evaluationType, branchForMetrics, periodStart, periodEnd),
      fetchWeeklyAutoMetricsFast(String(user.id), evaluationType, branchForMetrics, previous.start, previous.end),
      fetchWeeklyChecklistCompletion(subjectStaffId, periodStart, periodEnd, branchForMetrics),
      fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics),
    ])
      .then(([cur, prevMetrics, checklist, hist]) => {
        if (cancelled) return;
        setCurrentMetrics(cur);
        setPreviousMetrics(prevMetrics);
        setChecklistRates(checklist);
        setHistory(hist);
        const currentSaved = hist.find((row) => row.week_start === periodStart && row.week_end === periodEnd);
        if (currentSaved) {
          setManualScores(numericRecord(currentSaved.manual_scores));
          setNote(String(currentSaved.manual_note || ''));
        }
        setLoading(false);
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
      const criterionSystemScores = Object.fromEntries(weightedCriteria.map((row) => [row.criterion.key, row.score10]));
      const criterionCombinedScores = Object.fromEntries(criteria.map((criterion) => {
        const system = criterionSystemScores[criterion.key] ?? 0;
        const manual = manualScores[criterion.key];
        return [criterion.key, Number.isFinite(manual)
          ? Math.round((system * SYSTEM_PERFORMANCE_WEIGHT + clampManagerScore(manual) * MANAGER_JUDGMENT_WEIGHT) * 10) / 10
          : system];
      }));
      const enrichedMetrics = {
        ...currentMetrics,
        __objective_score: objectiveScore,
        __manager_judgment_score: managerJudgmentScore,
        __system_performance_weight: SYSTEM_PERFORMANCE_WEIGHT,
        __manager_judgment_weight: MANAGER_JUDGMENT_WEIGHT,
        __checklist_rates: checklistRates,
        __criterion_system_scores: criterionSystemScores,
        __criterion_combined_scores: criterionCombinedScores,
      } as WeeklyAutoMetrics & Record<string, unknown>;

      const payload: ManagerWeeklyEvaluation = {
        evaluation_type: evaluationType,
        subject_staff_id: subjectStaffId,
        subject_name: subject?.name || null,
        branch: branchForMetrics,
        evaluator_staff_id: evaluatorStaffId || null,
        evaluator_name: user?.name || null,
        week_start: periodStart,
        week_end: periodEnd,
        auto_metrics: enrichedMetrics,
        manual_scores: manualScores,
        manual_note: note.trim() || null,
        total_score: totalScore,
        status,
      };
      const saved = await saveWeeklyEvaluation(payload);
      const hist = await fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics);
      setHistory(hist);
      if (saved?.id) setExpandedRecordId(saved.id);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'success',
          message: status === 'submitted'
            ? 'تم حفظ واعتماد تقييم الدورة وإضافته إلى سجل التقييمات'
            : 'تم حفظ مسودة التقييم في السجل',
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handlePdf = async (record: ManagerEvaluationHistoryRecord, share: boolean) => {
    setExportingId(record.id);
    setError('');
    try {
      const { pdf, fileName } = await buildEvaluationPdf(record, EVALUATION_CRITERIA[record.evaluation_type]);
      const blob = pdf.output('blob');
      if (share && typeof navigator.share === 'function') {
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ title: fileName, text: 'تقرير تقييم الأداء من صيدليات دواء', files: [file] });
          return;
        }
      }
      pdf.save(fileName);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(err instanceof Error ? err.message : 'تعذر إنشاء ملف PDF');
    } finally {
      setExportingId(null);
    }
  };

  if (!canEvaluate) {
    return <div dir="rtl" className="p-6 text-sm text-slate-400">ليس لديك مستوى الاعتماد المطلوب لهذا النوع من التقييم.</div>;
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">{EVALUATION_TYPE_LABELS[evaluationType]}{isMonthlyIncentiveEvaluation ? ' — تقييم شهري للحافز' : ''}</h1>
          <p className="text-sm text-slate-400">
            {allowManagerJudgment
              ? 'التقييم النهائي يجمع 80% من الأداء الموثق داخل التطبيق + 20% تقييم مدير الفروع، ويحفظ كسجل كامل قابل للتصدير والمشاركة.'
              : 'التقييم مبني على بيانات التطبيق والمهام الموثقة.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input-dark" value={subjectStaffId} onChange={(e) => setSubjectStaffId(e.target.value)} disabled={subjectsLoading}>
          <option value="">{subjectsLoading ? 'جارٍ تحميل الأشخاص...' : 'اختر الشخص المُقيَّم'}</option>
          {subjectChoices.map((s) => <option key={s.id} value={s.id}>{s.name} {s.branch ? `— ${s.branch}` : ''}</option>)}
        </select>
        {evaluationType === 'branches_manager' && (
          <select className="input-dark" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value as 'فرع شكري' | 'فرع الشامي')}>
            <option value="فرع شكري">تقييم فرع شكري</option><option value="فرع الشامي">تقييم فرع الشامي</option>
          </select>
        )}
        <input type="date" className="input-dark" value={periodStart} onChange={(e) => {
          const chosen = new Date(`${e.target.value}T12:00:00`);
          setPeriodStart(isMonthlyIncentiveEvaluation ? incentiveCycleBounds(chosen).start : weekBoundsOf(chosen).start);
        }} />
        <span className="flex items-center text-xs text-slate-400">{isMonthlyIncentiveEvaluation ? 'دورة الحافز' : 'الأسبوع'}: {periodStart} إلى {periodEnd}</span>
      </div>

      {!subjectsLoading && subjectChoices.length === 0 && <p className="text-sm text-amber-300">لا يوجد موظف نشط وصالح للتقييم في هذا المسار.</p>}
      {loading && <p className="text-sm text-slate-400">جارٍ تحميل بيانات التقييم...</p>}
      {error && <p className="rounded-xl border border-red-500/20 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}

      {currentMetrics && !loading && (
        <>
          <div className={`grid gap-3 ${allowManagerJudgment ? 'md:grid-cols-3' : ''}`}>
            <div className="stat-card"><div className="text-sm text-slate-400">أداء التطبيق والمهام {allowManagerJudgment ? '(80%)' : ''}</div><div className={`text-4xl font-black ${scoreTone(objectiveScore)}`}>{objectiveScore}<span className="text-lg text-slate-500"> / 100</span></div></div>
            {allowManagerJudgment && <>
              <div className="stat-card"><div className="flex items-center gap-2 text-sm text-slate-400"><Star className="h-4 w-4" /> تقييم مدير الفروع (20%)</div><div className={`text-4xl font-black ${scoreTone(managerJudgmentScore)}`}>{managerJudgmentScore}<span className="text-lg text-slate-500"> / 100</span></div><div className="mt-1 text-xs text-slate-500">تم تقييم {manualCompletedCount} من {criteria.length} بند</div></div>
              <div className="stat-card"><div className="text-sm text-slate-400">الدرجة النهائية للحافز</div><div className={`text-4xl font-black ${scoreTone(totalScore)}`}>{totalScore}<span className="text-lg text-slate-500"> / 100</span></div>{!managerJudgmentComplete && <div className="mt-1 text-xs text-amber-300">تكتمل الدرجة بعد تقييم كل البنود.</div>}</div>
            </>}
          </div>

          <ManagerLiveIncentiveCard evaluationType={evaluationType} staffId={subjectStaffId} branch={branchForMetrics} />
          <ManagerMonthlyPerformanceReport evaluationType={evaluationType} staffId={subjectStaffId} branch={branchForMetrics} />

          <div className="grid gap-3 md:grid-cols-2">
            {criteria.map((criterion) => {
              const weighted = weightedCriteria.find((row) => row.criterion.key === criterion.key);
              const systemScore10 = weighted?.score10 ?? 0;
              const autoScore = criterion.mode === 'auto' && criterion.autoScore ? criterion.autoScore(currentMetrics, previousMetrics) : null;
              const checklistKeys = criterionChecklistKeys(criterion);
              const checklistScore = criterion.mode === 'checklist' && checklistKeys.length
                ? checklistKeys.reduce((sum, k) => sum + (checklistRates[k] ?? 0), 0) / checklistKeys.length / 10 : null;
              const manualScore = manualScores[criterion.key];
              const combinedCriterionScore = Number.isFinite(manualScore)
                ? Math.round((systemScore10 * SYSTEM_PERFORMANCE_WEIGHT + clampManagerScore(manualScore) * MANAGER_JUDGMENT_WEIGHT) * 10) / 10 : null;
              return (
                <div key={criterion.key} className="stat-card space-y-3">
                  <div className="flex items-start justify-between gap-3"><span className="font-black text-white">{criterion.label}</span><span className="whitespace-nowrap text-xs font-bold text-slate-400">وزن {Math.round(criterion.weight * 100)}%</span></div>
                  {criterion.hint && <p className="text-xs text-slate-500">{criterion.hint}</p>}
                  {criterion.sourceRoute && <Link to={criterion.sourceRoute} className="inline-flex items-center gap-1 text-xs font-bold text-teal-300"><ExternalLink className="h-3 w-3" /> فتح مصدر البيانات: {criterion.sourceLabel || 'التفاصيل'}</Link>}
                  <div className="rounded-xl border border-white/5 bg-black/10 p-3">
                    <div className="text-[11px] font-bold text-slate-500">درجة الأداء الموثق</div>
                    {criterion.mode === 'auto' ? <div className="flex items-center gap-2"><span className={`text-2xl font-black ${scoreTone((autoScore || 0) * 10)}`}>{(autoScore || 0).toFixed(1)} / 10</span>{previousMetrics && ((autoScore || 0) >= 5 ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />)}</div>
                      : <div className="flex items-center gap-2"><span className={`text-2xl font-black ${scoreTone((checklistScore || 0) * 10)}`}>{(checklistScore || 0).toFixed(1)} / 10</span><span className="text-xs text-slate-500">من إنجاز المهام خلال {isMonthlyIncentiveEvaluation ? 'الدورة' : 'الأسبوع'}</span></div>}
                  </div>
                  {allowManagerJudgment && <div className="rounded-xl border border-teal-500/15 bg-teal-950/10 p-3">
                    <label className="mb-2 block text-xs font-black text-teal-200">تقييم مدير الفروع لهذا البند</label>
                    <div className="flex items-center gap-3"><input type="number" min="0" max="10" step="0.5" value={Number.isFinite(manualScore) ? manualScore : ''} onChange={(e) => handleManualScore(criterion.key, e.target.value)} placeholder="0 - 10" className="input-dark w-28" /><span className="text-xs text-slate-400">من 10</span>{combinedCriterionScore !== null && <span className="mr-auto text-xs font-bold text-white">المجمّع: {combinedCriterionScore.toFixed(1)} / 10</span>}</div>
                  </div>}
                </div>
              );
            })}
          </div>

          <div className="stat-card space-y-2">
            <label className="text-sm font-bold text-white">ملاحظة مدير الفروع على التقييم</label>
            <p className="text-xs text-slate-500">الملاحظة تحفظ داخل سجل الدورة وتظهر كاملة في ملف الـPDF المرسل للموظف.</p>
            <textarea className="input-dark min-h-[120px] w-full" placeholder="اكتب نقاط القوة، الملاحظات، المطلوب تحسينه، أو خطة العمل للدورة القادمة..." value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => handleSave('draft')} className="flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2 font-black text-white disabled:opacity-50"><Save className="h-4 w-4" /> حفظ كمسودة</button>
            <button type="button" disabled={saving} onClick={() => handleSave('submitted')} className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50"><Send className="h-4 w-4" /> {saving ? 'جارٍ الحفظ...' : isMonthlyIncentiveEvaluation ? 'حفظ واعتماد تقييم الدورة' : 'حفظ واعتماد التقييم'}</button>
          </div>

          {history.length > 0 && <div className="stat-card space-y-3">
            <div><div className="text-base font-black text-white">سجل التقييمات</div><div className="text-xs text-slate-500">كل دورة محفوظة ببياناتها ودرجاتها وملاحظاتها، ويمكن تصديرها أو مشاركتها كـ PDF.</div></div>
            {history.map((record) => {
              const expanded = expandedRecordId === record.id;
              const recMetrics = (record.auto_metrics || {}) as Record<string, unknown>;
              const objective = Number(recMetrics.__objective_score ?? record.total_score ?? 0);
              const manager = Number(recMetrics.__manager_judgment_score ?? 0);
              return <div key={record.id} className="rounded-xl border border-white/10 bg-black/10">
                <button type="button" onClick={() => setExpandedRecordId(expanded ? null : record.id)} className="flex w-full items-center gap-3 p-3 text-right">
                  <div className="min-w-0 flex-1"><div className="font-bold text-white">{record.week_start} إلى {record.week_end}</div><div className="text-xs text-slate-500">{record.status === 'submitted' ? 'معتمد' : 'مسودة'} • {record.evaluator_name || '—'}</div></div>
                  <span className={`font-black ${scoreTone(Number(record.total_score || 0))}`}>{Number(record.total_score || 0).toFixed(1)} / 100</span>{expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {expanded && <div className="space-y-3 border-t border-white/5 p-3">
                  <div className="grid gap-2 text-sm md:grid-cols-3"><div>أداء النظام: <b>{objective.toFixed(1)}/100</b></div><div>تقييم مدير الفروع: <b>{manager.toFixed(1)}/100</b></div><div>النهائي: <b>{Number(record.total_score || 0).toFixed(1)}/100</b></div></div>
                  <div className="rounded-lg border border-white/5 p-3"><div className="mb-1 text-xs font-bold text-slate-400">الملاحظة</div><div className="whitespace-pre-wrap text-sm text-white">{record.manual_note || 'لا توجد ملاحظات.'}</div></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={exportingId === record.id} onClick={() => void handlePdf(record, false)} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white"><FileDown className="h-4 w-4" /> تصدير PDF</button>
                    <button type="button" disabled={exportingId === record.id} onClick={() => void handlePdf(record, true)} className="flex items-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-slate-950"><Share2 className="h-4 w-4" /> مشاركة التقرير</button>
                  </div>
                </div>}
              </div>;
            })}
          </div>}
        </>
      )}
    </div>
  );
}
