import { useEffect, useMemo, useState } from 'react';
import { Bot, RefreshCw, ShieldCheck, UserCheck, UserRoundSearch } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  buildDoctorCoachingV25,
  evaluateWhatsAppGovernance,
  type WhatsAppGovernanceRow,
} from '@/lib/whatsappReviewGovernanceV25';

type Props = {
  onOpenSource?: (sourceId: string) => void;
};

const dispositionLabel = {
  mandatory_human: 'مراجعة بشرية إلزامية',
  human_sample: 'عينة QA بشرية',
  auto_review_candidate: 'مرشح للمراجعة الآلية',
} as const;

function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-[10px] leading-5 text-slate-500">{note}</div>
    </div>
  );
}

export default function WhatsAppReviewGovernanceV25({ onOpenSource }: Props) {
  const [rows, setRows] = useState<WhatsAppGovernanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_review_sources')
        .select('id,branch,customer_name,customer_code,customer_phone,staff_name,review_status,priority,analysis_confidence,service_score,commercial_eligible,invoice_match_status,followup_required,analysis_json,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as WhatsAppGovernanceRow[]);
    } catch (error) {
      console.warn('[whatsapp-governance-v25] load failed', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const evaluated = useMemo(
    () => rows.map((row) => ({ row, decision: evaluateWhatsAppGovernance(row) })),
    [rows],
  );

  const pending = useMemo(
    () => evaluated.filter(({ row }) => ['new', 'ready_quick', 'ready_detailed', 'needs_context'].includes(String(row.review_status || ''))),
    [evaluated],
  );

  const totals = useMemo(() => ({
    mandatory: pending.filter(({ decision }) => decision.disposition === 'mandatory_human').length,
    sample: pending.filter(({ decision }) => decision.disposition === 'human_sample').length,
    auto: pending.filter(({ decision }) => decision.disposition === 'auto_review_candidate').length,
    unresolvedCustomer: pending.filter(({ decision }) => !decision.customerResolved).length,
  }), [pending]);

  const reasonSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { decision } of pending) {
      for (const label of decision.reasonLabels) counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [pending]);

  const coaching = useMemo(
    () => buildDoctorCoachingV25(pending.map(({ row }) => row)).slice(0, 10),
    [pending],
  );

  const priorityQueue = useMemo(
    () => pending
      .filter(({ decision }) => decision.disposition === 'mandatory_human')
      .sort((a, b) => b.decision.priorityScore - a.decision.priorityScore)
      .slice(0, 12),
    [pending],
  );

  const automationCoverage = pending.length
    ? Math.round(((totals.auto + totals.sample) / pending.length) * 100)
    : 0;

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-emerald-200"><ShieldCheck size={15} /> Review Governance V25</div>
          <div className="mt-1 text-xl font-black text-white">مراجعة ذكية بدون تخمين — والإنسان يدخل فقط عندما يلزم</div>
          <div className="mt-1 max-w-4xl text-xs leading-6 text-slate-400">
            أي شكوى، أمان طبي، ميديا ناقصة، عميل غير محسوم، فاتورة غير مؤكدة أو بند تقييم غير واضح يمنع الاعتماد الآلي. الحالات النظيفة فقط تصبح مرشحة، و15% منها تظل عينة QA بشرية ثابتة للمعايرة.
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'ml-1 inline animate-spin' : 'ml-1 inline'} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="بشرية إلزامية" value={totals.mandatory} note="لا يمكن تجاوزها آليًا" />
        <Metric label="عينة QA" value={totals.sample} note="اختيار ثابت 15% من الحالات الآمنة" />
        <Metric label="مرشحة آليًا" value={totals.auto} note="ترشيح فقط — لا يضيف نقاطًا أو خصومات" />
        <Metric label="عميل غير محسوم" value={totals.unresolvedCustomer} note="ممنوع الربط بالتخمين" />
        <Metric label="Automation coverage" value={`${automationCoverage}%`} note="نسبة الحالات المؤهلة قبل الاعتماد النهائي" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
          <div className="flex items-center gap-2 font-black text-white"><UserRoundSearch size={16} /> طابور المراجعة البشرية حسب الخطورة</div>
          <div className="mt-1 text-[11px] text-slate-500">الترتيب هنا تشغيلي بحسب أسباب المراجعة، وليس توقعًا لأداء الموظف أو العميل.</div>
          <div className="mt-3 space-y-2">
            {priorityQueue.map(({ row, decision }) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenSource?.(row.id)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/35 p-3 text-right hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{row.customer_name || 'عميل غير محدد'}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{row.staff_name || 'الدكتور غير محدد'} • {row.branch || 'فرع غير محدد'}</div>
                  </div>
                  <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-black text-rose-200">Priority {decision.priorityScore}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {decision.reasonLabels.slice(0, 4).map((reason) => <span key={reason} className="rounded-lg bg-slate-800/70 px-2 py-1 text-[10px] text-slate-300">{reason}</span>)}
                </div>
              </button>
            ))}
            {!priorityQueue.length && !loading ? <div className="p-6 text-center text-sm text-slate-500">لا توجد حالات بشرية إلزامية ضمن البيانات الحالية.</div> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
          <div className="flex items-center gap-2 font-black text-white"><UserCheck size={16} /> Doctor Coaching — أخطاء متكررة قابلة للتحسين</div>
          <div className="mt-1 text-[11px] text-slate-500">مبني فقط على أسباب مراجعة فعلية في البيانات، بدون استنتاجات شخصية عن الموظف.</div>
          <div className="mt-3 space-y-2">
            {coaching.map((item) => (
              <div key={item.staffName} className="rounded-xl border border-slate-800 bg-slate-950/35 p-3">
                <div className="flex items-center justify-between gap-3"><div className="font-black text-white">{item.staffName}</div><div className="text-[11px] text-slate-400">{item.mandatory}/{item.total} تحتاج مراجعة بشرية</div></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.topReasons.map((reason) => <span key={reason.label} className="rounded-lg bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">{reason.label} × {reason.count}</span>)}
                </div>
              </div>
            ))}
            {!coaching.length && !loading ? <div className="p-6 text-center text-sm text-slate-500">لا توجد بيانات كافية لملخص Coaching حاليًا.</div> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-500/5 p-3">
        <div className="flex items-center gap-2 font-black text-cyan-100"><Bot size={16} /> سياسة الاعتماد الآمن</div>
        <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-3">
          <div><span className="font-black text-rose-200">Human mandatory:</span> أي غموض أو مخاطرة أو بند غير محسوم.</div>
          <div><span className="font-black text-amber-200">Human sample:</span> عينة ثابتة من الحالات النظيفة لمراقبة جودة الـAI.</div>
          <div><span className="font-black text-emerald-200">Auto candidate:</span> ثقة ≥95% وحالة Quick نظيفة فقط؛ لا اعتماد مالي أو نقاط تلقائية.</div>
        </div>
      </div>
    </section>
  );
}
