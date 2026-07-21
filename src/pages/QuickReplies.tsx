import { useEffect, useMemo, useState } from 'react';
import { Archive, Clipboard, MessageSquare, Plus, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
type LibraryFilter = 'active' | 'inactive' | 'recovery' | 'all';

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
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

const isRecoveryRecord = (script: QuickReplyScript) =>
  (script.tags || []).some((tag) => /recovery_backup|duplicate_message_corruption|corrupt/i.test(tag));

export default function QuickReplies() {
  const { user } = useAuth();
  const [scripts, setScripts] = useState<QuickReplyScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [doctorFilter, setDoctorFilter] = useState(ALL);
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('active');
  const [backupCount, setBackupCount] = useState(0);
  const [form, setForm] = useState<Partial<QuickReplyScript>>(emptyForm(user));
  const [useCustomerName, setUseCustomerName] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchQuickReplyScripts();
      setScripts(data);
      const backupTables = ['quick_reply_scripts_restore_backup_20260721', 'quick_reply_scripts_recovery_backup_20260721'];
      let total = 0;
      for (const table of backupTables) {
        const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (!error) total += Number(count || 0);
      }
      setBackupCount(total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الردود السريعة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const doctors = useMemo(() => [ALL, ...new Set(scripts.map((script) => script.doctor_name || 'عام').filter(Boolean))], [scripts]);
  const stats = useMemo(() => ({
    all: scripts.length,
    active: scripts.filter((script) => script.active && !isRecoveryRecord(script)).length,
    inactive: scripts.filter((script) => !script.active && !isRecoveryRecord(script)).length,
    recovery: scripts.filter(isRecoveryRecord).length,
  }), [scripts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scripts.filter((script) => {
      if (libraryFilter === 'active' && (!script.active || isRecoveryRecord(script))) return false;
      if (libraryFilter === 'inactive' && (script.active || isRecoveryRecord(script))) return false;
      if (libraryFilter === 'recovery' && !isRecoveryRecord(script)) return false;
      if (doctorFilter !== ALL && (script.doctor_name || 'عام') !== doctorFilter) return false;
      if (branchFilter !== ALL && (script.branch || ALL) !== branchFilter) return false;
      if (typeFilter !== ALL && script.script_type !== typeFilter) return false;
      if (!q) return true;
      return [script.shortcut, script.title, script.category, script.script_type, script.message_body, ...(script.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [branchFilter, doctorFilter, libraryFilter, query, scripts, typeFilter]);

  const renderedMessage = (script: Partial<QuickReplyScript>) => renderQuickReplyTemplate(script.message_body || '', {
    customer_name: 'عميل دواء',
    doctor_name: script.doctor_name || user?.name || 'صيدليات دواء',
    branch: script.branch && script.branch !== ALL ? script.branch : user?.branch || 'فرع الصيدلية',
    last_purchase: 'آخر تعامل',
    use_customer_name: useCustomerName,
  });

  const save = async () => {
    if (saving) return;
    if (!form.shortcut?.trim() || !form.title?.trim() || !form.message_body?.trim()) {
      toast.error('اكتب الاختصار والعنوان والرسالة');
      return;
    }
    setSaving(true);
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
      setScripts((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setForm(emptyForm(user));
      toast.success('تم حفظ الرد السريع');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الرد السريع');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (script: QuickReplyScript) => {
    try {
      await copyText(renderedMessage(script));
      await incrementQuickReplyUsage(script.id);
      setScripts((current) => current.map((item) => item.id === script.id ? { ...item, usage_count: item.usage_count + 1 } : item));
      toast.success('تم نسخ الرد');
    } catch {
      toast.error('تعذر النسخ تلقائيًا');
    }
  };

  const toggleActive = async (script: QuickReplyScript) => {
    if (isRecoveryRecord(script)) {
      toast.error('سجل الاستعادة لا يُفعّل قبل مراجعة النص الأصلي');
      return;
    }
    try {
      const saved = await saveQuickReplyScript({
        ...script,
        active: !script.active,
        created_by: user?.id || script.created_by || null,
        created_by_name: user?.name || script.created_by_name || null,
      });
      setScripts((current) => current.map((item) => item.id === script.id ? saved : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة الرد');
    }
  };

  const seedDefaults = async () => {
    try {
      const saved: QuickReplyScript[] = [];
      for (const script of DEFAULT_QUICK_REPLY_SCRIPTS) {
        const existing = scripts.find((item) => item.shortcut.toLowerCase() === script.shortcut.toLowerCase() && item.active);
        if (!existing) saved.push(await saveQuickReplyScript({ ...script, created_by: user?.id || null, created_by_name: user?.name || null }));
      }
      setScripts((current) => [...saved, ...current]);
      toast.success(saved.length ? `تمت إضافة ${saved.length} ردود افتراضية مفقودة` : 'كل الردود الافتراضية موجودة بالفعل');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إضافة السكريبتات الافتراضية');
    }
  };

  const cards: Array<[LibraryFilter, string, number, typeof MessageSquare, string]> = [
    ['active', 'نشط وجاهز للاستخدام', stats.active, MessageSquare, 'text-emerald-200'],
    ['inactive', 'غير نشط وسليم', stats.inactive, Archive, 'text-amber-200'],
    ['recovery', 'أرشيف الاستعادة والتالف', stats.recovery || backupCount, ShieldAlert, 'text-red-200'],
    ['all', 'كل السجلات الحالية', stats.all, Clipboard, 'text-cyan-200'],
  ];

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border border-cyan-500/30 bg-slate-950/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black text-white">اختصارات الردود السريعة</h1><p className="mt-2 text-sm text-slate-300">مكتبة موحدة مع فصل الردود الجاهزة عن الأرشيف والبيانات القديمة التالفة.</p></div>
        <div className="flex gap-2"><button className="btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'}/> تحديث</button><button className="btn-secondary" onClick={() => void seedDefaults()}><Plus className="ml-1 inline h-4 w-4"/> استكمال الافتراضي</button></div>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([id, label, count, Icon, color]) => <button key={id} onClick={() => setLibraryFilter(id)} className={`rounded-3xl border p-4 text-right transition ${libraryFilter === id ? 'border-cyan-300 bg-cyan-400/10' : 'border-white/10 bg-slate-950/40 hover:bg-white/[0.04]'}`}><Icon className={`mb-3 h-5 w-5 ${color}`}/><div className="text-xs font-black text-slate-400">{label}</div><div className="mt-1 text-3xl font-black text-white">{count}</div></button>)}
    </section>

    {libraryFilter === 'recovery' ? <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-4 text-sm font-bold leading-7 text-red-100">سجلات الاستعادة محفوظة للحماية والمراجعة فقط. لا يتم تشغيل النصوص التي تعرضت للتلف الجماعي أو أصبحت نسخًا متطابقة دون مصدر أصلي موثوق. عدد صفوف النسخ الاحتياطية المقروءة: {backupCount}.</section> : null}

    <section className="dawaa-panel grid gap-3 lg:grid-cols-2">
      <input className="input-dark" placeholder="الاختصار مثل /برد" value={form.shortcut || ''} onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))}/>
      <input className="input-dark" placeholder="عنوان السكريبت" value={form.title || ''} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}/>
      <input className="input-dark" placeholder="اسم الدكتور/الموظف" value={form.doctor_name || ''} onChange={(event) => setForm((current) => ({ ...current, doctor_name: event.target.value }))}/>
      <select className="input-dark" value={form.branch || ALL} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}><option>{ALL}</option>{BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}</select>
      <input className="input-dark" placeholder="التصنيف" value={form.category || ''} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}/>
      <select className="input-dark" value={form.script_type || 'quick_reply'} onChange={(event) => setForm((current) => ({ ...current, script_type: event.target.value }))}>{QUICK_REPLY_SCRIPT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
      <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200"><input type="checkbox" checked={form.active !== false} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}/> نشط</label>
      <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200"><input type="checkbox" checked={useCustomerName} onChange={(event) => setUseCustomerName(event.target.checked)}/> تجربة الرسالة باسم العميل</label>
      <textarea className="input-dark lg:col-span-2" rows={5} placeholder="الرسالة. متغيرات متاحة: {{customer_name}} {{doctor_name}} {{branch}} {{last_purchase}}" value={form.message_body || ''} onChange={(event) => setForm((current) => ({ ...current, message_body: event.target.value }))}/>
      <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm leading-7 text-slate-200 lg:col-span-2">{renderedMessage(form)}</div>
      <input className="input-dark lg:col-span-2" placeholder="الوسوم مفصولة بفاصلة" value={(form.tags || []).join(', ')} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))}/>
      <button className="btn-primary lg:col-span-2" disabled={saving} onClick={() => void save()}><Save className="ml-1 inline h-4 w-4"/> حفظ الرد</button>
    </section>

    <section className="dawaa-panel grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <input className="input-dark xl:col-span-2" placeholder="بحث في الاختصار أو النص أو التصنيف" value={query} onChange={(event) => setQuery(event.target.value)}/>
      <select className="input-dark" value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}>{doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}</select>
      <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option>{ALL}</option>{BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}</select>
      <select className="input-dark" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>{ALL}</option>{QUICK_REPLY_SCRIPT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
    </section>

    <div className="text-sm font-black text-cyan-200">المعروض الآن: {filtered.length} رد</div>
    <section className="grid gap-3 xl:grid-cols-2">
      {filtered.map((script) => <article key={script.id} className="rounded-3xl border border-white/10 bg-slate-950/45 p-5">
        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-cyan-500/15 px-3 py-1 font-black text-cyan-200">{script.shortcut}</span><span className="text-xs font-bold text-slate-400">{script.category} · {script.script_type}</span>{isRecoveryRecord(script) ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-black text-red-200">أرشيف استعادة</span> : null}</div><h2 className="mt-3 text-lg font-black text-white">{script.title}</h2></div><button className="btn-secondary" disabled={isRecoveryRecord(script)} onClick={() => void toggleActive(script)}>{script.active ? 'تعطيل' : 'تفعيل'}</button></div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-7 text-slate-200">{renderedMessage(script)}</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-400"><span>{script.branch || 'كل الفروع'} · {script.doctor_name || 'عام'}</span><span>الاستخدام: {script.usage_count || 0}</span></div>
        <button className="btn-primary mt-4 w-full" disabled={isRecoveryRecord(script)} onClick={() => void copy(script)}><Clipboard className="ml-1 inline h-4 w-4"/> نسخ الرد</button>
      </article>)}
      {!loading && filtered.length === 0 ? <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center font-black text-emerald-200 xl:col-span-2">لا توجد ردود مطابقة للفلاتر الحالية.</div> : null}
    </section>
  </div>;
}
