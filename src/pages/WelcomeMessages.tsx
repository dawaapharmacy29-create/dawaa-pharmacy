import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_WELCOME_MESSAGE,
  addWelcomeMessageLog,
  fetchWelcomeMessageLogs,
  searchCustomerIdentity,
  whatsappWelcomeUrl,
  type CustomerIdentity,
  type WelcomeMessageLogRow,
} from '@/lib/customerEngagement';

export default function WelcomeMessages() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const initialCustomer = useMemo<CustomerIdentity>(
    () => ({
      customer_id: params.get('customerId'),
      customer_code: params.get('code'),
      customer_phone: params.get('phone'),
      customer_name: params.get('name'),
      branch: params.get('branch') || user?.branch || '',
    }),
    [params, user?.branch]
  );
  const [query, setQuery] = useState(initialCustomer.customer_code || initialCustomer.customer_phone || initialCustomer.customer_name || '');
  const [customer, setCustomer] = useState<CustomerIdentity>(initialCustomer);
  const [rows, setRows] = useState<WelcomeMessageLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ branch: '', status: '', doctor: '' });
  const [form, setForm] = useState({
    doctor_name: user?.name || '',
    message_body: DEFAULT_WELCOME_MESSAGE,
    status: 'sent',
    notes: '',
  });

  const load = async (identity = customer) => {
    setLoading(true);
    try {
      setRows(await fetchWelcomeMessageLogs(identity));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل الرسائل الترحيبية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(initialCustomer);
  }, []);

  const filteredRows = rows.filter((row) => {
    if (filters.branch && row.branch !== filters.branch) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.doctor && row.doctor_name !== filters.doctor) return false;
    return true;
  });

  const todayCount = rows.filter((row) => String(row.sent_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthCount = rows.filter((row) => String(row.sent_at || '').slice(0, 7) === monthKey).length;
  const repliedCount = rows.filter((row) => row.status === 'customer_replied').length;
  const topDoctor = Object.entries(
    rows.reduce<Record<string, number>>((acc, row) => {
      const name = row.doctor_name || 'غير محدد';
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  const runSearch = async () => {
    if (query.trim().length < 2) return toast.error('اكتب كود العميل أو الهاتف أو الاسم');
    setLoading(true);
    try {
      const found = await searchCustomerIdentity(query);
      if (found[0]) {
        setCustomer(found[0]);
        await load(found[0]);
      } else {
        setCustomer((current) => ({
          ...current,
          customer_phone: /^\d/.test(query) ? query : current.customer_phone,
          customer_name: /^\d/.test(query) ? current.customer_name : query,
        }));
        setRows([]);
        toast.info('لم يتم العثور على العميل. يمكنك تسجيل رسالة برقم الهاتف.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر البحث عن العميل');
    } finally {
      setLoading(false);
    }
  };

  const save = async (openWhatsapp = false) => {
    try {
      if (openWhatsapp) window.open(whatsappWelcomeUrl(customer.customer_phone, form.message_body), '_blank', 'noopener,noreferrer');
      const saved = await addWelcomeMessageLog({
        ...customer,
        doctor_name: form.doctor_name || user?.name || null,
        doctor_id: user?.id || null,
        message_body: form.message_body,
        channel: 'whatsapp',
        status: form.status,
        sent_by: user?.id || null,
        sent_by_name: user?.name || null,
        notes: form.notes || null,
      });
      setRows((current) => [saved, ...current]);
      toast.success('تم تسجيل الرسالة الترحيبية');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الرسالة الترحيبية');
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-slate-950/50 p-5">
        <h1 className="flex items-center gap-2 text-2xl font-black text-white">
          <MessageSquare className="text-cyan-300" /> سجل الرسائل الترحيبية
        </h1>
        <p className="mt-2 text-sm text-slate-300">سجل مستقل لرسائل واتساب الترحيبية بدون localStorage.</p>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="رسائل اليوم" value={todayCount} />
        <Metric label="رسائل الشهر" value={monthCount} />
        <Metric label="أكثر دكتور أرسل" value={topDoctor} />
        <Metric label="ردود العملاء" value={repliedCount} />
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-[1fr_auto]">
        <input className="input-dark" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالعميل أو الهاتف أو الكود أو الدكتور" />
        <button className="btn-primary" onClick={() => void runSearch()} disabled={loading}>
          {loading ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin" /> : <Search className="ml-1 inline h-4 w-4" />} بحث
        </button>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-4">
        <input className="input-dark" placeholder="اسم العميل اختياري" value={customer.customer_name || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_name: event.target.value }))} />
        <input className="input-dark" placeholder="الهاتف" value={customer.customer_phone || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_phone: event.target.value }))} />
        <input className="input-dark" placeholder="الكود" value={customer.customer_code || ''} onChange={(event) => setCustomer((current) => ({ ...current, customer_code: event.target.value }))} />
        <select className="input-dark" value={customer.branch || ''} onChange={(event) => setCustomer((current) => ({ ...current, branch: event.target.value }))}>
          <option value="">كل الفروع</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <input className="input-dark" placeholder="الدكتور" value={form.doctor_name} onChange={(event) => setForm((current) => ({ ...current, doctor_name: event.target.value }))} />
        <select className="input-dark" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
          <option value="drafted">مسودة</option>
          <option value="sent">تم الإرسال</option>
          <option value="failed">فشل</option>
          <option value="customer_replied">العميل رد</option>
        </select>
        <input className="input-dark lg:col-span-2" placeholder="ملاحظات" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        <textarea className="input-dark lg:col-span-4" rows={4} value={form.message_body} onChange={(event) => setForm((current) => ({ ...current, message_body: event.target.value }))} />
        <button className="btn-secondary lg:col-span-2" onClick={() => void save(false)}>
          <Plus className="ml-1 inline h-4 w-4" /> تسجيل رسالة ترحيبية
        </button>
        <button className="btn-primary lg:col-span-2" onClick={() => void save(true)}>
          <MessageSquare className="ml-1 inline h-4 w-4" /> فتح واتساب وتسجيل الرسالة
        </button>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-4">
        <select className="input-dark" value={filters.branch} onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value }))}>
          <option value="">كل الفروع</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <select className="input-dark" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">كل الحالات</option>
          <option value="drafted">مسودة</option>
          <option value="sent">تم الإرسال</option>
          <option value="failed">فشل</option>
          <option value="customer_replied">العميل رد</option>
        </select>
        <input className="input-dark lg:col-span-2" placeholder="فلتر الدكتور" value={filters.doctor} onChange={(event) => setFilters((current) => ({ ...current, doctor: event.target.value }))} />
      </section>

      <section className="grid gap-3">
        {filteredRows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{row.customer_name || row.customer_phone || 'عميل'}</b>
              <span className="text-xs text-slate-400">{row.sent_at ? new Date(row.sent_at).toLocaleString('ar-EG') : '-'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{row.doctor_name || '-'} - {row.branch || '-'} - {row.status}</p>
            <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-900 p-3 text-sm leading-7">{row.message_body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
    </div>
  );
}
