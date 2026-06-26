import { useEffect, useMemo, useState } from 'react';
import { Gift, Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  addCustomerPoints,
  fetchCustomerPointsLedger,
  searchCustomerIdentity,
  totalCustomerPoints,
  type CustomerIdentity,
  type CustomerPointsLedgerRow,
} from '@/lib/customerEngagement';

const SOURCE_TYPES = [
  'manual',
  'welcome_message',
  'complaint_compensation',
  'loyalty_adjustment',
  'campaign',
  'cashback',
  'correction',
];

export default function CustomerPointsLedger() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const initialCustomer = useMemo<CustomerIdentity>(
    () => ({
      customer_id: params.get('customerId'),
      customer_code: params.get('code'),
      customer_phone: params.get('phone'),
      customer_name: params.get('name'),
      branch: params.get('branch') || user?.branch || BRANCHES[0],
    }),
    [params, user?.branch]
  );
  const [query, setQuery] = useState(initialCustomer.customer_code || initialCustomer.customer_phone || initialCustomer.customer_name || '');
  const [matches, setMatches] = useState<CustomerIdentity[]>([]);
  const [customer, setCustomer] = useState<CustomerIdentity>(initialCustomer);
  const [rows, setRows] = useState<CustomerPointsLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    points_amount: '',
    transaction_type: 'credit' as 'credit' | 'debit' | 'correction',
    source_type: 'manual',
    points_reason: '',
    related_invoice_number: '',
    expiry_date: '',
    notes: '',
  });

  const loadLedger = async (identity = customer) => {
    setLoading(true);
    try {
      setRows(await fetchCustomerPointsLedger(identity));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل النقاط');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customer.customer_code || customer.customer_phone || customer.customer_id) void loadLedger(customer);
  }, []);

  const runSearch = async () => {
    if (query.trim().length < 2) return toast.error('اكتب كود العميل أو الهاتف أو الاسم');
    setLoading(true);
    try {
      const found = await searchCustomerIdentity(query);
      setMatches(found);
      if (found[0]) {
        setCustomer(found[0]);
        await loadLedger(found[0]);
      } else {
        setCustomer((current) => ({
          ...current,
          customer_phone: /^\d/.test(query) ? query : current.customer_phone,
          customer_name: /^\d/.test(query) ? current.customer_name : query,
        }));
        setRows([]);
        toast.info('لم يتم العثور على العميل. يمكنك تسجيله كعميل جديد برقم هاتف.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر البحث عن العميل');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    try {
      const saved = await addCustomerPoints({
        ...customer,
        points_amount: Number(form.points_amount),
        transaction_type: form.transaction_type,
        source_type: form.source_type,
        points_reason: form.points_reason || null,
        related_invoice_number: form.related_invoice_number || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        created_by: user?.id || null,
        created_by_name: user?.name || null,
      });
      setRows((current) => [saved, ...current]);
      setForm({ points_amount: '', transaction_type: 'credit', source_type: 'manual', points_reason: '', related_invoice_number: '', expiry_date: '', notes: '' });
      toast.success('تم احتساب النقاط');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر احتساب النقاط');
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-emerald-500/30 bg-slate-950/50 p-5">
        <h1 className="flex items-center gap-2 text-2xl font-black text-white">
          <Gift className="text-emerald-300" /> احتساب نقاط العملاء
        </h1>
        <p className="mt-2 text-sm text-slate-300">كل تعديل نقاط يتم كسجل جديد في ledger، ويدعم العميل الجديد برقم هاتف بدون كود.</p>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-[1fr_auto]">
        <input className="input-dark" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالكود أو الهاتف أو الاسم" />
        <button className="btn-primary" onClick={() => void runSearch()} disabled={loading}>
          {loading ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin" /> : <Search className="ml-1 inline h-4 w-4" />} بحث
        </button>
        {matches.length > 1 && (
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            {matches.map((item) => (
              <button key={`${item.customer_code || item.customer_phone}-${item.customer_name}`} className="btn-secondary text-xs" onClick={() => { setCustomer(item); void loadLedger(item); }}>
                {item.customer_name || 'عميل'} - {item.customer_code || item.customer_phone}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-4">
        <input className="input-dark" placeholder="اسم العميل" value={customer.customer_name || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_name: event.target.value }))} />
        <input className="input-dark" placeholder="الهاتف" value={customer.customer_phone || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_phone: event.target.value }))} />
        <input className="input-dark" placeholder="الكود اختياري" value={customer.customer_code || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_code: event.target.value }))} />
        <select className="input-dark" value={customer.branch || ''} onChange={(event) => setCustomer((current) => ({ ...current, branch: event.target.value }))}>
          <option value="">بدون فرع</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100 lg:col-span-4">
          إجمالي النقاط الحالي: <b>{totalCustomerPoints(rows)}</b>
        </div>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-3">
        <input className="input-dark" type="number" placeholder="عدد النقاط" value={form.points_amount} onChange={(event) => setForm((current) => ({ ...current, points_amount: event.target.value }))} />
        <select className="input-dark" value={form.transaction_type} onChange={(event) => setForm((current) => ({ ...current, transaction_type: event.target.value as typeof form.transaction_type }))}>
          <option value="credit">إضافة</option>
          <option value="debit">خصم</option>
          <option value="correction">تصحيح</option>
        </select>
        <select className="input-dark" value={form.source_type} onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value }))}>
          {SOURCE_TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <input className="input-dark" placeholder="سبب النقاط" value={form.points_reason} onChange={(event) => setForm((current) => ({ ...current, points_reason: event.target.value }))} />
        <input className="input-dark" placeholder="رقم فاتورة اختياري" value={form.related_invoice_number} onChange={(event) => setForm((current) => ({ ...current, related_invoice_number: event.target.value }))} />
        <input className="input-dark" type="date" value={form.expiry_date} onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))} />
        <textarea className="input-dark lg:col-span-3" rows={3} placeholder="ملاحظات" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        <button className="btn-primary lg:col-span-3" onClick={() => void save()}>
          <Plus className="ml-1 inline h-4 w-4" /> حفظ عملية النقاط
        </button>
      </section>

      <section className="grid gap-3">
        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{row.transaction_type} {row.points_amount} نقطة</b>
              <span className="text-xs text-slate-400">{row.created_at ? new Date(row.created_at).toLocaleString('ar-EG') : '-'}</span>
            </div>
            <p className="mt-2 text-sm text-slate-300">{row.points_reason || row.source_type} {row.notes ? `- ${row.notes}` : ''}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
