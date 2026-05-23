import { useMemo, useState } from "react";
import { Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseQuery, supabaseDelete, supabaseInsert } from "@/hooks/useSupabaseQuery";
import { defaultEvaluationRules2027, repeatPenaltyPoints } from "@/lib/dawaa2027";

const categories = ["خدمة العملاء", "التشغيل", "المبيعات", "المخزون", "أدوية اللستة", "الدليفري", "السلامة الدوائية", "التطوير"];
const roles = ["الكل", "صيدلاني", "توصيل", "خدمة عملاء", "مدير فرع"];

export default function EvaluationRules2027() {
  const { data: dbRules, refetch } = useSupabaseQuery<Record<string, unknown>>({ table: "evaluation_rules", limit: 500, orderBy: { column: "created_at", ascending: false }, realtimeEnabled: true });
  const [form, setForm] = useState({ title: "", type: "penalty", category: "خدمة العملاء", role: "الكل", points: "10", repeatable: true, requires_approval: true });
  const rules = useMemo(() => {
    const fromDb = dbRules.map((r) => ({
      id: String(r.id || ""),
      title: String(r.title || r.name || ""),
      type: String(r.type || "penalty"),
      category: String(r.category || "عام"),
      role: String(r.role || r.target_role || "الكل"),
      points: Number(r.points || r.base_points || 0),
      repeatable: Boolean(r.repeatable ?? r.is_repeatable ?? true),
      requires_approval: Boolean(r.requires_approval ?? true),
      active: r.active !== false,
      source: "db",
    })).filter((r) => r.title);
    const fallback = defaultEvaluationRules2027.map((r, idx) => ({ ...r, id: `default-${idx}`, role: "الكل", requires_approval: true, active: true, source: "default" }));
    return fromDb.length ? fromDb : fallback;
  }, [dbRules]);

  const grouped = useMemo(() => {
    return rules.reduce((acc: Record<string, typeof rules>, rule) => {
      const key = rule.category || "عام";
      acc[key] = acc[key] || [];
      acc[key].push(rule);
      return acc;
    }, {});
  }, [rules]);

  const addRule = async () => {
    if (!form.title.trim()) return toast.error("اكتب اسم البند أولًا");
    const { error } = await supabaseInsert("evaluation_rules", {
      title: form.title.trim(),
      type: form.type,
      category: form.category,
      target_role: form.role,
      points: Number(form.points || 0),
      base_points: Number(form.points || 0),
      repeatable: form.repeatable,
      requires_approval: form.requires_approval,
      active: true,
      severity: form.type === "reward" ? "positive" : Number(form.points) >= 80 ? "critical" : Number(form.points) >= 40 ? "high" : "medium",
    } as Record<string, unknown>);
    if (error) return toast.error(error);
    toast.success("تمت إضافة بند التقييم");
    setForm((f) => ({ ...f, title: "" }));
    refetch();
  };

  const removeRule = async (id: string) => {
    if (id.startsWith("default-")) return toast.info("هذا بند افتراضي. أضف نسخة معدلة من الأعلى أو شغّل SQL 2027 لإدارته من Supabase.");
    const { error } = await supabaseDelete("evaluation_rules", id);
    if (error) return toast.error(error);
    toast.success("تم حذف البند");
    refetch();
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="page-title">قواعد التقييم والحوافز 2027</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">صفحة مرنة لتطويع أي فكرة جديدة داخل السيستم: خصومات، مكافآت استثنائية، تكرار الأخطاء، اعتماد المدير، والدور المستهدف.</p>
        </div>
        <button onClick={refetch} className="btn-secondary inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" /> تحديث</button>
      </div>

      <div className="stat-card">
        <h2 className="section-title mb-4">إضافة بند جديد</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input className="input-dark xl:col-span-2" placeholder="اسم البند مثل: عدم متابعة عميل VIP" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input-dark" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="penalty">خصم</option><option value="reward">مكافأة استثنائية</option>
          </select>
          <select className="input-dark" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="input-dark" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
          <input className="input-dark" type="number" placeholder="النقاط" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.repeatable} onChange={(e) => setForm({ ...form, repeatable: e.target.checked })} /> يتضاعف عند التكرار داخل الدورة</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.requires_approval} onChange={(e) => setForm({ ...form, requires_approval: e.target.checked })} /> يحتاج اعتماد مدير</label>
          <button onClick={addRule} className="btn-primary mr-auto inline-flex items-center gap-2"><Plus className="h-4 w-4" /> إضافة البند</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="stat-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title">{category}</h2>
              <span className="badge-info">{items.length} بند</span>
            </div>
            <div className="space-y-3">
              {items.map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-white">{rule.title}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className={rule.type === "reward" ? "badge-success" : "badge-danger"}>{rule.type === "reward" ? "مكافأة" : "خصم"}</span>
                        <span className="badge-purple">{rule.points} نقطة</span>
                        <span className="badge-info">{rule.role}</span>
                        {rule.repeatable && <span className="badge-warning">يتضاعف: {rule.points} ثم {repeatPenaltyPoints(rule.points, 1)} ثم {repeatPenaltyPoints(rule.points, 2)}</span>}
                      </div>
                    </div>
                    <button onClick={() => removeRule(rule.id)} className="rounded-xl p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-teal-500/20 bg-teal-500/10 p-5 text-sm leading-7 text-teal-100">
        <ShieldCheck className="mb-2 h-6 w-6 text-teal-300" />
        قاعدة التطبيق: كل موظف يبدأ كل دورة شهرية بـ 500 نقطة. الخصومات تخصم من الرصيد، والمكافآت الشهرية استثنائية ومعتمدة. الحافز الربع سنوي مستقل بقيمة 2000 جنيه ويركز على المبيعات، متوسط الفاتورة، العملاء، اللستة، والرواكد.
      </div>
    </div>
  );
}
