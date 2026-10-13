import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Edit,
  FileSpreadsheet,
  Package,
  Plus,
  Search,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth, getCurrentUserProfile } from '@/hooks/useAuth';
import { useSupabaseQuery, logActivity } from '@/hooks/useSupabaseQuery';
import { canViewAllBranches, canViewBranchData } from '@/lib/security/userDataScope';
import { formatCurrency } from '@/lib/utils';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';

interface IncentiveMedicine {
  id: string;
  product_code?: string | null;
  product_name: string;
  product_type?: string | null;
  product_price?: number | null;
  incentive_type?: string | null;
  incentive_value?: number | null;
  incentive_percent?: number | null;
  branch: string;
  active?: boolean | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
}

interface IncentiveSaleRecord {
  id: string;
  medicine_id?: string | null;
  doctor_name: string;
  branch?: string | null;
  quantity?: number | null;
  incentive_total?: number | null;
  sale_date?: string | null;
}

type ImportAction = 'new' | 'update' | 'error';
type StatusFilter = 'all' | 'active' | 'inactive';

interface ImportRow {
  rowNumber: number;
  productCode: string;
  productName: string;
  productPrice: number;
  productType: string;
  incentiveValue: number;
  action: ImportAction;
  message: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const blankForm = {
  product_code: '',
  product_name: '',
  product_type: '',
  product_price: 0,
  incentive_value: 0,
  branch: 'كل الفروع',
  effective_date: today(),
  expiry_date: '',
  active: true,
  notes: '',
};

function cleanCode(value: unknown) {
  return String(value ?? '').trim().replace(/\.0$/, '');
}

function numeric(value: unknown) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function branchKey(value?: string | null) {
  return String(value || '').trim() || 'كل الفروع';
}

function incentivePerUnit(item: IncentiveMedicine) {
  if (item.incentive_type === 'percent') {
    return (Number(item.product_price || 0) * Number(item.incentive_percent || 0)) / 100;
  }
  return Number(item.incentive_value || 0);
}

export default function IncentiveMedicines() {
  const { user, canManage } = useAuth();
  const canCreate = canManage || user?.permissions?.create_incentive_medicine === true;
  const canEdit = canManage || user?.permissions?.edit_incentive_medicine === true;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<IncentiveMedicine | null>(null);
  const [form, setForm] = useState(blankForm);
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importBranch, setImportBranch] = useState('كل الفروع');
  const [importEffectiveDate, setImportEffectiveDate] = useState(today());
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [usageFilter, setUsageFilter] = useState('all');

  const { data: medicines = [], loading, refetch } = useSupabaseQuery<IncentiveMedicine>({
    table: 'incentive_medicines',
    orderBy: { column: 'product_name', ascending: true },
    realtimeEnabled: true,
  });

  const { data: saleRecords = [] } = useSupabaseQuery<IncentiveSaleRecord>({
    table: 'incentive_medicine_sales',
    orderBy: { column: 'sale_date', ascending: false },
    realtimeEnabled: true,
  });

  const visibleMedicines = useMemo(
    () => medicines.filter((item) => canViewAllBranches(user) || canViewBranchData(user, item.branch)),
    [medicines, user]
  );

  const existingByKey = useMemo(() => {
    const map = new Map<string, IncentiveMedicine>();
    for (const item of medicines) {
      const code = cleanCode(item.product_code);
      if (code) map.set(`${code}::${branchKey(item.branch)}`, item);
    }
    return map;
  }, [medicines]);

  const cycle = getCurrentCycle();

  const cycleSales = useMemo(
    () => saleRecords.filter((row) => {
      if (!row.sale_date) return false;
      const date = new Date(`${row.sale_date}T00:00:00`);
      if (date < cycle.start || date > cycle.end) return false;
      return canViewAllBranches(user) || canViewBranchData(user, row.branch);
    }),
    [saleRecords, cycle.start, cycle.end, user]
  );

  const medicineSales = useMemo(() => {
    const map = new Map<string, { quantity: number; money: number }>();
    for (const row of cycleSales) {
      if (!row.medicine_id) continue;
      const current = map.get(row.medicine_id) || { quantity: 0, money: 0 };
      current.quantity += Number(row.quantity || 0);
      current.money += Number(row.incentive_total || 0);
      map.set(row.medicine_id, current);
    }
    return map;
  }, [cycleSales]);

  const stats = useMemo(() => {
    const active = visibleMedicines.filter((item) => item.active !== false);
    const incentives = active.map(incentivePerUnit).filter((n) => n > 0);
    const totalEarned = cycleSales.reduce((sum, row) => sum + Number(row.incentive_total || 0), 0);
    const totalUnits = cycleSales.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    return {
      active: active.length,
      coded: active.filter((item) => cleanCode(item.product_code)).length,
      max: incentives.length ? Math.max(...incentives) : 0,
      totalEarned,
      totalUnits,
    };
  }, [visibleMedicines, cycleSales]);

  const usageOptions = useMemo(
    () => Array.from(new Set(visibleMedicines.map((item) => item.product_type?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'ar')),
    [visibleMedicines]
  );

  const filteredMedicines = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ar');
    return visibleMedicines.filter((item) => {
      if (statusFilter === 'active' && item.active === false) return false;
      if (statusFilter === 'inactive' && item.active !== false) return false;
      if (usageFilter !== 'all' && (item.product_type || '') !== usageFilter) return false;
      if (!q) return true;
      return [item.product_name, cleanCode(item.product_code), item.product_type || '', item.branch || '']
        .some((value) => value.toLocaleLowerCase('ar').includes(q));
    });
  }, [visibleMedicines, search, statusFilter, usageFilter]);

  const doctorTotals = useMemo(() => {
    const map = new Map<string, { quantity: number; money: number }>();
    for (const row of cycleSales) {
      const name = row.doctor_name || 'غير محدد';
      const current = map.get(name) || { quantity: 0, money: 0 };
      current.quantity += Number(row.quantity || 0);
      current.money += Number(row.incentive_total || 0);
      map.set(name, current);
    }
    return Array.from(map.entries())
      .map(([doctor, totals]) => ({ doctor, ...totals }))
      .sort((a, b) => b.money - a.money);
  }, [cycleSales]);

  function openNew() {
    setEditing(null);
    setForm({ ...blankForm, branch: 'كل الفروع', effective_date: today() });
    setShowForm(true);
  }

  function openEdit(item: IncentiveMedicine) {
    setEditing(item);
    setForm({
      product_code: cleanCode(item.product_code),
      product_name: item.product_name || '',
      product_type: item.product_type || '',
      product_price: Number(item.product_price || 0),
      incentive_value: incentivePerUnit(item),
      branch: branchKey(item.branch),
      effective_date: item.effective_date || today(),
      expiry_date: item.expiry_date || '',
      active: item.active !== false,
      notes: item.notes || '',
    });
    setShowForm(true);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    const code = cleanCode(form.product_code);
    if (!code || !form.product_name.trim()) return toast.error('كود الصنف واسم الصنف مطلوبان');
    if (Number(form.incentive_value) <= 0) return toast.error('حافز الوحدة يجب أن يكون أكبر من صفر');

    const duplicate = existingByKey.get(`${code}::${branchKey(form.branch)}`);
    if (duplicate && duplicate.id !== editing?.id) return toast.error('هذا الكود موجود بالفعل لنفس نطاق الفرع');

    const profile = getCurrentUserProfile();
    const payload = {
      product_code: code,
      product_name: form.product_name.trim(),
      product_type: form.product_type.trim() || null,
      product_price: Number(form.product_price || 0),
      incentive_type: 'fixed',
      incentive_value: Number(form.incentive_value || 0),
      incentive_percent: 0,
      branch: branchKey(form.branch),
      active: form.active,
      effective_date: form.effective_date || today(),
      expiry_date: form.expiry_date || null,
      notes: form.notes.trim() || null,
      doctor_id: null,
      responsible_doctor: null,
      source_file_date: today(),
      created_by: profile.id,
    };

    const query = editing
      ? supabase.from('incentive_medicines').update(payload).eq('id', editing.id)
      : supabase.from('incentive_medicines').insert(payload);
    const { error } = await query;
    if (error) return toast.error(error.message);

    await logActivity(profile.id, profile.name, editing ? 'تحديث صنف لستة' : 'إضافة صنف لستة', 'أدوية الحوافز', `${code} - ${form.product_name}`, form.branch);
    toast.success(editing ? 'تم تحديث الصنف' : 'تم إضافة الصنف');
    setShowForm(false);
    setEditing(null);
    setForm(blankForm);
    refetch();
  }

  async function toggleActive(item: IncentiveMedicine) {
    const { error } = await supabase.from('incentive_medicines').update({ active: item.active === false }).eq('id', item.id);
    if (error) return toast.error(error.message);
    toast.success(item.active === false ? 'تم تفعيل الصنف' : 'تم إيقاف الصنف');
    refetch();
  }

  async function parseFile(file: File) {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames.includes('Master List') ? 'Master List' : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const seen = new Set<string>();
      const parsed: ImportRow[] = rows.map((row, index) => {
        const productCode = cleanCode(row['كود الصنف'] ?? row['الكود'] ?? row['code']);
        const productName = String(row['اسم الصنف'] ?? row['إسم الصنف'] ?? row['product_name'] ?? '').trim();
        const productPrice = numeric(row['سعر البيع'] ?? row['سعر الصنف'] ?? row['product_price']);
        const productType = String(row['الاستخدام'] ?? row['نوع الصنف'] ?? row['product_type'] ?? '').trim();
        const incentiveValue = numeric(row['حافز الوحدة للدكتور'] ?? row['حافز الوحدة'] ?? row['incentive_value']);
        const key = `${productCode}::${branchKey(importBranch)}`;
        let action: ImportAction = existingByKey.has(key) ? 'update' : 'new';
        let message = action === 'update' ? 'سيتم تحديث الصنف الموجود' : 'صنف جديد';

        if (!productCode || !productName || incentiveValue <= 0) {
          action = 'error';
          message = 'يلزم كود + اسم + حافز أكبر من صفر';
        } else if (seen.has(productCode)) {
          action = 'error';
          message = 'كود مكرر داخل الملف';
        }
        seen.add(productCode);
        return { rowNumber: index + 2, productCode, productName, productPrice, productType, incentiveValue, action, message };
      });

      setFileName(file.name);
      setPreview(parsed);
      const errors = parsed.filter((row) => row.action === 'error').length;
      if (errors) toast.warning(`تمت القراءة مع ${errors} صفوف تحتاج مراجعة`);
      else toast.success(`تمت قراءة ${parsed.length} صنف وجاهزة للمعاينة`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف Excel');
    }
  }

  async function importPreview() {
    const valid = preview.filter((row) => row.action !== 'error');
    if (!valid.length) return toast.error('لا توجد صفوف صالحة للاستيراد');
    if (preview.some((row) => row.action === 'error')) return toast.error('عالج الصفوف التي عليها خطأ قبل الحفظ');

    setImporting(true);
    try {
      const profile = getCurrentUserProfile();
      const payload = valid.map((row) => ({
        product_code: row.productCode,
        product_name: row.productName,
        product_type: row.productType || null,
        product_price: row.productPrice,
        incentive_type: 'fixed',
        incentive_value: row.incentiveValue,
        incentive_percent: 0,
        branch: branchKey(importBranch),
        active: true,
        effective_date: importEffectiveDate || today(),
        expiry_date: null,
        doctor_id: null,
        responsible_doctor: null,
        source_file_date: today(),
        notes: `Master List import: ${fileName}`,
        created_by: profile.id,
      }));

      const { error } = await supabase.from('incentive_medicines').upsert(payload, { onConflict: 'product_code,branch' });
      if (error) throw error;

      await logActivity(profile.id, profile.name, 'استيراد لستة حوافز', 'أدوية الحوافز', `${valid.length} صنف - ${fileName}`, importBranch);
      toast.success(`تم حفظ ${valid.length} صنف بنجاح`);
      setPreview([]);
      setFileName('');
      setShowImport(false);
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الليستة');
    } finally {
      setImporting(false);
    }
  }

  const previewCounts = useMemo(() => ({
    newCount: preview.filter((row) => row.action === 'new').length,
    updateCount: preview.filter((row) => row.action === 'update').length,
    errorCount: preview.filter((row) => row.action === 'error').length,
  }), [preview]);

  return (
    <div className="space-y-6" dir="rtl">
      <section className="relative overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/12 via-[#15243e] to-[#101b30] p-5 md:p-6">
        <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/12 text-emerald-300 shadow-lg shadow-emerald-950/20">
              <Sparkles size={24} />
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-200">دورة {cycle.shortLabel}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-300">{stats.active} صنف نشط</span>
              </div>
              <h1 className="text-2xl font-black text-white md:text-3xl">أدوية اللستة</h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                كل أصناف الحوافز في مكان واحد — بالكود، سعر البيع، حافز الوحدة، وحركة الدورة الحالية لكل صنف.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate && (
              <button className="btn-secondary flex items-center gap-2" onClick={() => setShowImport((value) => !value)}>
                <FileSpreadsheet size={16} /> إدارة ملف الليستة {showImport ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
            {canCreate && <button className="btn-primary flex items-center gap-2" onClick={openNew}><Plus size={16} /> إضافة صنف</button>}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="أصناف نشطة" value={stats.active} sub={`${stats.coded} بكود مؤكد`} icon={<Package size={18} />} />
        <Stat label="المباع في الدورة" value={stats.totalUnits} sub="وحدة من أصناف الليستة" icon={<CheckCircle2 size={18} />} />
        <Stat label="الحافز المحقق" value={formatCurrency(stats.totalEarned)} sub="إجمالي الدورة الحالية" icon={<DollarSign size={18} />} />
        <Stat label="أعلى حافز للوحدة" value={formatCurrency(stats.max)} sub="أعلى قيمة في الكتالوج" icon={<Sparkles size={18} />} />
      </div>

      {canCreate && showImport && (
        <section className="rounded-3xl border border-white/10 bg-[#15243e]/90 p-5 shadow-xl shadow-black/10 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-white"><FileSpreadsheet size={18} className="text-emerald-300" /> إدارة ملف الليستة</div>
              <p className="mt-1 text-xs text-slate-400">الاستيراد أداة إدارة، لذلك بيفضل مقفول أثناء الاستخدام اليومي للصفحة.</p>
            </div>
            <button className="text-xs text-slate-400 hover:text-white" onClick={() => setShowImport(false)}>إغلاق</button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="نطاق الليستة"><select className="input-dark" value={importBranch} onChange={(e) => setImportBranch(e.target.value)}><option value="كل الفروع">كل الفروع</option>{user?.branch && <option value={user.branch}>{user.branch}</option>}</select></Field>
            <Field label="بداية السريان"><input className="input-dark" type="date" value={importEffectiveDate} onChange={(e) => setImportEffectiveDate(e.target.value)} /></Field>
            <div className="flex items-end"><label className="btn-secondary flex w-full cursor-pointer items-center justify-center gap-2"><Upload size={16} /> اختر ملف Excel<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseFile(file); e.currentTarget.value = ''; }} /></label></div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-slate-400">الأعمدة الأساسية: كود الصنف، اسم الصنف، حافز الوحدة للدكتور. السعر والاستخدام اختياريان.</div>

          {preview.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-300">{fileName} — جديد: <b className="text-emerald-300">{previewCounts.newCount}</b>، تحديث: <b className="text-blue-300">{previewCounts.updateCount}</b>، أخطاء: <b className="text-red-300">{previewCounts.errorCount}</b></div>
                <button className="btn-primary" disabled={importing || previewCounts.errorCount > 0} onClick={importPreview}>{importing ? 'جاري الحفظ...' : `اعتماد وحفظ ${preview.length} صنف`}</button>
              </div>
              <div className="max-h-[420px] overflow-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="sticky top-0 bg-[#182945] text-slate-300"><tr><th className="p-2 text-right">#</th><th className="p-2 text-right">الكود</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">السعر</th><th className="p-2 text-right">الاستخدام</th><th className="p-2 text-right">الحافز</th><th className="p-2 text-right">الحالة</th></tr></thead>
                  <tbody>{preview.map((row) => <tr key={`${row.rowNumber}-${row.productCode}`} className="border-t border-white/5"><td className="p-2 text-slate-500">{row.rowNumber}</td><td className="p-2 font-mono text-white">{row.productCode || '—'}</td><td className="p-2 text-white">{row.productName || '—'}</td><td className="p-2 text-slate-300">{formatCurrency(row.productPrice)}</td><td className="p-2 text-slate-300">{row.productType || '—'}</td><td className="p-2 font-bold text-emerald-300">{formatCurrency(row.incentiveValue)}</td><td className={`p-2 ${row.action === 'error' ? 'text-red-300' : row.action === 'update' ? 'text-blue-300' : 'text-emerald-300'}`}>{row.message}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 md:p-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input className="input-dark pr-10" placeholder="ابحث باسم الصنف أو الكود أو الاستخدام..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input-dark min-w-[150px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}><option value="all">كل الحالات</option><option value="active">النشط فقط</option><option value="inactive">الموقوف فقط</option></select>
          <select className="input-dark min-w-[170px]" value={usageFilter} onChange={(e) => setUsageFilter(e.target.value)}><option value="all">كل الاستخدامات</option>{usageOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>ظاهر {filteredMedicines.length} من {visibleMedicines.length} صنف</span>{search || statusFilter !== 'all' || usageFilter !== 'all' ? <button className="text-emerald-300 hover:text-emerald-200" onClick={() => { setSearch(''); setStatusFilter('all'); setUsageFilter('all'); }}>مسح الفلاتر</button> : null}</div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-black text-white">أصناف الليستة</h2><p className="mt-1 text-xs text-slate-500">الكارت بيوضح بيانات الصنف وحركته في الدورة الحالية من غير زحمة جداول.</p></div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-3xl border border-white/8 bg-white/5" />)}</div>
        ) : filteredMedicines.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-slate-400">لا توجد أصناف مطابقة للفلاتر الحالية.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredMedicines.map((item, index) => {
              const sale = medicineSales.get(item.id) || { quantity: 0, money: 0 };
              const price = Number(item.product_price || 0);
              const incentive = incentivePerUnit(item);
              const ratio = price > 0 ? (incentive / price) * 100 : 0;
              const accents = [
                'from-emerald-500/16 via-teal-500/7 to-transparent border-emerald-400/20',
                'from-sky-500/14 via-cyan-500/6 to-transparent border-sky-400/20',
                'from-violet-500/14 via-indigo-500/6 to-transparent border-violet-400/20',
                'from-amber-500/14 via-orange-500/6 to-transparent border-amber-400/20',
              ];
              return (
                <article key={item.id} className={`group relative overflow-hidden rounded-3xl border bg-gradient-to-br ${accents[index % accents.length]} p-5 shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-xl`}>
                  <div className="pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full bg-white/5 blur-2xl" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 font-mono text-[11px] text-slate-300">#{cleanCode(item.product_code) || 'بدون كود'}</span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${item.active === false ? 'bg-slate-500/15 text-slate-400' : 'bg-emerald-400/12 text-emerald-300'}`}>{item.active === false ? 'موقوف' : 'نشط'}</span>
                        </div>
                        <h3 className="text-lg font-black leading-7 text-white">{item.product_name}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{item.product_type || 'بدون تصنيف'}</span><span className="text-slate-600">•</span><span>{item.branch}</span></div>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-emerald-300"><Package size={22} /></div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <Mini label="سعر البيع" value={formatCurrency(price)} />
                      <Mini label="حافز الوحدة" value={formatCurrency(incentive)} tone="text-emerald-300" />
                      <Mini label="المباع بالدورة" value={`${sale.quantity} وحدة`} />
                      <Mini label="الحافز المحقق" value={formatCurrency(sale.money)} tone="text-cyan-300" />
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/8 bg-black/10 px-3 py-3">
                      <div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-400">نسبة الحافز من سعر البيع</span><span className="font-bold text-white">{ratio ? `${ratio.toFixed(1)}%` : '—'}</span></div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/8 pt-4">
                      <div className="text-[11px] text-slate-500">ساري من {item.effective_date || 'غير محدد'}{item.expiry_date ? ` حتى ${item.expiry_date}` : ''}</div>
                      <div className="flex items-center gap-2">
                        {canEdit && <button onClick={() => toggleActive(item)} className={`rounded-xl border px-3 py-2 text-xs transition ${item.active === false ? 'border-slate-500/20 bg-slate-500/10 text-slate-400' : 'border-emerald-400/15 bg-emerald-400/10 text-emerald-300'}`} title={item.active === false ? 'تفعيل' : 'إيقاف'}>{item.active === false ? <ToggleLeft size={17} /> : <ToggleRight size={17} />}</button>}
                        {canEdit && <button className="btn-secondary px-3 py-2" onClick={() => openEdit(item)} title="تعديل"><Edit size={15} /></button>}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#15243e]/70 p-5">
        <div className="mb-4 flex items-center justify-between"><div><div className="font-bold text-white">حوافز الدكاترة — {cycle.shortLabel}</div><div className="mt-1 text-xs text-slate-500">ملخص الحركة المسجلة فعليًا في الدورة.</div></div></div>
        {doctorTotals.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{doctorTotals.map((row) => <div key={row.doctor} className="rounded-2xl border border-white/8 bg-white/5 p-4"><div className="font-bold text-white">{row.doctor}</div><div className="mt-1 text-xs text-slate-400">{row.quantity} وحدة</div><div className="mt-3 font-black text-emerald-300">{formatCurrency(row.money)}</div></div>)}</div> : <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">لا توجد حركات حوافز في الدورة الحالية.</div>}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border border-[#2d4063] bg-[#172744] p-6 shadow-2xl">
            <div className="mb-5"><h3 className="text-xl font-black text-white">{editing ? 'تعديل صنف من الليستة' : 'إضافة صنف جديد'}</h3><p className="mt-1 text-xs text-slate-400">الصنف جزء من كتالوج عام، وليس مرتبطًا بدكتور بعينه.</p></div>
            <form onSubmit={saveItem} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="كود الصنف *"><input className="input-dark" value={form.product_code} onChange={(e) => setForm({ ...form, product_code: e.target.value })} required /></Field>
                <Field label="اسم الصنف *"><input className="input-dark" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} required /></Field>
                <Field label="الاستخدام"><input className="input-dark" value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value })} /></Field>
                <Field label="سعر البيع"><input className="input-dark" type="number" step="0.01" min="0" value={form.product_price} onChange={(e) => setForm({ ...form, product_price: Number(e.target.value) })} /></Field>
                <Field label="حافز الوحدة بالجنيه *"><input className="input-dark" type="number" step="0.01" min="0.01" value={form.incentive_value} onChange={(e) => setForm({ ...form, incentive_value: Number(e.target.value) })} required /></Field>
                <Field label="النطاق"><select className="input-dark" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}><option value="كل الفروع">كل الفروع</option>{user?.branch && <option value={user.branch}>{user.branch}</option>}</select></Field>
                <Field label="تاريخ السريان"><input className="input-dark" type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
                <Field label="تاريخ الانتهاء"><input className="input-dark" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
              </div>
              <Field label="ملاحظات"><textarea className="input-dark resize-none" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
              <div className="flex gap-2 rounded-2xl border border-blue-400/15 bg-blue-500/8 p-3 text-sm leading-6 text-blue-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" /> كل دكتور يتحسب له الحافز عند ثبوت بيع الصنف باسمه؛ مفيش دكتور مسؤول ثابت للصنف.</div>
              <div className="flex gap-3 pt-1"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>إلغاء</button><button type="submit" className="btn-primary flex-1">{editing ? 'حفظ التعديل' : 'إضافة الصنف'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm text-slate-300">{label}</label>{children}</div>;
}

function Mini({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return <div className="rounded-2xl border border-white/8 bg-white/5 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-1 font-black ${tone}`}>{value}</div></div>;
}

function Stat({ label, value, sub, icon }: { label: string; value: string | number; sub: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-4"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">{icon}</div><div className="min-w-0"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div><div className="mt-1 truncate text-[11px] text-slate-600">{sub}</div></div></div></div>;
}
