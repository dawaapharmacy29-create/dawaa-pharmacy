import { useEffect, useMemo, useState } from 'react';
import { Clipboard, MessageSquare, Plus, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_QUICK_REPLY_SCRIPTS,
  QUICK_REPLY_SCRIPT_TYPES,
  fetchQuickReplyScripts,
  incrementQuickReplyUsage,
  renderQuickReplyTemplate,
  saveQuickReplyScript,
  type QuickReplyScript,
} from '@/lib/quickReplyScripts';

const ALL = 'الكل';

function emptyForm(user?: { name?: string | null; branch?: string | null }): Partial<QuickReplyScript> {
  return {
    shortcut: '/',
    title: '',
    category: 'متابعة',
    script_type: 'quick_reply',
    doctor_name: user?.name || null,
    branch: user?.branch || ALL,
    message_body: '',
    active: true,
    tags: [],
  };
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

export default function QuickReplies() {
  const { user } = useAuth();
  const [scripts, setScripts] = useState<QuickReplyScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [doctorFilter, setDoctorFilter] = useState(ALL);
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [form, setForm] = useState<Partial<QuickReplyScript>>(emptyForm(user));
  const [useCustomerName, setUseCustomerName] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setScripts(await fetchQuickReplyScripts());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الردود السريعة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const doctors = useMemo(
    () => [ALL, ...new Set(scripts.map((script) => script.doctor_name || 'عام').filter(Boolean))],
    [scripts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scripts.filter((script) => {
      if (activeFilter === 'active' && script.active === false) return false;
      if (activeFilter === 'inactive' && script.active !== false) return false;
      if (doctorFilter !== ALL && (script.doctor_name || 'عام') !== doctorFilter) return false;
      if (branchFilter !== ALL && (script.branch || ALL) !== branchFilter) return false;
      if (typeFilter !== ALL && script.script_type !== typeFilter) return false;
      if (!q) return true;
      return [script.shortcut, script.title, script.category, script.script_type, script.message_body, ...(script.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [activeFilter, branchFilter, doctorFilter, query, scripts, typeFilter]);

  const renderedMessage = (script: Partial<QuickReplyScript>) =>
    renderQuickReplyTemplate(script.message_body || '', {
      customer_name: 'عميل دواء',
      doctor_name: script.doctor_name || user?.name || 'صيدليات دواء',
      branch: script.branch && script.branch !== ALL ? script.branch : user?.branch || 'فرع الصيدلية',
      last_purchase: 'آخر تعامل',
      use_customer_name: useCustomerName,
    });

  const save = async () => {
    if (!form.shortcut?.trim() || !form.title?.trim() || !form.message_body?.trim()) {
      toast.error('اكتب الاختصار والعنوان والرسالة');
      return;
    }
    try {
      const saved = await saveQuickReplyScript({
        ...form,
        shortcut: form.shortcut,
        title: form.title,
        category: form.category || 'عام',
        script_type: form.script_type || 'quick_reply',
        message_body: form.message_body,
        branch: form.branch === ALL ? null : form.branch || null,
        created_by: user?.id || null,
        created_by_name: user?.name || null,
      } as QuickReplyScript);
      setScripts((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current];
      });
      setForm(emptyForm(user));
      toast.success('تم حفظ الرد السريع');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الرد السريع');
    }
  };

  const copy = async (script: QuickReplyScript) => {
    try {
      await copyText(renderedMessage(script));
      await incrementQuickReplyUsage(script.id);
      setScripts((current) => current.map((item) => (item.id === script.id ? { ...item, usage_count: item.usage_count + 1 } : item)));
      toast.success('تم نسخ الرد');
    } catch {
      toast.error('تعذر النسخ تلقائيًا');
    }
  };

  const toggleActive = async (script: QuickReplyScript) => {
    try {
      const saved = await saveQuickReplyScript({ ...script, active: !script.active });
      setScripts((current) => current.map((item) => (item.id === script.id ? saved : item)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة الرد');
    }
  };

  const seedDefaults = async () => {
    try {
      const saved: QuickReplyScript[] = [];
      for (const script of DEFAULT_QUICK_REPLY_SCRIPTS) {
        saved.push(
          await saveQuickReplyScript({
            ...script,
            created_by: user?.id || null,
            created_by_name: user?.name || null,
          })
        );
      }
      setScripts((current) => [...saved, ...current]);
      toast.success('تمت إضافة السكريبتات الافتراضية');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إضافة السكريبتات الافتراضية');
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-slate-950/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-white">اختصارات الردود السريعة</h1>
            <p className="mt-2 text-sm text-slate-300">سكريبتات واتساب محفوظة في Supabase مع اختصارات تبدأ بـ / وقابلة للتعديل من الصفحة.</p>
          </div>
          <button className="btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'} /> تحديث
          </button>
        </div>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-2">
        <input className="input-dark" placeholder="الاختصار مثل /برد" value={form.shortcut || ''} onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))} />
        <input className="input-dark" placeholder="عنوان السكريبت" value={form.title || ''} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        <input className="input-dark" placeholder="اسم الدكتور/الموظف" value={form.doctor_name || ''} onChange={(event) => setForm((current) => ({ ...current, doctor_name: event.target.value }))} />
        <select className="input-dark" value={form.branch || ALL} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
          <option>{ALL}</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <input className="input-dark" placeholder="التصنيف" value={form.category || ''} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
        <select className="input-dark" value={form.script_type || 'quick_reply'} onChange={(event) => setForm((current) => ({ ...current, script_type: event.target.value }))}>
          {QUICK_REPLY_SCRIPT_TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200">
          <input type="checkbox" checked={form.active !== false} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
          نشط
        </label>
        <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200">
          <input type="checkbox" checked={useCustomerName} onChange={(event) => setUseCustomerName(event.target.checked)} />
          تجربة الرسالة باسم العميل
        </label>
        <textarea className="input-dark lg:col-span-2" rows={5} placeholder="الرسالة. متغيرات متاحة: {{customer_name}} {{doctor_name}} {{branch}} {{last_purchase}}" value={form.message_body || ''} onChange={(event) => setForm((current) => ({ ...current, message_body: event.target.value }))} />
        <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm leading-7 text-slate-200 lg:col-span-2">
          {renderedMessage(form)}
        </div>
        <div className="grid gap-2 lg:col-span-2 lg:grid-cols-[1fr_auto_auto]">
          <input
            className="input-dark"
            placeholder="وسوم مفصولة بفواصل"
            value={(form.tags || []).join(', ')}
            onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))}
          />
          <button className="btn-secondary" type="button" onClick={() => setForm(emptyForm(user))}>تفريغ النموذج</button>
          <button className="btn-primary" type="button" onClick={() => void save()}><Save className="ml-1 inline h-4 w-4" /> حفظ الرد</button>
        </div>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-5">
        <input className="input-dark lg:col-span-2" placeholder="بحث بالاختصار أو العنوان أو التصنيف" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="input-dark" value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}>
          {doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}
        </select>
        <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
          <option>{ALL}</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <select className="input-dark" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option>{ALL}</option>
          {QUICK_REPLY_SCRIPT_TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <select className="input-dark" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}>
          <option value="active">النشط فقط</option>
          <option value="inactive">المعطل فقط</option>
          <option value="all">الكل</option>
        </select>
        <button className="btn-secondary lg:col-span-4" type="button" onClick={() => void seedDefaults()}>
          <Plus className="ml-1 inline h-4 w-4" /> إضافة السكريبتات الافتراضية
        </button>
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((script) => {
          const message = renderedMessage(script);
          const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;
          return (
            <article key={script.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-black text-white">{script.shortcut} · {script.title}</div>
                  <div className="mt-1 text-xs text-slate-400">{script.doctor_name || 'عام'} · {script.branch || ALL} · {script.category} · {script.script_type}</div>
                </div>
                <span className={script.active ? 'text-emerald-300' : 'text-slate-500'}>{script.active ? 'نشط' : 'متوقف'}</span>
              </div>
              <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-900 p-3 text-sm leading-7 text-slate-200">{message}</p>
              <div className="mt-2 text-xs text-slate-500">عدد مرات الاستخدام: {script.usage_count || 0}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-secondary text-xs" type="button" onClick={() => void copy(script)}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ</button>
                <a className="btn-primary text-center text-xs" href={whatsapp} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> واتساب</a>
                <button className="btn-secondary text-xs" type="button" onClick={() => setForm(script)}><Plus className="ml-1 inline h-3.5 w-3.5" /> تعديل</button>
                <button className="btn-secondary text-xs" type="button" onClick={() => void toggleActive(script)}>{script.active ? 'تعطيل' : 'تفعيل'}</button>
              </div>
            </article>
          );
        })}
      </section>

      {!filtered.length && <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">لا توجد ردود سريعة مطابقة.</div>}
    </div>
  );
}
