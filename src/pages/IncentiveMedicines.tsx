import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Edit,
  FileSpreadsheet,
  Package,
  Plus,
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

  const stats = useMemo(() => {
    const active = visibleMedicines.filter((item) => item.active !== false);
    const incentives = active.map(incentivePerUnit).filter((n) => n > 0);
    return {
      active: active.length,
      coded: active.filter((item) => cleanCode(item.product_code)).length,
      average: incentives.length ? incentives.reduce((a, b) => a + b, 0) / incentives.length : 0,
      max: incentives.length ? Math.max(...incentives) : 0,
    };
  }, [visibleMedicines]);

  const cycle = getCurrentCycle();
  const doctorTotals = useMemo(() => {
    const map = new Map<string, { quantity: number; money: number }>();
    for (const row of saleRecords) {
      if (!row.sale_date) continue;
      const date = new Date(`${row.sale_date}T00:00:00`);
      if (date < cycle.start || date > cycle.end) continue;
      if (!(canViewAllBranches(user) || canViewBranchData(user, row.branch))) continue;
      const name = row.doctor_name || 'غير محدد';
      const current = map.get(name) || { quantity: 0, money: 0 };
      current.quantity += Number(row.quantity || 0);
      current.money += Number(row.incentive_total || 0);
      map.set(name, current);
    }
    return Array.from(map.entries())
      .map(([doctor, totals]) => ({ doctor, ...totals }))
      .sort((a, b) => b.money - a.money);
  }, [saleRecords, cycle.start, cycle.end, user]);

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
    if (!code || !form.product_name.trim()) {
      toast.error('كود الصنف واسم الصنف مطلوبان');
      return;
    }
    if (Number(form.incentive_value) <= 0) {
      toast.error('حافز الوحدة يجب أن يكون أكبر من صفر');
      return;
    }

    const duplicate = existingByKey.get(`${code}::${branchKey(form.branch)}`);
    if (duplicate && duplicate.id !== editing?.id) {
      toast.error('هذا الكود موجود بالفعل لنفس نطاق الفرع');
      return;
    }

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
    if (error) {
      toast.error(error.message);
      return;
    }

    await logActivity(
      profile.id,
      profile.name,
      editing ? 'تحديث صنف لستة' : 'إضافة صنف لستة',
      'أدوية الحوافز',
      `${code} - ${form.product_name}`,
      form.branch
    );
    toast.success(editing ? 'تم تحديث الصنف' : 'تم إضافة الصنف');
    setShowForm(false);
    setEditing(null);
    setForm(blankForm);
    refetch();
  }

  async function toggleActive(item: IncentiveMedicine) {
    const { error } = await supabase
      .from('incentive_medicines')
      .update({ active: item.active === false })
      .eq('id', item.id);
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
    if (preview.some((row) => row.action === 'error')) {
      return toast.error('عالج الصفوف التي عليها خطأ قبل الحفظ');
    }

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

      const { error } = await supabase
        .from('incentive_medicines')
        .upsert(payload, { onConflict: 'product_code,branch' });
      if (error) throw error;

      await logActivity(
        profile.id,
        profile.name,
        'استيراد لستة حوافز',
        'أدوية الحوافز',
        `${valid.length} صنف - ${fileName}`,
        importBranch
      );
      toast.success(`تم حفظ ${valid.length} صنف بنجاح`);
      setPreview([]);
      setFileName('');
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الليستة');
    } finally {
      setImporting(false);
    }
  }

  const previewCounts = useMemo(
    () => ({
      newCount: preview.filter((row) => row.action === 'new').length,
      updateCount: preview.filter((row) => row.action === 'update').length,
      errorCount: preview.filter((row) => row.action === 'error').length,
    }),
    [preview]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">لستة حوافز الأصناف</h2>
          <p className="text-slate-400 text-sm mt-1">
            كتالوج موحد بالكود؛ الحافز يتبع الصنف وليس دكتورًا محددًا.
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary flex items-center gap-2" onClick={openNew}>
            <Plus size={16} /> إضافة صنف
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="أصناف نشطة" value={stats.active} icon={<Package size={18} />} />
        <Stat label="بكود مؤكد" value={stats.coded} icon={<CheckCircle2 size={18} />} />
        <Stat label="متوسط الحافز" value={formatCurrency(stats.average)} icon={<DollarSign size={18} />} />
        <Stat label="أعلى حافز" value={formatCurrency(stats.max)} icon={<DollarSign size={18} />} />
      </div>

      {canCreate && (
        <section className="stat-card space-y-4">
          <div className="flex items-center gap-2 text-white font-bold">
            <FileSpreadsheet size={18} className="text-emerald-300" /> استيراد Master List
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">نطاق الليستة</label>
              <select className="input-dark" value={importBranch} onChange={(e) => setImportBranch(e.target.value)}>
                <option value="كل الفروع">كل الفروع</option>
                {user?.branch && <option value={user.branch}>{user.branch}</option>}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">بداية السريان</label>
              <input className="input-dark" type="date" value={importEffectiveDate} onChange={(e) => setImportEffectiveDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="btn-secondary w-full flex items-center justify-center gap-2 cursor-pointer">
                <Upload size={16} /> اختر ملف Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) parseFile(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            الأعمدة المطلوبة: كود الصنف، اسم الصنف، حافز الوحدة للدكتور. السعر والاستخدام اختياريان.
          </div>

          {preview.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-300">
                  {fileName} — جديد: <b className="text-emerald-300">{previewCounts.newCount}</b>، تحديث: <b className="text-blue-300">{previewCounts.updateCount}</b>، أخطاء: <b className="text-red-300">{previewCounts.errorCount}</b>
                </div>
                <button className="btn-primary" disabled={importing || previewCounts.errorCount > 0} onClick={importPreview}>
                  {importing ? 'جاري الحفظ...' : `اعتماد وحفظ ${preview.length} صنف`}
                </button>
              </div>
              <div className="overflow-auto max-h-[420px] rounded-xl border border-white/10">
                <table className="w-full text-sm min-w-[850px]">
                  <thead className="bg-white/5 text-slate-300 sticky top-0">
                    <tr>
                      <th className="p-2 text-right">#</th><th className="p-2 text-right">الكود</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">السعر</th><th className="p-2 text-right">الاستخدام</th><th className="p-2 text-right">الحافز</th><th className="p-2 text-right">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={`${row.rowNumber}-${row.productCode}`} className="border-t border-white/5">
                        <td className="p-2 text-slate-500">{row.rowNumber}</td>
                        <td className="p-2 text-white font-mono">{row.productCode || '—'}</td>
                        <td className="p-2 text-white">{row.productName || '—'}</td>
                        <td className="p-2 text-slate-300">{formatCurrency(row.productPrice)}</td>
                        <td className="p-2 text-slate-300">{row.productType || '—'}</td>
                        <td className="p-2 text-emerald-300 font-bold">{formatCurrency(row.incentiveValue)}</td>
                        <td className={`p-2 ${row.action === 'error' ? 'text-red-300' : row.action === 'update' ? 'text-blue-300' : 'text-emerald-300'}`}>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="stat-card">
        <div className="text-white font-bold mb-3">حوافز الدكاترة — {cycle.shortLabel}</div>
        {doctorTotals.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {doctorTotals.map((row) => (
              <div key={row.doctor} className="rounded-xl bg-white/5 p-3">
                <div className="text-white font-bold">{row.doctor}</div>
                <div className="text-xs text-slate-400 mt-1">{row.quantity} وحدة</div>
                <div className="text-emerald-300 font-bold mt-2">{formatCurrency(row.money)}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-slate-400 text-sm">لا توجد حركات حوافز في الدورة الحالية.</div>}
      </section>

      <section className="stat-card">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="text-white font-bold">الكتالوج الحالي</div>
          <div className="text-xs text-slate-400">{visibleMedicines.length} صنف</div>
        </div>
        {loading ? <div className="text-slate-400">جاري التحميل...</div> : (
          <div className="overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-white/5 text-slate-300">
                <tr>
                  <th className="p-3 text-right">الكود</th><th className="p-3 text-right">الصنف</th><th className="p-3 text-right">الاستخدام</th><th className="p-3 text-right">السعر</th><th className="p-3 text-right">حافز الوحدة</th><th className="p-3 text-right">النطاق</th><th className="p-3 text-right">السريان</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {visibleMedicines.map((item) => (
                  <tr key={item.id} className="border-t border-white/5">
                    <td className="p-3 text-white font-mono">{cleanCode(item.product_code) || <span className="text-amber-300">بدون كود</span>}</td>
                    <td className="p-3 text-white font-semibold">{item.product_name}</td>
                    <td className="p-3 text-slate-300">{item.product_type || '—'}</td>
                    <td className="p-3 text-slate-300">{formatCurrency(Number(item.product_price || 0))}</td>
                    <td className="p-3 text-emerald-300 font-bold">{formatCurrency(incentivePerUnit(item))}</td>
                    <td className="p-3 text-slate-300">{item.branch}</td>
                    <td className="p-3 text-slate-300">{item.effective_date || '—'}</td>
                    <td className="p-3">
                      <button onClick={() => toggleActive(item)} className={item.active === false ? 'text-slate-400' : 'text-emerald-300'}>
                        {item.active === false ? <ToggleLeft size={18} /> : <ToggleRight size={18} />}
                      </button>
                    </td>
                    <td className="p-3">
                      {canEdit && <button className="btn-secondary px-3 py-2" onClick={() => openEdit(item)}><Edit size={15} /></button>}
                    </td>
                  </tr>
                ))}
                {!visibleMedicines.length && <tr><td colSpan={9} className="p-8 text-center text-slate-400">لا توجد أصناف حاليًا.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#1B2B4B] border border-[#2d4063] p-6 max-h-[90vh] overflow-auto">
            <h3 className="text-white text-xl font-bold mb-4">{editing ? 'تعديل صنف' : 'إضافة صنف'}</h3>
            <form onSubmit={saveItem} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <label className="flex items-center gap-2 text-slate-300 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-100 flex gap-2"><AlertTriangle size={17} className="shrink-0 mt-0.5" /> الصنف غير مربوط بدكتور. كل دكتور يُحسب له الحافز عند ثبوت بيع الصنف باسمه.</div>
              <div className="flex gap-3"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>إلغاء</button><button type="submit" className="btn-primary flex-1">{editing ? 'حفظ التعديل' : 'إضافة'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-slate-300 text-sm block mb-1">{label}</label>{children}</div>;
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="stat-card"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-300 flex items-center justify-center">{icon}</div><div><div className="text-xs text-slate-400">{label}</div><div className="text-white font-bold mt-1">{value}</div></div></div></div>;
}
