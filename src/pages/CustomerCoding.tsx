import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const STEPS = [
  { key: 'registered', label: 'تم تسجيله في التطبيق' },
  { key: 'beeconnect', label: 'تم تكويده على BeeConnect' },
  { key: 'welcome', label: 'تم إرسال الرسالة الترحيبية' },
  { key: 'customers_db', label: 'تم ربطه بقاعدة العملاء' },
  { key: 'phone_saved', label: 'تم حفظه على تليفون الفرع' },
  { key: 'evaluated', label: 'تم تقييم العميل إن وجد' },
  { key: 'closed', label: 'تم إغلاق الحالة' },
] as const;

type CodingStatus = 'open' | 'in_progress' | 'completed' | 'blocked';
type CustomerCodingRow = {
  id: string;
  customer_name: string;
  phone: string;
  address: string | null;
  branch: string | null;
  notes: string | null;
  source: string | null;
  status: CodingStatus | string | null;
  created_by_name: string | null;
  created_at: string;
  beeconnect_coded_at: string | null;
  welcome_sent_at: string | null;
  customers_db_saved_at: string | null;
  phone_saved_at: string | null;
  evaluated_at: string | null;
  closed_at: string | null;
  completed_by_name: string | null;
};

type FormState = {
  customer_name: string;
  phone: string;
  address: string;
  branch: string;
  source: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  customer_name: '',
  phone: '',
  address: '',
  branch: 'فرع شكري',
  source: 'داخل الفرع',
  notes: '',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'جاري',
  completed: 'مكتملة',
  blocked: 'متعذرة',
};

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').replace(/^20/, '0');
}
function fmt(date?: string | null) {
  return date ? new Date(date).toLocaleString('ar-EG') : 'لم يتم';
}
function stepDone(row: CustomerCodingRow, key: string) {
  if (key === 'registered') return Boolean(row.created_at);
  if (key === 'beeconnect') return Boolean(row.beeconnect_coded_at);
  if (key === 'welcome') return Boolean(row.welcome_sent_at);
  if (key === 'customers_db') return Boolean(row.customers_db_saved_at);
  if (key === 'phone_saved') return Boolean(row.phone_saved_at);
  if (key === 'evaluated') return Boolean(row.evaluated_at);
  if (key === 'closed') return Boolean(row.closed_at);
  return false;
}
function statusTone(status?: string | null) {
  if (status === 'completed') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
  if (status === 'blocked') return 'border-red-400/30 bg-red-500/10 text-red-100';
  if (status === 'in_progress') return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
  return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
}

async function ensureCodingTables() {
  // The app can work only after the SQL in CUSTOMER_CODING_SETUP.sql is executed.
  // We keep this function as a readable guard instead of attempting destructive schema changes from the frontend.
  return true;
}

export default function CustomerCoding() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CustomerCodingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase غير مضبوط');
      await ensureCodingTables();
      const { data, error } = await supabase
        .from('customer_coding_requests')
        .select(
          'id,customer_name,phone,address,branch,notes,source,status,created_by_name,created_at,beeconnect_coded_at,welcome_sent_at,customers_db_saved_at,phone_saved_at,evaluated_at,closed_at,completed_by_name'
        )
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data || []) as CustomerCodingRow[]);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'تعذر تحميل تكويد العملاء');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (branchFilter !== 'all' && row.branch !== branchFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          row.customer_name.toLowerCase().includes(q) ||
          row.phone.includes(q) ||
          String(row.notes || '')
            .toLowerCase()
            .includes(q)
        );
      }),
    [branchFilter, rows, search, statusFilter]
  );

  const branches = useMemo(
    () => [
      'all',
      ...Array.from(new Set(rows.map((row) => row.branch).filter(Boolean) as string[])),
    ],
    [rows]
  );
  const summary = useMemo(
    () => ({
      open: rows.filter((r) => !r.status || r.status === 'open').length,
      in_progress: rows.filter((r) => r.status === 'in_progress').length,
      completed: rows.filter((r) => r.status === 'completed').length,
      blocked: rows.filter((r) => r.status === 'blocked').length,
    }),
    [rows]
  );

  function exportExcel() {
    if (!filtered.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    const exportRows = filtered.map((row) => {
      const extended = row as CustomerCodingRow & {
        customer_code?: string | null;
        whatsapp?: string | null;
        whatsapp_phone?: string | null;
        updated_at?: string | null;
      };
      return {
        'كود العميل': extended.customer_code || '',
        'اسم العميل': row.customer_name,
        'رقم الهاتف': row.phone,
        'رقم واتساب': extended.whatsapp || extended.whatsapp_phone || '',
        العنوان: row.address || '',
        الفرع: row.branch || '',
        الحالة: STATUS_LABEL[String(row.status || 'open')] || row.status || '',
        المصدر: row.source || '',
        الملاحظات: row.notes || '',
        'تاريخ الإنشاء': row.created_at,
        'تاريخ آخر تحديث': extended.updated_at || '',
        'من أنشأ الطلب': row.created_by_name || '',
        'من أغلق الطلب': row.completed_by_name || '',
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تكويد العملاء');
    const branchPart =
      branchFilter === 'all'
        ? 'كل_الفروع'
        : String(branchFilter).replace(/\s+/g, '_');
    const filename = `تصدير_تكويد_العملاء_${branchPart}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
    toast.success('تم تصدير ملف Excel');
  }

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    const phone = normalizePhone(form.phone);
    if (!form.customer_name.trim() || !phone) {
      toast.error('اكتب اسم العميل ورقم الهاتف');
      return;
    }
    setSaving(true);
    try {
      const existing = await supabase
        .from('customer_coding_requests')
        .select('id,status')
        .eq('phone', phone)
        .in('status', ['open', 'in_progress', 'blocked'])
        .limit(1);
      if (existing.data?.length) {
        toast.error('يوجد طلب مفتوح لنفس رقم الهاتف بالفعل');
        return;
      }
      const { error } = await supabase.from('customer_coding_requests').insert({
        customer_name: form.customer_name.trim(),
        phone,
        address: form.address.trim() || null,
        branch: form.branch || null,
        source: form.source || 'داخل الفرع',
        notes: form.notes.trim() || null,
        status: 'open',
        created_by: user?.id || null,
        created_by_name: user?.name || user?.email || 'غير محدد',
      });
      if (error) throw error;
      toast.success('تم تسجيل العميل للتكويد');
      setForm(EMPTY_FORM);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الطلب');
    } finally {
      setSaving(false);
    }
  }

  async function markStep(row: CustomerCodingRow, key: string) {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: key === 'closed' ? 'completed' : 'in_progress',
      completed_by_name: user?.name || user?.email || 'غير محدد',
    };
    if (key === 'beeconnect') patch.beeconnect_coded_at = now;
    if (key === 'welcome') patch.welcome_sent_at = now;
    if (key === 'customers_db') patch.customers_db_saved_at = now;
    if (key === 'phone_saved') patch.phone_saved_at = now;
    if (key === 'evaluated') patch.evaluated_at = now;
    if (key === 'closed') patch.closed_at = now;
    try {
      const { error } = await supabase
        .from('customer_coding_requests')
        .update(patch)
        .eq('id', row.id);
      if (error) throw error;
      if (key === 'customers_db') {
        await supabase
          .from('customers')
          .upsert(
            { name: row.customer_name, phone: row.phone, branch: row.branch, notes: row.notes },
            { onConflict: 'phone' }
          )
          .then(() => undefined);
      }
      toast.success('تم تحديث الخطوة');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث الخطوة');
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-white">
              <UserPlus className="text-teal-300" />
              تكويد العميل
            </h1>
            <p className="mt-1 text-sm font-bold text-slate-400">
              تسجيل أي عميل لم يتم تكويده على BeeConnect ومتابعة خطوات التكويد والترحيب والحفظ.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-4 py-2 text-sm font-black text-white"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm font-bold text-red-100">
          <AlertTriangle size={16} className="inline ml-2" />
          {error}
          <div className="mt-2 text-xs text-red-200">
            لو الجدول غير موجود، شغّل ملف CUSTOMER_CODING_SETUP.sql المرفق في Supabase SQL Editor.
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="مفتوحة" value={summary.open} tone="cyan" />
        <SummaryCard label="جاري" value={summary.in_progress} tone="amber" />
        <SummaryCard label="مكتملة" value={summary.completed} tone="emerald" />
        <SummaryCard label="متعذرة" value={summary.blocked} tone="red" />
      </div>

      <form
        onSubmit={createRequest}
        className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-5"
      >
        <h2 className="mb-4 flex items-center gap-2 font-black text-white">
          <Plus size={18} />
          تسجيل عميل جديد غير مكود
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <input
            value={form.customer_name}
            onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            placeholder="اسم العميل"
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white outline-none"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="رقم الهاتف"
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white outline-none"
          />
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="العنوان إن وجد"
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white outline-none"
          />
          <select
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white"
          >
            <option>فرع شكري</option>
            <option>فرع الشامي</option>
          </select>
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white"
          >
            <option>داخل الفرع</option>
            <option>واتساب</option>
            <option>اتصال</option>
            <option>دليفري</option>
            <option>أخرى</option>
          </select>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="ملاحظات"
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-white outline-none"
          />
        </div>
        <button
          disabled={saving}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          <Plus size={16} /> حفظ طلب التكويد
        </button>
      </form>

      <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو الملاحظات"
              className="flex-1 bg-transparent text-sm font-bold text-white outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-white"
          >
            <option value="all">كل الحالات</option>
            <option value="open">مفتوحة</option>
            <option value="in_progress">جاري</option>
            <option value="completed">مكتملة</option>
            <option value="blocked">متعذرة</option>
          </select>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-white"
          >
            <option value="all">كل الفروع</option>
            {branches
              .filter((b) => b !== 'all')
              .map((b) => (
                <option key={b}>{b}</option>
              ))}
          </select>
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-500/40 bg-teal-600/20 px-4 py-2 text-sm font-black text-teal-100"
          >
            <Download size={16} />
            تصدير Excel
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {filtered.map((row) => (
          <RequestCard key={row.id} row={row} onMark={markStep} />
        ))}
        {!loading && !filtered.length && (
          <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-10 text-center font-bold text-slate-400">
            لا توجد طلبات مطابقة
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'cyan' | 'amber' | 'emerald' | 'red';
}) {
  const colors = {
    cyan: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    emerald: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    red: 'border-red-400/30 bg-red-500/10 text-red-100',
  }[tone];
  return (
    <div className={`rounded-3xl border p-5 ${colors}`}>
      <div className="text-xs font-bold opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-black">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}

function RequestCard({
  row,
  onMark,
}: {
  row: CustomerCodingRow;
  onMark: (row: CustomerCodingRow, key: string) => void;
}) {
  const wa = `https://wa.me/${normalizePhone(row.phone).replace(/^0/, '20')}`;
  return (
    <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-black text-white">{row.customer_name}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-400">
            <span>{row.phone}</span>
            <span>{row.branch || 'غير محدد'}</span>
            <span>سجله: {row.created_by_name || 'غير محدد'}</span>
            <span>{fmt(row.created_at)}</span>
          </div>
          {row.notes && (
            <div className="mt-2 rounded-2xl bg-slate-950/40 p-3 text-sm text-slate-300">
              {row.notes}
            </div>
          )}
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(row.status)}`}
        >
          {STATUS_LABEL[row.status || 'open'] || row.status || 'مفتوحة'}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`tel:${row.phone}`}
          className="inline-flex items-center gap-1 rounded-xl border border-cyan-400/30 px-3 py-2 text-xs font-black text-cyan-100"
        >
          <Phone size={14} /> اتصال
        </a>
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/30 px-3 py-2 text-xs font-black text-emerald-100"
        >
          <MessageCircle size={14} /> واتساب
        </a>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-4">
        {STEPS.map((step) => {
          const done = stepDone(row, step.key);
          return (
            <button
              key={step.key}
              onClick={() => !done && onMark(row, step.key)}
              disabled={done}
              className={`rounded-2xl border p-3 text-right text-xs font-black transition ${done ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-slate-700 bg-slate-950/30 text-slate-300 hover:border-teal-400/40'}`}
            >
              {done ? (
                <CheckCircle2 size={15} className="mb-1" />
              ) : (
                <Clock size={15} className="mb-1" />
              )}
              {step.label}
              <div className="mt-1 text-[11px] font-bold opacity-70">
                {done ? 'تم' : 'اضغط للتنفيذ'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
