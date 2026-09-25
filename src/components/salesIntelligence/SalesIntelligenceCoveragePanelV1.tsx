import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleAlert, Database, GitBranch, PackageSearch } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { selectCanonicalReviewSourceIds } from '@/lib/salesIntelligence/sourceSnapshotLineage';

type SourceRow = {
  id: string;
  branch: string | null;
  source_filename: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  message_count: number | null;
  created_at: string | null;
  raw_text: string | null;
  analysis_json: Record<string, any> | null;
};
type CaseRow = { conversation_id: string; branch_name_raw: string | null };
type BranchCoverage = {
  branch: string;
  sources: number;
  covered: number;
  uncovered: number;
};

export default function SalesIntelligenceCoveragePanelV1() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [policyReady, setPolicyReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [sourceResult, caseResult, policyResult] = await Promise.all([
        supabase.from('whatsapp_review_sources').select('id,branch,source_filename,customer_id,customer_code,customer_phone,customer_name,conversation_started_at,conversation_ended_at,message_count,created_at,raw_text,analysis_json').limit(2000),
        supabase.from('sales_intelligence_cases').select('conversation_id,branch_name_raw').limit(5000),
        supabase.from('sales_intelligence_policy_config').select('policy_config_id').eq('is_current', true).eq('enabled', true).limit(1),
      ]);
      if (cancelled) return;
      if (sourceResult.error || caseResult.error) {
        setCoverageError(sourceResult.error?.message || caseResult.error?.message || 'تعذر قراءة تغطية المصادر.');
        setSources([]);
        setCases([]);
      } else {
        setCoverageError(null);
        setSources((sourceResult.data || []) as SourceRow[]);
        setCases((caseResult.data || []) as CaseRow[]);
      }
      setPolicyReady(policyResult.error ? null : (policyResult.data || []).length > 0);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const analyzableSources = useMemo(
    () => sources.filter((row) => typeof row.raw_text === 'string' && row.raw_text.trim().length > 0),
    [sources]
  );

  const canonicalSources = useMemo(() => {
    const canonicalIds = selectCanonicalReviewSourceIds(analyzableSources);
    return analyzableSources.filter((row) => canonicalIds.has(row.id));
  }, [analyzableSources]);

  const sourcesWithoutRawText = sources.length - analyzableSources.length;

  const coverage = useMemo(() => {
    const coveredIds = new Set(cases.map((row) => row.conversation_id).filter(Boolean));
    const map = new Map<string, BranchCoverage>();
    for (const source of canonicalSources) {
      const key = source.branch || 'بدون فرع';
      const current = map.get(key) || { branch: key, sources: 0, covered: 0, uncovered: 0 };
      current.sources += 1;
      if (coveredIds.has(source.id)) current.covered += 1;
      else current.uncovered += 1;
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => b.sources - a.sources || a.branch.localeCompare(b.branch, 'ar'));
  }, [canonicalSources, cases]);

  const totalSources = canonicalSources.length;
  const analyzedV22 = canonicalSources.filter((row) => row.analysis_json?.productDemandVersion === 'product-demand-v22.1').length;
  const remainingV22 = Math.max(0, totalSources - analyzedV22);
  const v22Completion = totalSources ? Math.round((analyzedV22 / totalSources) * 1000) / 10 : 0;

  const coveredSources = useMemo(() => {
    const coveredIds = new Set(cases.map((row) => row.conversation_id).filter(Boolean));
    return canonicalSources.filter((row) => coveredIds.has(row.id)).length;
  }, [canonicalSources, cases]);

  if (loading) {
    return <section className="dawaa-card"><div className="dawaa-muted py-6 text-center text-xs">جاري فحص تغطية مصادر ذكاء المبيعات...</div></section>;
  }

  if (coverageError) {
    return (
      <section className="dawaa-card" dir="rtl">
        <div className="dawaa-alert dawaa-alert--warning text-xs">
          تعذر قراءة تغطية مصادر ذكاء المبيعات للحساب الحالي. لم يتم تحويل هذا الخطأ إلى نسبة تغطية صفرية: {coverageError}
        </div>
      </section>
    );
  }

  return (
    <section className="dawaa-card" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black"><Database size={18} />تغطية البيانات</div>
          <div className="dawaa-muted mt-1 text-xs">
            التغطية مبنية على مصادر واتساب القابلة للتحليل فقط، وبعد حذف الـsnapshots القديمة من المقام.
            {sourcesWithoutRawText ? ` يوجد ${sourcesWithoutRawText.toLocaleString('ar-EG')} مصدر بدون نص أصلي ولا يدخل نسبة التغطية.` : ''}
          </div>
        </div>
        <div className={coveredSources === totalSources && totalSources ? 'dawaa-badge dawaa-badge--success' : 'dawaa-badge dawaa-badge--warning'}>
          {coveredSources.toLocaleString('ar-EG')} / {totalSources.toLocaleString('ar-EG')} مصدر داخل Sales Intelligence
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {coverage.map((row) => {
          const percent = row.sources ? Math.round((row.covered / row.sources) * 100) : 0;
          return (
            <div key={row.branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-black">{row.branch}</div>
                <GitBranch size={16} className="dawaa-muted" />
              </div>
              <div className="mt-3 text-2xl font-black">{percent.toLocaleString('ar-EG')}٪</div>
              <div className="dawaa-muted mt-1 text-[11px]">
                {row.covered.toLocaleString('ar-EG')} محلل من {row.sources.toLocaleString('ar-EG')} مصدر
              </div>
              {row.uncovered ? <div className="mt-2 text-[10px] text-amber-600">{row.uncovered.toLocaleString('ar-EG')} مصدر لم يدخل الـpipeline بعد</div> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
        <div className="flex items-center gap-2 font-black text-sm"><PackageSearch size={16} />تغطية Product Demand V22</div>
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, v22Completion))}%` }} />
          </div>
          <div className="dawaa-muted mt-2 text-[11px]">
            Canonical قابل للتحليل: {totalSources.toLocaleString('ar-EG')} • تم V22: {analyzedV22.toLocaleString('ar-EG')} • متبقي: {remainingV22.toLocaleString('ar-EG')}
          </div>
        </>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
        <div className="flex items-center gap-2 font-black text-sm"><Activity size={16} />Governance / Policy Evaluation</div>
        <div className="mt-3">
          {policyReady === true ? (
            <span className="dawaa-badge dawaa-badge--success">Policy Config فعّال</span>
          ) : policyReady === false ? (
            <span className="dawaa-badge dawaa-badge--warning">لا يوجد Policy Config فعّال</span>
          ) : (
            <span className="dawaa-badge dawaa-badge--warning">تعذر التحقق من Policy Config</span>
          )}
        </div>
        <div className="dawaa-muted mt-2 text-[11px] leading-5">
          غياب الـPolicy Config لا يوقف ربط الفواتير أو Staff Truth، لكنه يعني أن طبقة Policy Evaluation ليست مكتملة بعد.
        </div>
      </div>
      </div>

      {(coveredSources < totalSources || remainingV22 > 0 || policyReady === false) ? (
        <div className="dawaa-muted mt-3 flex items-start gap-2 text-[10px] leading-5">
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          المقارنات بين الفروع أو تحليلات فقد البيع يجب قراءتها مع نسبة التغطية أعلاه؛ اكتمال الـDashboard لا يعني اكتمال المصدر.
        </div>
      ) : (
        <div className="dawaa-muted mt-3 flex items-center gap-2 text-[10px]"><Activity size={13} />مصادر التحليل مكتملة التغطية.</div>
      )}
    </section>
  );
}
