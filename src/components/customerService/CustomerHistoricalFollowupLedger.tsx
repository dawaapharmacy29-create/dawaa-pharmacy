import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, History, Link2, MessageCircleOff, PhoneOff, RefreshCw, Search, ShoppingCart, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Drawer, DrawerFieldGrid, SectionEmptyState, SectionSkeleton } from '@/components/customerService/SectionBoundary';

type Kind = 'closed' | 'linked' | 'timeline';
type KindFilter = 'all' | Kind;
type StatusFilter = 'all' | 'replied' | 'no_answer' | 'purchased' | 'needs_next';
type Row = {
  id: string; kind: Kind; customerCode: string | null; customerName: string; customerPhone: string | null;
  branch: string | null; responsibleName: string | null; occurredAt: string | null; result: string | null;
  notes: string | null; purchaseAfter: boolean | null; purchaseAmount: number | null; needsNext: boolean | null;
  nextDate: string | null; sourceFile: string | null; sourceSheet: string | null; sourceRow: number | null;
  linkedFollowupId: string | null; replied: boolean | null;
};

const PAGE_SIZE = 25;
const text = (v: unknown) => String(v ?? '').trim();
const asBool = (v: unknown) => v === true || v === 1 || v === '1' || /^(true|نعم|yes)$/i.test(text(v));
const asNumber = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmtDate = (v: string | null) => { if (!v) return 'غير محدد'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); };
const fmtDay = (v: string | null) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? v.slice(0, 10) : d.toISOString().slice(0, 10); };
const normBranch = (v: unknown) => normalizeBranchName(text(v));
const kindInfo: Record<Kind, { label: string; tone: string; Icon: typeof History }> = {
  closed: { label: 'متابعة تاريخية مغلقة', tone: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]', Icon: CheckCircle2 },
  linked: { label: 'حدث مرتبط بحالة حالية', tone: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]', Icon: Link2 },
  timeline: { label: 'تاريخ العميل', tone: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]', Icon: UserRound },
};

// نحدد "هل تم الرد" من النص المسجل فعليًا (النتيجة/الملاحظات/حالة التواصل) بدل افتراض قيمة —
// لو معندناش أي إشارة واضحة نرجّع null (غير مسجل) بدل ما نظلم السجل بـ "لا".
function deriveReplied(signalText: string, purchaseAfter: boolean | null): boolean | null {
  const combined = text(signalText);
  if (!combined) return purchaseAfter ? true : null;
  if (/لم يرد|لا يرد|no_answer|no answer/i.test(combined)) return false;
  if (/تم الرد|رد العميل|responded|replied/i.test(combined)) return true;
  return purchaseAfter ? true : null;
}

export default function CustomerHistoricalFollowupLedger() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normBranch(user?.branch || '');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [branch, setBranch] = useState(managerView ? 'كل الفروع' : userBranch);
  const [responsible, setResponsible] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    setError('');
    try {
      let closedQ = supabase.from('daily_followups')
        .select('id,customer_code,customer_name,name,customer_phone,phone,branch,responsible_name,followup_date,followup_datetime,completed_at,followup_result,contact_result,followup_summary,notes,followup_notes,response_status,contact_status,purchase_after_followup,purchase_amount,needs_next_followup,next_followup_date,source_file,source_sheet,source_row_number')
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

      const closed: Row[] = (closedR.data || []).map((r: any) => {
        const purchaseAfter = r.purchase_after_followup == null ? null : asBool(r.purchase_after_followup);
        const result = text(r.followup_result || r.contact_result || r.followup_summary || r.followup_notes) || null;
        const signal = `${result || ''} ${r.response_status || ''} ${r.contact_status || ''}`;
        return {
          id: `closed:${r.id}`, kind: 'closed' as const, customerCode: r.customer_code || null, customerName: text(r.customer_name || r.name || 'عميل غير مسجل'),
          customerPhone: text(r.customer_phone || r.phone) || null, branch: r.branch || null, responsibleName: r.responsible_name || null,
          occurredAt: r.followup_datetime || r.followup_date || r.completed_at || null, result,
          notes: text(r.notes || r.followup_notes) || null, purchaseAfter, purchaseAmount: asNumber(r.purchase_amount),
          needsNext: r.needs_next_followup == null ? null : asBool(r.needs_next_followup), nextDate: r.next_followup_date || null,
          sourceFile: r.source_file || null, sourceSheet: r.source_sheet || null, sourceRow: r.source_row_number ?? null, linkedFollowupId: r.id,
          replied: deriveReplied(signal, purchaseAfter),
        };
      });
      const linked: Row[] = (linkedR.data || []).map((r: any) => {
        const p = (r.event_payload || {}) as Record<string, unknown>;
        const purchaseAfter = p.purchase_after_followup == null ? null : asBool(p.purchase_after_followup);
        const result = text(p.historical_followup_result) || null;
        return {
          id: `linked:${r.id}`, kind: 'linked' as const, customerCode: r.customer_code || text(p.customer_code_source) || null,
          customerName: text(p.matched_customer_name || p.customer_name_source || 'عميل غير مسجل'), customerPhone: text(p.customer_phone) || null,
          branch: r.branch || text(p.branch) || null, responsibleName: r.actor_name || text(p.responsible_staff_name) || null,
          occurredAt: text(p.historical_date) || r.created_at || null, result, notes: text(p.historical_notes || r.event_note) || null,
          purchaseAfter, purchaseAmount: asNumber(p.purchase_amount), needsNext: p.needs_next_followup == null ? null : asBool(p.needs_next_followup),
          nextDate: text(p.next_followup_date) || null, sourceFile: text(p.source_file) || null, sourceSheet: text(p.source_sheet) || null, sourceRow: asNumber(p.source_row_number), linkedFollowupId: r.followup_id || null,
          replied: deriveReplied(`${result || ''} ${text(p.responded)} ${text(p.response_status)}`, purchaseAfter),
        };
      });
      const timeline: Row[] = (timelineR.data || []).map((r: any) => {
        const m = (r.metadata || {}) as Record<string, unknown>;
        const d = (r.details || {}) as Record<string, unknown>;
        const purchaseAfter = m.purchase_after_followup == null ? null : asBool(m.purchase_after_followup);
        const result = text(m.historical_followup_result || r.title) || null;
        return {
          id: `timeline:${r.id}`, kind: 'timeline' as const, customerCode: r.customer_code || null, customerName: text(r.customer_name || 'عميل غير مسجل'), customerPhone: text(r.customer_phone) || null,
          branch: text(m.branch || d.branch) || null, responsibleName: text(m.responsible_staff_name || r.created_by_name) || null,
          occurredAt: text(m.historical_date || d.historical_date) || r.created_at || null, result, notes: text(m.historical_notes || r.description) || null,
          purchaseAfter, purchaseAmount: asNumber(m.purchase_amount), needsNext: m.needs_next_followup == null ? null : asBool(m.needs_next_followup),
          nextDate: text(m.next_followup_date) || null, sourceFile: text(m.source_file || d.source_file) || null, sourceSheet: text(m.source_sheet || d.source_sheet) || null, sourceRow: asNumber(m.source_row_number ?? d.source_row_number), linkedFollowupId: null,
          replied: deriveReplied(`${result || ''} ${text(m.responded)} ${text(m.response_status)}`, purchaseAfter),
        };
      });
      setRows([...closed, ...linked, ...timeline].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime()));
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error(`تعذر تحميل سجل المتابعات: ${message}`);
    } finally { setLoading(false); }
  }, [managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({ total: rows.length, closed: rows.filter(r => r.kind === 'closed').length, linked: rows.filter(r => r.kind === 'linked').length, timeline: rows.filter(r => r.kind === 'timeline').length }), [rows]);
  const responsibleOptions = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((r) => { if (r.responsibleName) names.add(r.responsibleName); });
    return ['الكل', ...Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (branch !== 'كل الفروع' && normBranch(r.branch) !== normBranch(branch)) return false;
      if (responsible !== 'الكل' && (r.responsibleName || 'غير محدد') !== responsible) return false;
      if (dateFrom && fmtDay(r.occurredAt) < dateFrom) return false;
      if (dateTo && fmtDay(r.occurredAt) > dateTo) return false;
      if (statusFilter === 'replied' && r.replied !== true) return false;
      if (statusFilter === 'no_answer' && r.replied !== false) return false;
      if (statusFilter === 'purchased' && !r.purchaseAfter) return false;
      if (statusFilter === 'needs_next' && !r.needsNext) return false;
      if (q && !`${r.customerName} ${r.customerCode || ''} ${r.customerPhone || ''} ${r.result || ''} ${r.notes || ''} ${r.sourceFile || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [branch, dateFrom, dateTo, kindFilter, responsible, rows, search, statusFilter]);

  // أي فلتر يتغير نرجع لأول صفحة عشان المستخدم ميلاقيش نفسه واقف في نص نتائج قديمة.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [branch, dateFrom, dateTo, kindFilter, responsible, search, statusFilter]);
  const paged = visible.slice(0, visibleCount);

  if (loading && !rows.length) return <SectionSkeleton label="سجل المتابعات" rows={4} />;

  return <section className="rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-xl" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div><div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-primary)]"><History size={17}/> سجل المتابعات</div><h2 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">كل المتابعات التاريخية بتفاصيلها الكاملة</h2><p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">للمراجعة والرجوع فقط؛ هذه السجلات لا تظهر في «قائمة اليوم» ولا تُنشئ متابعة مفتوحة — تظهر هنا وفي تايم لاين العميل فقط.</p></div><button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> تحديث</button></div>

    {error ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3" role="alert"><div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-status-danger-text)]"><AlertTriangle size={16}/> تعذر تحميل السجل: {error.slice(0, 160)}</div><button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => void load()}><RefreshCw size={14}/> إعادة المحاولة</button></div> : null}

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{([['all','الإجمالي',counts.total,History,'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]'],['closed','مغلقة',counts.closed,CheckCircle2,'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'],['linked','مرتبطة بحالة',counts.linked,Link2,'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]'],['timeline','تاريخ العميل',counts.timeline,UserRound,'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]']] as const).map(([id,label,count,Icon,tone]) => <button key={id} onClick={() => setKindFilter(id)} className={`rounded-2xl border p-3 text-right ${kindFilter === id ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.03]'}`}><span className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}><Icon size={16}/></span><div className="mt-2 text-xs font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className="text-2xl font-black text-[var(--dawaa-theme-heading)]">{count}</div></button>)}</div>

    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
      <div className="relative xl:col-span-2"><Search size={17} className="absolute right-3 top-3 text-[var(--dawaa-theme-muted)]"/><input className="input-dark w-full pr-10" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الكود أو الهاتف"/></div>
      {managerView ? <select className="input-dark" value={branch} onChange={e => setBranch(e.target.value)} aria-label="فلتر الفرع"><option>كل الفروع</option><option>فرع الشامي</option><option>فرع شكري</option></select> : null}
      <select className="input-dark" value={responsible} onChange={e => setResponsible(e.target.value)} aria-label="فلتر المسؤول">{responsibleOptions.map((name) => <option key={name}>{name}</option>)}</select>
      <select className="input-dark" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} aria-label="فلتر الحالة">
        <option value="all">كل الحالات</option>
        <option value="replied">تم الرد</option>
        <option value="no_answer">لم يرد</option>
        <option value="purchased">تم الشراء</option>
        <option value="needs_next">يحتاج متابعة أخرى</option>
      </select>
      <div className="grid grid-cols-2 gap-2"><input type="date" className="input-dark" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="من تاريخ"/><input type="date" className="input-dark" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="إلى تاريخ"/></div>
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)]"><table className="min-w-[1280px] w-full text-right text-xs"><thead className="bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]"><tr><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">الفرع</th><th className="p-3">المسؤول</th><th className="p-3">النوع</th><th className="p-3">النتيجة</th><th className="p-3">تم الرد</th><th className="p-3">شراء</th><th className="p-3">المتابعة القادمة</th><th className="p-3">المصدر</th><th className="p-3"></th></tr></thead><tbody>{paged.map(r => { const info = kindInfo[r.kind]; const KindIcon = info.Icon; return <tr key={r.id} className="border-t border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.02] align-top text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface-2)]/[0.045]"><td className="p-3 whitespace-nowrap">{fmtDate(r.occurredAt)}</td><td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{r.customerName}</div><div className="mt-1 text-[var(--dawaa-theme-muted)]">{r.customerCode || 'بدون كود'}{r.customerPhone ? ` · ${r.customerPhone}` : ''}</div></td><td className="p-3 whitespace-nowrap">{r.branch || 'غير محدد'}</td><td className="p-3 whitespace-nowrap">{r.responsibleName || 'غير محدد'}</td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-black ${info.tone}`}><KindIcon size={13}/>{info.label}</span></td><td className="p-3 max-w-60"><div className="font-bold text-[var(--dawaa-theme-heading)]">{r.result || 'غير مسجل'}</div>{r.notes ? <div className="mt-1 text-[var(--dawaa-theme-muted)]">{r.notes}</div> : null}</td><td className="p-3 whitespace-nowrap">{r.replied === true ? <span className="inline-flex items-center gap-1 font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={13}/> نعم</span> : r.replied === false ? <span className="inline-flex items-center gap-1 font-black text-[var(--dawaa-status-danger-text)]"><PhoneOff size={13}/> لا</span> : <span className="inline-flex items-center gap-1 text-[var(--dawaa-theme-muted)]"><MessageCircleOff size={13}/> غير مسجل</span>}</td><td className="p-3 whitespace-nowrap">{r.purchaseAfter ? <span className="font-black text-[var(--dawaa-status-success-text)]"><ShoppingCart size={14} className="ml-1 inline"/>{r.purchaseAmount != null ? formatCurrency(r.purchaseAmount) : 'نعم'}</span> : 'لا / غير مسجل'}</td><td className="p-3 whitespace-nowrap">{r.needsNext ? (r.nextDate || 'مطلوبة') : 'لا'}</td><td className="p-3 max-w-52"><div className="truncate" title={r.sourceFile || ''}>{r.sourceFile || 'سجل النظام'}</div>{r.sourceRow ? <div className="mt-1 text-[var(--dawaa-theme-muted)]">صف {r.sourceRow}</div> : null}</td><td className="p-3"><button className="btn-secondary flex items-center gap-1 px-2" onClick={() => setSelected(r)}><Eye size={15}/> تفاصيل</button></td></tr>; })}</tbody></table>{!loading && visible.length === 0 ? <div className="p-2"><SectionEmptyState title="لا توجد سجلات مطابقة" description="جرّب توسيع نطاق البحث أو مسح الفلاتر." icon={History} /></div> : null}</div>
    {visible.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-secondary mt-2 w-full text-xs">عرض {Math.min(PAGE_SIZE, visible.length - visibleCount)} أخرى (من إجمالي {visible.length.toLocaleString('ar-EG')})</button> : null}

    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.customerName || ''} subtitle={`${selected?.customerCode || 'بدون كود'} · ${selected?.branch || 'فرع غير محدد'}`}>
      {selected ? <DrawerFieldGrid fields={[['التاريخ',fmtDate(selected.occurredAt)],['الهاتف',selected.customerPhone || 'غير مسجل'],['المسؤول',selected.responsibleName || 'غير محدد'],['النتيجة',selected.result || 'غير مسجلة'],['هل تم الرد',selected.replied === true ? 'نعم' : selected.replied === false ? 'لا' : 'غير مسجل'],['الملاحظات',selected.notes || 'لا توجد'],['هل حصل شراء',selected.purchaseAfter ? 'نعم' : 'لا / غير مسجل'],['قيمة الشراء',selected.purchaseAmount != null ? formatCurrency(selected.purchaseAmount) : 'غير مسجلة'],['هل يحتاج متابعة أخرى',selected.needsNext ? 'نعم' : 'لا'],['موعد المتابعة القادمة',selected.nextDate || 'غير محدد'],['ملف المصدر',selected.sourceFile || 'سجل النظام'],['Sheet / الصف',`${selected.sourceSheet || 'غير محدد'}${selected.sourceRow ? ` · صف ${selected.sourceRow}` : ''}`],['Follow-up مرتبط',selected.linkedFollowupId || 'لا يوجد'],['نوع السجل',kindInfo[selected.kind].label]]} /> : null}
    </Drawer>
  </section>;
}
