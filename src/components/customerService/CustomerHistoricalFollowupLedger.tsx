import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Eye, History, Link2, RefreshCw, Search, ShoppingCart, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

type LedgerKind = 'closed' | 'linked' | 'timeline';
type LedgerFilter = 'all' | LedgerKind;

type LedgerRow = {
  id: string;
  kind: LedgerKind;
  customerId: string | null;
  customerCode: string | null;
  customerName: string;
  customerPhone: string | null;
  branch: string | null;
  responsibleName: string | null;
  occurredAt: string | null;
  result: string | null;
  notes: string | null;
  purchaseAfterFollowup: boolean | null;
  purchaseAmount: number | null;
  needsNextFollowup: boolean | null;
  nextFollowupDate: string | null;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  linkedFollowupId: string | null;
  raw: Record<string, unknown>;
};

const text = (value: unknown) => String(value ?? '').trim();
const bool = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1' || /^(نعم|yes)$/i.test(text(value));
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const fmtDate = (value: string | null) => {
  if (!value) return 'غير محدد';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
};
const canonicalBranch = (value: unknown) => normalizeBranchName(text(value));

const kindCopy: Record<LedgerKind, { label: string; description: string; tone: string; icon: typeof History }> = {
  closed: { label: 'متابعة تاريخية مغلقة', description: 'سجل مكتمل محفوظ داخل المتابعات بدون إنشاء حالة مفتوحة.', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100', icon: CheckCircle2 },
  linked: { label: 'حدث مرتبط بحالة حالية', description: 'متابعة تاريخية محفوظة كحدث فقط؛ الحالة المفتوحة الحالية لم تتغير.', tone: 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100', icon: Link2 },
  timeline: { label: 'تاريخ العميل', description: 'واقعة تاريخية في Timeline العميل ولا تنشئ متابعة حالية.', tone: 'border-violet-300/30 bg-violet-400/10 text-violet-100', icon: History },
};

export default function CustomerHistoricalFollowupLedger() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = canonicalBranch(user?.branch || '');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [branch, setBranch] = useState(managerView ? 'كل الفروع' : userBranch);
  const [selected, setSelected] = useState<LedgerRow | null>(null);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      let closedQuery = supabase.from('daily_followups')
        .select('id,customer_id,customer_code,customer_name,name,customer_phone,phone,branch,responsible_name,assigned_to,followup_date,followup_datetime,completed_at,followup_result,contact_result,followup_summary,notes,followup_notes,purchase_after_followup,purchase_amount,needs_next_followup,next_followup_date,source_file,source_sheet,source_row_number,import_batch_id,import_source,import_metadata')
        .eq('import_source', 'historical_excel_import')
        .not('completed_at', 'is', null)
        .order('followup_date', { ascending: false })
        .limit(1000);
      if (!managerView && userBranch) closedQuery = closedQuery.eq('branch', userBranch);

      let eventQuery = supabase.from('customer_followup_events')
        .select('id,followup_id,customer_id,customer_code,event_type,event_note,event_payload,branch,actor_id,actor_name,created_at')
        .eq('event_type', 'historical_followup_event')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!managerView && userBranch) eventQuery = eventQuery.eq('branch', userBranch);

      const timelineQuery = supabase.from('customer_timeline_events')
        .select('id,customer_id,customer_code,customer_name,customer_phone,event_type,title,description,metadata,details,created_by,created_by_name,created_at')
        .eq('event_type', 'historical_customer_followup')
        .order('created_at', { ascending: false })
        .limit(1000);

      const [closedResult, eventResult, timelineResult] = await Promise.all([closedQuery, eventQuery, timelineQuery]);
      if (closedResult.error) throw closedResult.error;
      if (eventResult.error) throw eventResult.error;
      if (timelineResult.error) throw timelineResult.error;

      const closedRows: LedgerRow[] = (closedResult.data || []).map((row: any) => ({
        id: `closed:${row.id}`, kind: 'closed', customerId: row.customer_id || null, customerCode: row.customer_code || null,
        customerName: text(row.customer_name || row.name || 'عميل غير مسجل'), customerPhone: text(row.customer_phone || row.phone) || null,
        branch: row.branch || null, responsibleName: row.responsible_name || null,
        occurredAt: row.followup_datetime || row.followup_date || row.completed_at || null,
        result: text(row.followup_result || row.contact_result || row.followup_summary || row.followup_notes) || null,
        notes: text(row.notes || row.followup_notes) || null, purchaseAfterFollowup: row.purchase_after_followup === null ? null : bool(row.purchase_after_followup),
        purchaseAmount: num(row.purchase_amount), needsNextFollowup: row.needs_next_followup === null ? null : bool(row.needs_next_followup),
        nextFollowupDate: row.next_followup_date || null, sourceFile: row.source_file || null, sourceSheet: row.source_sheet || null,
        sourceRow: row.source_row_number ?? null, linkedFollowupId: row.id, raw: row,
      }));

      const linkedRows: LedgerRow[] = (eventResult.data || []).map((row: any) => {
        const p = (row.event_payload || {}) as Record<string, unknown>;
        return {
          id: `linked:${row.id}`, kind: 'linked', customerId: row.customer_id || null, customerCode: row.customer_code || text(p.customer_code) || null,
          customerName: text(p.customer_name || p.source_customer_name || 'عميل غير مسجل'), customerPhone: text(p.customer_phone) || null,
          branch: row.branch || text(p.branch) || null, responsibleName: row.actor_name || text(p.responsible_name) || null,
          occurredAt: text(p.historical_date || p.occurred_at) || row.created_at || null,
          result: text(p.historical_followup_result || p.followup_result || p.response_raw) || null,
          notes: text(row.event_note || p.historical_notes || p.source_note) || null,
          purchaseAfterFollowup: p.purchase_after_followup == null ? null : bool(p.purchase_after_followup), purchaseAmount: num(p.purchase_amount),
          needsNextFollowup: p.needs_next_followup == null ? null : bool(p.needs_next_followup), nextFollowupDate: text(p.next_followup_date) || null,
          sourceFile: text(p.source_file) || null, sourceSheet: text(p.source_sheet) || null, sourceRow: num(p.source_row_number),
          linkedFollowupId: row.followup_id || null, raw: row,
        };
      });

      const timelineRows: LedgerRow[] = (timelineResult.data || []).map((row: any) => {
        const m = (row.metadata || {}) as Record<string, unknown>;
        const d = (row.details || {}) as Record<string, unknown>;
        return {
          id: `timeline:${row.id}`, kind: 'timeline', customerId: row.customer_id || null, customerCode: row.customer_code || null,
          customerName: text(row.customer_name || m.customer_name || 'عميل غير مسجل'), customerPhone: text(row.customer_phone || m.customer_phone) || null,
          branch: text(m.branch || d.branch) || null, responsibleName: row.created_by_name || text(m.responsible_name) || null,
          occurredAt: text(m.historical_date || m.occurred_at || d.historical_date) || row.created_at || null,
          result: text(m.historical_followup_result || d.historical_followup_result || row.title) || null,
          notes: text(row.description || m.historical_notes || d.historical_notes) || null,
          purchaseAfterFollowup: (m.purchase_after_followup ?? d.purchase_after_followup) == null ? null : bool(m.purchase_after_followup ?? d.purchase_after_followup),
          purchaseAmount: num(m.purchase_amount ?? d.purchase_amount), needsNextFollowup: (m.needs_next_followup ?? d.needs_next_followup) == null ? null : bool(m.needs_next_followup ?? d.needs_next_followup),
          nextFollowupDate: text(m.next_followup_date || d.next_followup_date) || null, sourceFile: text(m.source_file || d.source_file) || null,
          sourceSheet: text(m.source_sheet || d.source_sheet) || null, sourceRow: num(m.source_row_number ?? d.source_row_number), linkedFollowupId: null, raw: row,
        };
      }).filter((row) => managerView || !userBranch || canonicalBranch(row.branch) === userBranch);

      const merged = [...closedRows, ...linkedRows, ...timelineRows].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime());
      setRows(merged);
    } catch (error) {
      toast.error(`تعذر تحميل السجل التاريخي: ${(error as Error).message}`);
    } finally { setLoading(false); }
  }, [managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    total: rows.length,
    closed: rows.filter((row) => row.kind === 'closed').length,
    linked: rows.filter((row) => row.kind === 'linked').length,
    timeline: rows.filter((row) => row.kind === 'timeline').length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.kind !== filter) return false;
      if (branch !== 'كل الفروع' && canonicalBranch(row.branch) !== canonicalBranch(branch)) return false;
      if (!q) return true;
      return `${row.customerName} ${row.customerCode || ''} ${row.customerPhone || ''} ${row.branch || ''} ${row.result || ''} ${row.notes || ''} ${row.sourceFile || ''}`.toLowerCase().includes(q);
    });
  }, [branch, filter, rows, search]);

  return <section className="mx-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-cyan-300"><History size={17}/> السجل التاريخي الموحد</div>
        <h2 className="mt-1 text-xl font-black text-white">كل المتابعات التاريخية المسجلة بتفاصيلها</h2>
        <p className="mt-1 text-sm font-bold text-slate-400">السجلات التاريخية لا تظهر في قائمة اليوم ولا تُنشئ مهام مفتوحة جديدة. هذا القسم للرجوع والمراجعة فقط.</p>
      </div>
      <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> تحديث السجل</button>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {([['all','الإجمالي',counts.total,History],['closed','مغلقة',counts.closed,CheckCircle2],['linked','مرتبطة بحالة',counts.linked,Link2],['timeline','تاريخ العميل',counts.timeline,UserRound]] as const).map(([id,label,count,Icon]) => <button key={id} onClick={() => setFilter(id)} className={`rounded-2xl border p-3 text-right ${filter === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}><Icon size={18} className="mb-2 text-cyan-300"/><div className="text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{count}</div></button>)}
    </div>

    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
      <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الكود أو الهاتف أو النتيجة أو الملف"/></div>
      {managerView ? <select className="input-dark" value={branch} onChange={(e) => setBranch(e.target.value)}><option>كل الفروع</option><option>فرع الشامي</option><option>فرع شكري</option></select> : null}
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="min-w-[1150px] w-full text-right text-xs">
        <thead className="bg-black/20 text-slate-300"><tr><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">الفرع</th><th className="p-3">المسؤول</th><th className="p-3">النوع</th><th className="p-3">النتيجة</th><th className="p-3">شراء بعد المتابعة</th><th className="p-3">المتابعة القادمة</th><th className="p-3">المصدر</th><th className="p-3">التفاصيل</th></tr></thead>
        <tbody>{visible.map((row) => { const copy = kindCopy[row.kind]; const Icon = copy.icon; return <tr key={row.id} className="border-t border-white/5 bg-white/[0.02] align-top text-slate-200 hover:bg-white/[0.045]">
          <td className="p-3 whitespace-nowrap"><CalendarDays size={14} className="ml-1 inline text-cyan-300"/>{fmtDate(row.occurredAt)}</td>
          <td className="p-3"><div className="font-black text-white">{row.customerName}</div><div className="mt-1 text-slate-500">{row.customerCode || 'بدون كود'}{row.customerPhone ? ` · ${row.customerPhone}` : ''}</div></td>
          <td className="p-3 whitespace-nowrap">{row.branch || 'غير محدد'}</td><td className="p-3 whitespace-nowrap">{row.responsibleName || 'غير محدد'}</td>
          <td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-black ${copy.tone}`}><Icon size={13}/>{copy.label}</span></td>
          <td className="p-3 max-w-64"><div className="font-bold text-white">{row.result || 'غير مسجل'}</div>{row.notes ? <div className="mt-1 line-clamp-2 text-slate-500">{row.notes}</div> : null}</td>
          <td className="p-3 whitespace-nowrap">{row.purchaseAfterFollowup ? <span className="font-black text-emerald-300"><ShoppingCart size={14} className="ml-1 inline"/>{row.purchaseAmount != null ? formatCurrency(row.purchaseAmount) : 'نعم'}</span> : 'لا / غير مسجل'}</td>
          <td className="p-3 whitespace-nowrap">{row.needsNextFollowup ? (row.nextFollowupDate || 'مطلوبة بدون تاريخ') : 'لا'}</td>
          <td className="p-3 max-w-56"><div className="truncate" title={row.sourceFile || ''}>{row.sourceFile || 'سجل النظام'}</div>{row.sourceRow ? <div className="mt-1 text-slate-500">صف {row.sourceRow}</div> : null}</td>
          <td className="p-3"><button className="btn-secondary p-2" onClick={() => setSelected(row)} title="عرض التفاصيل"><Eye size={15}/></button></td>
        </tr>; })}</tbody>
      </table>
      {!loading && visible.length === 0 ? <div className="p-8 text-center font-bold text-slate-400">لا توجد سجلات مطابقة للفلاتر الحالية.</div> : null}
    </div>

    {selected ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}><div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-cyan-300/20 bg-[#091b2d] p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-cyan-300">تفاصيل السجل التاريخي</div><h3 className="mt-1 text-2xl font-black text-white">{selected.customerName}</h3><p className="mt-1 text-sm text-slate-400">{selected.customerCode || 'بدون كود'} · {selected.branch || 'فرع غير محدد'}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}>إغلاق</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{[
        ['التاريخ', fmtDate(selected.occurredAt)], ['المسؤول', selected.responsibleName || 'غير محدد'], ['النتيجة', selected.result || 'غير مسجلة'], ['الملاحظات', selected.notes || 'لا توجد'],
        ['شراء بعد المتابعة', selected.purchaseAfterFollowup ? 'نعم' : 'لا / غير مسجل'], ['قيمة الشراء', selected.purchaseAmount != null ? formatCurrency(selected.purchaseAmount) : 'غير مسجلة'],
        ['هل يحتاج متابعة أخرى', selected.needsNextFollowup ? 'نعم' : 'لا'], ['موعد المتابعة القادمة', selected.nextFollowupDate || 'غير محدد'],
        ['ملف المصدر', selected.sourceFile || 'سجل النظام'], ['Sheet / الصف', `${selected.sourceSheet || 'غير محدد'}${selected.sourceRow ? ` · صف ${selected.sourceRow}` : ''}`],
        ['Follow-up مرتبط', selected.linkedFollowupId || 'لا يوجد'], ['نوع الحفظ', kindCopy[selected.kind].description],
      ].map(([label,value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-[11px] font-black text-slate-500">{label}</div><div className="mt-1 break-words text-sm font-bold text-white">{value}</div></div>)}</div>
    </div></div> : null}
  </section>;
}
