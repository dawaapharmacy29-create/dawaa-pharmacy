import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  lifecycleLabels,
  lifecycleState,
  type LifecycleCase,
  type LifecycleState,
} from '@/lib/salesIntelligence/qa/lifecycleExceptions';

export default function LifecycleExceptionsPanel() {
  const { user } = useAuth();
  const viewer = user?.id || '';
  const [state, setState] = useState<{
    viewer: string;
    rows: Array<{ caseId: string; branch: string; status: LifecycleState }>;
    error: string | null;
  }>({ viewer: '', rows: [], error: null });
  useEffect(() => {
    let cancelled = false;
    if (!viewer) return;
    void (async () => {
      try {
        const cases = await supabase
          .from('sales_intelligence_cases')
          .select('case_id,conversation_id,is_active,published_analysis_id,branch_name_raw')
          .eq('is_active', true)
          .limit(2001);
        if (cases.error) throw cases.error;
        if ((cases.data || []).length >= 1000)
          throw new Error('تجاوزت الحالات حد القراءة؛ يلزم تضييق النطاق.');
        const rows: LifecycleCase[] = cases.data || [];
        const output: Array<{ caseId: string; branch: string; status: LifecycleState }> = [];
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const [sources, analyses] = await Promise.all([
            supabase
              .from('whatsapp_review_sources')
              .select('id,review_status')
              .in('id', [...new Set(chunk.map((c) => c.conversation_id))]),
            supabase
              .from('sales_intelligence_case_analyses')
              .select('case_id,analysis_id,is_current,superseded_at,pipeline_status')
              .in(
                'case_id',
                chunk.map((c) => c.case_id)
              )
              .limit(5001),
          ]);
          if (sources.error || analyses.error) throw sources.error || analyses.error;
          if ((analyses.data || []).length >= 1000) throw new Error('تجاوز سجل التحليل حد القراءة.');
          for (const c of chunk) {
            const source = sources.data?.find((s) => s.id === c.conversation_id);
            if (!source) throw new Error('بعض المصادر غير متاحة لصلاحيات الحساب الحالي.');
            const status = lifecycleState(
              c,
              analyses.data || [],
              source.review_status === 'archived'
            );
            if (status !== 'CURRENT_ANALYSIS_AVAILABLE' && status !== 'ARCHIVED_SOURCE')
              output.push({ caseId: c.case_id, branch: c.branch_name_raw || 'بدون فرع', status });
          }
        }
        if (!cancelled) setState({ viewer, rows: output, error: null });
      } catch (e) {
        if (!cancelled)
          setState({
            viewer,
            rows: [],
            error: e instanceof Error ? e.message : 'تعذرت قراءة حالة التحليل.',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer]);
  if (!viewer || state.viewer !== viewer)
    return <div className="dawaa-muted text-xs">جاري فحص حالات نشر التحليل…</div>;
  return (
    <section className="dawaa-card" dir="rtl">
      <div className="font-black">حالات تحتاج إكمال التحليل أو النشر</div>
      <div className="dawaa-muted mt-2 text-xs">
        هذه الحالات لا تدخل مؤشرات البيع. العرض حسب صلاحيات الحساب؛ غياب التحليل الظاهر لا يثبت فشل
        تشغيله.
      </div>
      {state.error ? (
        <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs">{state.error}</div>
      ) : (
        <>
          <div className="mt-3 text-sm">
            {state.rows.length.toLocaleString('ar-EG')} حالة غير مؤرشفة بلا تحليل حالي منشور متوافق
          </div>
          <details className="mt-2 text-xs">
            <summary>عرض الحالات</summary>
            {state.rows.map((r) => (
              <div key={r.caseId} className="mt-2 break-all">
                {r.branch} • {lifecycleLabels[r.status]} • {r.caseId}
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
