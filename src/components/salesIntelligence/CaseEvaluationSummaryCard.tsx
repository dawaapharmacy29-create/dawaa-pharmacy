import { useEffect, useState } from 'react';
import { BadgeCheck, Clock3, Info, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadCaseEvaluationSummaries, type CaseEvaluationSummary } from '@/lib/salesIntelligence/qa/caseEvaluationSummary';

function ScoreGauge({ score }: { score: number | null }) {
  const circumference = 2 * Math.PI * 48;
  return (
    <div className="relative grid h-32 w-32 shrink-0 place-items-center" role="img" aria-label={score === null ? 'الدرجة الآلية غير متاحة' : `${score} / 100`}>
      <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 112 112" aria-hidden="true">
        <circle cx="56" cy="56" r="48" fill="none" stroke="var(--dawaa-theme-border)" strokeWidth="7" />
        {score !== null ? <circle cx="56" cy="56" r="48" fill="none" stroke="var(--dawaa-theme-primary)" strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} /> : null}
      </svg>
      <div className="text-center">
        <div className="dawaa-heading text-4xl font-black tabular-nums" dir="ltr">{score ?? '—'}</div>
        <div className="dawaa-muted mt-1 text-xs">من 100</div>
      </div>
    </div>
  );
}

function EvidenceMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="dawaa-muted text-xs">{label}</span>
        <span className="dawaa-heading text-sm font-bold tabular-nums" dir="ltr">{value === null ? 'غير متاحة' : `${value}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--dawaa-theme-soft)]" role="progressbar" aria-label={`${label}: ${value === null ? 'غير متاحة' : `${value}%`}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        {value !== null ? <div className="h-full rounded-full bg-[var(--dawaa-theme-primary)]" style={{ width: `${value}%` }} /> : null}
      </div>
    </div>
  );
}

export function SavedCaseEvaluationSummary({ rows }: { rows: CaseEvaluationSummary[] }) {
  if (!rows.length) return <p className="dawaa-muted rounded-xl bg-[var(--dawaa-theme-soft)] p-4 text-sm">لا يوجد تقييم محفوظ لهذه الحالة حتى الآن. غياب التقييم لا يعني درجة صفر.</p>;
  return <>
    {rows.length > 1 ? <p className="dawaa-muted text-xs">لكل دكتور تقييم مستقل على مشاركته؛ لا تُدمج درجات المشاركين.</p> : null}
    <div className={`grid gap-4 ${rows.length > 1 ? 'xl:grid-cols-2' : ''}`}>
      {rows.map((row) => <article key={row.reviewId} className="overflow-hidden rounded-2xl border border-[var(--dawaa-theme-accent-border)]">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--dawaa-theme-accent-soft)] px-5 py-3">
          <div className="dawaa-heading font-bold">{row.staffName}</div>
          <span className={`dawaa-badge ${row.official ? 'dawaa-badge--success' : 'dawaa-badge--warning'} inline-flex items-center gap-1.5`}>
            {row.official ? <BadgeCheck size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
            {row.official ? 'معتمد رسميًا' : 'بانتظار الاعتماد'}
          </span>
        </div>
        <div className="grid items-center gap-5 p-5 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <ScoreGauge score={row.automaticScore} />
            <div className="dawaa-heading text-xs font-bold">التقييم الآلي المقترح</div>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <EvidenceMetric label="تغطية الأدلة" value={row.evidenceCoverage} />
              <EvidenceMetric label="موثوقية النتيجة" value={row.reliability} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--dawaa-theme-soft)] px-4 py-3">
              <span className="dawaa-muted inline-flex items-center gap-2 text-xs"><ShieldCheck size={15} aria-hidden="true" /> التقييم الرسمي</span>
              <span className="dawaa-heading text-sm font-bold">{row.official ? (row.officialScore === null ? 'معتمد — الدرجة غير متاحة' : `${row.officialScore} / 100 — معتمد`) : 'لم يُعتمد رسميًا بعد'}</span>
            </div>
            {row.automaticScore === null ? <p className="dawaa-muted text-xs">{row.corrected ? 'تم استبدال النسخة الآلية بتصحيح بشري.' : 'الدرجة الآلية غير مكتملة أو غير متاحة.'}</p> : null}
          </div>
        </div>
        {row.clinicalReviewRequired ? <div className="dawaa-muted flex items-start gap-2 border-t border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] px-5 py-3 text-xs leading-6"><Stethoscope size={16} className="mt-1 shrink-0" aria-hidden="true" /><p>الاستشارة والجرعة/طريقة الاستخدام تحتاج مراجعة طبية بشرية منفصلة.</p></div> : null}
      </article>)}
    </div>
    <div className="dawaa-muted flex items-start gap-2 text-xs leading-6"><Info size={15} className="mt-1 shrink-0" aria-hidden="true" /><p>الدرجة المحفوظة من 100 تعتمد على البنود الآلية التي لديها أدلة كافية ضمن نظام الـ19 معيارًا. الدليل الناقص لا يُحسب صفرًا، والدرجة المقترحة مستقلة عن اعتماد المدير.</p></div>
  </>;
}

/** Keyed by case + published analysis by the parent, so no previous case/refresh can flash here. */
export function CaseEvaluationSummaryCard({ sourceId, caseId }: { sourceId: string; caseId: string }) {
  const [rows, setRows] = useState<CaseEvaluationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    void loadCaseEvaluationSummaries(supabase, sourceId, caseId).then(
      (result) => { if (active) setRows(result); },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message : 'تعذر تحميل التقييم.'); },
    );
    return () => { active = false; };
  }, [sourceId, caseId, attempt]);
  return <section className="dawaa-card space-y-3" aria-label="التقييم الإجمالي للمحادثة">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="dawaa-heading text-base font-black">التقييم الإجمالي للمحادثة</h2>
      <button type="button" className="dawaa-button dawaa-button--ghost text-xs" disabled={rows === null && !error} onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" /> تحديث التقييم المحفوظ</button>
    </div>
    {error ? <p role="alert" className="dawaa-alert dawaa-alert--warning text-sm">{error}</p>
      : rows === null ? <p className="dawaa-muted text-sm" role="status">جاري تحميل التقييم المحفوظ...</p>
      : <SavedCaseEvaluationSummary rows={rows} />}
  </section>;
}
