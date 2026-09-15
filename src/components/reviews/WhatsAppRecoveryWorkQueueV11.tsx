import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Play, RefreshCw, Search, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type WorkStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
type WorkRow = { action_id:string; source_id:string; action_type:string; work_status:WorkStatus; confidence:number|null; branch:string|null; customer_name:string|null; customer_code:string|null; customer_phone:string|null; staff_name:string|null; product_name:string|null; due_at:string|null; reason:string|null; assigned_to_id:string|null; assigned_to_name:string|null; started_at:string|null; completed_at:string|null; outcome:string|null; outcome_note:string|null; recovered_invoice_number:string|null; recovered_invoice_value:number|null; invoice_match_status:string|null; matched_invoice_number:string|null; matched_invoice_value:number|null; work_priority_rank:number };
type Staff = { id:string; name:string; branch:string|null };

const statusLabel:Record<string,string> = { unassigned:'غير مسندة', assigned:'مسندة', in_progress:'جاري التنفيذ', completed:'تمت', cancelled:'ملغاة', failed:'فشلت' };
const outcomeLabel:Record<string,string> = { sold:'تم البيع', followup_needed:'تحتاج متابعة أخرى', not_interested:'غير مهتم', unavailable:'غير متوفر', no_response:'لم يرد', complaint_resolved:'تم حل الشكوى', other:'أخرى' };
const money = (v:unknown) => `${Number(v || 0).toLocaleString('ar-EG',{ maximumFractionDigits:2 })} ج`;
const dueNow = (v:string|null) => Boolean(v && new Date(v).getTime() <= Date.now());

export default function WhatsAppRecoveryWorkQueueV11({ onOpenSource }:{ onOpenSource?:(sourceId:string)=>void }) {
  const [rows,setRows] = useState<WorkRow[]>([]);
  const [staff,setStaff] = useState<Staff[]>([]);
  const [loading,setLoading] = useState(false);
  const [mode,setMode] = useState<'open'|'completed'|'all'>('open');
  const [branch,setBranch] = useState('all');
  const [assignee,setAssignee] = useState('all');
  const [search,setSearch] = useState('');
  const [outcomes,setOutcomes] = useState<Record<string,string>>({});
  const [notes,setNotes] = useState<Record<string,string>>({});
  const [busyId,setBusyId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [q,s] = await Promise.all([
        supabase.from('whatsapp_recovery_work_queue_v1').select('*').order('work_priority_rank',{ascending:true}).order('due_at',{ascending:true}).limit(500),
        supabase.from('staff_accounts').select('id,staff_name,name,role,staff_role,branch,active,is_active').limit(300),
      ]);
      if (q.error) throw q.error;
      if (s.error) throw s.error;
      setRows((q.data || []) as WorkRow[]);
      setStaff((s.data || []).filter((x:any) => x.active !== false && x.is_active !== false && [x.role,x.staff_role].some((r) => String(r || '').toLowerCase() === 'team_dawaa_alpha')).map((x:any) => ({ id:String(x.id), name:String(x.staff_name || x.name || 'غير محدد'), branch:x.branch || null })));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر تحميل طابور الاسترجاع'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const patchAction = async (id:string, patch:Record<string,unknown>) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('whatsapp_conversation_actions').update({ ...patch, updated_at:new Date().toISOString() }).eq('id',id);
      if (error) throw error;
      await load();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر تحديث المهمة'); return false; }
    finally { setBusyId(''); }
  };

  const assign = async (row:WorkRow, staffId:string) => {
    const p = staff.find((x) => x.id === staffId); if (!p) return;
    if (await patchAction(row.action_id,{ assigned_to_id:p.id, assigned_to_name:p.name, assigned_at:new Date().toISOString(), work_status:row.work_status === 'unassigned' ? 'assigned' : row.work_status })) toast.success(`تم إسناد المهمة إلى ${p.name}`);
  };
  const start = async (row:WorkRow) => {
    if (!row.assigned_to_id) { toast.error('اسند المهمة لمسئول أولًا'); return; }
    if (await patchAction(row.action_id,{ work_status:'in_progress', started_at:row.started_at || new Date().toISOString() })) toast.success('تم بدء المهمة');
  };
  const complete = async (row:WorkRow) => {
    if (!row.assigned_to_id) { toast.error('اسند المهمة لمسئول أولًا'); return; }
    const outcome = outcomes[row.action_id] || row.outcome || ''; if (!outcome) { toast.error('اختار نتيجة المتابعة أولًا'); return; }
    const verified = row.invoice_match_status === 'verified';
    const ok = await patchAction(row.action_id,{ work_status:'completed', completed_at:new Date().toISOString(), outcome, outcome_note:notes[row.action_id] || row.outcome_note || null, recovered_invoice_number:outcome === 'sold' && verified ? row.matched_invoice_number : null, recovered_invoice_value:outcome === 'sold' && verified ? row.matched_invoice_value : null, recovered_at:outcome === 'sold' && verified ? new Date().toISOString() : null });
    if (ok) toast.success(outcome === 'sold' && !verified ? 'تمت المتابعة؛ البيع سيظل بانتظار فاتورة مؤكدة' : 'تم إكمال المهمة');
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (mode === 'open' && ['completed','cancelled'].includes(r.work_status)) return false;
    if (mode === 'completed' && r.work_status !== 'completed') return false;
    if (branch !== 'all' && r.branch !== branch) return false;
    if (assignee === 'unassigned' && r.assigned_to_id) return false;
    if (!['all','unassigned'].includes(assignee) && r.assigned_to_id !== assignee) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.customer_name,r.customer_code,r.customer_phone,r.product_name,r.reason,r.assigned_to_name].some((v) => String(v || '').toLowerCase().includes(q));
  }),[rows,mode,branch,assignee,search]);

  const stats = useMemo(() => ({ unassigned:rows.filter((r)=>r.work_status==='unassigned').length, due:rows.filter((r)=>!['completed','cancelled'].includes(r.work_status)&&dueNow(r.due_at)).length, progress:rows.filter((r)=>r.work_status==='in_progress').length, completed:rows.filter((r)=>r.work_status==='completed').length, recovered:rows.reduce((s,r)=>s+Number(r.recovered_invoice_value||0),0) }),[rows]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><div className="flex items-center gap-2 text-xs font-black text-fuchsia-200"><UserRoundCheck size={16}/> Recovery Work Queue V11</div><h2 className="mt-1 text-xl font-black text-white">طابور مهام استرجاع العملاء</h2><p className="mt-2 text-sm leading-7 text-slate-400">إسناد → تنفيذ → نتيجة → تحقق فاتورة. «تم البيع» لا يتحول لإيراد مسترجع إلا بعد فاتورة مؤكدة.</p></div><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{[['غير مسندة',stats.unassigned],['مستحقة الآن',stats.due],['جاري التنفيذ',stats.progress],['مكتملة',stats.completed],['إيراد مسترجع مؤكد',money(stats.recovered)]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">{l}</div><b className="text-xl text-white">{v}</b></div>)}</div>
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5"><label className="relative xl:col-span-2"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث بالعميل أو الصنف أو السبب" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label><select value={mode} onChange={(e)=>setMode(e.target.value as 'open'|'completed'|'all')} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="open">المهام المفتوحة</option><option value="completed">المكتملة</option><option value="all">الكل</option></select><select value={branch} onChange={(e)=>setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل المسئولين</option><option value="unassigned">غير مسندة</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="mt-4 space-y-2">{filtered.slice(0,150).map((r)=><div key={r.action_id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><b className="text-white">{r.customer_name||'عميل غير محدد'}</b>{r.customer_code?<span className="text-xs text-cyan-300">#{r.customer_code}</span>:null}<span className="text-xs text-slate-500">{r.branch||'—'}</span><span className={`rounded px-2 py-0.5 text-[10px] font-black ${dueNow(r.due_at)&&r.work_status!=='completed'?'bg-rose-500/10 text-rose-200':'bg-slate-800 text-slate-300'}`}>{statusLabel[r.work_status]}</span></div><div className="mt-2 text-sm text-cyan-200">{r.product_name||'بدون صنف محدد'}</div><div className="mt-1 text-sm leading-6 text-slate-300">{r.reason||'متابعة استرجاع عميل'}</div><div className="mt-1 text-xs text-slate-500">الدكتور: {r.staff_name||'غير محدد'} • المسئول: {r.assigned_to_name||'لم يتم الإسناد'} • ثقة {Math.round(Number(r.confidence||0))}%</div>{r.outcome?<div className="mt-2 text-xs text-emerald-300">النتيجة: {outcomeLabel[r.outcome]||r.outcome}{r.outcome_note?` • ${r.outcome_note}`:''}</div>:null}{r.outcome==='sold'&&!r.recovered_invoice_value?<div className="mt-1 text-xs text-amber-300">نتيجة بيع مسجلة، لكن الإيراد بانتظار فاتورة مؤكدة.</div>:null}{r.recovered_invoice_value?<div className="mt-1 text-xs font-black text-emerald-300">بيع مسترجع مؤكد: {money(r.recovered_invoice_value)} • فاتورة {r.recovered_invoice_number}</div>:null}</div><div className="w-full shrink-0 space-y-2 xl:w-[330px]">{r.work_status!=='completed'?<select value={r.assigned_to_id||''} onChange={(e)=>void assign(r,e.target.value)} disabled={busyId===r.action_id} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">إسناد لمسئول...</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select>:null}{r.work_status!=='completed'?<div className="flex gap-2"><button onClick={()=>void start(r)} disabled={!r.assigned_to_id||busyId===r.action_id} className="flex-1 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-2 text-xs font-black text-amber-200 disabled:opacity-40"><Play size={12} className="ml-1 inline"/>بدء</button>{onOpenSource?<button onClick={()=>onOpenSource(r.source_id)} className="flex-1 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button>:null}</div>:null}{r.work_status!=='completed'?<><select value={outcomes[r.action_id]||''} onChange={(e)=>setOutcomes((x)=>({...x,[r.action_id]:e.target.value}))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">اختار نتيجة المتابعة...</option>{Object.entries(outcomeLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><input value={notes[r.action_id]||''} onChange={(e)=>setNotes((x)=>({...x,[r.action_id]:e.target.value}))} placeholder="ملاحظة مختصرة (اختياري)" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"/><button onClick={()=>void complete(r)} disabled={!r.assigned_to_id||!outcomes[r.action_id]||busyId===r.action_id} className="w-full rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-2 text-xs font-black text-emerald-200 disabled:opacity-40"><CheckCircle2 size={12} className="ml-1 inline"/>إكمال المهمة</button></>:onOpenSource?<button onClick={()=>onOpenSource(r.source_id)} className="w-full rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button>:null}</div></div></div>)}{!loading&&filtered.length===0?<div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500"><Clock3 size={18} className="mx-auto mb-2"/>لا توجد مهام مطابقة حاليًا.</div>:null}</div>
  </section>;
}
