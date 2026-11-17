import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { loadCaseEvaluationSummaries, type CaseEvaluationSummary } from '@/lib/salesIntelligence/qa/caseEvaluationSummary';

export function SavedCaseEvaluationSummary({ rows }: { rows: CaseEvaluationSummary[] }) {
  if (!rows.length) return <p className="dawaa-muted text-sm">لا يوجد تقييم محفوظ لهذه الحالة حتى الآن. غياب التقييم لا يعني درجة صفر.</p>;
  return <>
    {rows.length > 1 ? <p className="dawaa-muted text-xs">لكل دكتور تقييم مستقل على مشاركته؛ لا تُدمج درجات المشاركين.</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => <div key={row.reviewId} className="rounded-xl bg-[var(--dawaa-theme-soft)] p-4 space-y-2">
        <div className="dawaa-heading font-bold">{row.staffName}</div>
        <div className="dawaa-muted text-xs">التقييم الآلي المقترح</div>
        <div className="dawaa-heading text-3xl font-black" dir="ltr">
          {row.automaticScore === null ? '—' : `${row.automaticScore} / 100`}
        </div>
        {row.automaticScore === null ? <p className="dawaa-muted text-xs">{row.corrected ? 'تم استبدال النسخة الآلية بتصحيح بشري.' : 'الدرجة الآلية غير مكتملة أو غير متاحة.'}</p> : null}
        <div className="dawaa-muted text-xs leading-6">
          التقييم الرسمي: {row.official ? (row.officialScore === null ? 'معتمد — الدرجة غير متاحة' : `${row.officialScore} / 100 — معتمد`) : 'لم يُعتمد رسميًا بعد'}
        </div>
        {row.evidenceCoverage !== null ? <div className="dawaa-muted text-xs">تغطية الأدلة: {row.evidenceCoverage}%</div> : null}
        {row.reliability !== null ? <div className="dawaa-muted text-xs">موثوقية النتيجة: {row.reliability}%</div> : null}
        {row.clinicalReviewRequired ? <p className="dawaa-muted text-xs">الاستشارة والجرعة/طريقة الاستخدام تحتاج مراجعة طبية بشرية منفصلة.</p> : null}
      </div>)}
    </div>
    <p className="dawaa-muted text-xs leading-6">الدرجة المحفوظة من 100 تعتمد على البنود الآلية التي لديها أدلة كافية ضمن نظام الـ19 معيارًا. الدليل الناقص لا يُحسب صفرًا، والدرجة المقترحة مستقلة عن اعتماد المدير.</p>
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
      <button type="button" className="dawaa-button dawaa-button--ghost text-xs" onClick={() => setAttempt((value) => value + 1)}>تحديث التقييم المحفوظ</button>
    </div>
    {error ? <p role="alert" className="dawaa-alert dawaa-alert--warning text-sm">{error}</p>
      : rows === null ? <p className="dawaa-muted text-sm" role="status">جاري تحميل التقييم المحفوظ...</p>
      : <SavedCaseEvaluationSummary rows={rows} />}
  </section>;
}
