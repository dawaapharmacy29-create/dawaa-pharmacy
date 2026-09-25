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
};
type CaseRow = { conversation_id: string; branch_name_raw: string | null };
type DemandStatus = {
  analyzable_sources: number | string | null;
  analyzed_v22: number | string | null;
  remaining_sources: number | string | null;
  completion_percent: number | string | null;
};

type BranchCoverage = {
  branch: string;
  sources: number;
  covered: number;
  uncovered: number;
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SalesIntelligenceCoveragePanelV1() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [demandStatus, setDemandStatus] = useState<DemandStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [sourceResult, caseResult, demandResult] = await Promise.all([
        supabase.from('whatsapp_review_sources').select('id,branch,source_filename,customer_id,customer_code,customer_phone,customer_name,conversation_started_at,conversation_ended_at,message_count,created_at').limit(2000),
        supabase.from('sales_intelligence_cases').select('conversation_id,branch_name_raw').limit(5000),
        supabase.from('whatsapp_product_demand_backfill_status_v22').select('*').maybeSingle(),
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
      setDemandStatus(demandResult.error ? null : ((demandResult.data || null) as DemandStatus | null));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const canonicalSources = useMemo(() => {
    const canonicalIds = selectCanonicalReviewSourceIds(sources);
    return sources.filter((row) => canonicalIds.has(row.id));
  }, [sources]);

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
          <div className="dawaa-muted mt-1 text-xs">تعرض الفرق بين مصادر واتساب الـcanonical الحالية وما دخل الـSales Intelligence والـProduct Demand، بدون احتساب snapshots القديمة كمصادر ناقصة.</div>
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

      <div className="mt-4 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
        <div className="flex items-center gap-2 font-black text-sm"><PackageSearch size={16} />تغطية Product Demand V22</div>
        {demandStatus ? (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, number(demandStatus.completion_percent)))}%` }} />
            </div>
            <div className="dawaa-muted mt-2 text-[11px]">
              قابل للتحليل: {number(demandStatus.analyzable_sources).toLocaleString('ar-EG')} • تم V22: {number(demandStatus.analyzed_v22).toLocaleString('ar-EG')} • متبقي: {number(demandStatus.remaining_sources).toLocaleString('ar-EG')}
            </div>
          </>
        ) : (
          <div className="dawaa-muted mt-2 text-xs">تعذر قراءة حالة Backfill الخاصة بـProduct Demand.</div>
        )}
      </div>

      {(coveredSources < totalSources || number(demandStatus?.remaining_sources) > 0) ? (
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
