import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, History, Link2, RefreshCw, Search, ShoppingCart, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

type Kind = 'closed' | 'linked' | 'timeline';
type Filter = 'all' | Kind;
type Row = {
  id: string; kind: Kind; customerCode: string | null; customerName: string; customerPhone: string | null;
  branch: string | null; responsibleName: string | null; occurredAt: string | null; result: string | null;
  notes: string | null; purchaseAfter: boolean | null; purchaseAmount: number | null; needsNext: boolean | null;
  nextDate: string | null; sourceFile: string | null; sourceSheet: string | null; sourceRow: number | null;
  linkedFollowupId: string | null;
};

const text = (v: unknown) => String(v ?? '').trim();
const asBool = (v: unknown) => v === true || v === 1 || v === '1' || /^true|نعم|yes$/i.test(text(v));
const asNumber = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmtDate = (v: string | null) => { if (!v) return 'غير محدد'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); };
const normBranch = (v: unknown) => normalizeBranchName(text(v));
const kindInfo: Record<Kind, { label: string; tone: string; Icon: typeof History }> = {
  closed: { label: 'متابعة تاريخية مغلقة', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100', Icon: CheckCircle2 },
  linked: { label: 'حدث مرتبط بحالة حالية', tone: 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100', Icon: Link2 },
  timeline: { label: 'تاريخ العميل', tone: 'border-violet-300/30 bg-violet-400/10 text-violet-100', Icon: UserRound },
};

export default function CustomerHistoricalFollowupLedger() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normBranch(user?.branch || '');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [branch, setBranch] = useState(managerView ? 'كل الفروع' : userBranch);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      let closedQ = supabase.from('daily_followups')
        .select('id,customer_code,customer_name,name,customer_phone,phone,branch,responsible_name,followup_date,followup_datetime,completed_at,followup_result,contact_result,followup_summary,notes,followup_notes,purchase_after_followup,purchase_amount,needs_next_followup,next_followup_date,source_file,source_sheet,source_row_number')
        .eq('import_source', 'historical_excel_import').not('completed_at', 'is', null).limit(1000);
      let linkedQ = supabase.from('customer_followup_events')
        .select('id,followup_id,customer_code,event_note,event_payload,branch,actor_name,created_at')
        .eq('event_type', 'historical_followup_event').limit(1000);
      let timelineQ = supabase.from('customer_timeline_events')
        .select('id,customer_code,customer_name,customer_phone,event_type,title,description,metadata,details,created_by_name,created_at')
        .eq('event_type', 'historical_followup').contains('metadata', { import_source: 'historical_excel_import' }).limit(1000);
      if (!managerView && userBranch) {
        closedQ = closedQ.eq('branch', userBranch);
        linkedQ = linkedQ.eq('branch', userBranch);
        timelineQ = timelineQ.contains('metadata', { branch: userBranch });
      }
      const [closedR, linkedR, timelineR] = await Promise.all([closedQ, linkedQ, timelineQ]);
      if (closedR.error) throw closedR.error;
      if (linkedR.error) throw linkedR.error;
      if (timelineR.error) throw timelineR.error;

      const closed: Row[] = (closedR.data || []).map((r: any) => ({
        id: `closed:${r.id}`, kind: 'closed', customerCode: r.customer_code || null, customerName: text(r.customer_name || r.name || 'عميل غير مسجل'),
        customerPhone: text(r.customer_phone || r.phone) || null, branch: r.branch || null, responsibleName: r.responsible_name || null,
        occurredAt: r.followup_datetime || r.followup_date || r.completed_at || null, result: text(r.followup_result || r.contact_result || r.followup_summary || r.followup_notes) || null,
        notes: text(r.notes || r.followup_notes) || null, purchaseAfter: r.purchase_after_followup == null ? null : asBool(r.purchase_after_followup), purchaseAmount: asNumber(r.purchase_amount),
        needsNext: r.needs_next_followup == null ? null : asBool(r.needs_next_followup), nextDate: r.next_followup_date || null,
        sourceFile: r.source_file || null, sourceSheet: r.source_sheet || null, sourceRow: r.source_row_number ?? null, linkedFollowupId: r.id,
      }));
      const linked: Row[] = (linkedR.data || []).map((r: any) => { const p = (r.event_payload || {}) as Record<string, unknown>; return {
        id: `linked:${r.id}`, kind: 'linked', customerCode: r.customer_code || text(p.customer_code_source) || null,
        customerName: text(p.matched_customer_name || p.customer_name_source || 'عميل غير مسجل'), customerPhone: text(p.customer_phone) || null,
        branch: r.branch || text(p.branch) || null, responsibleName: r.actor_name || text(p.responsible_staff_name) || null,
        occurredAt: text(p.historical_date) || r.created_at || null, result: text(p.historical_followup_result) || null, notes: text(p.historical_notes || r.event_note) || null,
        purchaseAfter: p.purchase_after_followup == null ? null : asBool(p.purchase_after_followup), purchaseAmount: asNumber(p.purchase_amount), needsNext: p.needs_next_followup == null ? null : asBool(p.needs_next_followup),
        nextDate: text(p.next_followup_date) || null, sourceFile: text(p.source_file) || null, sourceSheet: text(p.source_sheet) || null, sourceRow: asNumber(p.source_row_number), linkedFollowupId: r.followup_id || null,
      }; });
      const timeline: Row[] = (timelineR.data || []).map((r: any) => { const m = (r.metadata || {}) as Record<string, unknown>; const d = (r.details || {}) as Record<string, unknown>; return {
        id: `timeline:${r.id}`, kind: 'timeline', customerCode: r.customer_code || null, customerName: text(r.customer_name || 'عميل غير مسجل'), customerPhone: text(r.customer_phone) || null,
        branch: text(m.branch || d.branch) || null, responsibleName: text(m.responsible_staff_name || r.created_by_name) || null,
        occurredAt: text(m.historical_date || d.historical_date) || r.created_at || null, result: text(m.historical_followup_result || r.title) || null, notes: text(m.historical_notes || r.description) || null,
        purchaseAfter: m.purchase_after_followup == null ? null : asBool(m.purchase_after_followup), purchaseAmount: asNumber(m.purchase_amount), needsNext: m.needs_next_followup == null ? null : asBool(m.needs_next_followup),
        nextDate: text(m.next_followup_date) || null, sourceFile: text(m.source_file || d.source_file) || null, sourceSheet: text(m.source_sheet || d.source_sheet) || null, sourceRow: asNumber(m.source_row_number ?? d.source_row_number), linkedFollowupId: null,
      }; });
      setRows([...closed, ...linked, ...timeline].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime()));
    } catch (e) { toast.error(`تعذر تحميل السجل التاريخي: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({ total: rows.length, closed: rows.filter(r => r.kind === 'closed').length, linked: rows.filter(r => r.kind === 'linked').length, timeline: rows.filter(r => r.kind === 'timeline').length }), [rows]);
  const visible = useMemo(() => { const q = search.trim().toLowerCase(); return rows.filter(r => (filter === 'all' || r.kind === filter) && (branch === 'كل الفروع' || normBranch(r.branch) === normBranch(branch)) && (!q || `${r.customerName} ${r.customerCode || ''} ${r.customerPhone || ''} ${r.result || ''} ${r.notes || ''} ${r.sourceFile || ''}`.toLowerCase().includes(q))); }, [branch, filter, rows, search]);

  return <section className="mx-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div><div className="flex items-center gap-2 text-xs font-black text-cyan-300"><History size={17}/> السجل التاريخي الموحد</div><h2 className="mt-1 text-xl font-black text-white">المتابعات التاريخية المسجلة بتفاصيلها</h2><p className="mt-1 text-sm font-bold text-slate-400">للمراجعة والرجوع فقط؛ لا تدخل هذه السجلات في قائمة اليوم ولا تنشئ Follow-up مفتوحة.</p></div><button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> تحديث</button></div>
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{([['all','الإجمالي',counts.total,History],['closed','مغلقة',counts.closed,CheckCircle2],['linked','مرتبطة بحالة',counts.linked,Link2],['timeline','تاريخ العميل',counts.timeline,UserRound]] as const).map(([id,label,count,Icon]) => <button key={id} onClick={() => setFilter(id)} className={`rounded-2xl border p-3 text-right ${filter === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}><Icon size={18} className="mb-2 text-cyan-300"/><div className="text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{count}</div></button>)}</div>
    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الكود أو الهاتف أو الملف"/></div>{managerView ? <select className="input-dark" value={branch} onChange={e => setBranch(e.target.value)}><option>كل الفروع</option><option>فرع الشامي</option><option>فرع شكري</option></select> : null}</div>
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10"><table className="min-w-[1120px] w-full text-right text-xs"><thead className="bg-black/20 text-slate-300"><tr><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">الفرع</th><th className="p-3">المسؤول</th><th className="p-3">النوع</th><th className="p-3">النتيجة</th><th className="p-3">شراء</th><th className="p-3">المتابعة القادمة</th><th className="p-3">المصدر</th><th className="p-3"></th></tr></thead><tbody>{visible.map(r => { const info = kindInfo[r.kind]; return <tr key={r.id} className="border-t border-white/5 bg-white/[0.02] align-top text-slate-200 hover:bg-white/[0.045]"><td className="p-3 whitespace-nowrap">{fmtDate(r.occurredAt)}</td><td className="p-3"><div className="font-black text-white">{r.customerName}</div><div className="mt-1 text-slate-500">{r.customerCode || 'بدون كود'}{r.customerPhone ? ` · ${r.customerPhone}` : ''}</div></td><td className="p-3 whitespace-nowrap">{r.branch || 'غير محدد'}</td><td className="p-3 whitespace-nowrap">{r.responsibleName || 'غير محدد'}</td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-black ${info.tone}`}><info.Icon size={13}/>{info.label}</span></td><td className="p-3 max-w-60"><div className="font-bold text-white">{r.result || 'غير مسجل'}</div>{r.notes ? <div className="mt-1 text-slate-500">{r.notes}</div> : null}</td><td className="p-3 whitespace-nowrap">{r.purchaseAfter ? <span className="font-black text-emerald-300"><ShoppingCart size={14} className="ml-1 inline"/>{r.purchaseAmount != null ? formatCurrency(r.purchaseAmount) : 'نعم'}</span> : 'لا / غير مسجل'}</td><td className="p-3 whitespace-nowrap">{r.needsNext ? (r.nextDate || 'مطلوبة') : 'لا'}</td><td className="p-3 max-w-52"><div className="truncate" title={r.sourceFile || ''}>{r.sourceFile || 'سجل النظام'}</div>{r.sourceRow ? <div className="mt-1 text-slate-500">صف {r.sourceRow}</div> : null}</td><td className="p-3"><button className="btn-secondary p-2" onClick={() => setSelected(r)}><Eye size={15}/></button></td></tr>; })}</tbody></table>{!loading && visible.length === 0 ? <div className="p-8 text-center font-bold text-slate-400">لا توجد سجلات مطابقة.</div> : null}</div>
    {selected ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}><div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-cyan-300/20 bg-[#091b2d] p-5" onClick={e => e.stopPropagation()}><div className="flex justify-between gap-3"><div><div className="text-xs font-black text-cyan-300">تفاصيل المتابعة التاريخية</div><h3 className="mt-1 text-2xl font-black text-white">{selected.customerName}</h3><p className="text-sm text-slate-400">{selected.customerCode || 'بدون كود'} · {selected.branch || 'فرع غير محدد'}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}><X size={17}/></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['التاريخ',fmtDate(selected.occurredAt)],['المسؤول',selected.responsibleName || 'غير محدد'],['النتيجة',selected.result || 'غير مسجلة'],['الملاحظات',selected.notes || 'لا توجد'],['شراء بعد المتابعة',selected.purchaseAfter ? 'نعم' : 'لا / غير مسجل'],['قيمة الشراء',selected.purchaseAmount != null ? formatCurrency(selected.purchaseAmount) : 'غير مسجلة'],['هل يحتاج متابعة أخرى',selected.needsNext ? 'نعم' : 'لا'],['موعد المتابعة القادمة',selected.nextDate || 'غير محدد'],['ملف المصدر',selected.sourceFile || 'سجل النظام'],['Sheet / الصف',`${selected.sourceSheet || 'غير محدد'}${selected.sourceRow ? ` · صف ${selected.sourceRow}` : ''}`],['Follow-up مرتبط',selected.linkedFollowupId || 'لا يوجد'],['نوع الحفظ',kindInfo[selected.kind].label]].map(([l,v]) => <div key={l} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-[11px] font-black text-slate-500">{l}</div><div className="mt-1 break-words text-sm font-bold text-white">{v}</div></div>)}</div></div></div> : null}
  </section>;
}
