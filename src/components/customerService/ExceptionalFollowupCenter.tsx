import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Eye, FileSpreadsheet, Filter, RefreshCw, Search, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { formatFollowupDetailText } from '@/lib/followupFormat';
import {
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  updateFollowupResult,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import type { FollowupResultData } from '@/components/customerService/FollowupResultModal';

const FollowupResultModal = lazy(() => import('@/components/customerService/FollowupResultModal'));
const CustomerQuickDetailsModal = lazy(() => import('@/components/customers/CustomerQuickDetailsModal'));

const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const OWNERS: Record<string, string> = { 'فرع الشامي': 'د/ ضحى', 'فرع شكري': 'د/ دنيا' };
const STATUS_OPTIONS = ['الكل', 'جديد', 'قيد التنفيذ', 'تم', 'لم يرد', 'مؤجل', 'يحتاج مدير'];
const CONTACT_METHODS = ['الكل', 'اتصال', 'واتساب', 'رسالة', 'زيارة'];

type RecordMode = 'executed' | 'requests';
type ImportPreview = { rows: Record<string, unknown>[]; valid: number; invalid: number; errors: string[] };

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function rowDate(row: FollowupRow) {
  return String(row.contacted_at || row.completed_at || row.followup_datetime || row.followup_date || row.created_at || row.date || '').slice(0, 10);
}
function rowStatus(row: FollowupRow) {
  const raw = String(row.followup_status || row.status || row.contact_status || row.request_status || '').trim();
  const map: Record<string, string> = {
    pending: 'جديد', new: 'جديد', in_progress: 'قيد التنفيذ', attempted: 'قيد التنفيذ',
    completed: 'تم', done: 'تم', no_answer: 'لم يرد', postponed: 'مؤجل', needs_manager: 'يحتاج مدير',
  };
  return map[raw] || raw || 'جديد';
}
function isExceptional(row: FollowupRow) {
  return /استثنائي|exceptional|doctor_requested_followup|excel_followup_command|طلب دكتور|أمر متابعة/i.test(
    `${row.request_type || ''} ${row.followup_type || ''} ${row.followup_reason || ''} ${row.request_details || ''} ${row.notes || ''}`
  );
}
function isExecuted(row: FollowupRow) {
  return Boolean(row.contacted_at || row.completed_at || row.followup_summary || row.followup_result || row.contact_result);
}
function value(row: FollowupRow, ...keys: Array<keyof FollowupRow>) {
  for (const key of keys) {
    const current = row[key];
    if (current !== null && current !== undefined && String(current).trim()) return String(current);
  }
  return '';
}
function parseBool(value: unknown) {
  return ['1', 'true', 'yes', 'نعم', 'تم'].includes(String(value || '').trim().toLowerCase());
}
function excelDate(value: unknown) {
  if (!value) return localDate();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? localDate() : localDate(date);
}
function field(row: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const found = Object.keys(row).find((key) => key.trim().toLowerCase() === name.trim().toLowerCase());
    if (found && row[found] !== undefined && row[found] !== null) return String(row[found]).trim();
  }
  return '';
}

export default function ExceptionalFollowupCenter() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const lockedBranch = normalizeBranchName(user?.branch || '');
  const [mode, setMode] = useState<RecordMode>('executed');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState(managerView ? 'الكل' : lockedBranch || 'فرع الشامي');
  const [owner, setOwner] = useState('الكل');
  const [requester, setRequester] = useState('الكل');
  const [status, setStatus] = useState('الكل');
  const [contactMethod, setContactMethod] = useState('الكل');
  const [resultCompleteness, setResultCompleteness] = useState('الكل');
  const [purchase, setPurchase] = useState('الكل');
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [executeRow, setExecuteRow] = useState<FollowupRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<FollowupRow | null>(null);
  const [saving, setSaving] = useState(false);

  const saveExecution = async (result: FollowupResultData) => {
    if (!executeRow) return;
    setSaving(true);
    try {
      const purchase = result.result === 'تم الشراء بعد المتابعة';
      await updateFollowupResult(executeRow.id, {
        followup_status: result.result,
        status: result.result,
        contact_result: result.result,
        followup_result: result.result,
        followup_notes: result.notes,
        quality_rating: result.qualityRating,
        internal_rating: result.internalRating,
        needs_next_followup: result.needsNextFollowup,
        next_followup_date: result.needsNextFollowup ? result.nextFollowupDate : null,
        purchase_after_followup: purchase,
        purchase_amount: result.purchaseAmount,
        purchase_invoice_no: result.invoiceNumber,
        customer_satisfaction: result.customerSatisfaction || (result.customerSatisfied ? 'راضي' : null),
        contacted_at: new Date().toISOString(),
        evaluated_by_name: user?.name || null,
        evaluated_at: new Date().toISOString(),
      });
      toast.success('تم تسجيل تنفيذ المتابعة');
      setExecuteRow(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ نتيجة المتابعة');
    } finally {
      setSaving(false);
    }
  };
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const fetchBranch = branch === 'الكل' ? undefined : branch;
      const data = await fetchCustomerServiceFollowups({ branch: fetchBranch, limit: 2000, strict: true });
      setRows(data.filter(isExceptional));
    } catch (error) {
      console.error(error);
      toast.error('تعذر تحميل المتابعات الاستثنائية');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [branch]);

  const requesters = useMemo(() => [...new Set(rows.map((row) => value(row, 'created_by_name', 'assigned_doctor', 'responsible_name')).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const executed = isExecuted(row);
    if (mode === 'executed' ? !executed : executed) return false;
    if (branch !== 'الكل' && normalizeBranchName(row.branch || '') !== branch) return false;
    const date = rowDate(row);
    if (from && date && date < from) return false;
    if (to && date && date > to) return false;
    const assignedOwner = value(row, 'responsible_name', 'assigned_doctor') || OWNERS[normalizeBranchName(row.branch || '')];
    if (owner !== 'الكل' && assignedOwner !== owner) return false;
    const requestedBy = value(row, 'created_by_name', 'assigned_doctor', 'responsible_name');
    if (requester !== 'الكل' && requestedBy !== requester) return false;
    if (status !== 'الكل' && rowStatus(row) !== status) return false;
    if (contactMethod !== 'الكل' && value(row, 'contact_method') !== contactMethod) return false;
    const hasDetails = Boolean(value(row, 'followup_summary', 'followup_result', 'contact_result', 'followup_notes', 'notes'));
    if (resultCompleteness === 'مكتمل التفاصيل' && !hasDetails) return false;
    if (resultCompleteness === 'بدون تفاصيل' && hasDetails) return false;
    if (purchase === 'تم شراء' && !row.purchase_after_followup) return false;
    if (purchase === 'لم يشترِ' && row.purchase_after_followup) return false;
    const haystack = `${row.customer_name || row.name || ''} ${row.customer_code || ''} ${row.customer_phone || row.phone || ''} ${requestedBy} ${row.followup_summary || ''} ${row.followup_result || ''} ${row.notes || ''}`.toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [rows, mode, branch, from, to, owner, requester, status, contactMethod, resultCompleteness, purchase, search]);

  const stats = useMemo(() => ({
    total: filtered.length,
    done: filtered.filter((row) => rowStatus(row) === 'تم').length,
    noAnswer: filtered.filter((row) => rowStatus(row) === 'لم يرد').length,
    postponed: filtered.filter((row) => rowStatus(row) === 'مؤجل').length,
    purchase: filtered.filter((row) => row.purchase_after_followup).length,
    missing: filtered.filter((row) => !value(row, 'followup_summary', 'followup_result', 'contact_result', 'followup_notes', 'notes')).length,
  }), [filtered]);

  function setPreset(kind: 'today' | 'yesterday' | '7d' | 'month' | 'cycle') {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    if (kind === 'yesterday') { start.setDate(start.getDate() - 1); end = new Date(start); }
    if (kind === '7d') start.setDate(start.getDate() - 6);
    if (kind === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
    if (kind === 'cycle') start = now.getDate() >= 26 ? new Date(now.getFullYear(), now.getMonth(), 26) : new Date(now.getFullYear(), now.getMonth() - 1, 26);
    setFrom(localDate(start)); setTo(localDate(end));
  }

  async function readExcel(file: File) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const errors: string[] = [];
    let valid = 0;
    parsed.forEach((row, index) => {
      const name = field(row, 'اسم العميل', 'customer_name', 'name');
      const rowBranch = normalizeBranchName(field(row, 'الفرع', 'branch'));
      if (!name) errors.push(`صف ${index + 2}: اسم العميل مطلوب`);
      else if (!BRANCHES.includes(rowBranch)) errors.push(`صف ${index + 2}: الفرع غير صحيح`);
      else valid += 1;
    });
    setPreview({ rows: parsed, valid, invalid: parsed.length - valid, errors });
  }

  async function importRows() {
    if (!preview?.rows.length) return;
    setImporting(true);
    let imported = 0;
    let failed = 0;
    for (const source of preview.rows) {
      const customerName = field(source, 'اسم العميل', 'customer_name', 'name');
      const rowBranch = normalizeBranchName(field(source, 'الفرع', 'branch'));
      if (!customerName || !BRANCHES.includes(rowBranch)) { failed += 1; continue; }
      try {
        const created = await createExceptionalFollowup({
          customerName,
          customerPhone: field(source, 'الهاتف', 'phone', 'customer_phone'),
          customerCode: field(source, 'كود العميل', 'customer_code'),
          branch: rowBranch,
          priority: field(source, 'الأولوية', 'priority') || 'مهم',
          requestType: field(source, 'نوع السجل', 'request_type') || 'excel_followup_command',
          followupReason: field(source, 'سبب المتابعة', 'followup_reason') || 'متابعة استثنائية مستوردة',
          assignedDoctor: field(source, 'دكتورة خدمة العملاء', 'assigned_doctor') || OWNERS[rowBranch],
          followupDatetime: excelDate(field(source, 'تاريخ المتابعة', 'followup_date', 'date')),
          requestDetails: field(source, 'تفاصيل الطلب', 'request_details'),
          notes: field(source, 'الملاحظات', 'notes'),
          createdBy: user?.id || null,
          createdByName: field(source, 'مقدم الطلب', 'created_by_name') || user?.name || 'استيراد Excel',
          source: 'excel_followup_command',
        });
        const result = field(source, 'النتيجة', 'followup_result', 'ما تم مع العميل');
        const summary = field(source, 'ما تم مع العميل', 'followup_summary');
        const statusValue = field(source, 'الحالة', 'status', 'followup_status');
        if (created?.id && (result || summary || statusValue)) {
          await updateFollowupResult(created.id, {
            contact_method: field(source, 'طريقة التواصل', 'contact_method') || null,
            contact_result: field(source, 'رد العميل', 'contact_result') || null,
            followup_result: result || null,
            followup_summary: summary || result || null,
            followup_notes: field(source, 'الملاحظات', 'followup_notes', 'notes') || null,
            followup_status: statusValue || 'تم',
            status: statusValue || 'تم',
            purchase_after_followup: parseBool(field(source, 'شراء بعد المتابعة', 'purchase_after_followup')),
            purchase_amount: Number(field(source, 'قيمة الشراء', 'purchase_amount') || 0) || null,
            next_followup_date: field(source, 'موعد المتابعة القادمة', 'next_followup_date') || null,
            completed_at: ['تم', 'completed', 'done'].includes(statusValue) || result ? new Date().toISOString() : null,
            updated_by: user?.id || null,
          });
        }
        imported += 1;
      } catch (error) {
        console.error(error);
        failed += 1;
      }
    }
    setImporting(false);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
    toast.success(`تم استيراد ${imported} متابعة${failed ? ` وتعذر ${failed}` : ''}`);
    window.dispatchEvent(new CustomEvent('customer-followup-imported'));
    await load();
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const data = filtered.map((row) => ({
      'اسم العميل': row.customer_name || row.name || '', 'كود العميل': row.customer_code || '',
      الهاتف: row.customer_phone || row.phone || '', الفرع: normalizeBranchName(row.branch || ''),
      'نوع السجل': mode === 'executed' ? 'متابعة منفذة' : 'طلب متابعة',
      'مقدم الطلب': value(row, 'created_by_name', 'assigned_doctor'),
      'دكتورة خدمة العملاء': value(row, 'responsible_name', 'assigned_doctor') || OWNERS[normalizeBranchName(row.branch || '')],
      التاريخ: rowDate(row), الحالة: rowStatus(row), 'طريقة التواصل': row.contact_method || '',
      'ما تم مع العميل': row.followup_summary || '', 'رد العميل': row.contact_result || '',
      النتيجة: row.followup_result || '', 'شراء بعد المتابعة': row.purchase_after_followup ? 'نعم' : 'لا',
      'قيمة الشراء': row.purchase_amount || 0, الملاحظات: row.followup_notes || row.notes || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'المتابعات الاستثنائية');
    XLSX.writeFile(wb, `exceptional-followups-${localDate()}.xlsx`);
  }

  return <section className="rounded-3xl border border-amber-300/20 bg-[#0b2035] p-4 shadow-xl md:p-6" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div><div className="flex items-center gap-2 text-amber-300"><Sparkles size={20}/><span className="text-sm font-black">المركز المتخصص</span></div><h2 className="mt-1 text-2xl font-black text-white">المتابعات الاستثنائية وطلبات الفريق</h2><p className="mt-1 text-sm font-bold text-slate-400">فصل كامل بين ما نفذته دكتورة خدمة العملاء وما طلبه دكاترة الفرع.</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => void load()} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-black text-white"><RefreshCw className="ml-1 inline" size={15}/>تحديث</button><button onClick={() => inputRef.current?.click()} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-slate-950"><Upload className="ml-1 inline" size={15}/>استيراد Excel</button><button onClick={() => void exportExcel()} className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-black text-slate-950"><Download className="ml-1 inline" size={15}/>تصدير النتائج</button><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readExcel(file); }}/></div>
    </div>

    <div className="mt-5 grid gap-2 md:grid-cols-2"><button onClick={() => setMode('executed')} className={`rounded-2xl border p-4 text-right ${mode === 'executed' ? 'border-emerald-300/60 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]'}`}><span className="block font-black text-white">المتابعات الاستثنائية المنفذة</span><span className="text-xs font-bold text-slate-400">ما تم مع العميل والنتيجة والإجراء القادم</span></button><button onClick={() => setMode('requests')} className={`rounded-2xl border p-4 text-right ${mode === 'requests' ? 'border-amber-300/60 bg-amber-400/10' : 'border-white/10 bg-white/[0.03]'}`}><span className="block font-black text-white">طلبات المتابعة الاستثنائية</span><span className="text-xs font-bold text-slate-400">طلبات دكاترة الفرع التي لم تنفذ بعد</span></button></div>

    <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="mb-3 flex flex-wrap gap-2">{([['today','اليوم'],['yesterday','أمس'],['7d','آخر 7 أيام'],['month','الشهر الحالي'],['cycle','دورة 26–25']] as const).map(([id,label]) => <button key={id} onClick={() => setPreset(id)} className="rounded-xl border border-cyan-300/20 px-3 py-2 text-xs font-black text-cyan-100">{label}</button>)}</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <label className="relative"><Search className="absolute right-3 top-3 text-slate-500" size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="الاسم أو الكود أو الهاتف أو الملاحظات" className="w-full rounded-xl border border-white/10 bg-[#071827] py-2.5 pr-9 pl-3 text-sm text-white"/></label>
        <select value={branch} disabled={!managerView} onChange={(e)=>setBranch(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white"><option>الكل</option>{BRANCHES.map((item)=><option key={item}>{item}</option>)}</select>
        <select value={owner} onChange={(e)=>setOwner(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white"><option>الكل</option><option>د/ ضحى</option><option>د/ دنيا</option></select>
        <select value={requester} onChange={(e)=>setRequester(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white"><option>الكل</option>{requesters.map((item)=><option key={item}>{item}</option>)}</select>
        <select value={status} onChange={(e)=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white">{STATUS_OPTIONS.map((item)=><option key={item}>{item}</option>)}</select>
        <select value={contactMethod} onChange={(e)=>setContactMethod(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white">{CONTACT_METHODS.map((item)=><option key={item}>{item}</option>)}</select>
        <select value={resultCompleteness} onChange={(e)=>setResultCompleteness(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white"><option>الكل</option><option>مكتمل التفاصيل</option><option>بدون تفاصيل</option></select>
        <select value={purchase} onChange={(e)=>setPurchase(e.target.value)} className="rounded-xl border border-white/10 bg-[#071827] px-3 py-2.5 text-sm text-white"><option>الكل</option><option>تم شراء</option><option>لم يشترِ</option></select>
        <label className="text-xs font-black text-slate-400">من<input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#071827] px-3 py-2 text-white"/></label>
        <label className="text-xs font-black text-slate-400">إلى<input type="date" value={to} onChange={(e)=>setTo(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#071827] px-3 py-2 text-white"/></label>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{[['الإجمالي',stats.total],['تمت',stats.done],['لم يرد',stats.noAnswer],['مؤجل',stats.postponed],['شراء بعد المتابعة',stats.purchase],['بدون تفاصيل',stats.missing]].map(([label,count])=><div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">{label}</div><div className="mt-1 text-2xl font-black text-white">{count}</div></div>)}</div>

    <div className="mt-4 space-y-3">{loading ? <div className="p-8 text-center font-black text-slate-300">جارٍ التحميل...</div> : filtered.length === 0 ? <div className="p-8 text-center font-black text-slate-400">لا توجد سجلات مطابقة للفلاتر.</div> : filtered.map((row)=><article key={row.id} className="rounded-2xl border border-white/10 bg-[#102a45] p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div><h3 className="text-lg font-black text-white">{row.customer_name || row.name || 'عميل غير مسجل'}</h3><p className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {row.customer_phone || row.phone || 'بدون هاتف'} · {normalizeBranchName(row.branch || '') || 'فرع غير محدد'}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-200">{rowDate(row) || 'بدون تاريخ'}</span><span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-200">{rowStatus(row)}</span></div></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div><div className="text-[11px] font-black text-slate-500">مقدم الطلب</div><div className="text-sm font-bold text-slate-200">{value(row,'created_by_name','assigned_doctor') || 'غير محدد'}</div></div><div><div className="text-[11px] font-black text-slate-500">المسؤولة</div><div className="text-sm font-bold text-slate-200">{value(row,'responsible_name','assigned_doctor') || OWNERS[normalizeBranchName(row.branch || '')] || 'غير محددة'}</div></div><div><div className="text-[11px] font-black text-slate-500">سبب المتابعة</div><div className="text-sm font-bold text-slate-200">{row.followup_reason || row.request_details || 'غير مسجل'}</div></div><div><div className="text-[11px] font-black text-slate-500">طريقة التواصل</div><div className="text-sm font-bold text-slate-200">{row.contact_method || 'لم تبدأ'}</div></div></div>{mode === 'requests' ? <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setDetailsRow(row)} className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-xs font-black text-cyan-100"><Eye className="ml-1 inline" size={14}/>تفاصيل العميل</button><button onClick={() => setExecuteRow(row)} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950">تنفيذ المتابعة</button></div> : null}{mode === 'executed' ? <div className="mt-4 grid gap-3 md:grid-cols-3"><div className="rounded-xl bg-black/15 p-3"><div className="text-[11px] font-black text-slate-500">ما تم مع العميل</div><div className="mt-1 text-sm font-bold leading-6 text-slate-200">{formatFollowupDetailText(row.followup_summary || row.followup_notes || row.notes) || 'لم تُكتب التفاصيل'}</div></div><div className="rounded-xl bg-black/15 p-3"><div className="text-[11px] font-black text-slate-500">رد العميل والنتيجة</div><div className="mt-1 text-sm font-bold leading-6 text-slate-200">{formatFollowupDetailText(row.contact_result || row.followup_result) || 'لم تُسجل النتيجة'}</div></div><div className="rounded-xl bg-black/15 p-3"><div className="text-[11px] font-black text-slate-500">الإجراء القادم</div><div className="mt-1 text-sm font-bold leading-6 text-slate-200">{row.next_followup_date ? `متابعة في ${String(row.next_followup_date).slice(0,10)}` : row.purchase_after_followup ? `تم شراء بقيمة ${row.purchase_amount || 0}` : 'لا يوجد إجراء قادم'}</div></div></div> : null}</article>)}</div>

    {executeRow ? <Suspense fallback={null}><FollowupResultModal followup={executeRow as never} onClose={() => setExecuteRow(null)} onSave={saveExecution} mode="create" /></Suspense> : null}
    {detailsRow ? <Suspense fallback={null}><CustomerQuickDetailsModal
      followupId={detailsRow.id}
      customerCode={detailsRow.customer_code || null}
      customerPhone={detailsRow.customer_phone || detailsRow.phone || null}
      customerName={detailsRow.customer_name || detailsRow.name || null}
      branch={detailsRow.branch || null}
      onEditFollowup={() => { setExecuteRow(detailsRow); setDetailsRow(null); }}
      onClose={() => setDetailsRow(null)}
    /></Suspense> : null}

    {preview ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-2xl rounded-3xl border border-amber-300/30 bg-[#0b2035] p-6"><div className="flex items-center gap-2 text-amber-300"><FileSpreadsheet/><h3 className="text-xl font-black text-white">معاينة ملف الاستيراد</h3></div><div className="mt-4 grid grid-cols-3 gap-3"><div className="rounded-xl bg-white/5 p-3 text-center"><div className="text-xs text-slate-400">إجمالي</div><div className="text-xl font-black text-white">{preview.rows.length}</div></div><div className="rounded-xl bg-emerald-400/10 p-3 text-center"><div className="text-xs text-emerald-200">صحيح</div><div className="text-xl font-black text-white">{preview.valid}</div></div><div className="rounded-xl bg-rose-400/10 p-3 text-center"><div className="text-xs text-rose-200">خاطئ</div><div className="text-xl font-black text-white">{preview.invalid}</div></div></div>{preview.errors.length ? <div className="mt-4 max-h-44 overflow-auto rounded-xl border border-rose-300/20 bg-rose-400/5 p-3 text-sm font-bold text-rose-100">{preview.errors.map((error)=><div key={error}>{error}</div>)}</div> : null}<div className="mt-5 flex justify-end gap-2"><button onClick={()=>setPreview(null)} className="rounded-xl border border-white/10 px-4 py-2 font-black text-white">إلغاء</button><button disabled={importing || preview.valid === 0} onClick={()=>void importRows()} className="rounded-xl bg-amber-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50">{importing ? 'جارٍ الاستيراد...' : `استيراد ${preview.valid} صف`}</button></div></div></div> : null}
  </section>;
}
