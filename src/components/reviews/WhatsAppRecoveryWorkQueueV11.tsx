import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Play, RefreshCw, Search, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type WorkRow = {
  action_id: string;
  source_id: string;
  action_type: string;
  work_status: 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  confidence: number | null;
  branch: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  product_name: string | null;
  due_at: string | null;
  reason: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
  recovered_invoice_number: string | null;
  recovered_invoice_value: number | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  work_priority_rank: number;
};

type Staff = { id: string; name: string; branch: string | null };

const statusLabel: Record<string, string> = { unassigned: 'غير مسندة', assigned: 'مسندة', in_progress: 'جاري التنفيذ', completed: 'تمت', cancelled: 'ملغاة', failed: 'فشلت' };
const outcomeLabel: Record<string, string> = { sold: 'تم البيع', followup_needed: 'تحتاج متابعة أخرى', not_interested: 'غير مهتم', unavailable: 'غير متوفر', no_response: 'لم يرد', complaint_resolved: 'تم حل الشكوى', other: 'أخرى' };

function formatMoney(value: unknown) { return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`; }
function isDue(value: string | null) { return Boolean(value && new Date(value).getTime() <= Date.now()); }

export default function WhatsAppRecoveryWorkQueueV11({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'open' | 'completed' | 'all'>('open');
  const [branch, setBranch] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [search, setSearch] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [queueRes, staffRes] = await Promise.all([
        supabase.from('whatsapp_recovery_work_queue_v1').select('*').order('work_priority_rank', { ascending: true }).order('due_at', { ascending: true }).limit(500),
        supabase.from('staff_accounts').select('id,staff_name,name,role,staff_role,branch,active,is_active').limit(300),
      ]);
      if (queueRes.error) throw queueRes.error;
      if (staffRes.error) throw staffRes.error;
      setRows((queueRes.data || []) as WorkRow[]);
      setStaff((staffRes.data || []).filter((s: any) => s.active !== false && s.is_active !== false && [s.role, s.staff_role].some((r) => String(r || '').toLowerCase() === 'team_dawaa_alpha')).map((s: any) => ({ id: String(s.id), name: String(s.staff_name || s.name || 'غير محدد'), branch: s.branch || null })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طابور الاسترجاع');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const patchAction = async (id: string, patch: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('whatsapp_conversation_actions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحديث المهمة'); }
    finally { setBusyId(''); }
  };

  const assign = async (row: WorkRow, staffId: string) => {
    const person = staff.find((s) => s.id === staffId);
    if (!person) return;
    await patchAction(row.action_id, { assigned_to_id: person.id, assigned_to_name: person.name, assigned_at: new Date().toISOString(), work_status: row.work_status === 'unassigned' ? 'assigned' : row.work_status });
    toast.success(`تم إسناد المهمة إلى ${person.name}`);
  };

  const start = async (row: WorkRow) => {
    await patchAction(row.action_id, { work_status: 'in_progress', started_at: row.started_at || new Date().toISOString() });
    toast.success('تم بدء المهمة');
  };

  const complete = async (row: WorkRow) => {
    const outcome = outcomes[row.action_id] || row.outcome || '';
    if (!outcome) { toast.error('اختار نتيجة المتابعة أولًا'); return; }
    const verified = row.invoice_match_status === 'verified';
    const soldWithInvoice = outcome === 'sold' && verified;
    await patchAction(row.action_id, {
      work_status: 'completed', completed_at: new Date().toISOString(), outcome, outcome_note: notes[row.action_id] || row.outcome_note || null,
      recovered_invoice_number: soldWithInvoice ? row.matched_invoice_number : null,
      recovered_invoice_value: soldWithInvoice ? row.matched_invoice_value : null,
      recovered_at: soldWithInvoice ? new Date().toISOString() : null,
    });
    toast.success(outcome === 'sold' && !verified ? 'تم إكمال المتابعة، والبيع لن يُحسب ماليًا حتى تظهر فاتورة مؤكدة' : 'تم إكمال المهمة');
  };

  const filtered = useMemo(() => rows.filter((row) => {
    if (mode === 'open' && ['completed', 'cancelled'].includes(row.work_status)) return false;
    if (mode === 'completed' && row.work_status !== 'completed') return false;
    if (branch !== 'all' && row.branch !== branch) return false;
    if (assignee === 'unassigned' && row.assigned_to_id) return false;
    if (!['all', 'unassigned'].includes(assignee) && row.assigned_to_id !== assignee) return false;
    const q = search.trim().toLowerCase();
    return !q || [row.customer_name, row.customer_code, row.customer_phone, row.product_name, row.reason, row.assigned_to_name].some((v) => String(v || '').toLowerCase().includes(q));
  }), [rows, mode, branch, assignee, search]);

  const stats = useMemo(() => ({
    unassigned: rows.filter((r) => r.work_status === 'unassigned').length,
    due: rows.filter((r) => !['completed', 'cancelled'].includes(r.work_status) && isDue(r.due_at)).length,
    progress: rows.filter((r) => r.work_status === 'in_progress').length,
    completed: rows.filter((r) => r.work_status === 'completed').length,
    recovered: rows.filter((r) => Number(r.recovered_invoice_value || 0) > 0).reduce((s, r) => s + Number(r.recovered_invoice_value || 0), 0),
  }), [rows]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><div className="flex items-center gap-2 text-xs font-black text-fuchsia-200"><UserRoundCheck size={16}/> Recovery Work Queue V11</div><h2 className="mt-1 text-xl font-black text-white">طابور مهام استرجاع العملاء</h2><p className="mt-2 text-sm leading-7 text-slate-400">إسناد → تنفيذ → نتيجة → تحقق فاتورة. نتيجة «تم البيع» لا تتحول لإيراد مسترجع إلا لو الفاتورة مؤكدة.</p></div><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">غير مسندة</div><b className="text-xl text-white">{stats.unassigned}</b></div><div className="rounded-xl border border-rose-400/20 p-3"><div className="text-xs text-rose-300">مستحقة الآن</div><b className="text-xl text-white">{stats.due}</b></div><div className="rounded-xl border border-amber-400/20 p-3"><div className="text-xs text-amber-300">جاري التنفيذ</div><b className="text-xl text-white">{stats.progress}</b></div><div className="rounded-xl border border-emerald-400/20 p-3"><div className="text-xs text-emerald-300">مكتملة</div><b className="text-xl text-white">{stats.completed}</b></div><div className="rounded-xl border border-cyan-400/20 p-3"><div className="text-xs text-cyan-300">إيراد مسترجع مؤكد</div><b className="text-xl text-white">{formatMoney(stats.recovered)}</b></div></div>
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5"><label className="relative xl:col-span-2"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعميل أو الصنف أو السبب" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label><select value={mode} onChange={(e) => setMode(e.target.value as any)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="open">المهام المفتوحة</option><option value="completed">المكتملة</option><option value="all">الكل</option></select><select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select><select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل المسئولين</option><option value="unassigned">غير مسندة</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="mt-4 space-y-2">{filtered.slice(0, 150).map((row) => <div key={row.action_id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><b className="text-white">{row.customer_name || 'عميل غير محدد'}</b>{row.customer_code ? <span className="text-xs text-cyan-300">#{row.customer_code}</span> : null}<span className="text-xs text-slate-500">{row.branch || '—'}</span><span className={`rounded px-2 py-0.5 text-[10px] font-black ${isDue(row.due_at) && row.work_status !== 'completed' ? 'bg-rose-500/10 text-rose-200' : 'bg-slate-800 text-slate-300'}`}>{statusLabel[row.work_status]}</span></div><div className="mt-2 text-sm text-cyan-200">{row.product_name || 'بدون صنف محدد'}</div><div className="mt-1 text-sm leading-6 text-slate-300">{row.reason || 'متابعة استرجاع عميل'}</div><div className="mt-1 text-xs text-slate-500">الدكتور: {row.staff_name || 'غير محدد'} • المسئول: {row.assigned_to_name || 'لم يتم الإسناد'} • ثقة {Math.round(Number(row.confidence || 0))}%</div>{row.outcome ? <div className="mt-2 text-xs text-emerald-300">النتيجة: {outcomeLabel[row.outcome] || row.outcome}{row.outcome_note ? ` • ${row.outcome_note}` : ''}</div> : null}{row.outcome === 'sold' && !row.recovered_invoice_value ? <div className="mt-1 text-xs text-amber-300">تم تسجيل نتيجة بيع، لكن الإيراد ما زال بانتظار فاتورة مؤكدة.</div> : null}{row.recovered_invoice_value ? <div className="mt-1 text-xs font-black text-emerald-300">بيع مسترجع مؤكد: {formatMoney(row.recovered_invoice_value)} • فاتورة {row.recovered_invoice_number}</div> : null}</div><div className="w-full shrink-0 space-y-2 xl:w-[330px]">{row.work_status !== 'completed' ? <select value={row.assigned_to_id || ''} onChange={(e) => void assign(row, e.target.value)} disabled={busyId === row.action_id} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">إسناد لمسئول...</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}{row.work_status !== 'completed' ? <div className="flex gap-2"><button onClick={() => void start(row)} disabled={!row.assigned_to_id || busyId === row.action_id} className="flex-1 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-2 text-xs font-black text-amber-200 disabled:opacity-40"><Play size={12} className="ml-1 inline"/>بدء</button>{onOpenSource ? <button onClick={() => onOpenSource(row.source_id)} className="flex-1 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button> : null}</div> : null}{row.work_status !== 'completed' ? <><select value={outcomes[row.action_id] || ''} onChange={(e) => setOutcomes((x) => ({ ...x, [row.action_id]: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">اختار نتيجة المتابعة...</option>{Object.entries(outcomeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><input value={notes[row.action_id] || ''} onChange={(e) => setNotes((x) => ({ ...x, [row.action_id]: e.target.value }))} placeholder="ملاحظة مختصرة (اختياري)" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"/><button onClick={() => void complete(row)} disabled={!outcomes[row.action_id] || busyId === row.action_id} className="w-full rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-2 text-xs font-black text-emerald-200 disabled:opacity-40"><CheckCircle2 size={12} className="ml-1 inline"/>إكمال المهمة</button></> : onOpenSource ? <button onClick={() => onOpenSource(row.source_id)} className="w-full rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button> : null}</div></div></div>)}{!loading && filtered.length === 0 ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500"><Clock3 size={18} className="mx-auto mb-2"/>لا توجد مهام مطابقة حاليًا.</div> : null}</div>
  </section>;
}
