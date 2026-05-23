import { useMemo, useState } from "react";
import { BellRing, CheckCircle2, Clock, Plus, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseQuery, supabaseInsert, supabaseUpdate } from "@/hooks/useSupabaseQuery";
import { currentCycleText, pickFirst } from "@/lib/dawaa2027";

const taskTypes = ["متابعة عميل", "رواكد", "أدوية اللستة", "اعتماد خصم", "مراجعة موظف", "طلب عميل", "تحسين بيانات"];
const priorities = ["عادي", "مهم", "خطر"];

export default function OperationsCenter2027() {
  const { data: tasks, refetch } = useSupabaseQuery<Record<string, unknown>>({ table: "tasks", limit: 500, orderBy: { column: "created_at", ascending: false }, realtimeEnabled: true });
  const { data: notifications } = useSupabaseQuery<Record<string, unknown>>({ table: "notifications", limit: 100, orderBy: { column: "created_at", ascending: false }, realtimeEnabled: true });
  const [form, setForm] = useState({ title: "", type: "متابعة عميل", priority: "مهم", due_date: new Date().toISOString().slice(0, 10), assigned_to_name: "" });

  const normalizedTasks = useMemo(() => tasks.map((t) => ({
    id: String(t.id || ""),
    title: String(t.title || t.task_title || t.description || "مهمة بدون عنوان"),
    type: String(t.type || t.category || "مهمة"),
    priority: String(t.priority || "عادي"),
    status: String(t.status || "open"),
    due_date: String(t.due_date || t.deadline || t.created_at || ""),
    assigned_to_name: String(t.assigned_to_name || t.staff_name || t.employee_name || t.assigned_to || "غير محدد"),
  })), [tasks]);

  const open = normalizedTasks.filter((t) => !["done", "completed", "مكتمل", "closed"].includes(t.status));
  const urgent = open.filter((t) => ["خطر", "high", "urgent"].includes(t.priority));
  const today = open.filter((t) => String(t.due_date).slice(0, 10) <= new Date().toISOString().slice(0, 10));
  const unread = notifications.filter((n) => !n.read).length;

  const addTask = async () => {
    if (!form.title.trim()) return toast.error("اكتب عنوان المهمة");
    const { error } = await supabaseInsert("tasks", {
      title: form.title.trim(),
      type: form.type,
      category: form.type,
      priority: form.priority,
      status: "open",
      due_date: form.due_date,
      assigned_to_name: form.assigned_to_name,
      month_cycle: currentCycleText(),
      description: `مهمة تم إنشاؤها من مركز التشغيل 2027 - ${currentCycleText()}`,
    } as Record<string, unknown>);
    if (error) return toast.error(error);
    toast.success("تم إنشاء المهمة");
    setForm((f) => ({ ...f, title: "" }));
    refetch();
  };

  const closeTask = async (id: string) => {
    const { error } = await supabaseUpdate("tasks", id, { status: "completed", completed_at: new Date().toISOString() } as Record<string, unknown>);
    if (error) return toast.error(error);
    toast.success("تم إغلاق المهمة");
    refetch();
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="page-title">مركز المهام والتنبيهات 2027</h1>
        <p className="mt-2 text-sm leading-7 text-slate-400">منع النسيان والتكاسل: كل متابعة، راكد، صنف لستة، خصم يحتاج اعتماد، أو عميل مهم يتحول لمهمة واضحة.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Clock} label="مهام مفتوحة" value={open.length} hint="تحتاج متابعة" />
        <Kpi icon={BellRing} label="إشعارات غير مقروءة" value={unread} hint="من السيستم" />
        <Kpi icon={Sparkles} label="مهام اليوم والمتأخرة" value={today.length} hint="أولوية تنفيذ" />
        <Kpi icon={Send} label="مهام خطر" value={urgent.length} hint="تدخل مدير" />
      </div>

      <div className="stat-card">
        <h2 className="section-title mb-4">إنشاء مهمة تشغيلية</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input className="input-dark xl:col-span-2" placeholder="عنوان المهمة" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input-dark" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{taskTypes.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="input-dark" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select>
          <input className="input-dark" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <input className="input-dark" placeholder="المسؤول" value={form.assigned_to_name} onChange={(e) => setForm({ ...form, assigned_to_name: e.target.value })} />
        </div>
        <button onClick={addTask} className="btn-primary mt-4 inline-flex items-center gap-2"><Plus className="h-4 w-4" /> إنشاء مهمة</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="stat-card">
          <h2 className="section-title mb-4">المهام المفتوحة</h2>
          <div className="space-y-3">
            {open.slice(0, 40).map((t) => <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3"><div><div className="font-bold text-white">{t.title}</div><div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="badge-info">{t.type}</span><span className={t.priority === "خطر" ? "badge-danger" : t.priority === "مهم" ? "badge-warning" : "badge-success"}>{t.priority}</span><span className="badge-purple">{t.assigned_to_name}</span><span className="badge-info">{String(t.due_date).slice(0, 10)}</span></div></div><button onClick={() => closeTask(t.id)} className="rounded-xl p-2 text-teal-300 hover:bg-teal-500/10"><CheckCircle2 className="h-5 w-5" /></button></div>
            </div>)}
            {!open.length && <Empty text="لا توجد مهام مفتوحة. ممتاز." />}
          </div>
        </div>
        <div className="stat-card">
          <h2 className="section-title mb-4">آخر الإشعارات</h2>
          <div className="space-y-3">
            {notifications.slice(0, 30).map((n) => <div key={String(n.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="font-bold text-white">{String(n.title || n.type || "إشعار")}</div><div className="mt-1 text-sm leading-6 text-slate-400">{String(pickFirst(n, ["body", "message", "description"], ""))}</div><div className="mt-2 text-xs text-slate-500">{String(n.created_at || "").slice(0, 16).replace("T", " ")}</div></div>)}
            {!notifications.length && <Empty text="لا توجد إشعارات بعد." />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: any) { return <div className="stat-card"><div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">{label}</div><div className="mt-2 text-3xl font-black text-white">{value}</div><div className="mt-1 text-xs text-slate-500">{hint}</div></div><div className="rounded-2xl bg-teal-500/15 p-3 text-teal-300"><Icon className="h-6 w-6" /></div></div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400">{text}</div>; }
