import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, CalendarClock, CheckCircle2, RefreshCw, Search, UserRoundSearch } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ActionCenterRow = {
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  conversation_count: number;
  commercial_conversations: number;
  verified_sale_conversations: number;
  conversations_needing_followup: number;
  complaint_conversations: number;
  last_conversation_at: string | null;
  verified_invoice_count: number;
  verified_revenue: number;
  verified_revenue_over_500: boolean;
  pending_followup_actions: number;
  pending_customer_requests: number;
  needs_customer_service_action: boolean;
  next_action_id: string | null;
  next_source_id: string | null;
  next_action_type: string | null;
  next_action_status: string | null;
  next_action_confidence: number | null;
  next_action_product: string | null;
  next_action_reason: string | null;
  next_action_due_at: string | null;
  action_priority_rank: number;
  action_label: string | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
}

function dueLabel(value: string | null) {
  if (!value) return 'بدون موعد محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'موعد غير واضح';
  const now = new Date();
  if (date.getTime() <= now.getTime()) return 'مستحقة الآن';
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

const actionTypeLabel: Record<string, string> = {
  complaint_followup: 'متابعة شكوى',
  recommendation_followup: 'متابعة ترشيح',
  customer_followup: 'متابعة عميل',
  customer_request: 'طلب عميل',
  invoice_recheck: 'إعادة مطابقة فاتورة',
  manual_review: 'مراجعة بشرية',
};

export default function WhatsAppCustomerActionCenterV6({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<ActionCenterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [mode, setMode] = useState<'action' | 'over500'>('action');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      let query = supabase
        .from('whatsapp_customer_service_action_center_v1')
        .select('*')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .order('action_priority_rank', { ascending: true })
        .order('verified_revenue', { ascending: false })
        .limit(250);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as ActionCenterRow[]);
    } catch (error) {
      console.error('[whatsapp-action-center-v6] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (mode === 'action' && !row.needs_customer_service_action) return false;
      if (mode === 'over500' && !row.verified_revenue_over_500) return false;
      if (!q) return true;
      return [row.customer_name, row.customer_code, row.customer_phone, row.next_action_product, row.next_action_reason]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, branch, mode, search]);

  const actionCount = rows.filter((row) => row.needs_customer_service_action).length;
  const over500Count = rows.filter((row) => row.verified_revenue_over_500).length;
  const overdueCount = rows.filter((row) => row.needs_customer_service_action && row.next_action_due_at && new Date(row.next_action_due_at).getTime() <= Date.now()).length;

  return (
    <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-cyan-200"><UserRoundSearch size={16}/> مركز قرار خدمة العملاء V6</div>
          <h2 className="mt-1 text-xl font-black text-white">مين نتابعه دلوقتي وليه؟</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يربط نتيجة المحادثة بالإجراء المطلوب وقيمة العميل في سايكل 26→25. البيع لا يُحسب هنا إلا بعد فاتورة مؤكدة.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3"><div className="text-xs text-amber-200">محتاجين إجراء</div><div className="mt-1 text-2xl font-black text-white">{actionCount}</div></div>
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3"><div className="text-xs text-rose-200">مستحقين الآن</div><div className="mt-1 text-2xl font-black text-white">{overdueCount}</div></div>
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3"><div className="text-xs text-emerald-200">تجاوزوا 500 ج مبيعات مؤكدة</div><div className="mt-1 text-2xl font-black text-white">{over500Count}</div></div>
      </div>

      <div className="mt-4 flex flex-col gap-2 lg:flex-row">
        <div className="flex rounded-xl border border-slate-800 bg-slate-950/40 p-1">
          <button onClick={() => setMode('action')} className={`rounded-lg px-3 py-2 text-xs font-black ${mode === 'action' ? 'bg-violet-500/20 text-violet-100' : 'text-slate-400'}`}>مطلوب متابعة/إجراء</button>
          <button onClick={() => setMode('over500')} className={`rounded-lg px-3 py-2 text-xs font-black ${mode === 'over500' ? 'bg-emerald-500/20 text-emerald-100' : 'text-slate-400'}`}>عملاء +500 ج</button>
        </div>
        <label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم العميل أو الكود أو الصنف أو سبب المتابعة" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
      </div>

      <div className="mt-4 space-y-2">
        {filtered.slice(0, 80).map((row) => {
          const overdue = Boolean(row.next_action_due_at && new Date(row.next_action_due_at).getTime() <= Date.now());
          return <div key={`${row.customer_code || row.customer_phone || row.customer_name}-${row.cycle_start}`} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><b className="text-white">{row.customer_name || 'عميل غير محدد'}</b>{row.customer_code ? <span className="text-xs text-cyan-300">#{row.customer_code}</span> : null}<span className="text-xs text-slate-500">{row.branch || '—'}</span></div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {row.next_action_type ? <span className="rounded-lg bg-violet-500/10 px-2 py-1 font-bold text-violet-200">{actionTypeLabel[row.next_action_type] || row.action_label || row.next_action_type}</span> : null}
                  {overdue ? <span className="rounded-lg bg-rose-500/10 px-2 py-1 font-bold text-rose-200"><AlertTriangle size={12} className="ml-1 inline"/>مستحقة الآن</span> : row.next_action_due_at ? <span className="rounded-lg bg-amber-500/10 px-2 py-1 font-bold text-amber-200"><CalendarClock size={12} className="ml-1 inline"/>{dueLabel(row.next_action_due_at)}</span> : null}
                  {row.verified_revenue_over_500 ? <span className="rounded-lg bg-emerald-500/10 px-2 py-1 font-bold text-emerald-200"><BadgeDollarSign size={12} className="ml-1 inline"/>+500 ج</span> : null}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{row.next_action_reason || row.action_label || (row.needs_customer_service_action ? 'يوجد إجراء معلق يحتاج مراجعة.' : 'لا يوجد إجراء معلق.')}</div>
                {row.next_action_product ? <div className="mt-1 text-xs text-cyan-200">الصنف: {row.next_action_product}</div> : null}
              </div>
              <div className="shrink-0 text-left">
                <div className="text-lg font-black text-emerald-300">{formatMoney(row.verified_revenue)}</div>
                <div className="text-[11px] text-slate-500">{row.verified_invoice_count || 0} فاتورة مؤكدة • {row.conversation_count || 0} محادثة</div>
                {row.next_source_id && onOpenSource ? <button onClick={() => onOpenSource(row.next_source_id!)} className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-200">فتح المحادثة</button> : <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-slate-500"><CheckCircle2 size={12}/> السايكل {row.cycle_start} → {row.cycle_end}</div>}
              </div>
            </div>
          </div>;
        })}
        {!loading && filtered.length === 0 ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">لا توجد حالات مطابقة حاليًا. ستظهر الحالات هنا تلقائيًا مع دخول محادثات V6 وفواتير مؤكدة.</div> : null}
      </div>
    </section>
  );
}
