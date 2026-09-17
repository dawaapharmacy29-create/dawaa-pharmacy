import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
  saleCandidateCanBeHumanConfirmed,
  verifyFollowupSale,
  type FollowupSaleCandidate,
  type FollowupSaleVerification,
} from '@/lib/whatsappFollowupSalesVerification';

type FollowupRow = {
  id: string;
  created_at: string;
  evidence_timestamp?: string | null;
  branch: string | null;
  doctor_name: string | null;
  customer_name: string;
  customer_phone: string | null;
  signal_type: string;
  signal_type_label: string;
  evidence_quote: string;
  requested_product_name: string | null;
  alternative_offered: boolean | null;
  alternative_product_name: string | null;
  assigned_team: string;
  assigned_to: string | null;
  status: string;
  followup_notes: string | null;
  ai_confidence: number | null;
  matched_invoice_id?: string | null;
  matched_invoice_number?: string | null;
  matched_invoice_date?: string | null;
  matched_invoice_value?: number | null;
  sale_verification_confidence?: number | null;
  sale_verified_at?: string | null;
  sale_verified_by?: string | null;
};

type FollowupDraft = {
  assignedTo: string;
  notes: string;
};

const STATUS_OPTIONS = ['جديد', 'قيد المتابعة', 'تم التواصل', 'تم البيع', 'لم يتم الرد', 'ملغى'];

const SIGNAL_COLORS: Record<string, string> = {
  complaint: 'bg-red-950 text-red-300 border-red-800',
  sick_person: 'bg-amber-950 text-amber-300 border-amber-800',
  doctor_recommendation: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  missing_product: 'bg-sky-950 text-sky-300 border-sky-800',
  other_opportunity: 'bg-slate-800 text-slate-300 border-slate-700',
};

function normalizeSearch(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ar-EG');
}

function isMissingRpc(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false;
  return error.code === 'PGRST202' || /function.+not found|could not find the function/i.test(error.message || '');
}

async function listFollowups(status: string, signalType: string) {
  const params = { p_status: status || null, p_signal_type: signalType || null };
  const v2 = await supabase.rpc('whatsapp_auto_followup_list_v2', params);
  if (!v2.error || !isMissingRpc(v2.error)) return v2;
  return supabase.rpc('whatsapp_auto_followup_list_v1', params);
}

async function updateFollowupRpc(id: string, status: string, notes: string | null, assignedTo: string | null) {
  const params = { p_id: id, p_status: status, p_notes: notes, p_assigned_to: assignedTo };
  const v2 = await supabase.rpc('whatsapp_auto_followup_update_status_v2', params);
  if (!v2.error || !isMissingRpc(v2.error)) return v2;
  return supabase.rpc('whatsapp_auto_followup_update_status_v1', params);
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return '-';
  return value.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function invoiceDateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function WhatsAppAutoFollowupRequests() {
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [signalFilter, setSignalFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saleBusyId, setSaleBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FollowupDraft>>({});
  const [saleChecks, setSaleChecks] = useState<Record<string, FollowupSaleVerification>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listFollowups(statusFilter, signalFilter);
    if (error) {
      toast.error(error.message);
    } else {
      const nextRows = (data || []) as FollowupRow[];
      setRows(nextRows);
      setDrafts((current) => {
        const next = { ...current };
        for (const row of nextRows) {
          if (!next[row.id]) next[row.id] = { assignedTo: row.assigned_to || '', notes: row.followup_notes || '' };
        }
        return next;
      });
    }
    setLoading(false);
  }, [statusFilter, signalFilter]);

  useEffect(() => { void load(); }, [load]);

  const branches = useMemo(() => Array.from(new Set(rows.map((row) => row.branch).filter(Boolean) as string[])).sort(), [rows]);

  const visibleRows = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    return rows.filter((row) => {
      if (branchFilter && row.branch !== branchFilter) return false;
      if (!query) return true;
      return [
        row.customer_name,
        row.customer_phone,
        row.doctor_name,
        row.signal_type_label,
        row.evidence_quote,
        row.requested_product_name,
        row.alternative_product_name,
        row.assigned_to,
        row.followup_notes,
        row.matched_invoice_number,
        row.sale_verified_by,
      ].some((value) => normalizeSearch(value).includes(query));
    });
  }, [rows, branchFilter, searchQuery]);

  const stats = useMemo(() => ({
    newCount: visibleRows.filter((row) => row.status === 'جديد').length,
    activeCount: visibleRows.filter((row) => row.status === 'قيد المتابعة').length,
    contactedCount: visibleRows.filter((row) => row.status === 'تم التواصل').length,
    soldCount: visibleRows.filter((row) => row.status === 'تم البيع').length,
  }), [visibleRows]);

  function setDraft(id: string, patch: Partial<FollowupDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        assignedTo: current[id]?.assignedTo || '',
        notes: current[id]?.notes || '',
        ...patch,
      },
    }));
  }

  async function updateFollowup(id: string, status: string, includeDraft = false) {
    if (status === 'تم البيع') {
      toast.warning('اعتماد البيع لازم يتم من الفاتورة المطابقة وليس من تغيير الحالة مباشرة');
      return;
    }
    setBusyId(id);
    try {
      const draft = drafts[id];
      const { error } = await updateFollowupRpc(
        id,
        status,
        includeDraft ? (draft?.notes.trim() || null) : null,
        includeDraft ? (draft?.assignedTo.trim() || null) : null,
      );
      if (error) throw error;
      toast.success(includeDraft ? 'تم حفظ بيانات المتابعة' : 'تم تحديث الحالة');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحديث');
    } finally {
      setBusyId(null);
    }
  }

  async function checkSale(row: FollowupRow) {
    setSaleBusyId(row.id);
    try {
      const verification = await verifyFollowupSale({
        customerPhone: row.customer_phone,
        customerName: row.customer_name,
        branch: row.branch,
        signalAt: row.evidence_timestamp || row.created_at,
        windowDays: 14,
      });
      setSaleChecks((current) => ({ ...current, [row.id]: verification }));
      if (verification.status === 'verified_candidate') toast.success('تم العثور على فاتورة قوية المطابقة بعد المتابعة');
      else if (verification.status === 'weak_candidate') toast.info('تم العثور على فاتورة محتملة وتحتاج بيانات أقوى قبل اعتماد البيع');
      else if (verification.status === 'insufficient_identity') toast.warning('بيانات العميل غير كافية للتحقق من البيع');
      else toast.info('لم تظهر فاتورة مطابقة داخل نافذة التحقق');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحقق من المبيعات');
    } finally {
      setSaleBusyId(null);
    }
  }

  async function confirmSale(row: FollowupRow, candidate: FollowupSaleCandidate) {
    if (!saleCandidateCanBeHumanConfirmed(candidate)) {
      toast.warning('درجة المطابقة غير كافية لاعتماد البيع');
      return;
    }
    setBusyId(row.id);
    try {
      const draft = drafts[row.id];
      const { error } = await supabase.rpc('whatsapp_auto_followup_confirm_sale_v1', {
        p_id: row.id,
        p_invoice_id: candidate.invoiceId,
        p_invoice_number: candidate.invoiceNumber,
        p_invoice_date: invoiceDateOnly(candidate.invoiceDate),
        p_invoice_value: candidate.amount,
        p_confidence: candidate.confidence,
        p_notes: draft?.notes.trim() || null,
      });
      if (error) {
        if (isMissingRpc(error)) {
          toast.error('مسار حفظ دليل البيع موجود في التطوير لكنه لم يُطبّق على قاعدة البيانات بعد');
          return;
        }
        throw error;
      }
      toast.success('تم اعتماد البيع وربطه بالفاتورة وحفظ دليل المطابقة');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد البيع');
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    const headers = ['التاريخ', 'الفرع', 'الدكتور', 'العميل', 'الهاتف', 'نوع الإشارة', 'الدليل', 'الصنف المطلوب', 'اتعرض بديل؟', 'البديل', 'الحالة', 'رقم فاتورة البيع', 'قيمة البيع', 'ثقة الربط', 'اعتمد بواسطة', 'المسؤول', 'ملاحظات'];
    const lines = [headers.join(',')];
    for (const row of visibleRows) {
      lines.push([
        new Date(row.evidence_timestamp || row.created_at).toLocaleDateString('ar-EG'),
        row.branch || '',
        row.doctor_name || '',
        row.customer_name,
        row.customer_phone || '',
        row.signal_type_label,
        `"${(row.evidence_quote || '').replace(/"/g, '""')}"`,
        row.requested_product_name || '',
        row.alternative_offered == null ? '' : row.alternative_offered ? 'نعم' : 'لا',
        `"${(row.alternative_product_name || '').replace(/"/g, '""')}"`,
        row.status,
        row.matched_invoice_number || '',
        row.matched_invoice_value ?? '',
        row.sale_verification_confidence == null ? '' : `${Math.round(row.sale_verification_confidence * 100)}%`,
        row.sale_verified_by || '',
        row.assigned_to || row.assigned_team || '',
        `"${(row.followup_notes || '').replace(/"/g, '""')}"`,
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `طلبات-متابعة-الواتساب-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">طلبات المتابعة الآلية من محادثات الواتساب</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">طابور تشغيلي للحالات التي التقطها التحليل تلقائيًا. البيع لا يُعتمد آليًا: لازم توجد فاتورة قوية المطابقة ثم يعتمدها المراجع بشريًا.</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">جديد</div><div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{stats.newCount.toLocaleString('ar-EG')}</div></div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"><div className="text-[11px] font-bold text-amber-300">قيد المتابعة</div><div className="mt-1 text-2xl font-black text-amber-200">{stats.activeCount.toLocaleString('ar-EG')}</div></div>
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3"><div className="text-[11px] font-bold text-sky-300">تم التواصل</div><div className="mt-1 text-2xl font-black text-sky-200">{stats.contactedCount.toLocaleString('ar-EG')}</div></div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3"><div className="text-[11px] font-bold text-emerald-300">تم البيع الموثق</div><div className="mt-1 text-2xl font-black text-emerald-200">{stats.soldCount.toLocaleString('ar-EG')}</div></div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 lg:max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="بحث بالعميل، الهاتف، الدكتور، الصنف أو رقم الفاتورة" className="input-dark w-full pr-9 text-xs" />
          </div>
          <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)} className="input-dark text-xs">
            <option value="">كل الأنواع</option>
            <option value="complaint">شكوى عميل</option>
            <option value="sick_person">حالة مريض بالمنزل</option>
            <option value="doctor_recommendation">ترشيح دكتور</option>
            <option value="missing_product">صنف غير متوفر</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="input-dark text-xs">
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="input-dark text-xs">
            <option value="">كل الفروع</option>
            {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <button type="button" onClick={exportCsv} className="btn-secondary text-xs">تصدير Excel (CSV)</button>
          <span className="mr-auto text-xs font-bold text-[var(--dawaa-theme-muted)]">{visibleRows.length.toLocaleString('ar-EG')} من {rows.length.toLocaleString('ar-EG')} صف</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--dawaa-theme-surface-2)]">
            <tr>
              {['التاريخ', 'الفرع', 'العميل / الهاتف', 'الدكتور', 'النوع', 'الدليل من المحادثة', 'الصنف / البديل', 'التحقق من البيع', 'الحالة', 'المتابعة'].map((header) => (
                <th key={header} className="whitespace-nowrap p-2.5 text-right font-black text-[var(--dawaa-theme-heading)]">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ التحميل...</td></tr>}
            {!loading && !visibleRows.length && <tr><td colSpan={10} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات متابعة مطابقة للفلاتر الحالية.</td></tr>}
            {visibleRows.map((row) => {
              const draft = drafts[row.id] || { assignedTo: row.assigned_to || '', notes: row.followup_notes || '' };
              const saleCheck = saleChecks[row.id];
              const bestSale = saleCheck?.candidates[0];
              const canConfirmSale = saleCandidateCanBeHumanConfirmed(bestSale);
              const statusOptions = row.status === 'تم البيع' ? STATUS_OPTIONS : STATUS_OPTIONS.filter((status) => status !== 'تم البيع');
              return (
                <tr key={row.id} className="border-t border-[var(--dawaa-theme-border)] align-top">
                  <td className="whitespace-nowrap p-2.5 font-bold text-[var(--dawaa-theme-muted)]">{new Date(row.evidence_timestamp || row.created_at).toLocaleDateString('ar-EG')}</td>
                  <td className="whitespace-nowrap p-2.5">{row.branch || '-'}</td>
                  <td className="whitespace-nowrap p-2.5 font-black text-[var(--dawaa-theme-heading)]">{row.customer_name}<div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.customer_phone || '-'}</div></td>
                  <td className="whitespace-nowrap p-2.5 font-bold text-[var(--dawaa-theme-muted)]">{row.doctor_name || '-'}</td>
                  <td className="whitespace-nowrap p-2.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${SIGNAL_COLORS[row.signal_type] || SIGNAL_COLORS.other_opportunity}`}>{row.signal_type_label}</span><div className="mt-2 text-[10px] text-[var(--dawaa-theme-muted)]">ثقة {row.ai_confidence == null ? '-' : `${Math.round(row.ai_confidence * 100)}%`}</div></td>
                  <td className="max-w-[300px] p-2.5 leading-6 text-[var(--dawaa-theme-muted)]">{row.evidence_quote}</td>
                  <td className="max-w-[240px] p-2.5 text-[var(--dawaa-theme-muted)]">
                    {row.requested_product_name && <div>مطلوب: <b className="text-[var(--dawaa-theme-heading)]">{row.requested_product_name}</b></div>}
                    {row.alternative_offered != null && <div className={row.alternative_offered ? 'text-emerald-400' : 'text-red-400'}>{row.alternative_offered ? '✓ اتعرض بديل' : '✗ مفيش بديل اتعرض'}</div>}
                    {row.alternative_product_name && <div className="mt-1 text-[10px]">البديل: {row.alternative_product_name}</div>}
                  </td>
                  <td className="min-w-[200px] p-2.5">
                    {row.matched_invoice_id ? (
                      <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-2 text-[10px] leading-5">
                        <div className="flex items-center gap-1 font-black text-emerald-200"><BadgeCheck size={12} /> بيع موثق</div>
                        <div className="mt-1">فاتورة: {row.matched_invoice_number || row.matched_invoice_id}</div>
                        <div>القيمة: {formatMoney(row.matched_invoice_value)} ج</div>
                        <div>اعتماد: {row.sale_verified_by || '-'}</div>
                      </div>
                    ) : (
                      <>
                        <button type="button" disabled={saleBusyId === row.id} onClick={() => void checkSale(row)} className="w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-black text-emerald-100 disabled:opacity-50">{saleBusyId === row.id ? 'جاري التحقق...' : 'تحقق من الفواتير'}</button>
                        {saleCheck ? (
                          <div className="mt-2 rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2 text-[10px] leading-5">
                            {bestSale ? (
                              <>
                                <div className={`flex items-center gap-1 font-black ${canConfirmSale ? 'text-emerald-300' : 'text-amber-300'}`}><BadgeCheck size={12} /> فاتورة مرشحة {Math.round(bestSale.confidence * 100)}%</div>
                                <div className="mt-1 text-[var(--dawaa-theme-muted)]">رقم: {bestSale.invoiceNumber || '-'}</div>
                                <div className="text-[var(--dawaa-theme-muted)]">القيمة: {formatMoney(bestSale.amount)} ج</div>
                                <div className="text-[var(--dawaa-theme-muted)]">التاريخ: {new Date(bestSale.invoiceDate).toLocaleDateString('ar-EG')}</div>
                                <div className="mt-1 text-amber-200">{canConfirmSale ? 'مرشح قوي — يحتاج اعتماد بشري.' : 'المطابقة غير كافية لاعتماد البيع.'}</div>
                              </>
                            ) : <div className="text-[var(--dawaa-theme-muted)]">لا توجد فاتورة مطابقة داخل نافذة 14 يومًا.</div>}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-2.5">
                    <select value={row.status} disabled={busyId === row.id} onChange={(event) => void updateFollowup(row.id, event.target.value)} className="input-dark text-[10px]">
                      {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    {row.status === 'جديد' ? <button type="button" disabled={busyId === row.id} onClick={() => void updateFollowup(row.id, 'قيد المتابعة')} className="mt-2 block w-full rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-[10px] font-black text-amber-200 disabled:opacity-50">ابدأ المتابعة</button> : null}
                    {canConfirmSale && bestSale && row.status !== 'تم البيع' ? <button type="button" disabled={busyId === row.id} onClick={() => void confirmSale(row, bestSale)} className="mt-2 block w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-black text-emerald-200 disabled:opacity-50">اعتماد البيع وربط الفاتورة</button> : null}
                  </td>
                  <td className="min-w-[240px] p-2.5">
                    <input value={draft.assignedTo} onChange={(event) => setDraft(row.id, { assignedTo: event.target.value })} placeholder="اسم المسؤول عن المتابعة" className="input-dark w-full text-[10px]" />
                    <textarea value={draft.notes} onChange={(event) => setDraft(row.id, { notes: event.target.value })} placeholder="ملاحظة المتابعة أو نتيجة التواصل" rows={2} className="input-dark mt-2 w-full resize-y text-[10px]" />
                    <button type="button" disabled={busyId === row.id} onClick={() => void updateFollowup(row.id, row.status, true)} className="mt-2 w-full rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-black text-cyan-100 disabled:opacity-50">حفظ المسؤول والملاحظة</button>
                    <div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الفريق: {row.assigned_team || '-'}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
