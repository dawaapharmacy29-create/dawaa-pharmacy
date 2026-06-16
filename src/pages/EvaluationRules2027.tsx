import { useMemo, useState } from "react";
import { Plus, RefreshCw, ShieldCheck, Trash2, Search, Filter } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseQuery, supabaseDelete, supabaseInsert } from "@/hooks/useSupabaseQuery";
import { ALL_INCENTIVE_RULES } from "@/lib/performance/ruleDefinitions";
import { formatRuleImpact } from "@/lib/ruleDisplay";

const categories = ["الالتزام والانضباط", "التعامل مع العميل", "تصنيف العميل والفاتورة", "جودة البيع وصرف الدواء", "الواتساب والمحادثات", "الرواكد", "أصناف اللستة", "المخزون والجرد والنواقص", "الدليفري والتوصيل", "التعاون مع الفريق", "استخدام التطبيق والتسجيل", "الحافز الربع سنوي"];
const roles = ["الكل", "صيدلاني", "توصيل", "خدمة عملاء", "مدير فرع"];

export default function EvaluationRules2027() {
  const { data: dbRules, refetch } = useSupabaseQuery<Record<string, unknown>>({ table: "evaluation_rules", limit: 500, orderBy: { column: "created_at", ascending: false }, realtimeEnabled: true });
  const [form, setForm] = useState({ title: "", type: "penalty", category: "خدمة العملاء", role: "الكل", points: "10", repeatable: true, requires_approval: true });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("الكل");
  const [filterCategory, setFilterCategory] = useState("الكل");
  const rules = useMemo(() => {
    const fromDb = dbRules.map((r) => ({
      id: String(r.id || ""),
      title: String(r.title || r.name || ""),
      type: String(r.type || "penalty"),
      category: String(r.category || "عام"),
      role: String(r.role || r.target_role || "الكل"),
      points: Number(r.points || r.base_points || 0),
      money: Number(r.money || r.money_delta || 0),
      impact_type: String(r.impact_type || "monthly_points_deduction"),
      repeatable: Boolean(r.repeatable ?? r.is_repeatable ?? true),
      requires_approval: Boolean(r.requires_approval ?? true),
      active: r.active !== false,
      source: "db",
    })).filter((r) => r.title);
    const fallback = ALL_INCENTIVE_RULES.map((r, idx) => ({
      id: `default-${idx}`,
      title: r.title_ar,
      type: r.impact_type.includes("reward") ? "reward" : r.impact_type.includes("deduction") ? "penalty" : "warning",
      category: r.category,
      role: r.role_scope === "all" ? "الكل" : r.role_scope,
      points: Math.abs(Number(r.points_delta || 0)),
      money: Math.abs(Number(r.money_delta || 0)),
      repeatable: r.repeat_policy === "linear_multiplier",
      requires_approval: r.approval_required,
      active: r.active,
      source: "default",
      impact_type: r.impact_type,
    }));
    // عرض قواعد Supabase إن وُجدت؛ وإلا المصدر الموحّد 2027 (نفس صفحة النقاط)
    return fromDb.length ? fromDb : fallback;
  }, [dbRules]);

  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      const matchesSearch = search === "" || rule.title.toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === "الكل" || 
        (filterType === "خصم شهري" && rule.impact_type === "monthly_points_deduction") ||
        (filterType === "مكافأة شهرية" && rule.impact_type === "monthly_exceptional_reward") ||
        (filterType === "خصم ربع سنوي" && rule.impact_type === "quarterly_money_deduction") ||
        (filterType === "مكافأة ربع سنوية" && rule.impact_type === "quarterly_money_reward") ||
        (filterType === "تحذير فقط" && rule.impact_type === "warning_only");
      const matchesCategory = filterCategory === "الكل" || rule.category === filterCategory;
      return matchesSearch && matchesType && matchesCategory;
    });
  }, [rules, search, filterType, filterCategory]);

  const grouped = useMemo(() => {
    return filteredRules.reduce((acc: Record<string, typeof filteredRules>, rule) => {
      const key = rule.category || "عام";
      acc[key] = acc[key] || [];
      acc[key].push(rule);
      return acc;
    }, {});
  }, [filteredRules]);

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
          <h1 className="page-title">نظام إدارة الأداء والحوافز التشغيلية</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            الحافز الشهري للدكاترة (500 نقطة = 1500 ج) · الحافز الربع سنوي (2000 ج) · لائحة التشغيل والسلوك المهني داخل الصيدلية.
          </p>
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

      {/* Search and Filters */}
      <div className="stat-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              placeholder="بحث في القواعد..." 
              className="input-dark pr-10" 
            />
          </div>
          <select 
            value={filterType} 
            onChange={(e) => setFilterType(e.target.value)} 
            className="input-dark md:w-48"
          >
            <option value="الكل">كل الأنواع</option>
            <option value="خصم شهري">خصم شهري</option>
            <option value="مكافأة شهرية">مكافأة شهرية</option>
            <option value="خصم ربع سنوي">خصم ربع سنوي</option>
            <option value="مكافأة ربع سنوية">مكافأة ربع سنوية</option>
            <option value="تحذير فقط">تحذير فقط</option>
          </select>
          <select 
            value={filterCategory} 
            onChange={(e) => setFilterCategory(e.target.value)} 
            className="input-dark md:w-48"
          >
            <option value="الكل">كل الفئات</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(grouped as Record<string, typeof rules>).map(([category, items]) => (
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
                        <span className={rule.type === "reward" ? "badge-success" : rule.type === "warning" ? "badge-info" : "badge-danger"}>{rule.type === "reward" ? "مكافأة" : rule.type === "warning" ? "تنبيه" : "خصم"}</span>
                        <span className="badge-purple">
                          {formatRuleImpact({
                            impact_type: rule.impact_type,
                            points_delta: rule.type === "reward" ? Number(rule.points || 0) : -Math.abs(Number(rule.points || 0)),
                            money_delta: Number(rule.money || 0),
                          })}
                        </span>
                        <span className="badge-info">{rule.role}</span>
                        {rule.repeatable && Number(rule.points || 0) > 0 && <span className="badge-warning">يتضاعف: {Number(rule.points || 0)} ثم {Number(rule.points || 0) * 2} ثم {Number(rule.points || 0) * 3}</span>}
                        {rule.repeatable && Number(rule.points || 0) === 0 && <span className="badge-warning">بدون مضاعفة نقاط</span>}
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

      {/* Explanation Blocks */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 p-5 text-sm leading-7 text-teal-100">
          <ShieldCheck className="mb-2 h-6 w-6 text-teal-300" />
          <h3 className="font-bold text-teal-200 mb-2">الحافز الشهري</h3>
          <p>كل دكتور يبدأ الدورة بـ 500 نقطة = 1500 جنيه. الخصومات تقلل النقاط. المكافآت الاستثنائية الشهرية تعوض النقاط فقط. الحافز الشهري لا يتجاوز 1500 جنيه.</p>
        </div>
        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-5 text-sm leading-7 text-purple-100">
          <ShieldCheck className="mb-2 h-6 w-6 text-purple-300" />
          <h3 className="font-bold text-purple-200 mb-2">الحافز الربع سنوي</h3>
          <p>حافز مستقل بقيمة أساس 2000 جنيه كل 3 شهور. مكافآت الرواكد واللستة المالية تضاف هنا ولا تضاف لنقاط الشهر.</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm leading-7 text-amber-100">
          <ShieldCheck className="mb-2 h-6 w-6 text-amber-300" />
          <h3 className="font-bold text-amber-200 mb-2">التكرار</h3>
          <p>تكرار نفس الخطأ داخل نفس الدورة يضاعف الخصم: مرة أولى، ثانية ×2، ثالثة ×3، رابعة ×4 ومراجعة مدير.</p>
        </div>
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-5 text-sm leading-7 text-sky-100">
          <ShieldCheck className="mb-2 h-6 w-6 text-sky-300" />
          <h3 className="font-bold text-sky-200 mb-2">الأذونات</h3>
          <p>أول 3 أذونات معتمدة في الدورة بدون خصم. بعد ذلك يتم الخصم حسب العدد.</p>
        </div>
      </div>
    </div>
  );
}
