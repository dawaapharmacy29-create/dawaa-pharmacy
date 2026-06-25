import { useMemo, useState } from 'react';
import { Clipboard, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';

type Reply = {
  id: string;
  shortcut: string;
  title: string;
  message: string;
  doctorName: string;
  branch: string;
  category: string;
  active: boolean;
};

const STORAGE_KEY = 'dawaa_quick_replies_v1';

const DEFAULT_REPLIES: Reply[] = [
  {
    id: 'welcome',
    shortcut: '/ترحيب',
    title: 'رسالة ترحيب آمنة',
    doctorName: 'عام',
    branch: 'كل الفروع',
    category: 'ترحيب',
    active: true,
    message: 'أهلا بحضرتك، مع حضرتك {doctor_name} من صيدليات دواء فرع {branch}. بنرحب بحضرتك ونتشرف بخدمتك دائمًا.',
  },
  {
    id: 'followup',
    shortcut: '/متابعة',
    title: 'متابعة عميل',
    doctorName: 'عام',
    branch: 'كل الفروع',
    category: 'متابعة',
    active: true,
    message: 'أهلا بحضرتك، مع حضرتك {doctor_name} من صيدليات دواء. بنطمن على حضرتك وبنتابع هل في أي طلب أو استفسار نقدر نساعد فيه؟',
  },
  {
    id: 'invoice',
    shortcut: '/فاتورة',
    title: 'قيمة فاتورة بدون اسم العميل',
    doctorName: 'عام',
    branch: 'كل الفروع',
    category: 'تأكيد طلب',
    active: true,
    message: 'أهلا بحضرتك يا فندم، مع حضرتك صيدليات دواء. قيمة الفاتورة الخاصة بحضرتك {invoice_value}. نتشرف بخدمة حضرتك دائمًا.',
  },
  {
    id: 'complaint',
    shortcut: '/شكوى',
    title: 'احتواء شكوى',
    doctorName: 'عام',
    branch: 'كل الفروع',
    category: 'شكوى',
    active: true,
    message: 'نعتذر لحضرتك عن أي تقصير. تم تسجيل الملاحظة وسيتم متابعتها فورًا من المسؤول المختص.',
  },
  {
    id: 'offer',
    shortcut: '/عرض',
    title: 'عرض مناسب بدون ضغط',
    doctorName: 'عام',
    branch: 'كل الفروع',
    category: 'عرض',
    active: true,
    message: 'أهلا بحضرتك، مع حضرتك {doctor_name} من صيدليات دواء. حاليًا متاح عرض مناسب في فرع {branch}، ولو حضرتك محتاج أي صنف نقدر نراجعه ونأكد التوفر.',
  },
];

function safeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `reply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeReplies(value: unknown): Reply[] {
  if (!Array.isArray(value)) return DEFAULT_REPLIES;
  const normalized = value
    .map((item) => item as Partial<Reply>)
    .filter((item) => item.shortcut && item.title && item.message)
    .map((item) => ({
      id: String(item.id || safeId()),
      shortcut: String(item.shortcut || '/'),
      title: String(item.title || 'بدون عنوان'),
      doctorName: String(item.doctorName || 'عام'),
      branch: String(item.branch || 'كل الفروع'),
      category: String(item.category || 'متابعة'),
      active: item.active !== false,
      message: String(item.message || ''),
    }));
  return normalized.length ? normalized : DEFAULT_REPLIES;
}

function loadReplies(): Reply[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeReplies(JSON.parse(raw)) : DEFAULT_REPLIES;
  } catch {
    return DEFAULT_REPLIES;
  }
}

function applyVariables(message: string, userName: string, branch: string, invoiceValue: string) {
  return message
    .replaceAll('{doctor_name}', userName || 'خدمة عملاء صيدليات دواء')
    .replaceAll('{branch}', branch || 'فرع الصيدلية')
    .replaceAll('{invoice_value}', invoiceValue || 'قيمة الفاتورة')
    .replaceAll('{customer_status}', 'حالة العميل')
    .replaceAll('{last_purchase}', 'آخر شراء');
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

export default function QuickReplies() {
  const { user } = useAuth();
  const [replies, setReplies] = useState<Reply[]>(loadReplies);
  const [query, setQuery] = useState('');
  const [invoiceValue, setInvoiceValue] = useState('');
  const [form, setForm] = useState<Reply>({
    id: '',
    shortcut: '/',
    title: '',
    doctorName: user?.name || '',
    branch: user?.branch || 'كل الفروع',
    category: 'متابعة',
    active: true,
    message: '',
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return replies.filter((reply) => !q || [reply.shortcut, reply.title, reply.doctorName, reply.branch, reply.category, reply.message].join(' ').toLowerCase().includes(q));
  }, [query, replies]);

  const persist = (next: Reply[]) => {
    setReplies(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      toast.warning('تم الحفظ مؤقتًا، لكن المتصفح منع التخزين المحلي');
    }
  };

  const resetForm = () => {
    setForm({
      id: '',
      shortcut: '/',
      title: '',
      doctorName: user?.name || '',
      branch: user?.branch || 'كل الفروع',
      category: 'متابعة',
      active: true,
      message: '',
    });
  };

  const save = () => {
    if (!form.shortcut.trim() || !form.title.trim() || !form.message.trim()) {
      toast.error('اكتب الاختصار والعنوان والرسالة');
      return;
    }
    const id = form.id || safeId();
    const clean: Reply = {
      ...form,
      id,
      shortcut: form.shortcut.trim().startsWith('/') ? form.shortcut.trim() : `/${form.shortcut.trim()}`,
      title: form.title.trim(),
      message: form.message.trim(),
      doctorName: form.doctorName.trim() || 'عام',
      branch: form.branch || 'كل الفروع',
    };
    const next = replies.some((reply) => reply.id === id)
      ? replies.map((reply) => (reply.id === id ? clean : reply))
      : [clean, ...replies];
    persist(next);
    resetForm();
    toast.success('تم حفظ الاختصار');
  };

  const copy = async (reply: Reply) => {
    try {
      const doctorName = reply.doctorName === 'عام' ? user?.name || '' : reply.doctorName;
      await copyText(applyVariables(reply.message, doctorName, reply.branch || user?.branch || '', invoiceValue));
      toast.success('تم نسخ الرد');
    } catch {
      toast.error('تعذر النسخ تلقائيًا، انسخ النص يدويًا');
    }
  };

  const remove = (id: string) => {
    persist(replies.filter((reply) => reply.id !== id));
    toast.success('تم حذف الاختصار');
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-slate-950/50 p-5">
        <h1 className="text-2xl font-black text-white">اختصارات الردود السريعة</h1>
        <p className="mt-2 text-sm text-slate-300">
          جهّز رسائل واتساب آمنة بدون ذكر اسم العميل، مع متغيرات للدكتور والفرع وقيمة الفاتورة.
        </p>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-2">
        <input className="input-dark" placeholder="الاختصار مثل /متابعة" value={form.shortcut} onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))} />
        <input className="input-dark" placeholder="عنوان السكريبت" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        <input className="input-dark" placeholder="اسم الدكتور/الموظف" value={form.doctorName} onChange={(event) => setForm((current) => ({ ...current, doctorName: event.target.value }))} />
        <select className="input-dark" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
          <option>كل الفروع</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <select className="input-dark" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
          <option>ترحيب</option>
          <option>متابعة</option>
          <option>شكوى</option>
          <option>عرض</option>
          <option>تأكيد طلب</option>
          <option>اعتذار</option>
        </select>
        <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200">
          <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />نشط
        </label>
        <textarea className="input-dark lg:col-span-2" rows={5} placeholder="الرسالة. متغيرات متاحة: {doctor_name} {branch} {invoice_value} {customer_status} {last_purchase}" value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
        <div className="grid gap-2 lg:col-span-2 lg:grid-cols-[1fr_auto_auto]">
          <input className="input-dark" placeholder="قيمة الفاتورة للاختبار/النسخ مثل 250 جنيه" value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} />
          <button className="btn-secondary" type="button" onClick={resetForm}>تفريغ النموذج</button>
          <button className="btn-primary" type="button" onClick={save}><Save className="ml-1 inline h-4 w-4" /> حفظ الاختصار</button>
        </div>
      </section>

      <section className="dawaa-panel">
        <input className="input-dark mb-4" placeholder="بحث في الاختصارات" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((reply) => (
            <article key={reply.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-black text-white">{reply.shortcut} · {reply.title}</div>
                  <div className="mt-1 text-xs text-slate-400">{reply.doctorName || 'عام'} · {reply.branch} · {reply.category}</div>
                </div>
                <span className={reply.active ? 'text-emerald-300' : 'text-slate-500'}>{reply.active ? 'نشط' : 'متوقف'}</span>
              </div>
              <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-900 p-3 text-sm leading-7 text-slate-200">
                {applyVariables(reply.message, reply.doctorName === 'عام' ? user?.name || '' : reply.doctorName, reply.branch || user?.branch || '', invoiceValue)}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button className="btn-secondary text-xs" type="button" onClick={() => copy(reply)}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ</button>
                <button className="btn-secondary text-xs" type="button" onClick={() => setForm(reply)}><Plus className="ml-1 inline h-3.5 w-3.5" /> تعديل</button>
                <button className="btn-secondary text-xs" type="button" onClick={() => remove(reply.id)}><Trash2 className="ml-1 inline h-3.5 w-3.5" /> حذف</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
