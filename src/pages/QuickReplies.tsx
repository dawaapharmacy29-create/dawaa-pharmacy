import { useMemo, useState } from 'react';
import { Clipboard, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';

type Reply = { id: string; shortcut: string; title: string; message: string; doctorName: string; branch: string; category: string; active: boolean };
const STORAGE_KEY = 'dawaa_quick_replies_v1';
const DEFAULT_REPLIES: Reply[] = [
  { id: 'welcome', shortcut: '/ترحيب', title: 'رسالة ترحيب آمنة', doctorName: 'عام', branch: 'كل الفروع', category: 'ترحيب', active: true, message: 'أهلا بحضرتك، مع حضرتك {doctor_name} من صيدليات دواء فرع {branch}. بنرحب بحضرتك ونتشرف بخدمتك دائمًا.' },
  { id: 'followup', shortcut: '/متابعة', title: 'متابعة عميل', doctorName: 'عام', branch: 'كل الفروع', category: 'متابعة', active: true, message: 'أهلا بحضرتك، مع حضرتك {doctor_name} من صيدليات دواء. بنطمن على حضرتك وبنتابع هل في أي طلب أو استفسار نقدر نساعد فيه؟' },
  { id: 'complaint', shortcut: '/شكوى', title: 'احتواء شكوى', doctorName: 'عام', branch: 'كل الفروع', category: 'شكوى', active: true, message: 'نعتذر لحضرتك عن أي تقصير. تم تسجيل الملاحظة وسيتم متابعتها فورًا من المسؤول المختص.' },
];
function loadReplies(): Reply[] { try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : DEFAULT_REPLIES; } catch { return DEFAULT_REPLIES; } }
function applyVariables(message: string, userName: string, branch: string) { return message.replaceAll('{doctor_name}', userName || 'خدمة عملاء صيدليات دواء').replaceAll('{branch}', branch || 'فرع الصيدلية').replaceAll('{invoice_value}', 'قيمة الفاتورة'); }

export default function QuickReplies() {
  const { user } = useAuth();
  const [replies, setReplies] = useState<Reply[]>(loadReplies);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<Reply>({ id: '', shortcut: '/', title: '', doctorName: user?.name || '', branch: user?.branch || 'كل الفروع', category: 'متابعة', active: true, message: '' });
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return replies.filter((reply) => !q || [reply.shortcut, reply.title, reply.doctorName, reply.branch, reply.category, reply.message].join(' ').toLowerCase().includes(q)); }, [query, replies]);
  const persist = (next: Reply[]) => { setReplies(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };
  const save = () => {
    if (!form.shortcut.trim() || !form.title.trim() || !form.message.trim()) return toast.error('اكتب الاختصار والعنوان والرسالة');
    const id = form.id || crypto.randomUUID();
    const next = replies.some((reply) => reply.id === id) ? replies.map((reply) => (reply.id === id ? { ...form, id } : reply)) : [{ ...form, id }, ...replies];
    persist(next); setForm({ id: '', shortcut: '/', title: '', doctorName: user?.name || '', branch: user?.branch || 'كل الفروع', category: 'متابعة', active: true, message: '' }); toast.success('تم حفظ الاختصار');
  };
  const copy = async (reply: Reply) => { await navigator.clipboard.writeText(applyVariables(reply.message, reply.doctorName || user?.name || '', reply.branch || user?.branch || '')); toast.success('تم نسخ الرد'); };
  const remove = (id: string) => { persist(replies.filter((reply) => reply.id !== id)); toast.success('تم حذف الاختصار'); };
  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-slate-950/50 p-5">
        <h1 className="text-2xl font-black text-white">اختصارات الردود السريعة</h1>
        <p className="mt-2 text-sm text-slate-300">اكتب اختصار مثل /ترحيب أو /متابعة وانسخ الرد المناسب لكل دكتور وسكريبت واتساب.</p>
      </section>
      <section className="dawaa-panel grid gap-3 lg:grid-cols-2">
        <input className="input-dark" placeholder="الاختصار مثل /متابعة" value={form.shortcut} onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))} />
        <input className="input-dark" placeholder="عنوان السكريبت" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        <input className="input-dark" placeholder="اسم الدكتور/الموظف" value={form.doctorName} onChange={(event) => setForm((current) => ({ ...current, doctorName: event.target.value }))} />
        <select className="input-dark" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}><option>كل الفروع</option>{BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}</select>
        <select className="input-dark" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option>ترحيب</option><option>متابعة</option><option>شكوى</option><option>عرض</option><option>تأكيد طلب</option><option>اعتذار</option></select>
        <label className="flex items-center gap-2 rounded-2xl border border-slate-700 p-3 text-slate-200"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />نشط</label>
        <textarea className="input-dark lg:col-span-2" rows={5} placeholder="الرسالة. متغيرات متاحة: {doctor_name} {branch} {invoice_value}" value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
        <button className="btn-primary lg:col-span-2" onClick={save}><Save className="ml-1 inline h-4 w-4" /> حفظ الاختصار</button>
      </section>
      <section className="dawaa-panel">
        <input className="input-dark mb-4" placeholder="بحث في الاختصارات" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((reply) => (
            <article key={reply.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
              <div className="flex items-start justify-between gap-2"><div><div className="text-lg font-black text-white">{reply.shortcut} · {reply.title}</div><div className="mt-1 text-xs text-slate-400">{reply.doctorName || 'عام'} · {reply.branch} · {reply.category}</div></div><span className={reply.active ? 'text-emerald-300' : 'text-slate-500'}>{reply.active ? 'نشط' : 'متوقف'}</span></div>
              <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-900 p-3 text-sm leading-7 text-slate-200">{applyVariables(reply.message, reply.doctorName || user?.name || '', reply.branch || user?.branch || '')}</p>
              <div className="mt-3 grid grid-cols-3 gap-2"><button className="btn-secondary text-xs" onClick={() => copy(reply)}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ</button><button className="btn-secondary text-xs" onClick={() => setForm(reply)}><Plus className="ml-1 inline h-3.5 w-3.5" /> تعديل</button><button className="btn-secondary text-xs" onClick={() => remove(reply.id)}><Trash2 className="ml-1 inline h-3.5 w-3.5" /> حذف</button></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
