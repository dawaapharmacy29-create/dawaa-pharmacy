import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = {
  source_id: string;
  primary_intent: string;
  criterion_key: string;
  category: string;
  label_ar: string;
  description_ar: string | null;
  evidence_requirement: string;
  automation_level: string;
  evidence_status: 'applicable' | 'evidence_present' | 'evidence_missing';
  available_fact_types: string[] | null;
};

const categoryLabel: Record<string, string> = {
  service: 'الخدمة', operations: 'تنفيذ الطلب', sales: 'البيع', complaint: 'الشكوى', followup: 'المتابعة', safety: 'السلامة',
};
const evidenceLabel: Record<string, string> = { message: 'رسائل', timeline: 'توقيتات', invoice: 'فاتورة', human: 'مراجعة بشرية', mixed: 'أكثر من دليل' };
const automationLabel: Record<string, string> = { deterministic: 'قاعدة مؤكدة', assist: 'تحليل مساعد', human_only: 'إنسان فقط' };

export default function WhatsAppEvidenceCoverageV17({ sourceId }: { sourceId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sourceId) { setRows([]); return; }
      setLoading(true); setError(null);
      const { data, error: qError } = await supabase
        .from('whatsapp_source_evaluation_coverage_v17')
        .select('*')
        .eq('source_id', sourceId)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      if (qError) { setError(qError.message); setRows([]); }
      else setRows((data || []) as Row[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sourceId]);

  const summary = useMemo(() => ({
    present: rows.filter((r) => r.evidence_status === 'evidence_present').length,
    missing: rows.filter((r) => r.evidence_status === 'evidence_missing').length,
    applicable: rows.length,
    humanOnly: rows.filter((r) => r.automation_level === 'human_only').length,
  }), [rows]);

  if (!sourceId) return null;
  return (
    <section className="dawaa-card dawaa-card--soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><ShieldCheck size={17}/>مصفوفة أدلة التقييم V17</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">كل بند يظهر فقط لو ينطبق على نوع الجلسة. وجود الدليل لا يعني نقطة أو خصم رسمي؛ الاعتماد البشري منفصل.</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-2 py-1 text-emerald-200">دليل مكتمل {summary.present}</span>
          <span className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-2 py-1 text-amber-200">يحتاج دليل {summary.missing}</span>
          <span className="rounded-lg border border-slate-700 px-2 py-1 text-slate-300">بنود منطبقة {summary.applicable}</span>
          <span className="rounded-lg border border-violet-400/20 px-2 py-1 text-violet-200">بشري فقط {summary.humanOnly}</span>
        </div>
      </div>

      {loading ? <div className="mt-4 text-sm text-slate-400">جاري تحميل أدلة التقييم...</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-200">تعذر تحميل مصفوفة الأدلة: {error}</div> : null}
      {!loading && !error && !rows.length ? <div className="mt-4 text-sm text-slate-500">لا توجد بنود منطبقة محفوظة لهذه الجلسة حتى الآن.</div> : null}

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {rows.map((row) => {
          const present = row.evidence_status === 'evidence_present';
          const missing = row.evidence_status === 'evidence_missing';
          const Icon = present ? CheckCircle2 : missing ? AlertTriangle : CircleDashed;
          return (
            <div key={row.criterion_key} className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
              <div className="flex items-start gap-2">
                <Icon size={16} className={present ? 'mt-0.5 text-emerald-300' : missing ? 'mt-0.5 text-amber-300' : 'mt-0.5 text-slate-400'} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-white">{row.label_ar}</span>
                    <span className="text-[10px] text-slate-500">{categoryLabel[row.category] || row.category}</span>
                  </div>
                  {row.description_ar ? <div className="mt-1 text-[11px] leading-5 text-slate-400">{row.description_ar}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-md border border-slate-800 px-2 py-1 text-slate-300">الدليل: {evidenceLabel[row.evidence_requirement] || row.evidence_requirement}</span>
                    <span className="rounded-md border border-slate-800 px-2 py-1 text-slate-300">{automationLabel[row.automation_level] || row.automation_level}</span>
                    <span className={present ? 'rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-200' : missing ? 'rounded-md bg-amber-500/10 px-2 py-1 text-amber-200' : 'rounded-md bg-slate-800/50 px-2 py-1 text-slate-300'}>{present ? 'الدليل الأساسي موجود' : missing ? 'الدليل الأساسي ناقص' : 'منطبق ويحتاج مراجعة'}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
