import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, RefreshCw, Search, ShieldAlert, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

type BudgetRow = {
  id: string;
  responsible_id: string | null;
  responsible_name: string | null;
  branch: string | null;
  month_start: string;
  opening_balance: number | null;
  used_amount: number | null;
  remaining_amount?: number | null;
  status: string | null;
};

type MovementRow = {
  id: string;
  budget_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  amount: number | null;
  reason: string | null;
  invoice_number: string | null;
  status: string | null;
  created_at: string | null;
  approved_at: string | null;
};

function currentMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function CustomerServiceCredit() {
  const { user, isAdmin } = useAuth();
  const [month, setMonth] = useState(currentMonthStart());
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [selectedBudget, setSelectedBudget] = useState<BudgetRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    customerName: '',
    customerCode: '',
    amount: '',
    reason: '',
    invoiceNumber: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_service_credit_budgets')
        .select(
          'id,responsible_id,responsible_name,branch,month_start,opening_balance,used_amount,remaining_amount,status'
        )
        .eq('month_start', month)
        .order('responsible_name', { ascending: true });
      if (error) throw error;
      const nextBudgets = (data || []) as BudgetRow[];
      setBudgets(nextBudgets);
      setSelectedBudget(
        (current) =>
          (current && nextBudgets.find((b) => b.id === current.id)) || nextBudgets[0] || null
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل كريديت خدمة العملاء');
      setBudgets([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  const loadMovements = useCallback(async () => {
    if (!selectedBudget?.id) {
      setMovements([]);
      return;
    }
    const { data, error } = await supabase
      .from('customer_service_credit_movements')
      .select(
        'id,budget_id,customer_name,customer_code,amount,reason,invoice_number,status,created_at,approved_at'
      )
      .eq('budget_id', selectedBudget.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return toast.error(error.message);
    setMovements((data || []) as MovementRow[]);
  }, [selectedBudget?.id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const createBudget = async () => {
    const responsible = window.prompt('اسم مسؤول خدمة العملاء', user?.name || 'خدمة العملاء');
    if (!responsible) return;
    const branch = window.prompt('الفرع', user?.branch || 'غير محدد') || 'غير محدد';
    const { error } = await supabase.from('customer_service_credit_budgets').upsert(
      {
        responsible_id: user?.id || null,
        responsible_name: responsible,
        branch,
        month_start: month,
        opening_balance: 10000,
        used_amount: 0,
        status: 'active',
      },
      { onConflict: 'responsible_name,month_start' }
    );
    if (error) return toast.error(error.message);
    toast.success('تم إنشاء/تحديث رصيد الشهر');
    load();
  };

  const addMovement = async () => {
    if (!selectedBudget) return toast.error('اختار مسؤول خدمة العملاء أولًا');
    const amount = Number(form.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('قيمة الخصم غير صحيحة');
    const remaining =
      Number(selectedBudget.opening_balance || 0) - Number(selectedBudget.used_amount || 0);
    if (amount > remaining && !isAdmin)
      return toast.error('لا يسمح بتجاوز رصيد 10,000 إلا بصلاحية مدير عام');
    const status = amount >= 500 ? 'pending_approval' : 'approved';
    const { error } = await supabase.from('customer_service_credit_movements').insert({
      budget_id: selectedBudget.id,
      responsible_id: selectedBudget.responsible_id,
      responsible_name: selectedBudget.responsible_name,
      branch: selectedBudget.branch,
      customer_name: form.customerName || null,
      customer_code: form.customerCode || null,
      amount,
      reason: form.reason || null,
      invoice_number: form.invoiceNumber || null,
      status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
      created_by: user?.id || null,
      created_by_name: user?.name || null,
    });
    if (error) return toast.error(error.message);
    toast.success(
      status === 'approved'
        ? 'تم اعتماد الخصم وخصمه من الرصيد'
        : 'تم تسجيل الخصم وينتظر موافقة المدير'
    );
    setForm({ customerName: '', customerCode: '', amount: '', reason: '', invoiceNumber: '' });
    load();
    loadMovements();
  };

  const approveMovement = async (movement: MovementRow, status: 'approved' | 'rejected') => {
    const { error } = await supabase
      .from('customer_service_credit_movements')
      .update({
        status,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
        approved_by: user?.id || null,
        approved_by_name: user?.name || null,
      })
      .eq('id', movement.id);
    if (error) return toast.error(error.message);
    toast.success(status === 'approved' ? 'تم اعتماد الحركة' : 'تم رفض الحركة');
    load();
    loadMovements();
  };

  const filteredBudgets = useMemo(
    () =>
      budgets.filter((b) =>
        [b.responsible_name, b.branch].some((v) => String(v || '').includes(search))
      ),
    [budgets, search]
  );
  const totals = budgets.reduce(
    (acc, b) => {
      acc.open += Number(b.opening_balance || 0);
      acc.used += Number(b.used_amount || 0);
      return acc;
    },
    { open: 0, used: 0 }
  );

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">Customer Service Credit</span>
          <h1 className="mt-3 text-2xl font-black text-slate-950">كريديت خدمة العملاء</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            رصيد شهري 10,000 جنيه لكل مسؤول لخدمة العملاء والعروض الخاصة.
          </p>
        </div>
        <button className="dawaa-button-primary" onClick={createBudget}>
          <Plus className="h-4 w-4" /> إنشاء رصيد شهري
        </button>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi label="الرصيد الافتتاحي" value={formatCurrency(totals.open)} />
        <Kpi label="المستخدم" value={formatCurrency(totals.used)} />
        <Kpi label="المتبقي" value={formatCurrency(totals.open - totals.used)} />
        <Kpi label="عدد المسؤولين" value={budgets.length.toLocaleString('ar-EG')} />
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-[180px_1fr_160px]">
        <input
          type="date"
          className="dawaa-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="dawaa-input w-full pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالمسؤول أو الفرع"
          />
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> تحديث
        </button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.85fr_1.15fr]">
        <div className="dawaa-panel space-y-3">
          <h2 className="font-black text-slate-950">أرصدة المسؤولين</h2>
          {filteredBudgets.map((b) => (
            <button
              key={b.id}
              className={`w-full rounded-2xl border p-4 text-right ${selectedBudget?.id === b.id ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white'}`}
              onClick={() => setSelectedBudget(b)}
            >
              <div className="font-black">{b.responsible_name || 'مسؤول غير محدد'}</div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {b.branch || '-'} · المستخدم {formatCurrency(b.used_amount || 0)} · المتبقي{' '}
                {formatCurrency(Number(b.opening_balance || 0) - Number(b.used_amount || 0))}
              </div>
            </button>
          ))}
          {!filteredBudgets.length ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-center font-bold text-slate-500">
              لا توجد أرصدة لهذا الشهر
            </div>
          ) : null}
        </div>

        <div className="dawaa-panel space-y-4">
          <h2 className="font-black text-slate-950">إضافة خصم إضافي</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="dawaa-input"
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              placeholder="اسم العميل"
            />
            <input
              className="dawaa-input"
              value={form.customerCode}
              onChange={(e) => setForm({ ...form, customerCode: e.target.value })}
              placeholder="كود العميل"
            />
            <input
              className="dawaa-input"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="قيمة الخصم"
            />
            <input
              className="dawaa-input"
              value={form.invoiceNumber}
              onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
              placeholder="رقم الفاتورة إن وجد"
            />
            <textarea
              className="dawaa-input md:col-span-2"
              rows={2}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="سبب الخصم"
            />
          </div>
          <button className="dawaa-button-primary" onClick={addMovement}>
            <CheckCircle2 className="h-4 w-4" /> اعتماد الخصم
          </button>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-slate-500">
                  <th className="p-3">العميل</th>
                  <th className="p-3">القيمة</th>
                  <th className="p-3">السبب</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء المدير</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="p-3">
                      <div className="font-bold">{m.customer_name || '-'}</div>
                      <div className="text-xs text-slate-500">
                        {m.customer_code || '-'} · فاتورة {m.invoice_number || '-'}
                      </div>
                    </td>
                    <td className="p-3 font-black">{formatCurrency(m.amount || 0)}</td>
                    <td className="p-3">{m.reason || '-'}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">
                        {m.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {m.status === 'pending_approval' && isAdmin ? (
                        <div className="flex gap-2">
                          <button
                            className="btn-secondary px-2 py-1"
                            onClick={() => approveMovement(m, 'approved')}
                          >
                            اعتماد
                          </button>
                          <button
                            className="btn-secondary px-2 py-1"
                            onClick={() => approveMovement(m, 'rejected')}
                          >
                            رفض
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!movements.length ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center font-bold text-slate-500">
                      لا توجد حركات
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-950">
        <Wallet className="h-5 w-5 text-sky-600" />
        {value}
      </div>
    </div>
  );
}
