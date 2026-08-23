/* eslint-disable react/no-unescaped-entities */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Eye,
  Loader2,
  Plus,
  Save,
  Star,
  Trash2,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface RatingSection {
  key: string;
  label: string;
  description: string;
  icon: string;
  rating: number;
  notes: string;
}

interface StaffEval {
  id: string;
  staff_id?: string | null;
  name: string;
  role?: string | null;
  branch?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  rating: 'ممتاز' | 'جيد' | 'مقبول' | 'ضعيف';
  note: string;
  action_type?: 'none' | 'notice' | 'deduction' | 'reward';
  points_delta?: number;
  money_amount?: number;
}

interface ActionItem {
  id: string;
  text: string;
  priority: 'عاجل' | 'عادي' | 'منخفض';
  assigned_to: string;
}

interface InspectionForm {
  branch: string;
  date: string;
  time: string;
  inspector_name: string;
  sections: RatingSection[];
  staff_evals: StaffEval[];
  action_items: ActionItem[];
  overall_notes: string;
  next_visit_date: string;
}

interface PastInspection {
  id: string;
  branch: string;
  date: string;
  time?: string;
  inspector_name: string;
  overall_score: number;
  overall_notes: string;
  created_at: string;
  sections: RatingSection[];
  staff_evals: StaffEval[];
  action_items: ActionItem[];
  next_visit_date?: string;
}

const BRANCHES = ['فرع شكري', 'فرع الشامي', 'الفرع الرئيسي'];

const DEFAULT_SECTIONS: RatingSection[] = [
  { key: 'cleanliness', label: 'النظافة والترتيب', description: 'نظافة الأرضيات، الرفوف، المنضدة، الحمامات، مظهر الفرع العام', icon: '✨', rating: 0, notes: '' },
  { key: 'attendance', label: 'الحضور والالتزام', description: 'الحضور في الوقت، الزي الرسمي، الانتباه، الانضباط العام', icon: '🕐', rating: 0, notes: '' },
  { key: 'stock', label: 'المخزون والتوفر', description: 'توفر الأدوية الأساسية، ترتيب الرفوف، تاريخ الصلاحية، النواقص', icon: '📦', rating: 0, notes: '' },
  { key: 'customer_service', label: 'خدمة العملاء', description: 'التعامل مع العملاء، سرعة الخدمة، حل المشكلات، الاحترافية', icon: '🤝', rating: 0, notes: '' },
  { key: 'sales', label: 'الأداء البيعي', description: 'التوصية بالمنتجات، المبيعات، ربط العملاء بالكود، الكاش باك', icon: '📈', rating: 0, notes: '' },
  { key: 'safety', label: 'الأمان والسلامة', description: 'حالة الصراف، الأمان العام، إجراءات الطوارئ، الكاميرات', icon: '🔒', rating: 0, notes: '' },
  { key: 'followups', label: 'المتابعات والمهام', description: 'متابعة العملاء، تنفيذ المهام المطلوبة من المرور السابق', icon: '📋', rating: 0, notes: '' },
];

const now = () => {
  const d = new Date();
  return { date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 5) };
};

function newActionItem(): ActionItem {
  return { id: crypto.randomUUID(), text: '', priority: 'عادي', assigned_to: '' };
}

function newStaffEval(): StaffEval {
  return { id: crypto.randomUUID(), name: '', rating: 'جيد', note: '', action_type: 'none', points_delta: 0, money_amount: 0 };
}

function arabicDayName(dateText: string) {
  const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return names[new Date().getDay()];
  return names[date.getDay()];
}

function actionImpact(action?: StaffEval['action_type']) {
  if (action === 'deduction') return { points: -10, money: 0, label: 'خصم نقاط' };
  if (action === 'reward') return { points: 10, money: 0, label: 'مكافأة نقاط' };
  if (action === 'notice') return { points: -3, money: 0, label: 'لفت نظر' };
  return { points: 0, money: 0, label: 'بدون إجراء' };
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const labels = ['', 'ضعيف جداً', 'ضعيف', 'مقبول', 'جيد', 'ممتاز'];
  const active = hovered || value;
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="transition-transform hover:scale-110 focus:outline-none"
          aria-label={`تقييم ${star} من 5`}
        >
          <Star
            className={`h-7 w-7 transition-colors ${
              active >= star
                ? 'fill-[var(--dawaa-status-warning-text)] text-[var(--dawaa-status-warning-text)]'
                : 'text-[var(--dawaa-theme-muted)]'
            }`}
          />
        </button>
      ))}
      {active > 0 && <span className="dawaa-caption mr-2 text-sm font-bold">{labels[active]}</span>}
    </div>
  );
}

function scoreTone(score: number) {
  const pct = Math.round((score / 5) * 100);
  if (pct >= 80) return 'dawaa-badge--success';
  if (pct >= 60) return 'dawaa-badge--warning';
  if (pct >= 40) return 'dawaa-badge--info';
  return 'dawaa-badge--danger';
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round((score / 5) * 100);
  const label = pct >= 80 ? 'ممتاز' : pct >= 60 ? 'جيد' : pct >= 40 ? 'مقبول' : 'يحتاج تحسين';
  return <span className={`dawaa-badge ${scoreTone(score)}`}>{score.toFixed(1)}/5 — {label}</span>;
}

export default function BranchInspection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { date, time } = now();
  const [form, setForm] = useState<InspectionForm>({
    branch: user?.branch && user.branch !== 'كل الفروع' ? user.branch : BRANCHES[0],
    date,
    time,
    inspector_name: user?.name || '',
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    staff_evals: [],
    action_items: [],
    overall_notes: '',
    next_visit_date: '',
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pastInspections, setPastInspections] = useState<PastInspection[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('cleanliness');
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const ratedSections = form.sections.filter((s) => s.rating > 0);
  const overallScore = ratedSections.length ? ratedSections.reduce((sum, s) => sum + s.rating, 0) / ratedSections.length : 0;
  const completedSections = ratedSections.length;

  useEffect(() => {
    if (!isSupabaseConfigured || !showHistory) return;
    setLoadingHistory(true);
    supabase
      .from('branch_inspections')
      .select('id, branch, date, time, inspector_name, overall_score, overall_notes, created_at, sections, staff_evals, action_items, next_visit_date')
      .eq('branch', form.branch)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        const normalized = ((data || []) as Array<Record<string, any>>).map((row) => ({
          ...row,
          sections: Array.isArray(row.sections) ? row.sections : [],
          staff_evals: Array.isArray(row.staff_evals) ? row.staff_evals : [],
          action_items: Array.isArray(row.action_items) ? row.action_items : [],
        })) as PastInspection[];
        setPastInspections(normalized);
        setLoadingHistory(false);
      });
  }, [showHistory, form.branch]);

  useEffect(() => {
    if (!isSupabaseConfigured || !form.branch || !form.date) return;
    const dayName = arabicDayName(form.date);
    supabase
      .from('shift_schedules')
      .select('id,staff_id,staff_name,role,branch,day_name,shift_start,shift_end,start_time,end_time,is_off,status')
      .eq('branch', form.branch)
      .eq('day_name', dayName)
      .limit(120)
      .then(({ data }) => {
        const rows = (data || []) as Array<Record<string, any>>;
        const active = rows.filter((row) => !row.is_off && !String(row.status || '').includes('إجاز'));
        if (!active.length) return;
        setForm((prev) => {
          const typed = prev.staff_evals.filter((row) => row.name && !row.staff_id);
          const mapped = active.map((row) => {
            const existing = prev.staff_evals.find(
              (x) => (x.staff_id && x.staff_id === row.staff_id) || (!x.staff_id && x.name === row.staff_name)
            );
            return {
              id: existing?.id || String(row.id || crypto.randomUUID()),
              staff_id: row.staff_id || null,
              name: row.staff_name || row.name || 'موظف غير محدد',
              role: row.role || null,
              branch: row.branch || form.branch,
              shift_start: row.shift_start || row.start_time || null,
              shift_end: row.shift_end || row.end_time || null,
              rating: existing?.rating || 'جيد',
              note: existing?.note || '',
              action_type: existing?.action_type || 'none',
              points_delta: existing?.points_delta ?? actionImpact(existing?.action_type || 'none').points,
              money_amount: existing?.money_amount ?? 0,
            } as StaffEval;
          });
          return { ...prev, staff_evals: [...mapped, ...typed] };
        });
      });
  }, [form.branch, form.date]);

  const updateSection = useCallback((key: string, field: keyof RatingSection, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.key === key ? { ...s, [field]: value } : s)),
    }));
  }, []);

  const addStaffEval = () => setForm((prev) => ({ ...prev, staff_evals: [...prev.staff_evals, newStaffEval()] }));
  const removeStaffEval = (id: string) => setForm((prev) => ({ ...prev, staff_evals: prev.staff_evals.filter((e) => e.id !== id) }));
  const updateStaffEval = (id: string, field: keyof StaffEval, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      staff_evals: prev.staff_evals.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e, [field]: value } as StaffEval;
        if (field === 'action_type') {
          const impact = actionImpact(value as StaffEval['action_type']);
          next.points_delta = impact.points;
          next.money_amount = impact.money;
        }
        return next;
      }),
    }));
  };

  const addAction = () => setForm((prev) => ({ ...prev, action_items: [...prev.action_items, newActionItem()] }));
  const removeAction = (id: string) => setForm((prev) => ({ ...prev, action_items: prev.action_items.filter((a) => a.id !== id) }));
  const updateAction = (id: string, field: keyof ActionItem, value: string) => {
    setForm((prev) => ({ ...prev, action_items: prev.action_items.map((a) => (a.id === id ? { ...a, [field]: value } : a)) }));
  };

  const handleSave = async () => {
    if (completedSections < 3) {
      toast.error('قيّم 3 أقسام على الأقل قبل الحفظ');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        branch: form.branch,
        date: form.date,
        time: form.time,
        inspector_name: form.inspector_name,
        inspector_id: user?.id || null,
        sections: form.sections,
        staff_evals: form.staff_evals,
        action_items: form.action_items,
        overall_notes: form.overall_notes,
        overall_score: overallScore,
        next_visit_date: form.next_visit_date || null,
        created_at: new Date().toISOString(),
      };
      if (isSupabaseConfigured) {
        const { data: reportRows, error } = await supabase
          .from('branch_inspections')
          .insert(payload)
          .select('id')
          .limit(1);
        if (error) throw error;
        const reportId = (reportRows?.[0] as any)?.id || null;

        if (reportId && form.staff_evals.length) {
          await supabase
            .from('branch_visit_staff_reviews')
            .insert(
              form.staff_evals.map((ev) => ({
                report_id: reportId,
                staff_id: ev.staff_id || null,
                staff_name: ev.name,
                role: ev.role || null,
                branch: ev.branch || form.branch,
                shift_start: ev.shift_start || null,
                shift_end: ev.shift_end || null,
                rating: ev.rating,
                note: ev.note || null,
                action_type: ev.action_type || 'none',
                points_delta: ev.points_delta || 0,
                money_amount: ev.money_amount || 0,
                created_by_name: form.inspector_name || user?.name || null,
              }))
            )
            .then(() => undefined);

          const pointRows = form.staff_evals
            .filter((ev) => ev.staff_id && Number(ev.points_delta || 0) !== 0)
            .map((ev) => ({
              staff_id: ev.staff_id,
              employee_name: ev.name,
              branch: ev.branch || form.branch,
              points_delta: ev.points_delta || 0,
              points: ev.points_delta || 0,
              type: Number(ev.points_delta || 0) > 0 ? 'reward' : 'deduction',
              reason: `مرور مدير الفروع - ${actionImpact(ev.action_type).label}`,
              description: ev.note || form.overall_notes || 'تقييم مرور مدير الفروع',
              source: 'branch_visit',
              source_id: reportId,
              status: 'approved',
              created_by_name: form.inspector_name || user?.name || null,
            }));
          if (pointRows.length) {
            const { error: pointsError } = await supabase.from('employee_transactions').insert(pointRows);
            if (pointsError) toast.error(`تم حفظ نموذج المرور، لكن تعذر تسجيل نقاط الموظفين: ${pointsError.message}`);
          }
        }
      }
      setSaved(true);
      toast.success('تم حفظ نموذج المرور بنجاح ✅');
      setTimeout(() => {
        setSaved(false);
        setForm((prev) => ({
          ...prev,
          sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
          staff_evals: [],
          action_items: [],
          overall_notes: '',
          next_visit_date: '',
          time: new Date().toTimeString().slice(0, 5),
          date: new Date().toISOString().slice(0, 10),
        }));
        setExpandedSection('cleanliness');
      }, 2500);
    } catch (err) {
      toast.error(`فشل الحفظ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = saving || saved || completedSections < 3;

  return (
    <div className="dawaa-page space-y-5 p-4 md:p-6" dir="rtl">
      <header className="dawaa-card dawaa-card--raised flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="dawaa-button dawaa-button--secondary px-3 text-sm">
            <ArrowLeft className="h-4 w-4" /> رجوع
          </button>
          <span className="dawaa-icon-tile h-10 w-10"><ClipboardList className="h-5 w-5" /></span>
          <div>
            <h1 className="dawaa-title text-xl">نموذج مرور وتقييم مدير الفروع</h1>
            <p className="dawaa-caption text-xs">تقييم يومي شامل لأداء الفرع</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowHistory((v) => !v)} className="dawaa-button dawaa-button--secondary text-sm">
            <Eye className="h-4 w-4" /> {showHistory ? 'إخفاء السجل' : 'السجل السابق'}
          </button>
          <button onClick={() => void handleSave()} disabled={saveDisabled} className={`dawaa-button text-sm ${saved ? 'dawaa-badge--success' : 'dawaa-button--primary'}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? 'تم الحفظ' : saving ? 'جارٍ الحفظ...' : 'حفظ التقرير'}
          </button>
        </div>
      </header>

      <section className="dawaa-card dawaa-card--soft p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="dawaa-body text-sm font-bold">تقدم النموذج: {completedSections}/{form.sections.length} أقسام</span>
          {overallScore > 0 && <ScoreBadge score={overallScore} />}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--dawaa-theme-soft)]">
          <div className="h-full rounded-full bg-[var(--dawaa-theme-primary)] transition-all duration-500" style={{ width: `${(completedSections / form.sections.length) * 100}%` }} />
        </div>
      </section>

      <section className="dawaa-card p-5">
        <h2 className="dawaa-title mb-4 flex items-center gap-2"><User className="h-4 w-4 text-[var(--dawaa-theme-primary)]" /> معلومات المرور</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="dawaa-caption text-xs">الفرع<select value={form.branch} onChange={(e) => setForm((prev) => ({ ...prev, branch: e.target.value }))} className="dawaa-select mt-1 font-bold">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
          <label className="dawaa-caption text-xs">التاريخ<input type="date" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="dawaa-input mt-1 font-bold" /></label>
          <label className="dawaa-caption text-xs">وقت المرور<div className="relative mt-1"><Clock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" /><input type="time" value={form.time} onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))} className="dawaa-input pr-9 font-bold" /></div></label>
          <label className="dawaa-caption text-xs">اسم المفتش / المدير<input type="text" value={form.inspector_name} onChange={(e) => setForm((prev) => ({ ...prev, inspector_name: e.target.value }))} placeholder="اسم مدير الفروع" className="dawaa-input mt-1 font-bold" /></label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="dawaa-title flex items-center gap-2 px-1"><Star className="h-4 w-4 text-[var(--dawaa-status-warning-text)]" /> تقييم أقسام الفرع</h2>
        {form.sections.map((section) => {
          const isOpen = expandedSection === section.key;
          const isDone = section.rating > 0;
          return (
            <article key={section.key} className={`dawaa-card overflow-hidden p-0 ${isDone ? 'border-[var(--dawaa-theme-accent-border)]' : ''}`}>
              <button type="button" onClick={() => setExpandedSection(isOpen ? null : section.key)} className="flex w-full items-center justify-between gap-3 p-5 text-right">
                <div className="flex items-center gap-3"><span className="text-2xl">{section.icon}</span><div><p className="dawaa-title">{section.label}</p><p className="dawaa-caption text-xs">{section.description}</p></div></div>
                <div className="flex items-center gap-3">{isDone && <ScoreBadge score={section.rating} />}{isOpen ? <ChevronUp className="h-4 w-4 text-[var(--dawaa-theme-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--dawaa-theme-muted)]" />}</div>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t border-[var(--dawaa-theme-divider)] p-5">
                  <div><p className="dawaa-body mb-2 text-sm font-bold">التقييم *</p><StarRating value={section.rating} onChange={(v) => updateSection(section.key, 'rating', v)} /></div>
                  <label className="dawaa-body block text-sm font-bold">الملاحظات والتفاصيل<textarea value={section.notes} onChange={(e) => updateSection(section.key, 'notes', e.target.value)} placeholder="أضف ملاحظاتك عن هذا القسم..." rows={3} className="dawaa-textarea mt-1 resize-none" /></label>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="dawaa-card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="dawaa-title flex items-center gap-2"><User className="h-4 w-4 text-[var(--dawaa-theme-primary)]" /> تقييم الموظفين الموجودين</h2><button type="button" onClick={addStaffEval} className="dawaa-button dawaa-button--secondary text-sm"><Plus className="h-4 w-4" /> إضافة موظف</button></div>
        {form.staff_evals.length === 0 && <div className="dawaa-empty-state p-5 text-sm">يتم تحميل موظفي الشيفت تلقائيًا من جدول الشيفتات حسب الفرع واليوم. يمكن إضافة موظف يدويًا عند الحاجة.</div>}
        {form.staff_evals.map((ev) => (
          <article key={ev.id} className="dawaa-card dawaa-card--soft space-y-3 p-4">
            <div className="grid gap-3 lg:grid-cols-6">
              <input value={ev.name} onChange={(e) => updateStaffEval(ev.id, 'name', e.target.value)} placeholder="اسم الموظف" className="dawaa-input font-bold lg:col-span-2" />
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-bold dawaa-body"><Users className="ml-1 inline h-3 w-3 text-[var(--dawaa-theme-primary)]" />{ev.role || 'دور غير محدد'}<br /><span className="dawaa-caption">{ev.shift_start || '-'} → {ev.shift_end || '-'}</span></div>
              <select value={ev.rating} onChange={(e) => updateStaffEval(ev.id, 'rating', e.target.value)} className="dawaa-select font-bold">{(['ممتاز', 'جيد', 'مقبول', 'ضعيف'] as const).map((r) => <option key={r}>{r}</option>)}</select>
              <select value={ev.action_type || 'none'} onChange={(e) => updateStaffEval(ev.id, 'action_type', e.target.value)} className="dawaa-select font-bold"><option value="none">بدون إجراء</option><option value="notice">لفت نظر</option><option value="deduction">خصم نقاط</option><option value="reward">مكافأة نقاط</option></select>
              <button onClick={() => removeStaffEval(ev.id)} className="dawaa-button dawaa-badge--danger text-sm"><Trash2 className="h-4 w-4" /> حذف</button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px]">
              <textarea value={ev.note} onChange={(e) => updateStaffEval(ev.id, 'note', e.target.value)} placeholder="ملاحظة عن هذا الموظف أو سبب الإجراء" rows={2} className="dawaa-textarea resize-none" />
              <label className="dawaa-caption text-xs font-bold">نقاط<input type="number" value={ev.points_delta || 0} onChange={(e) => updateStaffEval(ev.id, 'points_delta', Number(e.target.value))} className="dawaa-input mt-1" /></label>
              <label className="dawaa-caption text-xs font-bold">قيمة مالية<input type="number" value={ev.money_amount || 0} onChange={(e) => updateStaffEval(ev.id, 'money_amount', Number(e.target.value))} className="dawaa-input mt-1" /></label>
            </div>
            {Number(ev.points_delta || 0) !== 0 && <div className="dawaa-alert dawaa-alert--info px-3 py-2 text-xs font-bold"><Wallet className="h-4 w-4" /> سيتم تسجيل أثر نقاط مرتبط بتقرير المرور عند الحفظ.</div>}
          </article>
        ))}
      </section>

      <section className="dawaa-card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="dawaa-title flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[var(--dawaa-status-warning-text)]" /> قرارات وإجراءات مطلوبة</h2><button type="button" onClick={addAction} className="dawaa-button dawaa-button--secondary text-sm"><Plus className="h-4 w-4" /> إضافة إجراء</button></div>
        {form.action_items.length === 0 && <div className="dawaa-empty-state p-5 text-sm">لا توجد إجراءات مضافة — اضغط "إضافة إجراء"</div>}
        {form.action_items.map((action) => (
          <article key={action.id} className="dawaa-card dawaa-card--soft space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3"><input value={action.text} onChange={(e) => updateAction(action.id, 'text', e.target.value)} placeholder="الإجراء المطلوب" className="dawaa-input font-bold sm:col-span-2" /><select value={action.priority} onChange={(e) => updateAction(action.id, 'priority', e.target.value)} className="dawaa-select font-bold">{(['عاجل', 'عادي', 'منخفض'] as const).map((p) => <option key={p}>{p}</option>)}</select></div>
            <div className="flex gap-3"><input value={action.assigned_to} onChange={(e) => updateAction(action.id, 'assigned_to', e.target.value)} placeholder="مسؤول التنفيذ (اختياري)" className="dawaa-input flex-1" /><button onClick={() => removeAction(action.id)} className="dawaa-button dawaa-badge--danger px-3"><Trash2 className="h-4 w-4" /></button></div>
          </article>
        ))}
      </section>

      <section className="dawaa-card space-y-4 p-5">
        <h2 className="dawaa-title flex items-center gap-2"><ClipboardList className="h-4 w-4 text-[var(--dawaa-theme-primary)]" /> ملاحظات عامة وموعد المرور القادم</h2>
        <textarea value={form.overall_notes} onChange={(e) => setForm((prev) => ({ ...prev, overall_notes: e.target.value }))} placeholder="ملاحظاتك الإجمالية عن الفرع وتوصياتك للإدارة..." rows={4} className="dawaa-textarea resize-none" />
        <label className="dawaa-body flex flex-wrap items-center gap-3 text-sm font-bold">موعد المرور القادم:<input type="date" value={form.next_visit_date} onChange={(e) => setForm((prev) => ({ ...prev, next_visit_date: e.target.value }))} className="dawaa-input max-w-xs font-bold" /></label>
      </section>

      {overallScore > 0 && (
        <section className="dawaa-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="dawaa-caption text-sm">التقييم الإجمالي للمرور</p><p className="dawaa-title mt-1 text-3xl">{overallScore.toFixed(2)} <span className="dawaa-caption text-base">/ 5.0</span></p></div>
            <div className="text-left"><p className="dawaa-caption mb-1 text-sm">الأقسام المقيّمة</p><p className="dawaa-title text-xl">{completedSections}/{form.sections.length}</p></div>
          </div>
        </section>
      )}

      {showHistory && (
        <section className="dawaa-card space-y-4 p-5">
          <h2 className="dawaa-title flex items-center gap-2"><Eye className="h-4 w-4 text-[var(--dawaa-theme-primary)]" /> سجل المرورات السابقة — {form.branch}</h2>
          {loadingHistory && <div className="dawaa-caption flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</div>}
          {!loadingHistory && pastInspections.length === 0 && <div className="dawaa-empty-state p-6 text-sm">لا توجد مرورات سابقة مسجلة لهذا الفرع</div>}
          {pastInspections.map((p) => {
            const expanded = expandedHistoryId === p.id;
            const historySections = p.sections.filter((s) => s.rating > 0 || s.notes);
            return (
              <article key={p.id} className="dawaa-card dawaa-card--soft p-4">
                <button type="button" onClick={() => setExpandedHistoryId(expanded ? null : p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-right">
                  <div className="flex items-center gap-2"><span className="dawaa-title">{p.date}</span>{p.time && <span className="dawaa-caption text-xs">{p.time}</span>}<span className="dawaa-caption text-xs">بواسطة {p.inspector_name}</span></div>
                  <div className="flex items-center gap-2"><ScoreBadge score={p.overall_score} />{expanded ? <ChevronUp className="h-4 w-4 text-[var(--dawaa-theme-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--dawaa-theme-muted)]" />}</div>
                </button>
                {p.overall_notes && <p className="dawaa-body mt-2 text-sm">{p.overall_notes}</p>}
                {expanded && (
                  <div className="mt-4 space-y-4 border-t border-[var(--dawaa-theme-divider)] pt-4">
                    {historySections.length > 0 && <div className="space-y-2"><p className="dawaa-caption text-xs font-black">تفاصيل الأقسام</p>{historySections.map((s) => <div key={s.key} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3"><div className="flex items-center justify-between gap-2"><span className="dawaa-title text-sm">{s.icon} {s.label}</span>{s.rating > 0 && <ScoreBadge score={s.rating} />}</div>{s.notes && <p className="dawaa-caption mt-1.5 text-xs">{s.notes}</p>}</div>)}</div>}
                    {p.staff_evals.length > 0 && <div className="space-y-2"><p className="dawaa-caption text-xs font-black">تقييم الموظفين وقت المرور</p>{p.staff_evals.map((ev) => <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs"><span className="dawaa-title text-xs">{ev.name} {ev.role ? `· ${ev.role}` : ''}</span><span className="dawaa-caption">{ev.rating}{ev.note ? ` — ${ev.note}` : ''}</span></div>)}</div>}
                    {p.action_items.length > 0 && <div className="space-y-2"><p className="dawaa-caption text-xs font-black">المهام المطلوبة من هذا المرور</p>{p.action_items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs"><span className="dawaa-body">{item.text}</span><span className="dawaa-caption">{item.priority}{item.assigned_to ? ` · ${item.assigned_to}` : ''}</span></div>)}</div>}
                    {p.next_visit_date && <p className="dawaa-caption text-xs">موعد المرور القادم: <span className="dawaa-title text-xs">{p.next_visit_date}</span></p>}
                    {!historySections.length && !p.staff_evals.length && !p.action_items.length && <p className="dawaa-caption text-xs italic">مفيش تفاصيل إضافية مسجلة لهذا المرور غير الملاحظة العامة.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="sticky bottom-4 flex justify-center">
        <button onClick={() => void handleSave()} disabled={saveDisabled} className={`dawaa-button px-8 py-3.5 text-base shadow-xl ${saved ? 'dawaa-badge--success' : 'dawaa-button--primary'}`}>
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : saved ? <CheckCircle2 className="h-5 w-5" /> : <Save className="h-5 w-5" />}
          {saved ? 'تم حفظ التقرير بنجاح ✅' : saving ? 'جارٍ الحفظ...' : `حفظ تقرير المرور (${completedSections}/${form.sections.length} أقسام)`}
        </button>
      </div>
    </div>
  );
}
