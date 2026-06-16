import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  rating: "ممتاز" | "جيد" | "مقبول" | "ضعيف";
  note: string;
  action_type?: "none" | "notice" | "deduction" | "reward";
  points_delta?: number;
  money_amount?: number;
}

interface ActionItem {
  id: string;
  text: string;
  priority: "عاجل" | "عادي" | "منخفض";
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
  inspector_name: string;
  overall_score: number;
  overall_notes: string;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BRANCHES = ["فرع شكري", "فرع الشامي", "الفرع الرئيسي"];

const DEFAULT_SECTIONS: RatingSection[] = [
  { key: "cleanliness", label: "النظافة والترتيب", description: "نظافة الأرضيات، الرفوف، المنضدة، الحمامات، مظهر الفرع العام", icon: "✨", rating: 0, notes: "" },
  { key: "attendance", label: "الحضور والالتزام", description: "الحضور في الوقت، الزي الرسمي، الانتباه، الانضباط العام", icon: "🕐", rating: 0, notes: "" },
  { key: "stock", label: "المخزون والتوفر", description: "توفر الأدوية الأساسية، ترتيب الرفوف، تاريخ الصلاحية، النواقص", icon: "📦", rating: 0, notes: "" },
  { key: "customer_service", label: "خدمة العملاء", description: "التعامل مع العملاء، سرعة الخدمة، حل المشكلات، الاحترافية", icon: "🤝", rating: 0, notes: "" },
  { key: "sales", label: "الأداء البيعي", description: "التوصية بالمنتجات، المبيعات، ربط العملاء بالكود، الكاش باك", icon: "📈", rating: 0, notes: "" },
  { key: "safety", label: "الأمان والسلامة", description: "حالة الصراف، الأمان العام، إجراءات الطوارئ، الكاميرات", icon: "🔒", rating: 0, notes: "" },
  { key: "followups", label: "المتابعات والمهام", description: "متابعة العملاء، تنفيذ المهام المطلوبة من المرور السابق", icon: "📋", rating: 0, notes: "" },
];

const now = () => {
  const d = new Date();
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  };
};

function newActionItem(): ActionItem {
  return { id: crypto.randomUUID(), text: "", priority: "عادي", assigned_to: "" };
}

function newStaffEval(): StaffEval {
  return { id: crypto.randomUUID(), name: "", rating: "جيد", note: "", action_type: "none", points_delta: 0, money_amount: 0 };
}

function arabicDayName(dateText: string) {
  const names = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return names[new Date().getDay()];
  return names[date.getDay()];
}

function actionImpact(action?: StaffEval["action_type"]) {
  if (action === "deduction") return { points: -10, money: 0, label: "خصم نقاط" };
  if (action === "reward") return { points: 10, money: 0, label: "مكافأة نقاط" };
  if (action === "notice") return { points: -3, money: 0, label: "لفت نظر" };
  return { points: 0, money: 0, label: "بدون إجراء" };
}

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const labels = ["", "ضعيف جداً", "ضعيف", "مقبول", "جيد", "ممتاز"];
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
        >
          <Star
            className={cn(
              "h-7 w-7 transition-colors",
              (hovered || value) >= star ? "fill-amber-400 text-amber-400" : "text-slate-600",
            )}
          />
        </button>
      ))}
      {(hovered || value) > 0 && (
        <span className="mr-2 text-sm font-bold text-amber-300">{labels[hovered || value]}</span>
      )}
    </div>
  );
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round((score / 5) * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  const bg = pct >= 80 ? "bg-emerald-400/15 border-emerald-400/30" : pct >= 60 ? "bg-amber-400/15 border-amber-400/30" : "bg-red-400/15 border-red-400/30";
  const label = pct >= 80 ? "ممتاز" : pct >= 60 ? "جيد" : pct >= 40 ? "مقبول" : "يحتاج تحسين";
  return (
    <span className={cn("rounded-xl border px-3 py-1 text-sm font-black", bg, color)}>
      {score.toFixed(1)}/5 — {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BranchInspection() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { date, time } = now();
  const [form, setForm] = useState<InspectionForm>({
    branch: user?.branch && user.branch !== "كل الفروع" ? user.branch : BRANCHES[0],
    date,
    time,
    inspector_name: user?.name || "",
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    staff_evals: [],
    action_items: [],
    overall_notes: "",
    next_visit_date: "",
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pastInspections, setPastInspections] = useState<PastInspection[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>("cleanliness");
  const [showHistory, setShowHistory] = useState(false);

  const overallScore = form.sections.filter((s) => s.rating > 0).length
    ? form.sections.filter((s) => s.rating > 0).reduce((sum, s) => sum + s.rating, 0) / form.sections.filter((s) => s.rating > 0).length
    : 0;

  const completedSections = form.sections.filter((s) => s.rating > 0).length;

  // Load past inspections
  useEffect(() => {
    if (!isSupabaseConfigured || !showHistory) return;
    setLoadingHistory(true);
    supabase
      .from("branch_inspections")
      .select("id, branch, date, inspector_name, overall_score, overall_notes, created_at")
      .eq("branch", form.branch)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setPastInspections((data || []) as PastInspection[]);
        setLoadingHistory(false);
      });
  }, [showHistory, form.branch]);

  // Load scheduled staff for selected branch/date from weekly shift_schedules
  useEffect(() => {
    if (!isSupabaseConfigured || !form.branch || !form.date) return;
    const dayName = arabicDayName(form.date);
    supabase
      .from("shift_schedules")
      .select("id,staff_id,staff_name,role,branch,day_name,shift_start,shift_end,start_time,end_time,is_off,status")
      .eq("branch", form.branch)
      .eq("day_name", dayName)
      .limit(120)
      .then(({ data }) => {
        const rows = (data || []) as Array<Record<string, any>>;
        const active = rows.filter((row) => !row.is_off && !String(row.status || "").includes("إجاز"));
        if (!active.length) return;
        setForm((prev) => {
          const typed = prev.staff_evals.filter((row) => row.name && !row.staff_id);
          const mapped = active.map((row) => {
            const existing = prev.staff_evals.find((x) => (x.staff_id && x.staff_id === row.staff_id) || (!x.staff_id && x.name === row.staff_name));
            return {
              id: existing?.id || String(row.id || crypto.randomUUID()),
              staff_id: row.staff_id || null,
              name: row.staff_name || row.name || "موظف غير محدد",
              role: row.role || null,
              branch: row.branch || form.branch,
              shift_start: row.shift_start || row.start_time || null,
              shift_end: row.shift_end || row.end_time || null,
              rating: existing?.rating || "جيد",
              note: existing?.note || "",
              action_type: existing?.action_type || "none",
              points_delta: existing?.points_delta ?? actionImpact(existing?.action_type || "none").points,
              money_amount: existing?.money_amount ?? 0,
            } as StaffEval;
          });
          return { ...prev, staff_evals: [...mapped, ...typed] };
        });
      });
  }, [form.branch, form.date]);

  // Section update helpers
  const updateSection = useCallback((key: string, field: keyof RatingSection, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => s.key === key ? { ...s, [field]: value } : s),
    }));
  }, []);

  const addStaffEval = () => setForm((prev) => ({ ...prev, staff_evals: [...prev.staff_evals, newStaffEval()] }));
  const removeStaffEval = (id: string) => setForm((prev) => ({ ...prev, staff_evals: prev.staff_evals.filter((e) => e.id !== id) }));
  const updateStaffEval = (id: string, field: keyof StaffEval, value: string | number) => {
    setForm((prev) => ({ ...prev, staff_evals: prev.staff_evals.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, [field]: value } as StaffEval;
      if (field === "action_type") {
        const impact = actionImpact(value as StaffEval["action_type"]);
        next.points_delta = impact.points;
        next.money_amount = impact.money;
      }
      return next;
    }) }));
  };

  const addAction = () => setForm((prev) => ({ ...prev, action_items: [...prev.action_items, newActionItem()] }));
  const removeAction = (id: string) => setForm((prev) => ({ ...prev, action_items: prev.action_items.filter((a) => a.id !== id) }));
  const updateAction = (id: string, field: keyof ActionItem, value: string) => {
    setForm((prev) => ({ ...prev, action_items: prev.action_items.map((a) => a.id === id ? { ...a, [field]: value } : a) }));
  };

  // Save inspection
  const handleSave = async () => {
    if (completedSections < 3) {
      toast.error("قيّم 3 أقسام على الأقل قبل الحفظ");
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
        const { data: reportRows, error } = await supabase.from("branch_inspections").insert(payload).select("id").limit(1);
        if (error) throw error;
        const reportId = (reportRows?.[0] as any)?.id || null;

        if (reportId && form.staff_evals.length) {
          await supabase.from("branch_visit_staff_reviews").insert(form.staff_evals.map((ev) => ({
            report_id: reportId,
            staff_id: ev.staff_id || null,
            staff_name: ev.name,
            role: ev.role || null,
            branch: ev.branch || form.branch,
            shift_start: ev.shift_start || null,
            shift_end: ev.shift_end || null,
            rating: ev.rating,
            note: ev.note || null,
            action_type: ev.action_type || "none",
            points_delta: ev.points_delta || 0,
            money_amount: ev.money_amount || 0,
            created_by_name: form.inspector_name || user?.name || null,
          }))).then(() => undefined);

          const pointRows = form.staff_evals
            .filter((ev) => ev.staff_id && Number(ev.points_delta || 0) !== 0)
            .map((ev) => ({
              staff_id: ev.staff_id,
              staff_name: ev.name,
              branch: ev.branch || form.branch,
              points_delta: ev.points_delta || 0,
              points: ev.points_delta || 0,
              type: Number(ev.points_delta || 0) > 0 ? "reward" : "deduction",
              reason: `مرور مدير الفروع - ${actionImpact(ev.action_type).label}`,
              description: ev.note || form.overall_notes || "تقييم مرور مدير الفروع",
              source: "branch_visit",
              source_id: reportId,
              status: "approved",
              created_by_name: form.inspector_name || user?.name || null,
            }));
          if (pointRows.length) {
            await supabase.from("points_transactions").insert(pointRows).then(() => undefined);
          }
        }
      }
      setSaved(true);
      toast.success("تم حفظ نموذج المرور بنجاح ✅");
      // Reset for next inspection
      setTimeout(() => {
        setSaved(false);
        setForm((prev) => ({
          ...prev,
          sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
          staff_evals: [],
          action_items: [],
          overall_notes: "",
          next_visit_date: "",
          time: new Date().toTimeString().slice(0, 5),
          date: new Date().toISOString().slice(0, 10),
        }));
        setExpandedSection("cleanliness");
      }, 2500);
    } catch (err) {
      toast.error(`فشل الحفظ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6 space-y-5" dir="rtl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 rounded-xl bg-slate-800/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            رجوع
          </button>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-cyan-400" />
              نموذج مرور وتقييم مدير الفروع
            </h1>
            <p className="text-xs text-slate-400">تقييم يومي شامل لأداء الفرع</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-700/60 transition-colors"
          >
            <Eye className="h-4 w-4" />
            {showHistory ? "إخفاء السجل" : "السجل السابق"}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || saved || completedSections < 3}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black transition-all",
              saved
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                : "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30 disabled:opacity-50",
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "تم الحفظ" : saving ? "جارٍ الحفظ..." : "حفظ التقرير"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <span className="text-sm font-bold text-slate-300">تقدم النموذج: {completedSections}/{form.sections.length} أقسام</span>
          {overallScore > 0 && <ScoreBadge score={overallScore} />}
        </div>
        <div className="h-2 rounded-full bg-slate-700/60">
          <div
            className="h-2 rounded-full bg-gradient-to-l from-cyan-400 to-teal-500 transition-all duration-500"
            style={{ width: `${(completedSections / form.sections.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Inspection Meta */}
      <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5">
        <h2 className="mb-4 font-black text-white flex items-center gap-2">
          <User className="h-4 w-4 text-cyan-400" />
          معلومات المرور
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">الفرع</label>
            <select
              value={form.branch}
              onChange={(e) => setForm((prev) => ({ ...prev, branch: e.target.value }))}
              className="w-full rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2.5 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
            >
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">التاريخ</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
              className="w-full rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2.5 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">وقت المرور</label>
            <div className="relative">
              <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))}
                className="w-full rounded-xl border border-slate-600 bg-slate-900/70 py-2.5 pr-9 pl-3 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">اسم المفتش / المدير</label>
            <input
              type="text"
              value={form.inspector_name}
              onChange={(e) => setForm((prev) => ({ ...prev, inspector_name: e.target.value }))}
              placeholder="اسم مدير الفروع"
              className="w-full rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2.5 text-sm font-bold text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Rating Sections */}
      <div className="space-y-3">
        <h2 className="font-black text-white flex items-center gap-2 px-1">
          <Star className="h-4 w-4 text-amber-400" />
          تقييم أقسام الفرع
        </h2>
        {form.sections.map((section) => {
          const isOpen = expandedSection === section.key;
          const isDone = section.rating > 0;
          return (
            <div
              key={section.key}
              className={cn(
                "rounded-3xl border transition-all",
                isDone ? "border-cyan-400/30 bg-cyan-500/5" : "border-slate-700/50 bg-slate-800/40",
              )}
            >
              {/* Section Header */}
              <button
                type="button"
                onClick={() => setExpandedSection(isOpen ? null : section.key)}
                className="flex w-full items-center justify-between p-5 text-right"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{section.icon}</span>
                  <div>
                    <p className="font-black text-white">{section.label}</p>
                    <p className="text-xs text-slate-400">{section.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isDone && <ScoreBadge score={section.rating} />}
                  {isOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>

              {/* Section Body */}
              {isOpen && (
                <div className="border-t border-slate-700/40 p-5 space-y-4">
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-300">التقييم *</p>
                    <StarRating value={section.rating} onChange={(v) => updateSection(section.key, "rating", v)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-300">الملاحظات والتفاصيل</label>
                    <textarea
                      value={section.notes}
                      onChange={(e) => updateSection(section.key, "notes", e.target.value)}
                      placeholder="أضف ملاحظاتك عن هذا القسم..."
                      rows={3}
                      className="w-full rounded-2xl border border-slate-600 bg-slate-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Staff Evaluations */}
      <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-white flex items-center gap-2">
            <User className="h-4 w-4 text-violet-400" />
            تقييم الموظفين الموجودين
          </h2>
          <button
            type="button"
            onClick={addStaffEval}
            className="flex items-center gap-1.5 rounded-xl bg-violet-500/20 px-3 py-2 text-sm font-bold text-violet-200 hover:bg-violet-500/30 transition-colors"
          >
            <Plus className="h-4 w-4" />
            إضافة موظف
          </button>
        </div>

        {form.staff_evals.length === 0 && (
          <p className="text-sm text-slate-500 italic text-center py-4">يتم تحميل موظفي الشيفت تلقائيًا من جدول الشيفتات حسب الفرع واليوم. يمكن إضافة موظف يدويًا عند الحاجة.</p>
        )}

        {form.staff_evals.map((ev) => (
          <div key={ev.id} className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4 space-y-3">
            <div className="grid gap-3 lg:grid-cols-6">
              <input
                value={ev.name}
                onChange={(e) => updateStaffEval(ev.id, "name", e.target.value)}
                placeholder="اسم الموظف"
                className="rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-bold text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none lg:col-span-2"
              />
              <div className="rounded-xl border border-slate-700 bg-slate-950/30 px-3 py-2 text-xs font-bold text-slate-300">
                <Users className="inline h-3 w-3 ml-1 text-cyan-300" />{ev.role || "دور غير محدد"}<br />
                <span className="text-slate-500">{ev.shift_start || "-"} → {ev.shift_end || "-"}</span>
              </div>
              <select
                value={ev.rating}
                onChange={(e) => updateStaffEval(ev.id, "rating", e.target.value)}
                className="rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
              >
                {(["ممتاز", "جيد", "مقبول", "ضعيف"] as const).map((r) => <option key={r}>{r}</option>)}
              </select>
              <select
                value={ev.action_type || "none"}
                onChange={(e) => updateStaffEval(ev.id, "action_type", e.target.value)}
                className="rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
              >
                <option value="none">بدون إجراء</option>
                <option value="notice">لفت نظر</option>
                <option value="deduction">خصم نقاط</option>
                <option value="reward">مكافأة نقاط</option>
              </select>
              <button onClick={() => removeStaffEval(ev.id)} className="flex items-center justify-center gap-1 rounded-xl border border-red-400/20 bg-red-500/10 py-2 text-sm text-red-300 hover:bg-red-500/20">
                <Trash2 className="h-4 w-4" />
                حذف
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px]">
              <textarea
                value={ev.note}
                onChange={(e) => updateStaffEval(ev.id, "note", e.target.value)}
                placeholder="ملاحظة عن هذا الموظف أو سبب الإجراء"
                rows={2}
                className="w-full rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none resize-none"
              />
              <label className="text-xs font-bold text-slate-400">نقاط
                <input type="number" value={ev.points_delta || 0} onChange={(e) => updateStaffEval(ev.id, "points_delta", Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-bold text-slate-400">قيمة مالية
                <input type="number" value={ev.money_amount || 0} onChange={(e) => updateStaffEval(ev.id, "money_amount", Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm text-white" />
              </label>
            </div>
            {Number(ev.points_delta || 0) !== 0 && <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100"><Wallet className="inline h-3 w-3 ml-1" />سيتم تسجيل أثر نقاط مرتبط بتقرير المرور عند الحفظ.</div>}
          </div>
        ))}
      </div>

      {/* Action Items */}
      <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-white flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            قرارات وإجراءات مطلوبة
          </h2>
          <button
            type="button"
            onClick={addAction}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500/20 px-3 py-2 text-sm font-bold text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            <Plus className="h-4 w-4" />
            إضافة إجراء
          </button>
        </div>

        {form.action_items.length === 0 && (
          <p className="text-sm text-slate-500 italic text-center py-4">لا توجد إجراءات مضافة — اضغط "إضافة إجراء"</p>
        )}

        {form.action_items.map((action) => (
          <div key={action.id} className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                value={action.text}
                onChange={(e) => updateAction(action.id, "text", e.target.value)}
                placeholder="الإجراء المطلوب"
                className="sm:col-span-2 rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-bold text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
              />
              <select
                value={action.priority}
                onChange={(e) => updateAction(action.id, "priority", e.target.value)}
                className={cn(
                  "rounded-xl border bg-slate-800/70 px-3 py-2 text-sm font-black focus:outline-none",
                  action.priority === "عاجل" ? "border-red-400/40 text-red-300" : action.priority === "عادي" ? "border-amber-400/40 text-amber-300" : "border-slate-600 text-slate-300",
                )}
              >
                {(["عاجل", "عادي", "منخفض"] as const).map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <input
                value={action.assigned_to}
                onChange={(e) => updateAction(action.id, "assigned_to", e.target.value)}
                placeholder="مسؤول التنفيذ (اختياري)"
                className="flex-1 rounded-xl border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
              />
              <button onClick={() => removeAction(action.id)} className="flex items-center gap-1 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/20">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Overall Notes + Next Visit */}
      <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-4">
        <h2 className="font-black text-white flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-cyan-400" />
          ملاحظات عامة وموعد المرور القادم
        </h2>
        <textarea
          value={form.overall_notes}
          onChange={(e) => setForm((prev) => ({ ...prev, overall_notes: e.target.value }))}
          placeholder="ملاحظاتك الإجمالية عن الفرع وتوصياتك للإدارة..."
          rows={4}
          className="w-full rounded-2xl border border-slate-600 bg-slate-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none resize-none"
        />
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-slate-300 whitespace-nowrap">موعد المرور القادم:</label>
          <input
            type="date"
            value={form.next_visit_date}
            onChange={(e) => setForm((prev) => ({ ...prev, next_visit_date: e.target.value }))}
            className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Final Score Summary */}
      {overallScore > 0 && (
        <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-amber-200/70">التقييم الإجمالي للمرور</p>
              <p className="text-3xl font-black text-amber-300">{overallScore.toFixed(2)} <span className="text-base text-amber-400/60">/ 5.0</span></p>
            </div>
            <div className="text-left">
              <p className="text-sm text-amber-200/70 mb-1">الأقسام المقيّمة</p>
              <p className="text-xl font-black text-amber-300">{completedSections}/{form.sections.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-4">
          <h2 className="font-black text-white flex items-center gap-2">
            <Eye className="h-4 w-4 text-cyan-400" />
            سجل المرورات السابقة — {form.branch}
          </h2>
          {loadingHistory && (
            <div className="flex items-center gap-2 text-slate-400 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحميل...
            </div>
          )}
          {!loadingHistory && pastInspections.length === 0 && (
            <p className="text-sm text-slate-500 italic text-center py-6">لا توجد مرورات سابقة مسجلة لهذا الفرع</p>
          )}
          {pastInspections.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-black text-white">{p.date}</span>
                  <span className="text-xs text-slate-400">بواسطة {p.inspector_name}</span>
                </div>
                <ScoreBadge score={p.overall_score} />
              </div>
              {p.overall_notes && <p className="text-sm text-slate-300">{p.overall_notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Bottom save button */}
      <div className="sticky bottom-4 flex justify-center">
        <button
          onClick={() => void handleSave()}
          disabled={saving || saved || completedSections < 3}
          className={cn(
            "flex items-center gap-2 rounded-2xl px-8 py-3.5 text-base font-black shadow-xl transition-all",
            saved
              ? "bg-emerald-500 text-white"
              : "bg-gradient-to-l from-cyan-500 to-teal-500 text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : saved ? <CheckCircle2 className="h-5 w-5" /> : <Save className="h-5 w-5" />}
          {saved ? "تم حفظ التقرير بنجاح ✅" : saving ? "جارٍ الحفظ..." : `حفظ تقرير المرور (${completedSections}/${form.sections.length} أقسام)`}
        </button>
      </div>
    </div>
  );
}
