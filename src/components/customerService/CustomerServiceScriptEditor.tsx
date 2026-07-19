import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ClipboardCopy, CopyPlus, MessageSquareText, Plus, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  QUICK_REPLY_SCRIPT_TYPES,
  fetchQuickReplyScripts,
  renderQuickReplyTemplate,
  saveQuickReplyScript,
  type QuickReplyScript,
} from '@/lib/quickReplyScripts';

const ALL_BRANCHES = 'كل الفروع';
const EDITOR_ROLES = new Set(['general_manager', 'admin', 'customer_service_manager', 'customer_service', 'branch_manager']);

type DraftScript = Partial<QuickReplyScript>;

function blankDraft(user?: { name?: string | null; branch?: string | null }): DraftScript {
  return {
    shortcut: '/',
    title: '',
    category: 'متابعة واطمئنان',
    script_type: 'followup',
    doctor_name: user?.name || null,
    branch: user?.branch || null,
    message_body:
      'أهلًا بحضرتك يا أستاذ {{customer_name}}، مع حضرتك د/ {{doctor_name}} من خدمة عملاء صيدليات دواء.\nحبيت أطمن على حضرتك وأتأكد إن آخر تعامل ليك معانا كان كويس، وإن مفيش أي استفسار أو حاجة نقدر نساعد حضرتك فيها.\n\nشكرًا جدًا لوقت حضرتك، وتشرفنا بالكلام معاك. سجلت ملاحظات حضرتك، وصيدليات دواء تحت أمر حضرتك في أي وقت.',
    active: true,
    tags: ['اطمئنان', 'خدمة العملاء'],
  };
}

function roleOf(user: unknown) {
  return String((user as { role?: string | null } | null)?.role || '').trim();
}

export default function CustomerServiceScriptEditor() {
  const { user } = useAuth();
  const canEdit = EDITOR_ROLES.has(roleOf(user));
  const [expanded, setExpanded] = useState(false);
  const [scripts, setScripts] = useState<QuickReplyScript[]>([]);
  const [draft, setDraft] = useState<DraftScript>(() => blankDraft(user));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setScripts(await fetchQuickReplyScripts());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل السكريبتات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded && scripts.length === 0) void load();
  }, [expanded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scripts
      .filter((script) => script.script_type === 'followup' || script.category.includes('متابعة') || script.category.includes('اطمئنان'))
      .filter((script) => !q || [script.shortcut, script.title, script.category, script.message_body].join(' ').toLowerCase().includes(q));
  }, [query, scripts]);

  const preview = renderQuickReplyTemplate(draft.message_body || '', {
    customer_name: 'إسلام محمد',
    doctor_name: user?.name || 'ضحى',
    branch: user?.branch || 'فرع الصيدلية',
    last_purchase: 'آخر تعامل',
    use_customer_name: true,
  });

  function startNew() {
    setDraft(blankDraft(user));
  }

  function edit(script: QuickReplyScript) {
    setDraft({ ...script });
    window.setTimeout(() => document.getElementById('customer-service-script-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  function duplicate(script: QuickReplyScript) {
    setDraft({
      ...script,
      id: undefined,
      shortcut: `${script.shortcut}-نسخة`,
      title: `${script.title} - نسخة`,
      active: false,
      usage_count: 0,
      created_at: null,
      updated_at: null,
    });
    window.setTimeout(() => document.getElementById('customer-service-script-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  async function save() {
    if (!canEdit) {
      toast.error('حسابك لا يملك صلاحية تعديل السكريبتات');
      return;
    }
    if (!draft.shortcut?.trim() || !draft.title?.trim() || !draft.message_body?.trim()) {
      toast.error('اكتب الاختصار والعنوان ونص السكريبت');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveQuickReplyScript({
        ...draft,
        shortcut: draft.shortcut,
        title: draft.title,
        category: draft.category || 'متابعة واطمئنان',
        script_type: draft.script_type || 'followup',
        message_body: draft.message_body,
        doctor_name: user?.name || draft.doctor_name || null,
        created_by: user?.id || null,
        created_by_name: user?.name || null,
      } as QuickReplyScript);
      setScripts((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setDraft(blankDraft(user));
      toast.success('تم حفظ السكريبت');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ السكريبت');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(script: QuickReplyScript) {
    try {
      const saved = await saveQuickReplyScript({
        ...script,
        active: !script.active,
        created_by: user?.id || script.created_by || null,
        created_by_name: user?.name || script.created_by_name || null,
      });
      setScripts((current) => current.map((item) => item.id === script.id ? saved : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة السكريبت');
    }
  }

  async function copyPreview(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success('تم نسخ السكريبت');
  }

  if (!canEdit) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-950/45" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-black text-white"><MessageSquareText className="text-cyan-300" size={20} />إدارة سكريبتات خدمة العملاء</div>
          <p className="mt-1 text-xs text-slate-400">إنشاء وتعديل ونسخ السكريبتات من داخل صفحة المتابعة.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={startNew}><Plus size={15} className="ml-1 inline" />سكريبت جديد</button>
          <button type="button" className="rounded-xl border border-white/10 p-2 text-slate-300" onClick={() => setExpanded((value) => !value)}><ChevronDown size={18} className={expanded ? 'rotate-180 transition' : 'transition'} /></button>
        </div>
      </header>

      {expanded && <div className="space-y-4 border-t border-white/10 p-4">
        <div id="customer-service-script-form" className="grid gap-3 lg:grid-cols-2">
          <input className="input-dark" value={draft.shortcut || ''} onChange={(event) => setDraft((current) => ({ ...current, shortcut: event.target.value }))} placeholder="الاختصار مثل /اطمئنان" />
          <input className="input-dark" value={draft.title || ''} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="اسم السكريبت" />
          <input className="input-dark" value={draft.category || ''} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="التصنيف" />
          <select className="input-dark" value={draft.script_type || 'followup'} onChange={(event) => setDraft((current) => ({ ...current, script_type: event.target.value }))}>
            {QUICK_REPLY_SCRIPT_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <select className="input-dark" value={draft.branch || ''} onChange={(event) => setDraft((current) => ({ ...current, branch: event.target.value || null }))}>
            <option value="">{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option>
          </select>
          <label className="input-dark flex items-center gap-2"><input type="checkbox" checked={draft.active !== false} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />نشط</label>
          <textarea className="input-dark lg:col-span-2" rows={7} value={draft.message_body || ''} onChange={(event) => setDraft((current) => ({ ...current, message_body: event.target.value }))} placeholder="اكتب السكريبت هنا. المتغيرات: {{customer_name}} و {{doctor_name}}" />
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-4 text-sm leading-8 text-slate-100 lg:col-span-2 whitespace-pre-line">{preview}</div>
          <div className="flex flex-wrap justify-end gap-2 lg:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => void copyPreview(preview)}><ClipboardCopy size={15} className="ml-1 inline" />نسخ المعاينة</button>
            <button type="button" className="btn-secondary" onClick={startNew}><X size={15} className="ml-1 inline" />تفريغ</button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}><Save size={15} className="ml-1 inline" />{saving ? 'جاري الحفظ...' : draft.id ? 'حفظ التعديل' : 'حفظ سكريبت جديد'}</button>
          </div>
        </div>

        <div className="flex gap-2">
          <input className="input-dark flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث في السكريبتات" />
          <button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((script) => <article key={script.id} className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-black text-white">{script.title}</h3><p className="text-xs text-slate-400">{script.shortcut} · {script.branch || ALL_BRANCHES}</p></div><span className={script.active ? 'text-xs text-emerald-300' : 'text-xs text-slate-500'}>{script.active ? 'نشط' : 'متوقف'}</span></div>
            <p className="mt-3 line-clamp-5 whitespace-pre-line text-sm leading-7 text-slate-300">{script.message_body}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => edit(script)}>تعديل</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => duplicate(script)}><CopyPlus size={14} className="ml-1 inline" />نسخة</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => void toggle(script)}>{script.active ? 'تعطيل' : 'تفعيل'}</button>
            </div>
          </article>)}
        </div>
      </div>}
    </section>
  );
}
