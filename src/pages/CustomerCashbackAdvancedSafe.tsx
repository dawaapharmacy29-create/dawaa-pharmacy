import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, FileSpreadsheet, Gift, Percent, RefreshCw, Search, ShieldCheck, Sparkles, Upload, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { cashbackStatusLabel } from '@/lib/api/customerLoyalty';
import { friendlySupabaseError } from '@/lib/supabaseError';

type Props = { forcedBranch?: string };

type CashbackRow = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  total_spent: number | null;
  cashback_rate: number | null;
  cashback_value: number | null;
  redeemed_value: number | null;
  remaining_value: number | null;
  status: string | null;
  notes: string | null;
};

type PeriodInfo = { branch: string; period_start: string; period_end: string; status: string };
type ImportPreview = {
  id: string;
  code: string;
  name: string;
  beforeStatus: string;
  nextStatus: string;
  beforeRedeemed: number;
  nextRedeemed: number;
  notes: string;
  error?: string;
};

const STATUS_LABELS: Record<string, string> = {
  'تم احتساب النقاط': 'calculated',
  'تم تبليغ العميل': 'notified',
  'تم تحديث بي كونكت': 'bconnect_updated',
  'تم سحب جزء': 'partially_redeemed',
  'تمت التسوية': 'settled',
  calculated: 'calculated',
  notified: 'notified',
  bconnect_updated: 'bconnect_updated',
  partially_redeemed: 'partially_redeemed',
  settled: 'settled',
};

function remaining(row: CashbackRow) {
  return Math.max(0, Number(row.cashback_value || 0) - Number(row.redeemed_value || 0));
}

export default function CustomerCashbackAdvancedSafe({ forcedBranch = '' }: Props) {
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [branch, setBranch] = useState(forcedBranch || '');
  const [rows, setRows] = useState<CashbackRow[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ code: '', name: '', phone: '', total: '', rate: '5', note: '' });
  const [importPreview, setImportPreview] = useState<ImportPreview[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadHealth = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_health_v1', {
        p_branch: forcedBranch || null,
      });
      if (error) throw error;
      const next = Array.isArray(data?.branches)
        ? data.branches.map((item: any) => ({
            branch: String(item.branch || ''),
            period_start: String(item.period_start || ''),
            period_end: String(item.period_end || ''),
            status: String(item.status || ''),
          })).filter((item: PeriodInfo) => item.branch && item.period_start && item.period_end)
        : [];
      setPeriods(next);
      if (forcedBranch) setBranch(forcedBranch);
      else if (!branch && next.length) setBranch(next[0].branch);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر قراءة الدورة الرسمية');
    }
  }, [branch, forcedBranch]);

  useEffect(() => { void loadHealth(); }, [loadHealth]);

  const period = useMemo(() => periods.find((item) => item.branch === branch) || null, [branch, periods]);

  const loadRows = useCallback(async () => {
    if (!period) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_fast_page_v1', {
        p_cycle_start: period.period_start,
        p_cycle_end: period.period_end,
        p_branch: branch,
        p_status: null,
        p_quick_filter: 'all',
        p_search: debouncedSearch || null,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر تحميل أدوات نقاط العملاء');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branch, debouncedSearch, period]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const accountAction = async (row: CashbackRow, action: 'set_rate' | 'set_multiplier' | 'add_voucher', value: number, note: string) => {
    if (savingId) return;
    setSavingId(row.id);
    try {
      const { error } = await (supabase as any).rpc('dawaa_customer_cashback_account_action_v1', {
        p_cycle_id: row.id,
        p_action: action,
        p_value: value,
        p_note: note,
      });
      if (error) throw error;
      toast.success('تم حفظ إعداد العميل بأمان');
      await Promise.all([loadRows(), loadHealth()]);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر حفظ إعداد العميل');
    } finally {
      setSavingId(null);
    }
  };

  const settleFull = async (row: CashbackRow) => {
    const amount = remaining(row);
    if (amount <= 0) {
      toast.info('الرصيد مسوّى بالفعل');
      return;
    }
    if (!window.confirm(`تأكيد تسوية كامل المتبقي ${formatCurrency(amount)} للعميل ${row.customer_name || row.customer_code || ''}؟`)) return;
    setSavingId(row.id);
    try {
      const { error } = await (supabase as any).rpc('dawaa_customer_cashback_action_v1', {
        p_cycle_id: row.id,
        p_action: 'redeem',
        p_amount: amount,
        p_expected_redeemed: Number(row.redeemed_value || 0),
        p_note: 'تسوية كاملة من الأدوات المتقدمة الآمنة',
      });
      if (error) throw error;
      toast.success('تمت التسوية الكاملة');
      await Promise.all([loadRows(), loadHealth()]);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر تنفيذ التسوية');
    } finally {
      setSavingId(null);
    }
  };

  const saveManual = async () => {
    if (!period || !branch) return;
    const total = Number(manual.total);
    const rate = Number(manual.rate);
    if (!manual.code.trim() || !Number.isFinite(total) || total < 0 || ![3, 5].includes(rate)) {
      toast.error('راجع كود العميل وإجمالي المشتريات والنسبة');
      return;
    }
    setSavingId('__manual__');
    try {
      const { error } = await (supabase as any).rpc('dawaa_customer_cashback_manual_upsert_v1', {
        p_branch: branch,
        p_cycle_start: period.period_start,
        p_cycle_end: period.period_end,
        p_customer_code: manual.code.trim(),
        p_customer_name: manual.name.trim() || null,
        p_customer_phone: manual.phone.trim() || null,
        p_total_spent: total,
        p_rate: rate,
        p_note: manual.note.trim() || null,
      });
      if (error) throw error;
      toast.success('تم حفظ الإدخال اليدوي داخل الدورة الرسمية');
      setManual({ code: '', name: '', phone: '', total: '', rate: '5', note: '' });
      setManualOpen(false);
      await Promise.all([loadRows(), loadHealth()]);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر حفظ الإدخال اليدوي');
    } finally {
      setSavingId(null);
    }
  };

  const fetchAllRows = async (): Promise<CashbackRow[]> => {
    if (!period || !branch) return [];
    const all: CashbackRow[] = [];
    let offset = 0;
    while (offset < 10000) {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_fast_page_v1', {
        p_cycle_start: period.period_start,
        p_cycle_end: period.period_end,
        p_branch: branch,
        p_status: null,
        p_quick_filter: 'all',
        p_search: null,
        p_limit: 200,
        p_offset: offset,
      });
      if (error) throw error;
      const chunk = Array.isArray(data?.rows) ? data.rows as CashbackRow[] : [];
      all.push(...chunk);
      if (chunk.length < 200) break;
      offset += chunk.length;
    }
    return all;
  };

  const readImport = async (file: File) => {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const input = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const currentRows = await fetchAllRows();
      const byCode = new Map(currentRows.map((row) => [String(row.customer_code || '').trim(), row]));
      const next: ImportPreview[] = input.map((raw) => {
        const code = String(raw['الكود'] ?? raw['customer_code'] ?? '').trim();
        const row = byCode.get(code);
        if (!row) return { id: '', code, name: String(raw['الاسم'] || ''), beforeStatus: '', nextStatus: '', beforeRedeemed: 0, nextRedeemed: 0, notes: '', error: 'الكود غير موجود في الدورة الحالية' };
        const statusRaw = String(raw['الحالة'] ?? row.status ?? '').trim();
        const nextStatus = STATUS_LABELS[statusRaw] || String(row.status || 'calculated');
        const redeemedRaw = raw['المسحوب'];
        const nextRedeemed = redeemedRaw === '' || redeemedRaw === undefined ? Number(row.redeemed_value || 0) : Number(redeemedRaw);
        let error = '';
        if (!Number.isFinite(nextRedeemed)) error = 'قيمة المسحوب غير صحيحة';
        else if (nextRedeemed < Number(row.redeemed_value || 0) - 0.009) error = 'لا يمكن تقليل المسحوب';
        else if (nextRedeemed > Number(row.cashback_value || 0) + 0.009) error = 'المسحوب أكبر من الاستحقاق';
        else if (nextStatus === 'settled' && nextRedeemed < Number(row.cashback_value || 0) - 0.009) error = 'التسوية الكاملة تحتاج سحب كامل الاستحقاق';
        return {
          id: row.id,
          code,
          name: row.customer_name || '',
          beforeStatus: String(row.status || 'calculated'),
          nextStatus,
          beforeRedeemed: Number(row.redeemed_value || 0),
          nextRedeemed,
          notes: String(raw['ملاحظات'] ?? '').trim(),
          error: error || undefined,
        };
      }).filter((item) => item.code);
      setImportPreview(next);
      if (!next.length) toast.error('الملف لا يحتوي بيانات قابلة للقراءة');
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر قراءة ملف Excel');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImport = async () => {
    const valid = importPreview.filter((item) => !item.error && item.id && (
      item.beforeStatus !== item.nextStatus || Math.abs(item.beforeRedeemed - item.nextRedeemed) > 0.009 || item.notes
    ));
    if (!valid.length) {
      toast.error('لا توجد تعديلات صالحة للتطبيق');
      return;
    }
    setImporting(true);
    try {
      let updated = 0;
      const errors: any[] = [];
      for (let i = 0; i < valid.length; i += 500) {
        const batch = valid.slice(i, i + 500).map((item) => ({
          id: item.id,
          status: item.nextStatus,
          redeemed_value: item.nextRedeemed,
          notes: item.notes || null,
        }));
        const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_import_batch_v1', { p_changes: batch });
        if (error) throw error;
        updated += Number(data?.updated || 0);
        if (Array.isArray(data?.errors)) errors.push(...data.errors);
      }
      if (errors.length) toast.warning(`تم تحديث ${updated} صف، ورفض ${errors.length} صف لحمايتهم من تعديل غير صحيح`);
      else toast.success(`تم تحديث ${updated} صف بأمان`);
      setImportPreview([]);
      await Promise.all([loadRows(), loadHealth()]);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر تطبيق ملف Excel');
    } finally {
      setImporting(false);
    }
  };

  const availableBranches = forcedBranch ? [forcedBranch] : periods.map((item) => item.branch).filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <section dir="rtl" className="space-y-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-[var(--theme-heading)]"><ShieldCheck className="h-5 w-5 text-emerald-400" /> أدوات نقاط العملاء الآمنة</div>
            <p className="mt-1 text-xs font-bold text-[var(--theme-muted)]">كل تعديل يمر من Commands محمية حسب الفرع، مع قفل للسجل وفحص الرصيد وتسجيل الحدث.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!forcedBranch ? (
              <select className="dawaa-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">اختر الفرع</option>
                {availableBranches.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : null}
            <button className="btn-secondary" type="button" onClick={() => { void loadRows(); void loadHealth(); }}><RefreshCw className="h-4 w-4" /> تحديث</button>
            <button className="dawaa-button-primary" type="button" onClick={() => setManualOpen((v) => !v)}><Database className="h-4 w-4" /> إدخال يدوي آمن</button>
            <button className="btn-secondary" type="button" onClick={() => fileRef.current?.click()} disabled={importing}><Upload className="h-4 w-4" /> استيراد Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readImport(file); }} />
          </div>
        </div>
        {period ? <div className="mt-3 text-xs font-bold text-emerald-200">الدورة الرسمية: {period.period_start} ← {period.period_end} · {branch}</div> : <div className="mt-3 text-xs font-bold text-amber-300">لا توجد دورة رسمية مفتوحة لهذا الفرع.</div>}
      </div>

      {manualOpen && period ? (
        <div className="dawaa-panel p-4">
          <div className="mb-3 font-black text-[var(--theme-heading)]">إضافة/تحديث عميل داخل الدورة الرسمية</div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="dawaa-input" placeholder="كود العميل" value={manual.code} onChange={(e) => setManual((v) => ({ ...v, code: e.target.value }))} />
            <input className="dawaa-input" placeholder="اسم العميل" value={manual.name} onChange={(e) => setManual((v) => ({ ...v, name: e.target.value }))} />
            <input className="dawaa-input" placeholder="الهاتف" value={manual.phone} onChange={(e) => setManual((v) => ({ ...v, phone: e.target.value }))} />
            <input className="dawaa-input" type="number" step="0.01" placeholder="إجمالي مشتريات الدورة" value={manual.total} onChange={(e) => setManual((v) => ({ ...v, total: e.target.value }))} />
            <select className="dawaa-input" value={manual.rate} onChange={(e) => setManual((v) => ({ ...v, rate: e.target.value }))}><option value="3">3%</option><option value="5">5%</option></select>
            <input className="dawaa-input" placeholder="سبب/ملاحظة التعديل" value={manual.note} onChange={(e) => setManual((v) => ({ ...v, note: e.target.value }))} />
          </div>
          <button className="dawaa-button-primary mt-3" type="button" disabled={savingId === '__manual__'} onClick={() => void saveManual()}>حفظ داخل Snapshot الدورة</button>
        </div>
      ) : null}

      {importPreview.length ? (
        <div className="dawaa-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-black text-[var(--theme-heading)]"><FileSpreadsheet className="ml-2 inline h-5 w-5" /> معاينة الاستيراد: {importPreview.length.toLocaleString('ar-EG')} صف</div>
            <div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => setImportPreview([])}>إلغاء</button><button className="dawaa-button-primary" type="button" disabled={importing} onClick={() => void applyImport()}>تطبيق التعديلات الآمنة</button></div>
          </div>
          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--theme-border)]">
            <table className="w-full text-xs"><thead><tr className="bg-[var(--theme-surface)]"><th className="p-2">الكود</th><th className="p-2">العميل</th><th className="p-2">الحالة</th><th className="p-2">المسحوب</th><th className="p-2">الفحص</th></tr></thead><tbody>
              {importPreview.slice(0, 500).map((item, index) => <tr key={`${item.code}-${index}`} className="border-t border-[var(--theme-border)]"><td className="p-2">{item.code}</td><td className="p-2">{item.name}</td><td className="p-2">{cashbackStatusLabel(item.beforeStatus)} ← {cashbackStatusLabel(item.nextStatus)}</td><td className="p-2">{item.beforeRedeemed} ← {item.nextRedeemed}</td><td className={`p-2 font-bold ${item.error ? 'text-rose-400' : 'text-emerald-400'}`}>{item.error || 'صالح'}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      ) : null}

      <div className="dawaa-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-muted)]" /><input className="dawaa-input w-full pr-9" placeholder="بحث بالاسم أو الكود أو الهاتف" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <span className="text-xs font-bold text-[var(--theme-muted)]">يظهر أول 100 نتيجة فقط للحفاظ على السرعة.</span>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? <div className="dawaa-panel p-8 text-center font-bold">جارٍ التحميل…</div> : rows.length ? rows.map((row) => (
          <article key={row.id} className="dawaa-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-black text-[var(--theme-heading)]">{row.customer_name || 'عميل بدون اسم'}</div><div className="mt-1 text-xs font-bold text-[var(--theme-muted)]">{row.customer_code || '-'} · {row.customer_phone || 'بدون هاتف'} · {cashbackStatusLabel(row.status)}</div></div>
              <div className="text-left"><div className="text-xs text-[var(--theme-muted)]">المستحق / المسحوب / المتبقي</div><div className="font-black text-[var(--theme-heading)]">{formatCurrency(row.cashback_value || 0)} / {formatCurrency(row.redeemed_value || 0)} / {formatCurrency(remaining(row))}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={savingId === row.id} onClick={() => void accountAction(row, 'set_rate', 3, 'تحويل إلى نظام 3%') }><Percent className="h-4 w-4" /> 3%</button>
              <button className="btn-secondary" disabled={savingId === row.id} onClick={() => void accountAction(row, 'set_rate', 5, 'تحويل إلى نظام 5%') }><Percent className="h-4 w-4" /> 5%</button>
              <button className="btn-secondary" disabled={savingId === row.id} onClick={() => void accountAction(row, 'set_multiplier', 2, 'مضاعفة الكاش باك ×2') }><Sparkles className="h-4 w-4" /> ×2</button>
              <button className="btn-secondary" disabled={savingId === row.id} onClick={() => { const value = Number(window.prompt('قيمة الفاوتشر الإضافي', '0') || 0); if (value > 0) void accountAction(row, 'add_voucher', value, `فاوتشر إضافي ${value}`); }}><Gift className="h-4 w-4" /> فاوتشر</button>
              <button className="dawaa-button-primary" disabled={savingId === row.id || remaining(row) <= 0} onClick={() => void settleFull(row)}><WalletCards className="h-4 w-4" /> تسوية كاملة</button>
            </div>
          </article>
        )) : <div className="dawaa-panel p-8 text-center font-bold">لا توجد نتائج.</div>}
      </div>
    </section>
  );
}
