import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, MessageSquare, Plus, RefreshCw, Search, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_WELCOME_MESSAGE,
  addWelcomeMessageLog,
  fetchWelcomeMessageLogs,
  searchCustomerIdentity,
  updateWelcomeMessageStatus,
  whatsappWelcomeUrl,
  type CustomerIdentity,
  type WelcomeMessageLogRow,
} from '@/lib/customerEngagement';
import {
  DEFAULT_QUICK_REPLY_SCRIPTS,
  fetchQuickReplyScripts,
  renderQuickReplyTemplate,
  saveQuickReplyScript,
  type QuickReplyScript,
} from '@/lib/quickReplyScripts';

const STATUS_LABELS: Record<string, string> = {
  drafted: 'مسودة',
  sent: 'تم الإرسال',
  failed: 'فشل',
  customer_replied: 'العميل رد',
};

type WelcomeForm = {
  customer_name: string;
  customer_code: string;
  customer_phone: string;
  branch: string;
  doctor_name: string;
  message_body: string;
  status: string;
  notes: string;
};

export default function WelcomeMessages() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const actorId = user?.id ? String(user.id) : null;
  const actorName = user?.name || null;

  const initialCustomer = useMemo<CustomerIdentity>(
    () => ({
      customer_id: params.get('customerId'),
      customer_code: params.get('customer_code') || params.get('code'),
      customer_phone: params.get('phone'),
      customer_name: params.get('name'),
      branch: params.get('branch') || user?.branch || '',
    }),
    [params, user?.branch]
  );

  const [query, setQuery] = useState(
    initialCustomer.customer_code || initialCustomer.customer_phone || initialCustomer.customer_name || ''
  );
  const [rows, setRows] = useState<WelcomeMessageLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [showForm, setShowForm] = useState(params.get('action') === 'create');
  const [filters, setFilters] = useState({
    search: '',
    branch: '',
    doctor: '',
    status: '',
    from: '',
    to: '',
  });
  const [form, setForm] = useState<WelcomeForm>({
    customer_name: initialCustomer.customer_name || '',
    customer_code: initialCustomer.customer_code || '',
    customer_phone: initialCustomer.customer_phone || '',
    branch: initialCustomer.branch || '',
    doctor_name: actorName || '',
    message_body: DEFAULT_WELCOME_MESSAGE,
    status: 'sent',
    notes: '',
  });

  const currentIdentity = useMemo<CustomerIdentity>(
    () => ({
      customer_id: initialCustomer.customer_id,
      customer_code: form.customer_code || null,
      customer_phone: form.customer_phone || null,
      customer_name: form.customer_name || null,
      branch: form.branch || null,
    }),
    [form.branch, form.customer_code, form.customer_name, form.customer_phone, initialCustomer.customer_id]
  );

  const welcomeScripts = useMemo(
    () =>
      quickReplies.filter((script) => {
        const text = `${script.script_type} ${script.category} ${script.title}`.toLowerCase();
        return (
          ['welcome', 'quick_reply', 'followup', 'vip'].includes(script.script_type) ||
          text.includes('welcome') ||
          text.includes('ترحيب')
        );
      }),
    [quickReplies]
  );

  const load = useCallback(
    async (identity: CustomerIdentity = currentIdentity) => {
      setLoading(true);
      try {
        const data = await fetchWelcomeMessageLogs(identity, {
          actor_id: actorId,
          search: filters.search,
          branch: filters.branch,
          status: filters.status,
          doctor: filters.doctor,
          from: filters.from,
          to: filters.to,
        });
        setRows(data);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل الرسائل الترحيبية');
      } finally {
        setLoading(false);
      }
    },
    [actorId, currentIdentity, filters.branch, filters.doctor, filters.from, filters.search, filters.status, filters.to]
  );

  useEffect(() => {
    void load(initialCustomer);
    void fetchQuickReplyScripts()
      .then(setQuickReplies)
      .catch(() => setQuickReplies([]));
  }, []);

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = new Date().toISOString().slice(0, 7);
    const today = rows.filter((row) => String(row.sent_at || '').slice(0, 10) === todayKey).length;
    const month = rows.filter((row) => String(row.sent_at || '').slice(0, 7) === monthKey).length;
    const replied = rows.filter((row) => row.status === 'customer_replied').length;
    const topDoctor =
      Object.entries(
        rows.reduce<Record<string, number>>((acc, row) => {
          const name = row.doctor_name || 'غير محدد';
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    return { today, month, replied, topDoctor };
  }, [rows]);

  const applyCustomer = (identity: CustomerIdentity) => {
    setForm((current) => ({
      ...current,
      customer_name: identity.customer_name || current.customer_name,
      customer_code: identity.customer_code || current.customer_code,
      customer_phone: identity.customer_phone || current.customer_phone,
      branch: identity.branch || current.branch,
    }));
  };

  const runSearch = async () => {
    const value = query.trim();
    if (value.length < 2) return toast.error('اكتب كود العميل أو الهاتف أو الاسم');
    setLoading(true);
    try {
      const found = await searchCustomerIdentity(value);
      if (found[0]) {
        applyCustomer(found[0]);
        await load(found[0]);
        setShowForm(true);
      } else {
        const manualIdentity = /^\d/.test(value) ? { customer_phone: value } : { customer_name: value };
        applyCustomer(manualIdentity);
        setRows([]);
        setShowForm(true);
        toast.info('لم يتم العثور على العميل. يمكن حفظ سجل داخلي أو فتح واتساب لو الرقم متاح.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر البحث عن العميل');
    } finally {
      setLoading(false);
    }
  };

  const applyScript = (scriptId: string) => {
    setSelectedScriptId(scriptId);
    const script = welcomeScripts.find((item) => item.id === scriptId);
    if (!script) return;
    setForm((current) => ({
      ...current,
      message_body: renderQuickReplyTemplate(script.message_body, {
        customer_name: current.customer_name,
        doctor_name: current.doctor_name || actorName,
        branch: current.branch,
        use_customer_name: true,
      }),
    }));
  };

  const seedWelcomeQuickReply = async () => {
    const script = DEFAULT_QUICK_REPLY_SCRIPTS.find((item) => item.shortcut === '/ترحيب');
    if (!script) return;
    try {
      await saveQuickReplyScript({
        ...script,
        created_by: actorId,
        created_by_name: actorName,
        active: true,
      });
      setQuickReplies(await fetchQuickReplyScripts());
      toast.success('تم إضافة اختصار /ترحيب للردود السريعة');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إضافة اختصار الترحيب');
    }
  };

  const save = async (openWhatsapp = false) => {
    try {
      let nextStatus = form.status;
      const waUrl = whatsappWelcomeUrl(form.customer_phone, form.message_body);

      if (openWhatsapp) {
        if (!waUrl) {
          toast.error('لا يمكن فتح واتساب بدون رقم هاتف، لكن يمكن حفظ السجل داخليا.');
        } else {
          window.open(waUrl, '_blank', 'noopener,noreferrer');
          nextStatus = window.confirm('هل تم إرسال الرسالة؟') ? 'sent' : 'drafted';
        }
      }

      const saved = await addWelcomeMessageLog({
        ...currentIdentity,
        followup_id: params.get('followup_id'),
        doctor_name: form.doctor_name || actorName,
        doctor_id: actorId,
        message_body: form.message_body,
        channel: 'whatsapp',
        status: nextStatus,
        sent_by: actorId,
        sent_by_name: actorName,
        notes: form.notes || null,
      });
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setShowForm(false);
      toast.success('تم تسجيل الرسالة الترحيبية');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الرسالة الترحيبية');
    }
  };

  const markReplied = async (row: WelcomeMessageLogRow) => {
    try {
      const updated = await updateWelcomeMessageStatus(row.id, 'customer_replied', actorId, actorName);
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('تم تحديث حالة الرسالة');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث الحالة');
    }
  };

  const openRowWhatsapp = (row: WelcomeMessageLogRow) => {
    const url = whatsappWelcomeUrl(row.customer_phone, row.message_body);
    if (!url) return toast.error('لا يمكن فتح واتساب بدون رقم هاتف.');
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-2xl border border-cyan-500/30 bg-slate-950/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-white">
              <MessageSquare className="text-cyan-300" /> سجل الرسائل الترحيبية
            </h1>
            <p className="mt-2 text-sm text-slate-300">تسجيل ومتابعة رسائل الترحيب المرتبطة بالعملاء وخدمة العملاء.</p>
          </div>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus className="ml-1 inline h-4 w-4" /> تسجيل رسالة ترحيبية
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="رسائل اليوم" value={stats.today} />
        <Metric label="رسائل الشهر" value={stats.month} />
        <Metric label="أكثر دكتور أرسل" value={stats.topDoctor} />
        <Metric label="ردود العملاء" value={stats.replied} />
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-[1fr_auto]">
        <input className="input-dark" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالعميل أو الهاتف أو الكود" />
        <button className="btn-primary" onClick={() => void runSearch()} disabled={loading}>
          {loading ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin" /> : <Search className="ml-1 inline h-4 w-4" />} بحث
        </button>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-6">
        <input className="input-dark lg:col-span-2" placeholder="بحث داخل السجل: عميل / كود / هاتف / دكتور" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        <select className="input-dark" value={filters.branch} onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value }))}>
          <option value="">كل الفروع</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <input className="input-dark" placeholder="الدكتور" value={filters.doctor} onChange={(event) => setFilters((current) => ({ ...current, doctor: event.target.value }))} />
        <select className="input-dark" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="ml-1 inline h-4 w-4" /> تحديث
        </button>
        <input className="input-dark" type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        <input className="input-dark" type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/40">
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm text-slate-200">
            <thead className="bg-slate-900 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-3">التاريخ</th>
                <th className="px-3 py-3">الدكتور</th>
                <th className="px-3 py-3">العميل</th>
                <th className="px-3 py-3">الكود</th>
                <th className="px-3 py-3">الهاتف</th>
                <th className="px-3 py-3">الفرع</th>
                <th className="px-3 py-3">الحالة</th>
                <th className="px-3 py-3">الرسالة</th>
                <th className="px-3 py-3">ملاحظات</th>
                <th className="px-3 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800 align-top">
                  <td className="px-3 py-3 whitespace-nowrap">{row.sent_at ? new Date(row.sent_at).toLocaleString('ar-EG') : '-'}</td>
                  <td className="px-3 py-3">{row.doctor_name || '-'}</td>
                  <td className="px-3 py-3">{row.customer_name || '-'}</td>
                  <td className="px-3 py-3">{row.customer_code || '-'}</td>
                  <td className="px-3 py-3">{row.customer_phone || '-'}</td>
                  <td className="px-3 py-3">{row.branch || '-'}</td>
                  <td className="px-3 py-3">{STATUS_LABELS[row.status] || row.status || '-'}</td>
                  <td className="max-w-md px-3 py-3">
                    <p className="line-clamp-4 whitespace-pre-line leading-6">{row.message_body}</p>
                  </td>
                  <td className="px-3 py-3">{row.notes || '-'}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary px-3 py-2" onClick={() => openRowWhatsapp(row)} title="فتح واتساب">
                        <Send className="h-4 w-4" />
                      </button>
                      <button className="btn-secondary px-3 py-2" onClick={() => void navigator.clipboard.writeText(row.message_body)} title="نسخ الرسالة">
                        <Clipboard className="h-4 w-4" />
                      </button>
                      <button className="btn-secondary px-3 py-2" onClick={() => void markReplied(row)} title="العميل رد">
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={10}>
                    لا توجد رسائل ترحيبية مطابقة.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">تسجيل رسالة ترحيبية</h2>
              <button className="btn-secondary px-3 py-2" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <input className="input-dark" placeholder="اسم العميل" value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
              <input className="input-dark" placeholder="كود العميل" value={form.customer_code} onChange={(event) => setForm((current) => ({ ...current, customer_code: event.target.value }))} />
              <input className="input-dark" placeholder="الهاتف" value={form.customer_phone} onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))} />
              <select className="input-dark" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
                <option value="">كل الفروع</option>
                {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
              </select>
              <input className="input-dark" placeholder="الدكتور" value={form.doctor_name} onChange={(event) => setForm((current) => ({ ...current, doctor_name: event.target.value }))} />
              <select className="input-dark" value={selectedScriptId} onChange={(event) => applyScript(event.target.value)}>
                <option value="">اختيار رد سريع للترحيب</option>
                {welcomeScripts.map((script) => (
                  <option key={script.id} value={script.id}>{script.shortcut} - {script.title}</option>
                ))}
              </select>
              <select className="input-dark" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button className="btn-secondary" onClick={() => void seedWelcomeQuickReply()}>
                إضافة اختصار /ترحيب
              </button>
              <input className="input-dark lg:col-span-4" placeholder="ملاحظات" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              <textarea className="input-dark lg:col-span-4" rows={6} value={form.message_body} onChange={(event) => setForm((current) => ({ ...current, message_body: event.target.value }))} />
              <button className="btn-secondary lg:col-span-2" onClick={() => void save(false)}>
                <Plus className="ml-1 inline h-4 w-4" /> حفظ كسجل داخلي
              </button>
              <button className="btn-primary lg:col-span-2" onClick={() => void save(true)}>
                <MessageSquare className="ml-1 inline h-4 w-4" /> فتح واتساب وحفظ الحالة
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
