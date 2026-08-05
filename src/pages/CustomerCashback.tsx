import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  FilePlus2,
  Gift,
  MessageSquare,
  Percent,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Upload,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { cashbackStatusLabel } from '@/lib/api/customerLoyalty';
import { cleanEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import { normalizeBranchName } from '@/lib/branch';
import CustomerQuickDetailsModal from '@/components/customers/CustomerQuickDetailsModal';
import { exportToExcel } from '@/lib/exportExcel';

type CashbackRow = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  cycle_label: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  total_spent: number | null;
  cashback_rate: number | null;
  cashback_value: number | null;
  redeemed_value: number | null;
  remaining_value?: number | null;
  status: string | null;
  notified_at: string | null;
  bconnect_updated_at: string | null;
  settled_at: string | null;
  notes: string | null;
};

const ALL = '__all__';
const SCRIPT_TEMPLATES = [
  {
    key: 'friendly',
    label: 'رسالة ودية مختصرة',
    build: (row: CashbackRow) =>
      `أهلاً أ/ ${row.customer_name || 'حضرتك'} 🌷\nمع حضرتك خدمة عملاء صيدليات دواء.\nحابين نبلغ حضرتك إن ليك نقاط/كاش باك بقيمة ${formatCurrency(row.cashback_value || 0)} عن مشترياتك في الفترة الحالية.\nتقدر تستخدمها في زيارتك القادمة أو مع الأوردر القادم إن شاء الله.\nصيدليات دواء تحت أمر حضرتك دائمًا.`,
  },
  {
    key: 'detailed',
    label: 'رسالة تفصيلية بالقيمة',
    build: (row: CashbackRow) =>
      `أهلاً بحضرتك أ/ ${row.customer_name || 'حضرتك'} 🌷\nإجمالي مشتريات حضرتك في الدورة: ${formatCurrency(row.total_spent || 0)}\nنسبة الكاش باك: ${Number(row.cashback_rate || 0)}%\nقيمة النقاط المستحقة: ${formatCurrency(row.cashback_value || 0)}\nالمتبقي المتاح: ${formatCurrency(remaining(row))}\nلو حضرتك تحب تستخدم النقاط في الأوردر القادم، ابعتلنا وهنساعد حضرتك فورًا.`,
  },
  {
    key: 'vip',
    label: 'رسالة عميل مهم',
    build: (row: CashbackRow) =>
      `أهلاً أ/ ${row.customer_name || 'حضرتك'}، حضرتك من عملائنا المهمين في صيدليات دواء 🌿\nتم احتساب نقاط/كاش باك لحضرتك بقيمة ${formatCurrency(row.cashback_value || 0)} تقديرًا لثقة حضرتك فينا.\nفريق خدمة العملاء تحت أمرك لاستخدامها أو تجهيز احتياجات حضرتك القادمة.`,
  },
];

function quarterBounds(date = new Date()) {
  const month = date.getMonth();
  const startMonth = Math.floor(month / 3) * 3;
  const start = new Date(date.getFullYear(), startMonth, 1);
  const end = new Date(date.getFullYear(), startMonth + 3, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function previousQuarterBounds() {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return quarterBounds(date);
}

function remaining(row: CashbackRow) {
  return Math.max(0, Number(row.cashback_value || 0) - Number(row.redeemed_value || 0));
}

function cashbackValueForRate(row: CashbackRow, rate: number) {
  return Math.round(Number(row.total_spent || 0) * (rate / 100) * 100) / 100;
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ar-EG');
}

function normalizeNeedle(value: string) {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function matchWildcard(value: unknown, query: string) {
  const raw = String(value || '').toLowerCase();
  const compact = normalizeNeedle(raw);
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  if (!trimmed.includes('*'))
    return raw.includes(trimmed) || compact.includes(normalizeNeedle(trimmed));
  const parts = trimmed.split('*').map(normalizeNeedle).filter(Boolean);
  if (!parts.length) return true;
  let cursor = 0;
  for (const part of parts) {
    const index = compact.indexOf(part, cursor);
    if (index === -1) return false;
    cursor = index + part.length;
  }
  return true;
}

function systemLogged(row: CashbackRow) {
  return Boolean(
    row.notes?.trim() ||
    row.notified_at ||
    row.bconnect_updated_at ||
    row.settled_at ||
    Number(row.redeemed_value || 0) > 0
  );
}

async function logCashbackEvent(
  row: CashbackRow,
  eventType: string,
  amount?: number,
  notes?: string
) {
  await supabase.from('customer_cashback_events').insert({
    cycle_id: row.id,
    customer_code: row.customer_code,
    event_type: eventType,
    amount: amount ?? null,
    notes: notes ?? null,
  });
}

function rowTone(status?: string | null) {
  switch (String(status || 'calculated')) {
    case 'notified':
      return 'border-emerald-300/60 bg-emerald-500/10';
    case 'bconnect_updated':
      return 'border-violet-300/60 bg-violet-500/10';
    case 'partially_redeemed':
      return 'border-cyan-300/60 bg-cyan-500/10';
    case 'settled':
      return 'border-sky-300/60 bg-sky-500/10';
    default:
      return 'border-amber-300/60 bg-amber-500/10';
  }
}

function summaryTone(kind: string, active: boolean) {
  const activeCls = active
    ? 'ring-2 ring-teal-300 ring-offset-2 ring-offset-[var(--theme-bg)]'
    : '';
  if (kind === 'notified')
    return `border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100 ${activeCls}`;
  if (kind === 'bconnect')
    return `border-violet-300/60 bg-violet-500/10 text-violet-700 dark:text-violet-100 ${activeCls}`;
  if (kind === 'settled')
    return `border-sky-300/60 bg-sky-500/10 text-sky-700 dark:text-sky-100 ${activeCls}`;
  if (kind === 'partial')
    return `border-cyan-300/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100 ${activeCls}`;
  if (kind === 'rate3')
    return `border-lime-300/60 bg-lime-500/10 text-lime-700 dark:text-lime-100 ${activeCls}`;
  if (kind === 'rate5')
    return `border-teal-300/60 bg-teal-500/10 text-teal-700 dark:text-teal-100 ${activeCls}`;
  if (kind === 'systemLog')
    return `border-slate-300/60 bg-slate-500/10 text-slate-700 dark:text-slate-100 ${activeCls}`;
  if (kind === 'available')
    return `border-teal-300/60 bg-teal-500/10 text-teal-700 dark:text-teal-100 ${activeCls}`;
  return `border-amber-300/60 bg-amber-500/10 text-amber-700 dark:text-amber-100 ${activeCls}`;
}

function CashbackActionButtons({
  row,
  wa,
  setSelected,
  notifyCustomer,
  updateRow,
  recordRedeem,
  setCustomerCashbackRate,
  multiply,
  addVoucher,
  copyScript,
}: {
  row: CashbackRow;
  wa: string;
  setSelected: (row: CashbackRow) => void;
  notifyCustomer: (row: CashbackRow) => void;
  updateRow: (
    row: CashbackRow,
    patch: Partial<CashbackRow>,
    eventType: string,
    amount?: number,
    notes?: string
  ) => Promise<void>;
  recordRedeem: (row: CashbackRow) => void;
  setCustomerCashbackRate: (row: CashbackRow, rate: 3 | 5) => void;
  multiply: (row: CashbackRow) => void;
  addVoucher: (row: CashbackRow) => void;
  copyScript: (row: CashbackRow, templateKey?: string) => void;
}) {
  const base =
    'inline-flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-black transition hover:scale-[1.01]';
  return (
    <div className="cashback-action-grid">
      <button
        type="button"
        className={`${base} border-slate-400/50 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white`}
        onClick={() => setSelected(row)}
      >
        <Eye className="h-4 w-4" /> عرض
      </button>
      {wa ? (
        <a
          className={`${base} border-emerald-300/70 bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-50`}
          href={wa}
          target="_blank"
          rel="noreferrer"
        >
          <MessageSquare className="h-4 w-4" /> واتساب
        </a>
      ) : null}
      <button
        type="button"
        className={`${base} border-teal-300/70 bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-50`}
        onClick={() => notifyCustomer(row)}
      >
        <Send className="h-4 w-4" /> تم تبليغه
      </button>
      <button
        type="button"
        className={`${base} border-violet-300/70 bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-50`}
        onClick={() =>
          updateRow(
            row,
            { status: 'bconnect_updated', bconnect_updated_at: new Date().toISOString() },
            'bconnect_updated'
          )
        }
      >
        <Smartphone className="h-4 w-4" /> بي كونكت
      </button>
      <button
        type="button"
        className={`${base} border-amber-300/70 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-50`}
        onClick={() => recordRedeem(row)}
      >
        <WalletCards className="h-4 w-4" /> سحب جزء
      </button>
      <button
        type="button"
        className={`${base} border-lime-300/70 bg-lime-100 text-lime-900 dark:bg-lime-500/20 dark:text-lime-50`}
        onClick={() => setCustomerCashbackRate(row, 3)}
      >
        <Percent className="h-4 w-4" /> نظام 3%
      </button>
      <button
        type="button"
        className={`${base} border-cyan-300/70 bg-cyan-100 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-50`}
        onClick={() => setCustomerCashbackRate(row, 5)}
      >
        <Percent className="h-4 w-4" /> نظام 5%
      </button>
      <button
        type="button"
        className={`${base} border-fuchsia-300/70 bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-500/20 dark:text-fuchsia-50`}
        onClick={() => multiply(row)}
      >
        مضاعفة
      </button>
      <button
        type="button"
        className={`${base} border-indigo-300/70 bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-50`}
        onClick={() => addVoucher(row)}
      >
        <Gift className="h-4 w-4" /> فاوتشر
      </button>
      <button
        type="button"
        className={`${base} border-sky-300/70 bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-50`}
        onClick={() =>
          updateRow(
            row,
            {
              redeemed_value: Number(row.cashback_value || 0),
              settled_at: new Date().toISOString(),
              status: 'settled',
            },
            'settled'
          )
        }
      >
        <CheckCircle2 className="h-4 w-4" /> تسوية كاملة
      </button>
      <button
        type="button"
        className={`${base} border-slate-300/70 bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white`}
        onClick={() => copyScript(row, 'friendly')}
      >
        <Clipboard className="h-4 w-4" /> سكريبت 1
      </button>
      <button
        type="button"
        className={`${base} border-slate-300/70 bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white`}
        onClick={() => copyScript(row, 'detailed')}
      >
        <Clipboard className="h-4 w-4" /> سكريبت 2
      </button>
      <button
        type="button"
        className={`${base} border-slate-300/70 bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white`}
        onClick={() => copyScript(row, 'vip')}
      >
        <Clipboard className="h-4 w-4" /> VIP
      </button>
    </div>
  );
}

function CashbackMobileCard({
  row,
  responsible,
  wa,
  setSelected,
  notifyCustomer,
  updateRow,
  recordRedeem,
  setCustomerCashbackRate,
  multiply,
  addVoucher,
  copyScript,
}: {
  row: CashbackRow;
  responsible: string;
  wa: string;
  setSelected: (row: CashbackRow) => void;
  notifyCustomer: (row: CashbackRow) => void;
  updateRow: (
    row: CashbackRow,
    patch: Partial<CashbackRow>,
    eventType: string,
    amount?: number,
    notes?: string
  ) => Promise<void>;
  recordRedeem: (row: CashbackRow) => void;
  setCustomerCashbackRate: (row: CashbackRow, rate: 3 | 5) => void;
  multiply: (row: CashbackRow) => void;
  addVoucher: (row: CashbackRow) => void;
  copyScript: (row: CashbackRow, templateKey?: string) => void;
}) {
  return (
    <article className={`cashback-responsive-card ${rowTone(row.status)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-[var(--theme-heading)]">
            {row.customer_name || 'عميل بدون اسم'}
          </div>
          <div className="mt-1 text-xs font-bold text-[var(--theme-muted)]">
            code:{row.customer_code || '-'} · {row.customer_phone || 'بدون رقم'}
          </div>
          <div className="mt-1 text-xs font-bold text-[var(--theme-muted)]">
            {row.branch || '-'} · المسؤول: {responsible}
          </div>
        </div>
        <span className="rounded-full border border-teal-300/60 bg-teal-500/15 px-3 py-1 text-xs font-black text-teal-100">
          {cashbackStatusLabel(row.status)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniCashbackStat label="المشتريات" value={formatCurrency(row.total_spent || 0)} />
        <MiniCashbackStat label="المستحق" value={formatCurrency(row.cashback_value || 0)} />
        <MiniCashbackStat label="المتبقي" value={formatCurrency(remaining(row))} />
        <MiniCashbackStat label="النسبة" value={`${Number(row.cashback_rate || 0)}%`} />
      </div>
      <div className="mt-2 text-xs font-bold text-[var(--theme-muted)]">
        الدورة: {row.cycle_label || `${row.cycle_start || ''} - ${row.cycle_end || ''}`} · آخر
        إجراء:{' '}
        {row.settled_at
          ? `تسوية ${formatDate(row.settled_at)}`
          : row.bconnect_updated_at
            ? `بي كونكت ${formatDate(row.bconnect_updated_at)}`
            : row.notified_at
              ? `تبليغ ${formatDate(row.notified_at)}`
              : 'لم يتم'}
      </div>
      <div className="mt-3">
        <CashbackActionButtons
          row={row}
          wa={wa}
          setSelected={setSelected}
          notifyCustomer={notifyCustomer}
          updateRow={updateRow}
          recordRedeem={recordRedeem}
          setCustomerCashbackRate={setCustomerCashbackRate}
          multiply={multiply}
          addVoucher={addVoucher}
          copyScript={copyScript}
        />
      </div>
    </article>
  );
}

function MiniCashbackStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
      <div className="text-[11px] font-bold text-[var(--theme-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--theme-heading)]">{value}</div>
    </div>
  );
}

export default function CustomerCashback() {
  const current = useMemo(() => quarterBounds(), []);
  const previous = useMemo(() => previousQuarterBounds(), []);
  const [cycleStart, setCycleStart] = useState(current.start);
  const [cycleEnd, setCycleEnd] = useState(current.end);
  const [rows, setRows] = useState<CashbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState(ALL);
  const [responsibleFilter, setResponsibleFilter] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [quickFilter, setQuickFilter] = useState<string>('pending');
  const [selected, setSelected] = useState<CashbackRow | null>(null);
  const [responsiblesMap, setResponsiblesMap] = useState<Record<string, string>>({});
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntry, setManualEntry] = useState<{ customer_code: string; customer_name: string; customer_phone: string; branch: string; total_spent: string; cashback_rate: string }>({
    customer_code: '', customer_name: '', customer_phone: '', branch: BRANCHES[0],
    total_spent: '', cashback_rate: '5',
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<Array<{
    id: string; customer_code: string; customer_name: string;
    before: { status: string; redeemed_value: number; notes: string };
    after: { status: string; redeemed_value: number; notes: string };
    matched: boolean;
  }>>([]);
  const [applyingImport, setApplyingImport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('staff_accounts')
      .select('name, branch')
      .eq('role', 'customer_service_manager')
      .eq('active', true)
      .eq('can_login', true)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        (data as Array<{ name: string; branch: string | null }>).forEach((row) => {
          const normalized = normalizeBranchName(row.branch || '');
          if (normalized) map[normalized] = row.name;
        });
        setResponsiblesMap(map);
      });
    return () => { cancelled = true; };
  }, []);

  const getResponsible = useCallback(
    (branchName: string | null) => responsiblesMap[normalizeBranchName(branchName || '')] || 'غير محدد',
    [responsiblesMap]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('customer_cashback_cycles')
        .select(
          'id,customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,total_spent,cashback_rate,cashback_value,redeemed_value,remaining_value,status,notified_at,bconnect_updated_at,settled_at,notes'
        )
        .gte('cycle_start', cycleStart)
        .lte('cycle_end', cycleEnd)
        .order('cashback_value', { ascending: false })
        .limit(1200);
      if (branch !== ALL) query = query.eq('branch', branch);
      if (status !== ALL) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as CashbackRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الكاش باك');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branch, cycleEnd, cycleStart, status]);

  useEffect(() => {
    load();
  }, [load]);

  const calculate = async () => {
    setCalculating(true);
    try {
      const { data, error } = await supabase.rpc('calculate_customer_cashback_cycle_v6', {
        p_cycle_start: cycleStart,
        p_cycle_end: cycleEnd,
      });
      if (error) throw error;
      toast.success(`تم احتساب الكاش باك لعدد ${Number(data || 0).toLocaleString('ar-EG')} عميل`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'تعذر احتساب الكاش باك. تأكد من تشغيل SQL الخاص بالكاش باك.'
      );
    } finally {
      setCalculating(false);
    }
  };

  const exportCashbackExcel = async () => {
    if (!searched.length) { toast.error('مفيش بيانات تتصدر دلوقتي.'); return; }
    const sheetRows = searched.map((row) => ({
      'الكود': row.customer_code || '',
      'الاسم': row.customer_name || '',
      'الهاتف': row.customer_phone || '',
      'الفرع': row.branch || '',
      'المسؤول': getResponsible(row.branch),
      'الدورة': row.cycle_label || `${row.cycle_start || ''} - ${row.cycle_end || ''}`,
      'إجمالي المشتريات': Number(row.total_spent || 0),
      'نسبة الكاش باك': Number(row.cashback_rate || 0),
      'قيمة الكاش باك': Number(row.cashback_value || 0),
      'المسحوب': Number(row.redeemed_value || 0),
      'المتبقي': remaining(row),
      'الحالة': cashbackStatusLabel(row.status),
      'تم التبليغ': row.notified_at ? formatDate(row.notified_at) : '',
      'تحديث بي كونكت': row.bconnect_updated_at ? formatDate(row.bconnect_updated_at) : '',
      'تمت التسوية': row.settled_at ? formatDate(row.settled_at) : '',
      'ملاحظات': row.notes || '',
    }));
    await exportToExcel(sheetRows, `كاش_باك_العملاء_${cycleStart}_${cycleEnd}`, 'الكاش باك');
  };

  const saveManualEntry = async () => {
    if (!manualEntry.customer_code.trim() || !manualEntry.total_spent) {
      toast.error('لازم كود العميل وإجمالي المشتريات على الأقل.');
      return;
    }
    setCalculating(true);
    try {
      const rate = Number(manualEntry.cashback_rate);
      const totalSpent = Number(manualEntry.total_spent);
      const cashbackValue = Math.round(totalSpent * (rate / 100) * 100) / 100;
      const { error } = await supabase.from('customer_cashback_cycles').upsert({
        customer_code: manualEntry.customer_code.trim(),
        customer_name: manualEntry.customer_name.trim() || null,
        customer_phone: manualEntry.customer_phone.trim() || null,
        branch: manualEntry.branch,
        cycle_label: `يدوي ${cycleStart} - ${cycleEnd}`,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        total_spent: totalSpent,
        cashback_rate: rate,
        cashback_value: cashbackValue,
        redeemed_value: 0,
        status: 'pending',
        notes: 'اتضاف يدويًا من صفحة كاش باك العملاء',
      });
      if (error) throw error;
      toast.success('اتحفظ الاحتساب اليدوي');
      setManualEntry({ customer_code: '', customer_name: '', customer_phone: '', branch: BRANCHES[0], total_spent: '', cashback_rate: '5' });
      setShowManualEntry(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الاحتساب اليدوي');
    } finally {
      setCalculating(false);
    }
  };

  const STATUS_LABEL_TO_VALUE: Record<string, string> = {
    'تم احتساب النقاط': 'calculated',
    'تم تبليغ العميل': 'notified',
    'تم تحديث بي كونكت': 'bconnect_updated',
    'تم سحب جزء': 'partially_redeemed',
    'تمت التسوية': 'settled',
  };

  const handleImportFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const byCode = new Map(rows.map((row) => [String(row.customer_code || '').trim(), row]));
      const preview = sheetRows
        .map((sheetRow) => {
          const code = String(sheetRow['الكود'] ?? sheetRow['customer_code'] ?? '').trim();
          const existing = byCode.get(code);
          if (!existing) {
            return {
              id: '', customer_code: code, customer_name: String(sheetRow['الاسم'] || ''),
              before: { status: '', redeemed_value: 0, notes: '' },
              after: { status: '', redeemed_value: 0, notes: '' },
              matched: false,
            };
          }
          const statusRaw = String(sheetRow['الحالة'] ?? '').trim();
          const newStatus = STATUS_LABEL_TO_VALUE[statusRaw] || String(existing.status || '');
          const redeemedRaw = sheetRow['المسحوب'];
          const newRedeemed = redeemedRaw !== undefined && redeemedRaw !== '' ? Number(redeemedRaw) : Number(existing.redeemed_value || 0);
          const newNotes = sheetRow['ملاحظات'] !== undefined && sheetRow['ملاحظات'] !== '' ? String(sheetRow['ملاحظات']) : String(existing.notes || '');
          return {
            id: existing.id, customer_code: code, customer_name: existing.customer_name || '',
            before: { status: String(existing.status || ''), redeemed_value: Number(existing.redeemed_value || 0), notes: String(existing.notes || '') },
            after: { status: newStatus, redeemed_value: newRedeemed, notes: newNotes },
            matched: true,
          };
        })
        .filter((item) => item.customer_code);
      setImportPreview(preview);
      if (!preview.length) toast.error('الملف فاضي أو مفيش عمود "الكود" فيه.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة الملف. تأكد إنه ملف Excel صحيح.');
    }
  };

  const applyImport = async () => {
    const changed = importPreview.filter((item) => item.matched && (
      item.after.status !== item.before.status ||
      item.after.redeemed_value !== item.before.redeemed_value ||
      item.after.notes !== item.before.notes
    ));
    if (!changed.length) { toast.error('مفيش أي تعديل حقيقي يتطبق.'); return; }
    setApplyingImport(true);
    try {
      for (const item of changed) {
        const { error } = await supabase.from('customer_cashback_cycles').update({
          status: item.after.status, redeemed_value: item.after.redeemed_value, notes: item.after.notes,
        }).eq('id', item.id);
        if (error) throw error;
      }
      toast.success(`اتحدّث ${changed.length} صف بنجاح`);
      setImportPreview([]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تطبيق كل التعديلات');
    } finally {
      setApplyingImport(false);
    }
  };

  const patchLocalRow = (rowId: string, patch: Partial<CashbackRow>) => {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const updateRow = async (
    row: CashbackRow,
    patch: Partial<CashbackRow>,
    eventType: string,
    amount?: number,
    notes?: string
  ): Promise<void> => {
    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };
    const { error } = await supabase
      .from('customer_cashback_cycles')
      .update({ ...nextPatch, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    patchLocalRow(row.id, nextPatch);
    await logCashbackEvent(row, eventType, amount, notes);
    toast.success('تم تحديث حالة الكاش باك');
  };

  const setCustomerCashbackRate = async (row: CashbackRow, rate: 3 | 5) => {
    if (!row.customer_code) {
      toast.error('لا يمكن تعديل النسبة لأن كود العميل غير موجود');
      return;
    }
    const cashbackValue = cashbackValueForRate(row, rate);
    const redeemedValue = Number(row.redeemed_value || 0);
    const { error: accountError } = await supabase.from('customer_cashback_accounts').upsert(
      {
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        branch: row.branch,
        cashback_rate: rate,
        cashback_enabled: true,
        cashback_multiplier: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_code' }
    );
    if (accountError) {
      toast.error(accountError.message);
      return;
    }
    await updateRow(
      row,
      {
        cashback_rate: rate,
        cashback_value: cashbackValue,
        remaining_value: Math.max(0, cashbackValue - redeemedValue),
        notes: `${row.notes || ''}\nتم تحويل العميل إلى نظام ${rate}%`.trim(),
      },
      `rate_${rate}`,
      rate,
      `تعديل نسبة الكاش باك إلى ${rate}%`
    );
  };

  const recordRedeem = async (row: CashbackRow) => {
    const available = remaining(row);
    const value = Number(window.prompt(`قيمة السحب من الكاش باك (المتاح حاليًا: ${formatCurrency(available)})`, '0') || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    if (value > available) {
      toast.error(`لا يمكن سحب أكثر من الرصيد المتاح (${formatCurrency(available)}).`);
      return;
    }
    const newRedeemed = Number(row.redeemed_value || 0) + value;
    await updateRow(
      row,
      {
        redeemed_value: newRedeemed,
        status: newRedeemed >= Number(row.cashback_value || 0) ? 'settled' : 'partially_redeemed',
        settled_at:
          newRedeemed >= Number(row.cashback_value || 0)
            ? new Date().toISOString()
            : row.settled_at,
      },
      'redeem',
      value,
      'سحب جزء من رصيد الكاش باك'
    );
  };

  const addVoucher = async (row: CashbackRow) => {
    const value = Number(window.prompt('قيمة الفاوتشر أو الهدية الإضافية', '0') || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    if (row.customer_code) {
      // لازم نحفظ الفاوتشر في customer_cashback_accounts كمان، لأن الدالة اللي بتحسب
      // الكاش باك (calculate_customer_cashback_cycle_v6) بتقرأ منها في كل إعادة حساب —
      // من غير ده، أي إعادة حساب هتمسح الفاوتشر اللي اتضاف من هنا من غير ما حد ياخد باله.
      const { data: existing } = await supabase
        .from('customer_cashback_accounts')
        .select('voucher_value')
        .eq('customer_code', row.customer_code)
        .maybeSingle();
      await supabase.from('customer_cashback_accounts').upsert(
        {
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          branch: row.branch,
          voucher_value: Number(existing?.voucher_value || 0) + value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_code' }
      );
    }
    await updateRow(
      row,
      {
        cashback_value: Number(row.cashback_value || 0) + value,
        notes: `${row.notes || ''}\nفاوتشر إضافي: ${value}`.trim(),
      },
      'voucher',
      value,
      'إضافة فاوتشر/هدية'
    );
  };

  const MULTIPLY_MARKER = '[[cashback_multiplied]]';

  const multiply = async (row: CashbackRow) => {
    if ((row.notes || '').includes(MULTIPLY_MARKER)) {
      toast.error('تم مضاعفة الكاش باك لهذا العميل من قبل — لا يمكن تكرارها في نفس الدورة.');
      return;
    }
    if (row.customer_code) {
      // نفس مشكلة الفاوتشر: cashback_multiplier في customer_cashback_accounts هي اللي
      // بتتقرأ عند أي إعادة حساب، فلازم نحدّثها هنا وإلا المضاعفة هتتمسح تلقائيًا.
      await supabase.from('customer_cashback_accounts').upsert(
        {
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          branch: row.branch,
          cashback_multiplier: 2,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_code' }
      );
    }
    await updateRow(
      row,
      {
        cashback_value: Number(row.cashback_value || 0) * 2,
        notes: `${row.notes || ''}\n${MULTIPLY_MARKER} تمت مضاعفة الكاش باك لعميل مميز`.trim(),
      },
      'multiplied',
      Number(row.cashback_value || 0),
      'مضاعفة كاش باك'
    );
  };

  const notifyCustomer = async (row: CashbackRow) => {
    await updateRow(row, { status: 'notified', notified_at: new Date().toISOString() }, 'notified');
  };

  const copyScript = async (row: CashbackRow, templateKey = 'friendly') => {
    const template =
      SCRIPT_TEMPLATES.find((item) => item.key === templateKey) || SCRIPT_TEMPLATES[0];
    await navigator.clipboard.writeText(template.build(row));
    toast.success(`تم نسخ: ${template.label}`);
  };

  const whatsappScriptLink = (row: CashbackRow) => {
    const message = SCRIPT_TEMPLATES[0].build(row);
    return row.customer_phone
      ? generateWhatsAppLink(cleanEgyptianPhone(row.customer_phone), message)
      : '';
  };

  const searched = useMemo(
    () =>
      rows.filter((row) => {
        const needle = search.trim();
        const responsible = getResponsible(row.branch);
        if (responsibleFilter !== ALL && responsible !== responsibleFilter) return false;
        if (!needle) return true;
        return [
          row.customer_name,
          row.customer_code,
          row.customer_phone,
          row.branch,
          responsible,
        ].some((v) => matchWildcard(v, needle));
      }),
    [responsibleFilter, rows, search]
  );

  const summary = useMemo(() => {
    return searched.reduce(
      (acc, row) => {
        acc.total += 1;
        if (remaining(row) > 0) acc.available += 1;
        if (String(row.status || '') === 'calculated' || !row.status) acc.pending += 1;
        if (
          ['notified', 'bconnect_updated', 'partially_redeemed', 'settled'].includes(
            String(row.status || '')
          )
        )
          acc.notified += 1;
        if (String(row.status || '') === 'bconnect_updated') acc.bconnect += 1;
        if (String(row.status || '') === 'settled') acc.settled += 1;
        if (Number(row.redeemed_value || 0) > 0 && String(row.status || '') !== 'settled')
          acc.partial += 1;
        if (Number(row.cashback_rate || 0) === 3) acc.rate3 += 1;
        if (Number(row.cashback_rate || 0) === 5) acc.rate5 += 1;
        if (systemLogged(row)) acc.systemLog += 1;
        return acc;
      },
      {
        total: 0,
        available: 0,
        pending: 0,
        notified: 0,
        bconnect: 0,
        partial: 0,
        settled: 0,
        rate3: 0,
        rate5: 0,
        systemLog: 0,
      }
    );
  }, [searched]);

  const filtered = useMemo(() => {
    return searched.filter((row) => {
      if (quickFilter === 'all') return true;
      if (quickFilter === 'pending') return String(row.status || 'calculated') === 'calculated';
      if (quickFilter === 'available') return remaining(row) > 0;
      if (quickFilter === 'notified')
        return ['notified', 'bconnect_updated', 'partially_redeemed', 'settled'].includes(
          String(row.status || '')
        );
      if (quickFilter === 'bconnect') return String(row.status || '') === 'bconnect_updated';
      if (quickFilter === 'partial')
        return Number(row.redeemed_value || 0) > 0 && String(row.status || '') !== 'settled';
      if (quickFilter === 'settled') return String(row.status || '') === 'settled';
      if (quickFilter === 'rate3') return Number(row.cashback_rate || 0) === 3;
      if (quickFilter === 'rate5') return Number(row.cashback_rate || 0) === 5;
      if (quickFilter === 'systemLog') return systemLogged(row);
      return true;
    });
  }, [quickFilter, searched]);

  const totals = filtered.reduce(
    (acc, row) => {
      acc.spent += Number(row.total_spent || 0);
      acc.cashback += Number(row.cashback_value || 0);
      acc.remaining += remaining(row);
      return acc;
    },
    { spent: 0, cashback: 0, remaining: 0 }
  );

  const responsibleOptions = useMemo(() => [ALL, ...new Set(Object.values(responsiblesMap))], [responsiblesMap]);

  return (
    <div className="customer-service-page space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">Quarterly Customer Cashback</span>
          <h1 className="mt-3 text-2xl font-black text-[var(--theme-heading)]">
            نقاط العملاء / الكاش باك
          </h1>
          <p className="mt-1 text-sm font-semibold text-[var(--theme-muted)]">
            احتساب ومتابعة الكاش باك، تبليغ العملاء، تحديث بي كونكت، وسكريبتات واتساب جاهزة لكل
            عميل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="dawaa-button-primary"
            onClick={calculate}
            disabled={calculating}
          >
            {calculating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="h-4 w-4" />
            )}
            احتساب الكاش باك للدورة
          </button>
          <button type="button" className="btn-secondary" onClick={() => void exportCashbackExcel()}>
            <Download className="ml-1 inline h-4 w-4" /> تصدير Excel
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload className="ml-1 inline h-4 w-4" /> استيراد Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImportFile(file); e.target.value = ''; }} />
          <button type="button" className="btn-secondary" onClick={() => setShowManualEntry((v) => !v)}>
            <FilePlus2 className="ml-1 inline h-4 w-4" /> إضافة يدوية
          </button>
        </div>
      </section>

      {importPreview.length ? (
        <section className="dawaa-panel space-y-3 border border-cyan-400/30 bg-cyan-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-black text-white"><Upload className="text-cyan-300" size={18}/> معاينة التعديلات قبل التطبيق ({importPreview.length} صف في الملف)</h2>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => setImportPreview([])}>إلغاء</button>
              <button type="button" className="dawaa-button-primary text-xs" onClick={() => void applyImport()} disabled={applyingImport}>
                {applyingImport ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin"/> : <CheckCircle2 className="ml-1 inline h-4 w-4"/>} تطبيق التعديلات
              </button>
            </div>
          </div>
          <p className="text-xs font-bold text-amber-200">التعديل بيمس بس الحالة/المسحوب/الملاحظات — إجمالي المشتريات ونسبة وقيمة الكاش باك محميين، مبيتغيروش من الاستيراد.</p>
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {importPreview.map((item, i) => (
              <div key={`${item.customer_code}-${i}`} className={`rounded-xl border p-3 text-xs ${item.matched ? 'border-slate-700 bg-slate-950/40' : 'border-rose-400/30 bg-rose-500/10'}`}>
                {!item.matched ? (
                  <span className="font-bold text-rose-200">كود "{item.customer_code}" مش موجود في القائمة المحملة حاليًا — اتجاهل.</span>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-white">{item.customer_name} ({item.customer_code})</span>
                    <span className="text-slate-400">{cashbackStatusLabel(item.before.status)} ← <b className="text-cyan-200">{cashbackStatusLabel(item.after.status)}</b></span>
                    <span className="text-slate-400">مسحوب: {item.before.redeemed_value} ← <b className="text-cyan-200">{item.after.redeemed_value}</b></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showManualEntry ? (
        <section className="dawaa-panel space-y-3 border border-amber-400/30 bg-amber-500/5">
          <h2 className="flex items-center gap-2 font-black text-white"><FilePlus2 className="text-amber-300" size={18}/> احتساب كاش باك يدوي لعميل واحد</h2>
          <p className="text-xs font-bold text-slate-400">لعميل استثنائي مش داخل في الاحتساب التلقائي، أو تصحيح رقم بعينه بدون التأثير على باقي القائمة.</p>
          <div className="grid gap-3 lg:grid-cols-6">
            <input className="input-dark" placeholder="كود العميل" value={manualEntry.customer_code} onChange={(e) => setManualEntry((c) => ({ ...c, customer_code: e.target.value }))}/>
            <input className="input-dark" placeholder="اسم العميل" value={manualEntry.customer_name} onChange={(e) => setManualEntry((c) => ({ ...c, customer_name: e.target.value }))}/>
            <input className="input-dark" placeholder="الهاتف" value={manualEntry.customer_phone} onChange={(e) => setManualEntry((c) => ({ ...c, customer_phone: e.target.value }))}/>
            <select className="input-dark" value={manualEntry.branch} onChange={(e) => setManualEntry((c) => ({ ...c, branch: e.target.value }))}>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <input className="input-dark" type="number" placeholder="إجمالي المشتريات" value={manualEntry.total_spent} onChange={(e) => setManualEntry((c) => ({ ...c, total_spent: e.target.value }))}/>
            <select className="input-dark" value={manualEntry.cashback_rate} onChange={(e) => setManualEntry((c) => ({ ...c, cashback_rate: e.target.value }))}><option value="5">5%</option><option value="3">3%</option></select>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-bold text-emerald-200">قيمة الكاش باك: {formatCurrency(Math.round(Number(manualEntry.total_spent || 0) * (Number(manualEntry.cashback_rate) / 100) * 100) / 100)}</div>
            <button type="button" className="dawaa-button-primary mr-auto" onClick={() => void saveManualEntry()} disabled={calculating}>حفظ الاحتساب اليدوي</button>
          </div>
        </section>
      ) : null}

      <section className="dawaa-panel grid gap-3 lg:grid-cols-7">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setCycleStart(current.start);
            setCycleEnd(current.end);
          }}
        >
          الدورة الحالية
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setCycleStart(previous.start);
            setCycleEnd(previous.end);
          }}
        >
          الدورة السابقة
        </button>
        <input
          type="date"
          className="dawaa-input"
          value={cycleStart}
          onChange={(e) => setCycleStart(e.target.value)}
        />
        <input
          type="date"
          className="dawaa-input"
          value={cycleEnd}
          onChange={(e) => setCycleEnd(e.target.value)}
        />
        <select className="dawaa-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value={ALL}>كل الفروع</option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          className="dawaa-input"
          value={responsibleFilter}
          onChange={(e) => setResponsibleFilter(e.target.value)}
        >
          <option value={ALL}>كل المسؤولين</option>
          {responsibleOptions
            .filter((item) => item !== ALL)
            .map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
        </select>
        <select className="dawaa-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value={ALL}>كل الحالات</option>
          {['calculated', 'notified', 'bconnect_updated', 'partially_redeemed', 'settled'].map(
            (s) => (
              <option key={s} value={s}>
                {cashbackStatusLabel(s)}
              </option>
            )
          )}
        </select>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-10">
        {[
          { key: 'all', label: 'إجمالي العملاء', value: summary.total },
          { key: 'pending', label: 'لم يتم التعامل', value: summary.pending },
          { key: 'available', label: 'لهم نقاط', value: summary.available },
          { key: 'notified', label: 'تم تبليغهم', value: summary.notified },
          { key: 'bconnect', label: 'اتغيروا على بي كونكت', value: summary.bconnect },
          { key: 'partial', label: 'سحبوا جزء', value: summary.partial },
          { key: 'settled', label: 'تمت التسوية', value: summary.settled },
          { key: 'rate5', label: 'عملاء 5%', value: summary.rate5 },
          { key: 'rate3', label: 'عملاء 3%', value: summary.rate3 },
          { key: 'systemLog', label: 'سجل السيستم', value: summary.systemLog },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setQuickFilter(item.key)}
            className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${summaryTone(item.key, quickFilter === item.key)}`}
          >
            <div className="text-xs font-bold">{item.label}</div>
            <div className="mt-2 text-2xl font-black">{item.value.toLocaleString('ar-EG')}</div>
            <div className="mt-1 text-xs font-bold opacity-80">اضغط لعرض هذه القائمة</div>
          </button>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi label="عدد العملاء في القائمة" value={filtered.length.toLocaleString('ar-EG')} />
        <Kpi label="إجمالي مشتريات القائمة" value={formatCurrency(totals.spent)} />
        <Kpi label="قيمة الكاش باك" value={formatCurrency(totals.cashback)} />
        <Kpi label="المتبقي للعملاء" value={formatCurrency(totals.remaining)} />
      </section>

      <section className="dawaa-panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-muted)]" />
            <input
              className="dawaa-input w-full pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم / الكود / الهاتف — يدعم * مثل: *احمد*رضا"
            />
          </div>
          <div className="text-xs font-bold text-[var(--theme-muted)]">
            المسؤولين المعتمدين: فرع الشامي = د ضحى · فرع شكري = د دنيا
          </div>
        </div>
        <div className="cashback-mobile-list">
          {loading ? (
            <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6 text-center font-bold text-[var(--theme-muted)]">
              جارٍ التحميل...
            </div>
          ) : filtered.length ? (
            filtered.map((row) => {
              const responsible = getResponsible(row.branch);
              const wa = whatsappScriptLink(row);
              return (
                <CashbackMobileCard
                  key={row.id}
                  row={row}
                  responsible={responsible}
                  wa={wa}
                  setSelected={setSelected}
                  notifyCustomer={notifyCustomer}
                  updateRow={updateRow}
                  recordRedeem={recordRedeem}
                  setCustomerCashbackRate={setCustomerCashbackRate}
                  multiply={multiply}
                  addVoucher={addVoucher}
                  copyScript={copyScript}
                />
              );
            })
          ) : (
            <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6 text-center font-bold text-[var(--theme-muted)]">
              لا توجد بيانات مطابقة
            </div>
          )}
        </div>

        <div className="cashback-desktop-table overflow-x-auto rounded-2xl border border-[var(--theme-border)]">
          <table className="w-full min-w-[1320px] text-sm text-[var(--theme-text)]">
            <thead className="bg-[var(--theme-table-head)] text-[var(--theme-muted)]">
              <tr className="border-b border-[var(--theme-border)] text-right text-xs">
                <th className="p-3">العميل</th>
                <th className="p-3">الفرع/المسؤول</th>
                <th className="p-3">المشتريات</th>
                <th className="p-3">الدورة</th>
                <th className="p-3">النسبة</th>
                <th className="p-3">المستحق</th>
                <th className="p-3">المسحوب</th>
                <th className="p-3">المتبقي</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">آخر إجراء</th>
                <th className="p-3">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center font-bold text-[var(--theme-muted)]">
                    جارٍ التحميل...
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const responsible = getResponsible(row.branch);
                  const wa = whatsappScriptLink(row);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-[var(--theme-border)] align-top text-[var(--theme-text)] ${rowTone(row.status)}`}
                    >
                      <td className="p-3">
                        <div className="max-w-[220px] whitespace-normal font-black text-[var(--theme-heading)]">
                          {row.customer_name || 'عميل بدون اسم'}
                        </div>
                        <div className="text-xs text-[var(--theme-muted)]">
                          code:{row.customer_code || '-'}
                        </div>
                        <div className="text-xs font-bold text-[var(--theme-muted)]">
                          {row.customer_phone || '-'}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold">{row.branch || '-'}</div>
                        <div className="text-xs font-bold text-[var(--theme-muted)]">
                          {responsible}
                        </div>
                      </td>
                      <td className="p-3 font-bold">{formatCurrency(row.total_spent || 0)}</td>
                      <td className="p-3 text-xs font-bold">
                        {row.cycle_label || `${row.cycle_start || ''} - ${row.cycle_end || ''}`}
                      </td>
                      <td className="p-3">{Number(row.cashback_rate || 0)}%</td>
                      <td className="p-3 font-black text-emerald-500">
                        {formatCurrency(row.cashback_value || 0)}
                      </td>
                      <td className="p-3">{formatCurrency(row.redeemed_value || 0)}</td>
                      <td className="p-3 font-black text-teal-500">
                        {formatCurrency(remaining(row))}
                      </td>
                      <td className="p-3">
                        <span className="rounded-full border border-teal-300/50 bg-teal-500/15 px-3 py-1 text-xs font-black text-teal-100">
                          {cashbackStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="p-3 text-xs font-bold text-[var(--theme-muted)]">
                        {row.settled_at
                          ? `تسوية ${formatDate(row.settled_at)}`
                          : row.bconnect_updated_at
                            ? `بي كونكت ${formatDate(row.bconnect_updated_at)}`
                            : row.notified_at
                              ? `تبليغ ${formatDate(row.notified_at)}`
                              : 'لم يتم'}
                      </td>
                      <td className="p-3">
                        <CashbackActionButtons
                          row={row}
                          wa={wa}
                          setSelected={setSelected}
                          notifyCustomer={notifyCustomer}
                          updateRow={updateRow}
                          recordRedeem={recordRedeem}
                          setCustomerCashbackRate={setCustomerCashbackRate}
                          multiply={multiply}
                          addVoucher={addVoucher}
                          copyScript={copyScript}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
              {!loading && !filtered.length ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center font-bold text-[var(--theme-muted)]">
                    لا توجد بيانات مطابقة
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <CustomerQuickDetailsModal
          customerCode={selected.customer_code}
          customerPhone={selected.customer_phone}
          customerName={selected.customer_name}
          branch={selected.branch}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 shadow-sm">
      <div className="text-sm font-bold text-[var(--theme-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-black text-[var(--theme-heading)]">{value}</div>
    </div>
  );
}
