import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { getStaffSessionToken } from '@/lib/auth/staffSession';
import { requestCanonicalSalesIntelligenceRefresh } from '@/lib/salesIntelligence/refresh/refreshClient';

type StoredSource = {
  id: string;
  source_filename: string | null;
  conversation_started_at: string | null;
};

type RefreshOutcome = {
  id: string;
  file: string;
  status: 'allowed' | 'blocked' | 'failed';
  detail: string;
  evaluated: number;
};

/**
 * A deliberately explicit, authenticated reanalysis of already-saved WhatsApp sources.
 * No file re-import, no local ledger reset, no direct case/review/action/points writes.
 * The server's canonical source gate, staff permission check and V50 versioning own all changes.
 */
export default function WhatsAppStoredSourcesRefresh() {
  const [sources, setSources] = useState<StoredSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<RefreshOutcome[]>([]);

  const loadSources = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .select('id,source_filename,conversation_started_at')
      .is('deleted_at', null)
      .order('conversation_started_at', { ascending: false })
      .limit(50);
    setLoading(false);
    if (error) {
      toast.error('تعذر قراءة مصادر الواتساب المحفوظة: ' + error.message);
      return;
    }
    setSources((data || []) as StoredSource[]);
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const refreshStored = async () => {
    if (running || !sources.length) return;
    const accessToken = getStaffSessionToken();
    if (!accessToken) {
      toast.error('لا توجد جلسة موظف موثقة. سجّل الدخول بحساب المدير ثم أعد المحاولة.');
      return;
    }
    if (!window.confirm(
      `إعادة تحليل ${sources.length} مصدر واتساب محفوظ باستخدام العقل التحليلي الحالي؟ لن تتم إعادة استيراد الملفات أو اعتماد النقاط تلقائيًا.`
    )) return;

    setRunning(true);
    setOutcomes([]);
    try {
      const response = await requestCanonicalSalesIntelligenceRefresh({
        sourceIds: sources.map((source) => source.id),
        accessToken,
        concurrency: 2,
      });
      const bySource = new Map(sources.map((source) => [source.id, source]));
      const rows: RefreshOutcome[] = sources.map((source) => {
        const result = response.bySource[source.id];
        const evaluations = response.conversationEvaluations.filter(
          (evaluation) => evaluation.sourceId === source.id
        );
        return {
          id: source.id,
          file: bySource.get(source.id)?.source_filename || 'مصدر بدون اسم',
          status: result?.status || 'failed',
          detail: result?.reason || response.errors.find((row) => row.sourceId === source.id)?.message || '',
          evaluated: evaluations.filter((evaluation) => !evaluation.error).length,
        };
      });
      setOutcomes(rows);
      const success = rows.filter((row) => row.status === 'allowed').length;
      if (response.authInvalid) toast.error('انتهت جلسة الموظف. سجّل الدخول مجددًا لاستكمال المصادر المتبقية.');
      else if (success === rows.length) toast.success(`اكتمل التحديث القياسي لـ ${success} مصدر واتساب.`);
      else toast.warning(`تم تحديث ${success} من ${rows.length} مصدر. راجع الحالات غير المكتملة أدناه.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'فشلت إعادة تحليل مصادر الواتساب');
    } finally {
      setRunning(false);
    }
  };

  const success = outcomes.filter((row) => row.status === 'allowed').length;
  const failed = outcomes.length - success;

  return (
    <section className="dawaa-card overflow-hidden" dir="rtl" data-testid="whatsapp-stored-refresh">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-black text-white">إعادة تحليل المحادثات المحفوظة في التطبيق</h2>
          <p className="mt-1 max-w-2xl text-xs leading-6 text-slate-400">
            يجلب آخر 50 مصدرًا ظاهرًا لحسابك ويعيد تحليلها في المحرك الرسمي بإثبات هوية العميل والفرع
            والأصناف والفواتير وفرص المتابعة وتقييم المحادثة. لا ينشئ نسخًا جديدة من الملفات
            ولا يعتمد نقاط الدكاترة أو الحوافز المالية تلقائيًا.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadSources()} disabled={running || loading}
            className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            تحديث القائمة
          </button>
          <button type="button" onClick={() => void refreshStored()} disabled={loading || running || sources.length === 0}
            className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50">
            <span className="inline-flex items-center gap-2">
              {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {running ? 'جاري التحليل...' : `إعادة تحليل ${sources.length} مصدر محفوظ`}
            </span>
          </button>
        </div>
      </div>
      {outcomes.length > 0 && (
        <div className="space-y-2 border-t border-slate-700 p-4" aria-live="polite">
          <p className="text-xs font-bold text-white">النتيجة: {success} نجح، {failed} يحتاج استكمالًا — {outcomes.reduce((sum, row) => sum + row.evaluated, 0)} نتيجة تقييم محادثة مستلمة من المحرك</p>
          {outcomes.filter((row) => row.status !== 'allowed').map((row) => (
            <div key={row.id} className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{row.file}: {row.status === 'blocked' ? 'المصدر غير مؤهل أو يحتاج مراجعة' : 'فشل التحديث'} — {row.detail || 'راجع سجل التحليل'}</span>
            </div>
          ))}
          {failed === 0 && <div className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 size={15} /> اكتملت كل المصادر التي ظهرت في القائمة.</div>}
          <p className="text-[11px] text-slate-400">نتائج التقييم الآلي تظل مقترحات حتى مراجعة واعتماد المدير. يمكن مراجعة تفاصيل كل حالة في مركز Sales Intelligence.</p>
        </div>
      )}
    </section>
  );
}
