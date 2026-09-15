import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Search, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Row = {
  source_id: string;
  branch: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  staff_id: string | null;
  staff_name: string | null;
  conversation_ended_at: string | null;
  product_name: string | null;
  product_code: string | null;
  quantity: number | null;
  current_stage: string | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  next_action: string | null;
  confidence: number | null;
  invoice_match_status: string | null;
  matched_invoice_value: number | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function normalizeKey(value: string | null) {
  return String(value || 'general').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '').slice(0, 80) || 'general';
}

function classify(row: Row) {
  const reason = String(row.leakage_reason || '').toLowerCase();
  const stage = String(row.current_stage || '').toLowerCase();
  const invoice = String(row.invoice_match_status || '').toLowerCase();
  const ageDays = row.conversation_ended_at ? Math.max(0, (Date.now() - new Date(row.conversation_ended_at).getTime()) / 86400000) : 0;
  let score = 30;
  const why: string[] = [];
  if (row.followup_candidate) { score += 25; why.push('مرشح متابعة'); }
  if (row.closed_in_chat && invoice !== 'verified') { score += 20; why.push('الأوردر اتقفل في الشات ولسه الفاتورة غير مؤكدة'); }
  if (stage.includes('accepted') || stage.includes('recommend') || stage.includes('alternative')) { score += 15; why.push('العميل وصل لمرحلة متقدمة'); }
  if (reason.includes('no reply') || reason.includes('لم يرد') || reason.includes('لم يحسم')) { score += 10; why.push('محتاج إعادة تواصل'); }
  if (reason.includes('unavailable') || reason.includes('غير متوفر')) { score += 5; why.push('ممكن استرجاع الفرصة لو الصنف/البديل توفر'); }
  if (invoice === 'verified') score -= 70;
  if (ageDays > 14) score -= 15;
  else if (ageDays <= 3) score += 10;
  score = Math.max(0, Math.min(100, score));
  return { score, priority: score >= 75 ? 'عالية' : score >= 50 ? 'متوسطة' : 'منخفضة', why: why.join(' • ') || 'فرصة تحتاج مراجعة بشرية' };
}

export default function WhatsAppRecoverableOpportunitiesV10({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState('');
  const [branch, setBranch] = useState('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,branch,customer_id,customer_name,customer_code,customer_phone,staff_id,staff_name,conversation_ended_at,product_name,product_code,quantity,current_stage,closed_in_chat,followup_candidate,leakage_reason,next_action,confidence,invoice_match_status,matched_invoice_value')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .neq('invoice_match_status', 'verified')
        .order('conversation_ended_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      console.error('[whatsapp-recoverable-v10] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createRecoveryTask = async (row: Row, recovery: ReturnType<typeof classify>) => {
    const actionKey = `recovery:${normalizeKey(row.product_code || row.product_name)}`;
    const uiKey = `${row.source_id}:${actionKey}`;
    setCreatingKey(uiKey);
    try {
      const due = new Date();
      if (recovery.score < 75) due.setDate(due.getDate() + 1);
      const { error } = await supabase.from('whatsapp_conversation_actions').insert({
        source_id: row.source_id,
        action_key: actionKey,
        action_type: 'customer_followup',
        status: 'ready',
        work_status: 'unassigned',
        confidence: recovery.score,
        auto_eligible: false,
        branch: row.branch,
        customer_id: row.customer_id,
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        staff_id: row.staff_id,
        staff_name: row.staff_name,
        product_code: row.product_code,
        product_name: row.product_name,
        quantity: row.quantity,
        due_at: due.toISOString(),
        reason: row.leakage_reason || row.next_action || recovery.why,
        evidence: { origin: 'recoverable_v10', recovery_score: recovery.score, current_stage: row.current_stage },
        payload: { origin: 'recoverable_v10', recovery_score: recovery.score, current_stage: row.current_stage, invoice_match_status: row.invoice_match_status },
      });
      if (error) {
        if (error.code === '23505') { toast.info('المهمة موجودة بالفعل في طابور الاسترجاع'); return; }
        throw error;
      }
      toast.success('تم تحويل الفرصة لمهمة استرجاع بدون إنشاء نقاط أو بيع وهمي');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء مهمة الاسترجاع');
    } finally {
      setCreatingKey('');
    }
  };

  const ranked = useMemo(() => rows.map((row) => ({ row, recovery: classify(row) }))
    .filter(({ row, recovery }) => recovery.score >= 40 && (row.followup_candidate || row.leakage_reason || row.closed_in_chat))
    .filter(({ row }) => branch === 'all' || row.branch === branch)
    .filter(({ row }) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [row.customer_name, row.customer_code, row.staff_name, row.product_name, row.leakage_reason, row.next_action].some((v) => String(v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => b.recovery.score - a.recovery.score), [rows, branch, search]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-black text-emerald-200"><RotateCcw size={16}/> فرص قابلة للاسترجاع V10</div><h2 className="mt-1 text-xl font-black text-white">العملاء اللي لسه نقدر نرجع ونكمل معاهم البيع</h2><p className="mt-2 text-sm leading-7 text-slate-400">البيع لا يُحسب إلا بعد فاتورة مؤكدة. تحويل الفرصة لمهمة لا ينشئ نقاط أو إيراد تلقائي.</p></div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button>
    </div>
    <div className="mt-4 flex flex-col gap-2 lg:flex-row"><label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعميل أو الدكتور أو الصنف أو سبب المتابعة" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label><select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select></div>
    <div className="mt-4 space-y-2">{ranked.slice(0, 100).map(({ row, recovery }) => {
      const uiKey = `${row.source_id}:recovery:${normalizeKey(row.product_code || row.product_name)}`;
      return <div key={`${row.source_id}-${row.product_code || row.product_name || 'x'}`} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-white">{row.customer_name || 'عميل غير محدد'}</b>{row.customer_code ? <span className="text-xs text-cyan-300">#{row.customer_code}</span> : null}<span className="text-xs text-slate-500">{row.branch || '—'} • {row.staff_name || 'الدكتور غير محدد'}</span></div><div className="mt-2 text-sm text-cyan-200">{row.product_name || 'صنف غير محدد'}</div><div className="mt-1 text-sm leading-6 text-slate-300">{row.leakage_reason || row.next_action || recovery.why}</div><div className="mt-1 text-xs text-slate-500">{recovery.why}</div></div><div className="shrink-0 text-left"><div className={`text-lg font-black ${recovery.score >= 75 ? 'text-emerald-300' : recovery.score >= 50 ? 'text-amber-300' : 'text-slate-300'}`}>{recovery.score}% فرصة استرجاع</div><div className="text-[11px] text-slate-500">أولوية {recovery.priority} • {row.invoice_match_status || 'فاتورة غير مؤكدة'}</div><div className="mt-2 flex flex-wrap justify-end gap-2"><button onClick={() => void createRecoveryTask(row, recovery)} disabled={creatingKey === uiKey} className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-200 disabled:opacity-50"><ListTodo size={12} className="ml-1 inline"/>{creatingKey === uiKey ? 'جاري الإنشاء...' : 'تحويل لمهمة استرجاع'}</button>{onOpenSource ? <button onClick={() => onOpenSource(row.source_id)} className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-200">فتح المحادثة</button> : null}</div></div></div></div>;
    })}{!loading && ranked.length === 0 ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">لا توجد فرص استرجاع واضحة في البيانات الحالية.</div> : null}</div>
  </section>;
}
