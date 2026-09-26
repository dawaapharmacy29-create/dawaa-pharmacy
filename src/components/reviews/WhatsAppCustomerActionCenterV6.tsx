import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, CalendarClock, CheckCircle2, FileText, PackageSearch, RefreshCw, Search, UserRoundSearch, X } from 'lucide-react';
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

type CustomerConversation = {
  id: string;
  staff_name: string | null;
  conversation_started_at: string | null;
  review_status: string | null;
  followup_required: boolean | null;
  suggested_followup_reason: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  analysis_json: any;
};

type CustomerProduct = {
  source_id: string;
  staff_name: string | null;
  product_name: string | null;
  current_stage: string | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  next_action: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
};

type CustomerAction = {
  id: string;
  action_type: string;
  status: string;
  product_name: string | null;
  due_at: string | null;
  reason: string | null;
  confidence: number | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
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
  const [selectedCustomer, setSelectedCustomer] = useState<ActionCenterRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conversations, setConversations] = useState<CustomerConversation[]>([]);
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [actions, setActions] = useState<CustomerAction[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_customer_service_action_center_v1')
        .select('*')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .order('action_priority_rank', { ascending: true })
        .order('verified_revenue', { ascending: false })
        .limit(250);
      if (error) throw error;
      setRows((data || []) as ActionCenterRow[]);
    } catch (error) {
      console.error('[whatsapp-action-center-v6] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  const openCustomer360 = async (row: ActionCenterRow) => {
    setSelectedCustomer(row);
    setDetailLoading(true);
    try {
      let sourceQuery = supabase
        .from('whatsapp_review_sources')
        .select('id,staff_name,conversation_started_at,review_status,followup_required,suggested_followup_reason,invoice_match_status,matched_invoice_number,matched_invoice_value,analysis_json')
        .gte('conversation_started_at', `${row.cycle_start}T00:00:00`)
        .lte('conversation_started_at', `${row.cycle_end}T23:59:59`)
        .eq('branch', row.branch || '')
        .order('conversation_started_at', { ascending: false })
        .limit(250);
      if (row.customer_id) sourceQuery = sourceQuery.eq('customer_id', row.customer_id);
      else if (row.customer_code) sourceQuery = sourceQuery.eq('customer_code', row.customer_code);
      else if (row.customer_phone) sourceQuery = sourceQuery.eq('customer_phone', row.customer_phone);
      else sourceQuery = sourceQuery.eq('customer_name', row.customer_name || '');

      let productQuery = supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,staff_name,product_name,current_stage,closed_in_chat,followup_candidate,leakage_reason,next_action,invoice_match_status,matched_invoice_number,matched_invoice_value')
        .eq('cycle_start', row.cycle_start)
        .eq('cycle_end', row.cycle_end)
        .eq('branch', row.branch || '')
        .order('conversation_started_at', { ascending: false })
        .limit(300);
      if (row.customer_id) productQuery = productQuery.eq('customer_id', row.customer_id);
      else if (row.customer_code) productQuery = productQuery.eq('customer_code', row.customer_code);
      else if (row.customer_phone) productQuery = productQuery.eq('customer_phone', row.customer_phone);
      else productQuery = productQuery.eq('customer_name', row.customer_name || '');

      const [sourceResult, productResult] = await Promise.all([sourceQuery, productQuery]);
      if (sourceResult.error) throw sourceResult.error;
      if (productResult.error) throw productResult.error;

      const sourceIds = (sourceResult.data || []).map((x: any) => String(x.id));
      let actionData: any[] = [];
      if (sourceIds.length) {
        const actionResult = await supabase
          .from('whatsapp_conversation_actions')
          .select('id,action_type,status,product_name,due_at,reason,confidence')
          .in('source_id', sourceIds)
          .order('due_at', { ascending: true, nullsFirst: false });
        if (!actionResult.error) actionData = actionResult.data || [];
      }

      setConversations((sourceResult.data || []) as CustomerConversation[]);
      setProducts((productResult.data || []) as CustomerProduct[]);
      setActions(actionData as CustomerAction[]);
    } catch (error) {
      console.error('[whatsapp-action-center-v8] customer 360 load failed', error);
      setConversations([]);
      setProducts([]);
      setActions([]);
    } finally {
      setDetailLoading(false);
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

  const detailSummary = useMemo(() => ({
    verifiedSales: 0, // Await canonical Sales Intelligence proof.
    verifiedRevenue: 0, // Legacy statistical invoice matching is not verified revenue.
    followups: actions.filter((x) => ['proposed', 'ready'].includes(x.status)).length,
    leakage: products.filter((x) => Boolean(x.leakage_reason)).length,
  }), [conversations, actions, products]);

  return (
    <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-cyan-200"><UserRoundSearch size={16}/> مركز قرار خدمة العملاء V8</div>
          <h2 className="mt-1 text-xl font-black text-white">مين نتابعه دلوقتي وليه؟</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يربط نتيجة المحادثة بالإجراء المطلوب وقيمة العميل في سايكل 26→25، مع Customer 360 كامل عند فتح أي عميل.</p>
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
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button onClick={() => void openCustomer360(row)} className="rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-black text-violet-200">Customer 360</button>
                  {row.next_source_id && onOpenSource ? <button onClick={() => onOpenSource(row.next_source_id!)} className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-200">فتح المحادثة</button> : null}
                </div>
              </div>
            </div>
          </div>;
        })}
        {!loading && filtered.length === 0 ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">لا توجد حالات مطابقة حاليًا. ستظهر الحالات هنا تلقائيًا مع دخول محادثات وفواتير مؤكدة.</div> : null}
      </div>

      {selectedCustomer ? <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div><div className="font-black text-white">Customer 360 — {selectedCustomer.customer_name || 'عميل غير محدد'} {selectedCustomer.customer_code ? `#${selectedCustomer.customer_code}` : ''}</div><div className="mt-1 text-xs text-slate-400">{selectedCustomer.branch || '—'} • السايكل {selectedCustomer.cycle_start} → {selectedCustomer.cycle_end}</div></div>
          <button onClick={() => setSelectedCustomer(null)} className="rounded-lg border border-slate-700 p-2 text-slate-400"><X size={15}/></button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-slate-950/45 p-3 text-center"><div className="text-[11px] text-slate-500">بيع مثبت رسميًا</div><div className="mt-1 text-lg font-black text-emerald-300">{detailSummary.verifiedSales}</div></div>
          <div className="rounded-xl bg-slate-950/45 p-3 text-center"><div className="text-[11px] text-slate-500">إيراد مثبت رسميًا</div><div className="mt-1 text-lg font-black text-emerald-300">{formatMoney(detailSummary.verifiedRevenue)}</div></div>
          <div className="rounded-xl bg-slate-950/45 p-3 text-center"><div className="text-[11px] text-slate-500">إجراءات مفتوحة</div><div className="mt-1 text-lg font-black text-amber-300">{detailSummary.followups}</div></div>
          <div className="rounded-xl bg-slate-950/45 p-3 text-center"><div className="text-[11px] text-slate-500">فرص متوقفة</div><div className="mt-1 text-lg font-black text-rose-300">{detailSummary.leakage}</div></div>
        </div>

        {detailLoading ? <div className="p-8 text-center text-sm text-slate-400">جاري تحميل رحلة العميل...</div> : <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"><div className="mb-3 flex items-center gap-2 font-black text-white"><FileText size={15}/> المحادثات</div><div className="max-h-[380px] space-y-2 overflow-y-auto">{conversations.map((item) => <button key={item.id} onClick={() => onOpenSource?.(item.id)} className="w-full rounded-xl border border-slate-800 p-3 text-right hover:border-cyan-400/30"><div className="flex justify-between gap-2"><b className="text-white">{item.staff_name || 'الدكتور غير محدد'}</b><span className="text-[10px] text-slate-500">{formatDate(item.conversation_started_at)}</span></div><div className="mt-2 text-xs text-slate-300">{item.analysis_json?.operational?.primaryIntent || item.review_status || '—'}{item.followup_required ? <span className="text-amber-300"> • متابعة</span> : null}</div>{item.invoice_match_status === 'verified' ? <div className="mt-1 text-xs text-cyan-300">مطابقة فاتورة آلية Legacy {item.matched_invoice_number || ''} • {formatMoney(item.matched_invoice_value)} — غير مثبتة رسميًا</div> : null}</button>)}{!conversations.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد محادثات مرتبطة في السايكل.</div> : null}</div></div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"><div className="mb-3 flex items-center gap-2 font-black text-white"><PackageSearch size={15}/> الأصناف والفرص</div><div className="max-h-[380px] space-y-2 overflow-y-auto">{products.map((item, i) => <button key={`${item.source_id}-${i}`} onClick={() => onOpenSource?.(item.source_id)} className="w-full rounded-xl border border-slate-800 p-3 text-right hover:border-violet-400/30"><div className="flex justify-between gap-2"><b className="text-white">{item.product_name || 'صنف غير محدد'}</b><span className="text-[10px] text-violet-300">{item.current_stage || '—'}</span></div><div className="mt-1 text-[11px] text-slate-500">{item.staff_name || 'الدكتور غير محدد'}</div>{item.leakage_reason ? <div className="mt-2 text-xs text-amber-200">{item.leakage_reason}</div> : null}<div className="mt-1 text-[11px] text-slate-400">{item.next_action || (item.invoice_match_status === 'verified' ? 'تم تأكيد البيع بالفاتورة.' : 'لا توجد خطوة تالية مثبتة.')}</div></button>)}{!products.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد رحلات أصناف مرتبطة بالعميل.</div> : null}</div></div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"><div className="mb-3 flex items-center gap-2 font-black text-white"><CheckCircle2 size={15}/> الإجراءات والمتابعات</div><div className="max-h-[380px] space-y-2 overflow-y-auto">{actions.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 p-3"><div className="flex justify-between gap-2"><b className="text-white">{actionTypeLabel[item.action_type] || item.action_type}</b><span className="text-[10px] text-slate-500">{item.status}</span></div><div className="mt-1 text-xs text-slate-300">{item.reason || '—'}</div>{item.product_name ? <div className="mt-1 text-[11px] text-cyan-300">{item.product_name}</div> : null}{item.due_at ? <div className="mt-1 text-[11px] text-amber-300">{dueLabel(item.due_at)}</div> : null}</div>)}{!actions.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد إجراءات تشغيلية مرتبطة بالعميل.</div> : null}</div></div>
        </div>}
      </div> : null}
    </section>
  );
}
