import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Plus, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

type SupplierBalance = {
  supplier_id: string;
  supplier_name: string;
  opening_debt: number;
  total_invoiced: number;
  total_returned: number;
  total_paid: number;
  current_balance: number;
};

type PaymentRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  branch: string | null;
  amount: number;
  payment_date: string;
  paid_by_name: string | null;
  notes: string | null;
};

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function SupplierAccounts() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<SupplierBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SupplierBalance | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('get_all_supplier_balances_v1');
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setBalances(((data || []) as SupplierBalance[]).sort((a, b) => n(b.current_balance) - n(a.current_balance)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSupplierPayments = useCallback(async (supplierId: string) => {
    const { data, error } = await supabase
      .from('supplier_payments')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('payment_date', { ascending: false })
      .limit(50);
    if (!error) setPayments((data || []) as PaymentRow[]);
  }, []);

  const openSupplier = useCallback(
    (supplier: SupplierBalance) => {
      setSelected(supplier);
      setShowPaymentForm(false);
      void loadSupplierPayments(supplier.supplier_id);
    },
    [loadSupplierPayments]
  );

  const filtered = useMemo(
    () => balances.filter((b) => !search.trim() || (b.supplier_name || '').includes(search.trim())),
    [balances, search]
  );

  const totals = useMemo(
    () => ({
      totalOwed: balances.reduce((a, b) => a + n(b.current_balance), 0),
      supplierCount: balances.length,
    }),
    [balances]
  );

  if (selected) {
    return (
      <div className="space-y-5" dir="rtl">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="dawaa-button dawaa-button--secondary text-sm"
        >
          <ChevronLeft size={16} /> رجوع لكل الموردين
        </button>

        <section className="dawaa-card dawaa-card--raised">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="dawaa-title text-2xl">{selected.supplier_name}</h1>
              <p className="dawaa-caption mt-1 font-bold">كشف حساب المورد</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPaymentForm((v) => !v)}
              className="dawaa-button dawaa-button--primary"
            >
              <Plus size={17} /> تسجيل سداد
            </button>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-5">
          <MiniBox label="الرصيد الافتتاحي" value={formatCurrency(n(selected.opening_debt))} />
          <MiniBox label="إجمالي الفواتير" value={formatCurrency(n(selected.total_invoiced))} />
          <MiniBox label="المرتجعات" value={formatCurrency(n(selected.total_returned))} />
          <MiniBox label="إجمالي المدفوع" value={formatCurrency(n(selected.total_paid))} />
          <MiniBox label="المديونية الحالية" value={formatCurrency(n(selected.current_balance))} tone="amber" />
        </div>

        {showPaymentForm ? (
          <NewPaymentForm
            supplierId={selected.supplier_id}
            supplierName={selected.supplier_name}
            staffId={user?.staffId || user?.id || ''}
            staffName={user?.name || ''}
            onCreated={() => {
              setShowPaymentForm(false);
              void load();
              void loadSupplierPayments(selected.supplier_id);
            }}
            onCancel={() => setShowPaymentForm(false)}
          />
        ) : null}

        <Panel className="p-4">
          <SectionTitle title="سجل المدفوعات" icon={<Wallet size={18} />} />
          {payments.length === 0 ? (
            <EmptyState label="لا توجد مدفوعات مسجلة" />
          ) : (
            <div className="dawaa-table-shell shadow-none">
              <table className="dawaa-table-semantic min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-right">التاريخ</th>
                    <th className="text-right">المبلغ</th>
                    <th className="text-right">الفرع</th>
                    <th className="text-right">بواسطة</th>
                    <th className="text-right">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_date}</td>
                      <td className="font-black">{formatCurrency(n(p.amount))}</td>
                      <td>{p.branch || '-'}</td>
                      <td>{p.paid_by_name || '-'}</td>
                      <td>{p.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <h1 className="dawaa-title text-2xl">حسابات الموردين</h1>
        <p className="dawaa-caption mt-1 font-bold">كشف حساب شامل لكل الموردين ومديونية كل واحد فيهم.</p>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <MiniBox label="عدد الموردين" value={totals.supplierCount.toLocaleString('ar-EG')} />
        <MiniBox label="إجمالي المديونية لكل الموردين" value={formatCurrency(totals.totalOwed)} tone="amber" />
      </div>

      <Panel className="p-4">
        <SectionTitle title="كل الموردين" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث باسم المورد"
          className="dawaa-input mb-3 py-2.5 text-sm font-bold"
        />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState label="لا يوجد موردين مطابقين" />
        ) : (
          <div className="space-y-2">
            {filtered.map((supplier) => (
              <button
                key={supplier.supplier_id}
                type="button"
                onClick={() => openSupplier(supplier)}
                className="flex w-full items-center justify-between rounded-xl border p-3 text-right transition hover:border-[var(--dawaa-theme-border-strong)]"
                style={{ borderColor: 'var(--dawaa-theme-border)' }}
              >
                <div>
                  <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{supplier.supplier_name}</p>
                  <p className="dawaa-caption mt-0.5 text-xs font-bold">
                    فواتير: {formatCurrency(n(supplier.total_invoiced))} · مدفوع: {formatCurrency(n(supplier.total_paid))}
                  </p>
                </div>
                <span className="font-black" style={{ color: n(supplier.current_balance) > 0 ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-status-success-text)' }}>
                  {formatCurrency(n(supplier.current_balance))}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function NewPaymentForm({
  supplierId,
  supplierName,
  onCreated,
  onCancel,
}: {
  supplierId: string;
  supplierName: string;
  staffId: string;
  staffName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [branch, setBranch] = useState('فرع شكري');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const value = n(amount);
    if (value <= 0) {
      toast.error('أدخل مبلغ صحيح');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('supplier_payments').insert({
        supplier_id: supplierId,
        supplier_name: supplierName,
        branch,
        amount: value,
        payment_date: paymentDate,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success('تم تسجيل السداد');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل السداد');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel className="p-4">
      <SectionTitle title="تسجيل سداد جديد" />
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">المبلغ</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold" />
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">الفرع</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold">
            <option value="فرع شكري">فرع شكري</option>
            <option value="فرع الشامي">فرع الشامي</option>
          </select>
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">تاريخ السداد</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold" />
        </div>
      </div>
      <div className="mt-3">
        <label className="dawaa-caption mb-1 block text-xs font-bold">ملاحظات</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="dawaa-input py-2 text-sm font-bold" rows={2} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="dawaa-button dawaa-button--secondary text-sm">إلغاء</button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleSubmit()}
          className="dawaa-button dawaa-button--primary text-sm disabled:opacity-50"
        >
          {submitting ? 'جاري الحفظ...' : 'حفظ السداد'}
        </button>
      </div>
    </Panel>
  );
}
