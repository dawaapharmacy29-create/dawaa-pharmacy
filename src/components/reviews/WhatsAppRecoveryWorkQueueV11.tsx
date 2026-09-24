import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Play, RefreshCw, Search, Sparkles, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type WorkStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
type WorkRow = {
  action_id:string; source_id:string; action_type:string; work_status:WorkStatus; confidence:number|null;
  branch:string|null; customer_name:string|null; customer_code:string|null; customer_phone:string|null;
  staff_name:string|null; product_name:string|null; due_at:string|null; reason:string|null;
  assigned_to_id:string|null; assigned_to_name:string|null; started_at:string|null; completed_at:string|null;
  outcome:string|null; outcome_note:string|null; recovered_invoice_number:string|null; recovered_invoice_value:number|null;
  invoice_match_status:string|null; matched_invoice_number:string|null; matched_invoice_value:number|null; work_priority_rank:number;
  followup_attempts:number|null; next_followup_at:string|null; last_followup_at:string|null; sla_due_at:string|null;
  sla_breached_at:string|null; is_overdue:boolean|null; overdue_hours:number|null;
};
type Staff = { id:string; name:string; branch:string|null };

const statusLabel:Record<string,string> = { unassigned:'غير مسندة', assigned:'مسندة', in_progress:'جاري التنفيذ', completed:'تمت', cancelled:'ملغاة', failed:'فشلت' };
const outcomeLabel:Record<string,string> = { sold:'تم البيع', followup_needed:'تحتاج متابعة أخرى', not_interested:'غير مهتم', unavailable:'غير متوفر', no_response:'لم يرد', complaint_resolved:'تم حل الشكوى', other:'أخرى' };
const money = (v:unknown) => `${Number(v || 0).toLocaleString('ar-EG',{ maximumFractionDigits:2 })} ج`;
const fmt = (v:string|null) => v ? new Date(v).toLocaleString('ar-EG',{ dateStyle:'short', timeStyle:'short' }) : '—';

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
  const [autoAssigning,setAutoAssigning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [q,s] = await Promise.all([
        supabase.from('whatsapp_recovery_work_queue_v2').select('*').order('work_priority_rank',{ascending:true}).order('due_at',{ascending:true}).limit(500),
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

  const patchAction = async (id:string, patch:Record<string,unknown>, reload=true) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('whatsapp_conversation_actions').update({ ...patch, updated_at:new Date().toISOString() }).eq('id',id);
      if (error) throw error;
      if (reload) await load();
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر تحديث المهمة'); return false; }
    finally { setBusyId(''); }
  };

  const assign = async (row:WorkRow, staffId:string) => {
    const p = staff.find((x) => x.id === staffId); if (!p) return;
    if (await patchAction(row.action_id,{ assigned_to_id:p.id, assigned_to_name:p.name, assigned_at:new Date().toISOString(), work_status:row.work_status === 'unassigned' ? 'assigned' : row.work_status })) toast.success(`تم إسناد المهمة إلى ${p.name}`);
  };

  const autoAssign = async () => {
    const pending = rows.filter((r) => r.work_status === 'unassigned' && !r.assigned_to_id).sort((a,b) => (a.work_priority_rank-b.work_priority_rank) || Number(new Date(a.due_at || 0))-Number(new Date(b.due_at || 0)));
    if (!pending.length) { toast.info('لا توجد مهام غير مسندة'); return; }
    if (!staff.length) { toast.error('لا يوجد أعضاء نشطون في فريق دواء ألفا'); return; }
    setAutoAssigning(true);
    const loadMap = new Map(staff.map((s) => [s.id, rows.filter((r) => r.assigned_to_id === s.id && !['completed','cancelled','failed'].includes(r.work_status)).length]));
    let success = 0;
    for (const row of pending) {
      const target = [...staff].sort((a,b) => (loadMap.get(a.id)||0)-(loadMap.get(b.id)||0) || a.name.localeCompare(b.name,'ar'))[0];
      const ok = await patchAction(row.action_id,{ assigned_to_id:target.id, assigned_to_name:target.name, assigned_at:new Date().toISOString(), work_status:'assigned' },false);
      if (ok) { success += 1; loadMap.set(target.id,(loadMap.get(target.id)||0)+1); }
    }
    await load();
    setAutoAssigning(false);
    success === pending.length ? toast.success(`تم توزيع ${success} مهمة بالتوازن على فريق خدمة العملاء`) : toast.warning(`تم توزيع ${success} من ${pending.length} مهمة`);
  };

  const start = async (row:WorkRow) => {
    if (!row.assigned_to_id) { toast.error('اسند المهمة لمسئول أولًا'); return; }
    if (await patchAction(row.action_id,{ work_status:'in_progress', started_at:row.started_at || new Date().toISOString() })) toast.success('تم بدء المهمة');
  };

  const complete = async (row:WorkRow) => {
    if (!row.assigned_to_id) { toast.error('اسند المهمة لمسئول أولًا'); return; }
    const outcome = outcomes[row.action_id] || row.outcome || ''; if (!outcome) { toast.error('اختار نتيجة المتابعة أولًا'); return; }
    const verified = false; // Legacy statistical match is never sufficient to book recovered revenue.
    const ok = await patchAction(row.action_id,{ work_status:'completed', completed_at:new Date().toISOString(), outcome, outcome_note:notes[row.action_id] || row.outcome_note || null, next_followup_at:outcome === 'followup_needed' ? new Date(Date.now()+86400000).toISOString() : null, recovered_invoice_number:outcome === 'sold' && verified ? row.matched_invoice_number : null, recovered_invoice_value:outcome === 'sold' && verified ? row.matched_invoice_value : null, recovered_at:outcome === 'sold' && verified ? new Date().toISOString() : null });
    if (!ok) return;
    setOutcomes((x) => ({...x,[row.action_id]:''}));
    if (outcome === 'followup_needed') toast.success('تمت المتابعة وسيُعاد فتح المهمة تلقائيًا بعد 24 ساعة');
    else toast.success(outcome === 'sold' ? 'تم تسجيل نتيجة المتابعة كبيع؛ الإيراد والفاتورة يظلان بانتظار إثبات رسمي.' : 'تم إكمال المهمة');
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (mode === 'open' && ['completed','cancelled','failed'].includes(r.work_status)) return false;
    if (mode === 'completed' && r.work_status !== 'completed') return false;
    if (branch !== 'all' && r.branch !== branch) return false;
    if (assignee === 'unassigned' && r.assigned_to_id) return false;
    if (!['all','unassigned'].includes(assignee) && r.assigned_to_id !== assignee) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.customer_name,r.customer_code,r.customer_phone,r.product_name,r.reason,r.assigned_to_name].some((v) => String(v || '').toLowerCase().includes(q));
  }),[rows,mode,branch,assignee,search]);

  const stats = useMemo(() => ({
    unassigned:rows.filter((r)=>r.work_status==='unassigned').length,
    overdue:rows.filter((r)=>r.is_overdue && !['completed','cancelled','failed'].includes(r.work_status)).length,
    progress:rows.filter((r)=>r.work_status==='in_progress').length,
    completed:rows.filter((r)=>r.work_status==='completed').length,
    recovered:rows.reduce((s,r)=>s+Number(r.recovered_invoice_value||0),0),
  }),[rows]);

  const staffReport = useMemo(() => staff.map((s) => {
    const mine = rows.filter((r) => r.assigned_to_id === s.id);
    const completed = mine.filter((r) => r.work_status === 'completed').length;
    const sold = mine.filter((r) => r.outcome === 'sold').length;
    return { ...s, total:mine.length, open:mine.filter((r)=>!['completed','cancelled','failed'].includes(r.work_status)).length, completed, sold, overdue:mine.filter((r)=>r.is_overdue && !['completed','cancelled','failed'].includes(r.work_status)).length, recovered:mine.reduce((sum,r)=>sum+Number(r.recovered_invoice_value||0),0), completion:mine.length ? Math.round(completed/mine.length*100) : 0 };
  }).filter((x)=>x.total>0).sort((a,b)=>b.recovered-a.recovered || b.completed-a.completed),[rows,staff]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><div className="flex items-center gap-2 text-xs font-black text-fuchsia-200"><UserRoundCheck size={16}/> Recovery Work Queue V12</div><h2 className="mt-1 text-xl font-black text-white">طابور مهام استرجاع العملاء</h2><p className="mt-2 text-sm leading-7 text-slate-400">توزيع ذكي للحمل + SLA + إعادة متابعة تلقائية + بيع مسترجع لا يُحتسب إلا بفواتير مؤكدة.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void autoAssign()} disabled={autoAssigning||loading} className="flex items-center gap-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-2 text-sm font-black text-fuchsia-200 disabled:opacity-50"><Sparkles size={15}/>{autoAssigning?'جاري التوزيع...':'توزيع تلقائي'}</button><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button></div></div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{[['غير مسندة',stats.unassigned],['متأخرة عن SLA',stats.overdue],['جاري التنفيذ',stats.progress],['مكتملة',stats.completed],['إيراد مسترجع مؤكد',money(stats.recovered)]].map(([l,v])=><div key={String(l)} className={`rounded-xl border p-3 ${l==='متأخرة عن SLA'&&Number(v)>0?'border-rose-400/30 bg-rose-500/5':'border-slate-800'}`}><div className="text-xs text-slate-500">{l}</div><b className="text-xl text-white">{v}</b></div>)}</div>

    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5"><label className="relative xl:col-span-2"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث بالعميل أو الصنف أو السبب" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label><select value={mode} onChange={(e)=>setMode(e.target.value as 'open'|'completed'|'all')} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="open">المهام المفتوحة</option><option value="completed">المكتملة</option><option value="all">الكل</option></select><select value={branch} onChange={(e)=>setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">كل المسئولين</option><option value="unassigned">غير مسندة</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>

    <div className="mt-4 space-y-2">{filtered.slice(0,150).map((r)=><div key={r.action_id} className={`rounded-2xl border p-4 ${r.is_overdue&&!['completed','cancelled','failed'].includes(r.work_status)?'border-rose-400/30 bg-rose-500/5':'border-slate-800 bg-slate-950/35'}`}><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><b className="text-white">{r.customer_name||'عميل غير محدد'}</b>{r.customer_code?<span className="text-xs text-cyan-300">#{r.customer_code}</span>:null}<span className="text-xs text-slate-500">{r.branch||'—'}</span><span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-black text-slate-300">{statusLabel[r.work_status]}</span>{r.is_overdue&&!['completed','cancelled','failed'].includes(r.work_status)?<span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-200">متأخرة {Math.max(1,Math.round(Number(r.overdue_hours||0)))} س</span>:null}</div><div className="mt-2 text-sm text-cyan-200">{r.product_name||'بدون صنف محدد'}</div><div className="mt-1 text-sm leading-6 text-slate-300">{r.reason||'متابعة استرجاع عميل'}</div><div className="mt-1 text-xs text-slate-500">المسئول: {r.assigned_to_name||'لم يتم الإسناد'} • الاستحقاق: {fmt(r.next_followup_at||r.sla_due_at||r.due_at)} • محاولات المتابعة: {r.followup_attempts||0}</div>{r.outcome?<div className="mt-2 text-xs text-emerald-300">النتيجة: {outcomeLabel[r.outcome]||r.outcome}{r.outcome_note?` • ${r.outcome_note}`:''}</div>:null}{r.outcome==='sold'&&!r.recovered_invoice_value?<div className="mt-1 text-xs text-amber-300">نتيجة بيع مسجلة يدويًا، لكن الإيراد بانتظار إثبات فاتورة رسمي.</div>:null}{r.recovered_invoice_value?<div className="mt-1 text-xs font-black text-emerald-300">بيع مسترجع مؤكد: {money(r.recovered_invoice_value)} • فاتورة {r.recovered_invoice_number}</div>:null}</div><div className="w-full shrink-0 space-y-2 xl:w-[330px]">{r.work_status!=='completed'?<select value={r.assigned_to_id||''} onChange={(e)=>void assign(r,e.target.value)} disabled={busyId===r.action_id} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">إسناد لمسئول...</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select>:null}{r.work_status!=='completed'?<div className="flex gap-2"><button onClick={()=>void start(r)} disabled={!r.assigned_to_id||busyId===r.action_id} className="flex-1 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-2 text-xs font-black text-amber-200 disabled:opacity-40"><Play size={12} className="ml-1 inline"/>بدء</button>{onOpenSource?<button onClick={()=>onOpenSource(r.source_id)} className="flex-1 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button>:null}</div>:null}{r.work_status!=='completed'?<><select value={outcomes[r.action_id]||''} onChange={(e)=>setOutcomes((x)=>({...x,[r.action_id]:e.target.value}))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"><option value="">اختار نتيجة المتابعة...</option>{Object.entries(outcomeLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><input value={notes[r.action_id]||''} onChange={(e)=>setNotes((x)=>({...x,[r.action_id]:e.target.value}))} placeholder="ملاحظة مختصرة (اختياري)" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white"/><button onClick={()=>void complete(r)} disabled={!r.assigned_to_id||!outcomes[r.action_id]||busyId===r.action_id} className="w-full rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-2 text-xs font-black text-emerald-200 disabled:opacity-40"><CheckCircle2 size={12} className="ml-1 inline"/>إكمال المتابعة</button></>:onOpenSource?<button onClick={()=>onOpenSource(r.source_id)} className="w-full rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-black text-cyan-200">فتح المحادثة</button>:null}</div></div></div>)}{!loading&&!filtered.length?<div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">لا توجد مهام مطابقة للفلاتر الحالية.</div>:null}</div>

    {staffReport.length?<div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="flex items-center gap-2"><Clock3 size={15} className="text-cyan-300"/><h3 className="font-black text-white">أداء فريق الاسترجاع</h3></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-right text-xs"><thead className="text-slate-500"><tr><th className="p-2">المسئول</th><th className="p-2">كل المهام</th><th className="p-2">مفتوحة</th><th className="p-2">متأخرة</th><th className="p-2">مكتملة</th><th className="p-2">نسبة الإكمال</th><th className="p-2">نتائج بيع</th><th className="p-2">إيراد مؤكد</th></tr></thead><tbody>{staffReport.map((r)=><tr key={r.id} className="border-t border-slate-800"><td className="p-2 font-black text-white">{r.name}</td><td className="p-2 text-slate-300">{r.total}</td><td className="p-2 text-slate-300">{r.open}</td><td className={`p-2 ${r.overdue?'text-rose-300':'text-slate-300'}`}>{r.overdue}</td><td className="p-2 text-slate-300">{r.completed}</td><td className="p-2 text-cyan-300">{r.completion}%</td><td className="p-2 text-amber-300">{r.sold}</td><td className="p-2 font-black text-emerald-300">{money(r.recovered)}</td></tr>)}</tbody></table></div></div>:null}
  </section>;
}
