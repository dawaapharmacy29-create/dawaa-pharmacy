import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  createPayrollManualEntry,
  listPayrollManualEntries,
  reversePayrollManualEntry,
  type PayrollManualEntry,
  type PayrollManualEntryCategory,
  type PayrollManualEntryKind,
} from '@/lib/payroll/payrollManualLedgerService';
import { getEmployeePayrollFinancialCompositionV1 } from '@/lib/payroll/payrollFinancialCompositionService';

const money = (value: unknown) => {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
};

const KIND_LABELS: Record<PayrollManualEntryKind, string> = {
  earning: 'إضافة مالية',
  deduction: 'خصم مالي',
  adjustment: 'تسوية (+/-)',
};

const CATEGORY_LABELS: Record<PayrollManualEntryCategory, string> = {
  attendance: 'الحضور',
  incentive: 'الحوافز',
  deduction: 'الجزاءات/الخصومات',
  salary: 'الراتب',
  other: 'أخرى',
};

export default function PayrollManualEntriesPanel({ staffId, monthCycle }: { staffId: string; monthCycle: string }) {
  const [rows, setRows] = useState<PayrollManualEntry[]>([]);
  const [financial, setFinancial] = useState<Record<string, any> | null>(null);
  const [kind, setKind] = useState<PayrollManualEntryKind>('deduction');
  const [category, setCategory] = useState<PayrollManualEntryCategory>('deduction');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [entries, composition] = await Promise.all([
        listPayrollManualEntries(staffId, monthCycle),
        getEmployeePayrollFinancialCompositionV1(staffId, monthCycle),
      ]);
      setRows(entries);
      setFinancial(composition as unknown as Record<string, any>);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل التسويات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [staffId, monthCycle]);

  const reversedOriginals = useMemo(
    () => new Set(rows.filter((row) => row.reversal_of).map((row) => row.reversal_of as string)),
    [rows]
  );

  async function submit() {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) {
      toast.warning('اكتب مبلغًا صحيحًا غير صفر.');
      return;
    }
    if (reason.trim().length < 3) {
      toast.warning('اكتب سببًا واضحًا للحركة.');
      return;
    }
    setLoading(true);
    try {
      await createPayrollManualEntry({
        staffId,
        monthCycle,
        kind,
        category,
        amount: numericAmount,
        reason: reason.trim(),
        referenceNote: referenceNote.trim() || null,
      });
      setAmount('');
      setReason('');
      setReferenceNote('');
      toast.success('تم تسجيل الحركة في Ledger الدورة.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الحركة');
    } finally {
      setLoading(false);
    }
  }

  async function reverse(row: PayrollManualEntry) {
    const reversalReason = window.prompt('سبب عكس الحركة:')?.trim();
    if (!reversalReason || reversalReason.length < 3) return;
    setLoading(true);
    try {
      await reversePayrollManualEntry(row.id, reversalReason);
      toast.success('تم عكس الحركة بدون تعديل السجل الأصلي.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر عكس الحركة');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-teal-200">Ledger التسويات والخصومات — {monthCycle}</div>
          <p className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">
            الساعات والأوفر تايم لا تُكتب يدويًا هنا. أي حركة مالية يدوية تُسجل كسطر مستقل بسبب ومستخدم، ولا تُعدل بعد إنشائها.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary !py-1.5 text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {financial && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border p-3"><div className="text-[10px] text-[var(--dawaa-theme-muted)]">إضافات يدوية</div><b>{money(financial.manual_ledger?.earnings_total)}</b></div>
          <div className="rounded-xl border p-3"><div className="text-[10px] text-[var(--dawaa-theme-muted)]">خصومات يدوية</div><b>{money(financial.manual_ledger?.deductions_total)}</b></div>
          <div className="rounded-xl border p-3"><div className="text-[10px] text-[var(--dawaa-theme-muted)]">تسويات صافية</div><b>{money(financial.manual_ledger?.adjustments_total)}</b></div>
          <div className="rounded-xl border p-3"><div className="text-[10px] text-[var(--dawaa-theme-muted)]">صافي Preview</div><b className="text-teal-200">{money(financial.display_net_salary)}</b></div>
        </div>
      )}

      <div className="mt-4 grid gap-2 rounded-2xl border border-[var(--dawaa-theme-border)] p-3 lg:grid-cols-[160px_170px_150px_1fr_1fr_auto]">
        <select value={kind} onChange={(e) => setKind(e.target.value as PayrollManualEntryKind)} className="input">
          {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value as PayrollManualEntryCategory)} className="input">
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder={kind === 'adjustment' ? 'مبلغ +/-' : 'المبلغ'} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="سبب الحركة" />
        <input value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} className="input" placeholder="مرجع/ملاحظة اختيارية" />
        <button type="button" disabled={loading} onClick={() => void submit()} className="btn-primary whitespace-nowrap"><Plus size={15} /> تسجيل</button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-right text-xs">
          <thead><tr className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">الفئة</th><th className="p-2">القيمة</th><th className="p-2">السبب</th><th className="p-2">سجلها</th><th className="p-2">إجراء</th>
          </tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => {
              const isReversal = Boolean(row.reversal_of);
              const isReversed = reversedOriginals.has(row.id);
              return (
                <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)]/50">
                  <td className="p-2">{new Date(row.created_at).toLocaleString('ar-EG')}</td>
                  <td className="p-2">{isReversal ? 'عكس حركة' : KIND_LABELS[row.entry_kind]}</td>
                  <td className="p-2">{CATEGORY_LABELS[row.category]}</td>
                  <td className="p-2 font-black">{row.signed_amount > 0 ? '+' : ''}{money(row.signed_amount)}</td>
                  <td className="p-2">{row.reason}</td>
                  <td className="p-2">{row.created_by_name || '-'}</td>
                  <td className="p-2">
                    {!isReversal && !isReversed ? (
                      <button type="button" onClick={() => void reverse(row)} disabled={loading} className="btn-secondary !py-1 text-[10px]"><RotateCcw size={12} /> عكس</button>
                    ) : <span className="text-[10px] text-[var(--dawaa-theme-muted)]">{isReversed ? 'تم عكسها' : 'سجل عكس'}</span>}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={7} className="p-6 text-center text-[var(--dawaa-theme-muted)]">لا توجد حركات يدوية لهذه الدورة.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
