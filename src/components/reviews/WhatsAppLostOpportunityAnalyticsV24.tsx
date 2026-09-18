import { useEffect, useMemo, useState } from 'react';
import { ArrowUpLeft, RefreshCw, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type LostReasonRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  lost_reason: string;
  stop_stage: string;
  confirmed_lost_cases: number;
  salvageable_cases: number;
  confirmed_lost_value: number | null;
  salvageable_value: number | null;
  commercial_cases: number;
};

type DoctorRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  staff_account_id: string;
  staff_name: string | null;
  commercial_cases: number;
  verified_sales: number;
  confirmed_lost_cases: number;
  salvageable_cases: number;
  verified_revenue: number | null;
  confirmed_lost_value: number | null;
  salvageable_value: number | null;
  verified_conversion_rate: number | null;
  confirmed_loss_rate: number | null;
  human_confirmed_ownership_cases: number;
};

type RescueRow = {
  id: string;
  root_source_id: string;
  customer_name: string | null;
  customer_code: string | null;
  branch: string | null;
  effective_outcome: string;
  effective_lost_reason: string | null;
  stop_stage: string;
  opportunity_value: number;
  rescue_score: number;
  opportunity_status: string;
  last_event_at: string;
  staff_names: string[] | null;
};

function cairoCycleStart() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  let year = Number(parts.find((x) => x.type === 'year')?.value || 0);
  let month = Number(parts.find((x) => x.type === 'month')?.value || 0);
  const day = Number(parts.find((x) => x.type === 'day')?.value || 0);
  if (day < 26) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return `${year}-${String(month).padStart(2, '0')}-26`;
}

const stageLabel: Record<string, string> = {
  intake: 'بداية المحادثة',
  order_request: 'طلب العميل',
  recommendation: 'الترشيح',
  order_confirmed: 'تأكيد الأوردر',
  invoice_verified: 'فاتورة مؤكدة',
};

const statusLabel: Record<string, string> = {
  at_risk: 'معرضة للفقد',
  needs_pharmacy_action: 'تحتاج إجراء من الصيدلية',
  needs_customer_followup: 'تحتاج متابعة العميل',
  invoice_pending: 'في انتظار الفاتورة',
  monitor: 'مراقبة',
  lost: 'Lost',
  won: 'Won',
};

function n(value: unknown) { return Number(value || 0); }

export default function WhatsAppLostOpportunityAnalyticsV24({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [reasons, setReasons] = useState<LostReasonRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [rescue, setRescue] = useState<RescueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);
  const cycle = cairoCycleStart();

  const load = async () => {
    setLoading(true);
    try {
      const [reasonRes, doctorRes, rescueRes] = await Promise.all([
        supabase.from('whatsapp_lost_reason_cycle_v24').select('*').eq('cycle_start', cycle).order('confirmed_lost_cases', { ascending: false }).limit(100),
        supabase.from('whatsapp_doctor_lost_opportunity_cycle_v24').select('*').eq('cycle_start', cycle).order('verified_revenue', { ascending: false }).limit(100),
        supabase.from('whatsapp_rescue_queue_v24').select('id,root_source_id,customer_name,customer_code,branch,effective_outcome,effective_lost_reason,stop_stage,opportunity_value,rescue_score,opportunity_status,last_event_at,staff_names').eq('cycle_start', cycle).order('rescue_score', { ascending: false }).limit(80),
      ]);
      if (reasonRes.error) throw reasonRes.error;
      if (doctorRes.error) throw doctorRes.error;
      if (rescueRes.error) throw rescueRes.error;
      setReasons((reasonRes.data || []) as LostReasonRow[]);
      setDoctors((doctorRes.data || []) as DoctorRow[]);
      setRescue((rescueRes.data || []) as RescueRow[]);
    } catch (error) {
      console.warn('[whatsapp-lost-opportunity-v24] load failed', error);
      setReasons([]); setDoctors([]); setRescue([]);
    } finally {
      setLoading(false);
    }
  };

  const createRescueTask = async (row: RescueRow) => {
    setCreatingTaskFor(row.id);
    try {
      const { data, error } = await supabase.rpc('dawaa_create_case_rescue_task_v24', { p_case_id: row.id });
      if (error) throw error;
      const payload = data as any;
      toast.success(`تم تجهيز مهمة متابعة للعميل${payload?.rescue_score != null ? ` — أولوية ${payload.rescue_score}` : ''}`);
    } catch (error: any) {
      const message = String(error?.message || 'تعذر إنشاء مهمة المتابعة');
      if (message.includes('case_already_won')) toast.error('الحالة لها بيع مؤكد بالفعل ولا تحتاج Rescue.');
      else if (message.includes('case_confirmed_lost')) toast.error('الحالة معتمدة Lost؛ راجع النتيجة أولًا قبل إعادة فتحها.');
      else if (message.includes('case_not_salvageable')) toast.error('الحالة الحالية غير مؤهلة للـRescue.');
      else toast.error('تعذر تجهيز مهمة المتابعة.');
    } finally {
      setCreatingTaskFor(null);
    }
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => ({
    confirmedLost: reasons.reduce((s, x) => s + n(x.confirmed_lost_cases), 0),
    salvageable: rescue.length,
    lostValue: reasons.reduce((s, x) => s + n(x.confirmed_lost_value), 0),
    salvageableValue: reasons.reduce((s, x) => s + n(x.salvageable_value), 0),
  }), [reasons, rescue.length]);

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-rose-200">Lost Opportunity Analytics V24 — دورة 26→25</div>
          <div className="mt-1 text-xl font-black text-white">فين الفرص بتضيع وإيه اللي لسه نقدر ننقذه؟</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">Lost الرسمي يعتمد على نتيجة بشرية مؤكدة. الحالات القابلة للإنقاذ تظل منفصلة ولا تُحسب Lost لمجرد إن العميل لم يرد.</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'ml-1 inline animate-spin' : 'ml-1 inline'} /> تحديث</button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3"><div className="text-[11px] text-slate-400">Lost مؤكد</div><div className="mt-1 text-xl font-black text-rose-200">{totals.confirmedLost.toLocaleString('ar-EG')}</div></div>
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3"><div className="text-[11px] text-slate-400">قابلة للإنقاذ</div><div className="mt-1 text-xl font-black text-amber-200">{totals.salvageable.toLocaleString('ar-EG')}</div></div>
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3"><div className="text-[11px] text-slate-400">قيمة Lost المسجلة</div><div className="mt-1 text-xl font-black text-rose-200">{totals.lostValue.toLocaleString('ar-EG')} ج</div></div>
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3"><div className="text-[11px] text-slate-400">قيمة ممكن إنقاذها</div><div className="mt-1 text-xl font-black text-emerald-200">{totals.salvageableValue.toLocaleString('ar-EG')} ج</div></div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
          <div className="font-black text-white">أسباب الفقد ومكان التسريب</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[650px] w-full text-right text-xs">
              <thead className="text-slate-400"><tr><th className="p-2">السبب</th><th className="p-2">Stage</th><th className="p-2">Lost</th><th className="p-2">قابلة للإنقاذ</th><th className="p-2">Lost value</th></tr></thead>
              <tbody>{reasons.slice(0, 20).map((row, i) => <tr key={`${row.branch}:${row.lost_reason}:${row.stop_stage}:${i}`} className="border-t border-slate-800/80"><td className="p-2 font-black text-white">{row.lost_reason}</td><td className="p-2 text-cyan-200">{stageLabel[row.stop_stage] || row.stop_stage}</td><td className="p-2 text-rose-200">{n(row.confirmed_lost_cases)}</td><td className="p-2 text-amber-200">{n(row.salvageable_cases)}</td><td className="p-2 text-rose-300">{n(row.confirmed_lost_value).toLocaleString('ar-EG')} ج</td></tr>)}</tbody>
            </table>
          </div>
          {!reasons.length && !loading ? <div className="p-5 text-center text-sm text-slate-500">لا توجد Lost Opportunities مؤكدة في الدورة الحالية.</div> : null}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
          <div className="font-black text-white">Loss وConversion حسب الدكتور</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[760px] w-full text-right text-xs">
              <thead className="text-slate-400"><tr><th className="p-2">الدكتور</th><th className="p-2">فرص</th><th className="p-2">بيع مؤكد</th><th className="p-2">Conversion</th><th className="p-2">Lost</th><th className="p-2">Loss rate</th><th className="p-2">Rescue</th></tr></thead>
              <tbody>{doctors.map((row) => <tr key={`${row.staff_account_id}:${row.branch || ''}`} className="border-t border-slate-800/80"><td className="p-2 font-black text-white">{row.staff_name || 'غير محدد'}</td><td className="p-2">{n(row.commercial_cases)}</td><td className="p-2 text-emerald-200">{n(row.verified_sales)}</td><td className="p-2 text-violet-200">{row.verified_conversion_rate == null ? '—' : `${n(row.verified_conversion_rate).toLocaleString('ar-EG')}%`}</td><td className="p-2 text-rose-200">{n(row.confirmed_lost_cases)}</td><td className="p-2 text-rose-300">{row.confirmed_loss_rate == null ? '—' : `${n(row.confirmed_loss_rate).toLocaleString('ar-EG')}%`}</td><td className="p-2 text-amber-200">{n(row.salvageable_cases)}</td></tr>)}</tbody>
            </table>
          </div>
          {!doctors.length && !loading ? <div className="p-5 text-center text-sm text-slate-500">لا توجد بيانات Ownership موثقة في الدورة الحالية.</div> : null}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3">
        <div className="font-black text-amber-100">Rescue Queue — فرص لسه ممكن تتلحق</div>
        <div className="mt-1 text-xs text-slate-400">مرتبة بدرجة إنقاذ تشغيلية، وليست توقعًا لاحتمال الشراء. إنشاء المهمة لا يضيف نقاط أو حوافز تلقائيًا.</div>
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {rescue.slice(0, 20).map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-950/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-black text-white">{row.customer_name || 'عميل غير محدد'} {row.customer_code ? `— ${row.customer_code}` : ''}</div><div className="mt-1 text-[11px] text-slate-500">{row.branch || '-'} • {new Date(row.last_event_at).toLocaleString('ar-EG')}</div></div>
                <div className="rounded-lg bg-amber-500/10 px-2 py-1 text-xs font-black text-amber-200">Rescue {n(row.rescue_score)}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]"><span className="text-cyan-200">{stageLabel[row.stop_stage] || row.stop_stage}</span><span className="text-violet-200">{statusLabel[row.opportunity_status] || row.opportunity_status}</span>{(row.staff_names || []).length ? <span className="text-emerald-300">{(row.staff_names || []).join('، ')}</span> : null}</div>
              {row.effective_lost_reason ? <div className="mt-2 text-xs text-amber-100">إشارة التعثر: {row.effective_lost_reason}</div> : null}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-400">قيمة الفرصة: {n(row.opportunity_value).toLocaleString('ar-EG')} ج</span>
                <div className="flex gap-2">
                  <button type="button" disabled={creatingTaskFor === row.id} onClick={() => void createRescueTask(row)} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs font-black text-amber-100 disabled:opacity-50"><UserRoundPlus size={13} className="ml-1 inline" /> {creatingTaskFor === row.id ? 'جاري التجهيز...' : 'تحويل لمهمة متابعة'}</button>
                  {onOpenSource ? <button type="button" onClick={() => onOpenSource(row.root_source_id)} className="rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs font-black text-cyan-200"><ArrowUpLeft size={13} className="ml-1 inline" /> فتح المحادثة</button> : null}
                </div>
              </div>
            </div>
          ))}
          {!rescue.length && !loading ? <div className="col-span-full rounded-xl border border-dashed border-slate-800 p-5 text-center text-sm text-slate-500">لا توجد فرص Salvageable محفوظة في الدورة الحالية.</div> : null}
        </div>
      </div>
    </section>
  );
}
