import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ImagePlus, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import ImageUploadBox from "@/components/ImageUploadBox";
import { supabase } from "@/lib/supabase";
import { BRANCHES } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { formatCurrency } from "@/lib/utils";

type Row = Record<string, unknown>;
type StaffOption = { id?: string; name?: string | null; role?: string | null; branch?: string | null };
const ALL = "الكل";

function text(row: Row, key: string, fallback = "") {
  return String(row[key] ?? fallback).trim();
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function safeUuid(value: unknown) {
  const textValue = String(value ?? "").trim();
  return isUuidLike(textValue) ? textValue : null;
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

async function insertResilient(table: string, payload: Record<string, unknown>) {
  let next = payload;
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(next).select("*").single();
    if (!error) return data as Row;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    next = { ...next };
    delete next[column];
  }
  throw new Error("تعذر الحفظ بسبب اختلاف أعمدة الجدول.");
}

export default function Stories() {
  const { user } = useAuth();
  const { data: staffRows } = useSupabaseQuery<StaffOption>({ table: "staff", realtimeEnabled: false });
  const [stories, setStories] = useState<Row[]>([]);
  const [reports, setReports] = useState<Row[]>([]);
  const [sales, setSales] = useState<Row[]>([]);
  const [offers, setOffers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [image, setImage] = useState({ publicUrl: "", path: "" });
  const [form, setForm] = useState({
    title: "",
    story_date: new Date().toISOString().slice(0, 10),
    story_time: new Date().toTimeString().slice(0, 5),
    story_order: 1,
    story_type: "offer",
    related_offer_id: "",
    related_item_name: "",
    related_item_code: "",
    planned_quantity: 0,
    uploaded_by_staff_id: "",
    uploaded_by_staff_name: user?.name || "",
    branch: "كل الفروع",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [storyResult, reportResult, salesResult, offerResult] = await Promise.all([
      supabase.from("whatsapp_stories").select("*").order("story_date", { ascending: false }).limit(500),
      supabase.from("story_performance_reports").select("*").order("report_date", { ascending: false }).limit(500),
      supabase.from("story_sales").select("*").order("sold_at", { ascending: false }).limit(500),
      supabase.from("offers").select("id,title,item_name").order("created_at", { ascending: false }).limit(200),
    ]);
    if (storyResult.error) toast.error(`تعذر تحميل الاستوريز: ${storyResult.error.message}`);
    setStories((storyResult.data || []) as Row[]);
    setReports(reportResult.error ? [] : ((reportResult.data || []) as Row[]));
    setSales(salesResult.error ? [] : ((salesResult.data || []) as Row[]));
    setOffers(offerResult.error ? [] : ((offerResult.data || []) as Row[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reportByStory = useMemo(() => {
    const map = new Map<string, Row>();
    for (const report of reports) {
      const storyId = text(report, "story_id");
      if (storyId && !map.has(storyId)) map.set(storyId, report);
    }
    return map;
  }, [reports]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stories.filter((story) => {
      if (branchFilter !== ALL && text(story, "branch") !== branchFilter) return false;
      if (typeFilter !== ALL && text(story, "story_type") !== typeFilter) return false;
      if (!needle) return true;
      return ["title", "related_item_name", "uploaded_by_staff_name", "branch"].some((key) => text(story, key).toLowerCase().includes(needle));
    });
  }, [branchFilter, query, stories, typeFilter]);

  const stats = useMemo(() => {
    const views = reports.reduce((sum, row) => sum + num(row.views_count), 0);
    const inquiries = reports.reduce((sum, row) => sum + num(row.inquiries_count), 0);
    const salesValue = reports.reduce((sum, row) => sum + num(row.sales_value), 0);
    const missing = stories.filter((story) => !reportByStory.has(String(story.id))).length;
    return { views, inquiries, salesValue, missing };
  }, [reportByStory, reports, stories]);

  const doctors = useMemo(
    () =>
      (staffRows || []).filter((item) =>
        [item.name, item.role].filter(Boolean).some((value) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist/i.test(String(value))),
      ),
    [staffRows],
  );

  const updateField = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return toast.error("اكتب عنوان الاستوري.");
    setSaving(true);
    try {
      const created = await insertResilient("whatsapp_stories", {
        ...form,
        related_offer_id: form.related_offer_id || null,
        image_url: image.publicUrl || null,
        image_path: image.path || null,
        uploaded_by_staff_id: safeUuid(form.uploaded_by_staff_id) || safeUuid(user?.staffId) || safeUuid(user?.id),
        uploaded_by_staff_name: form.uploaded_by_staff_name || user?.name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setStories((rows) => [created, ...rows]);
      setImage({ publicUrl: "", path: "" });
      toast.success("تم حفظ الاستوري بنجاح.");
    } catch (error) {
      toast.error(`تعذر حفظ الاستوري: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveReport = async (story: Row, report: { views: number; inquiries: number; salesCount: number; salesValue: number; notes: string }) => {
    try {
      await insertResilient("story_performance_reports", {
        story_id: story.id,
        report_date: new Date().toISOString().slice(0, 10),
        views_count: report.views,
        inquiries_count: report.inquiries,
        sales_count: report.salesCount,
        sales_value: report.salesValue,
        report_notes: report.notes,
        report_by_staff_id: safeUuid(user?.staffId) || safeUuid(user?.id),
        report_by_staff_name: user?.name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      toast.success("تم حفظ تقرير الاستوري.");
      await load();
    } catch (error) {
      toast.error(`تعذر حفظ التقرير: ${(error as Error).message}`);
    }
  };

  if (loading) return <div className="stat-card py-16 text-center text-slate-300"><Loader2 className="mx-auto mb-3 animate-spin text-teal-300" /> جاري تحميل الاستوريز...</div>;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-teal-500/15 p-3 text-teal-300"><BarChart3 size={24} /></div>
          <div>
            <h1 className="text-2xl font-black text-white">الاستوريز وتحليلها</h1>
            <p className="mt-1 text-sm text-slate-400">إدارة ستوري واتساب وتحليل المشاهدات، الاستفسارات، المبيعات، والدكتور المرتبط.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="إجمالي المشاهدات" value={stats.views} />
        <Stat label="استفسارات" value={stats.inquiries} />
        <Stat label="مبيعات من الاستوري" value={Math.round(stats.salesValue)} />
        <Stat label="تحتاج تقرير" value={stats.missing} danger={stats.missing > 0} />
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-5">
        <div className="mb-4 text-lg font-black text-white">إضافة استوري جديد</div>
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ImageUploadBox bucket="story-assets" folder="stories" label="رفع صورة الاستوري" valueUrl={image.publicUrl} valuePath={image.path} onUploaded={setImage} disabled={saving} />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="عنوان الاستوري *" value={form.title} onChange={(v) => updateField("title", v)} />
            <Field label="التاريخ" type="date" value={form.story_date} onChange={(v) => updateField("story_date", v)} />
            <Field label="الساعة" type="time" value={form.story_time} onChange={(v) => updateField("story_time", v)} />
            <Field label="ترتيب الاستوري" type="number" value={form.story_order} onChange={(v) => updateField("story_order", Number(v))} />
            <Select label="النوع" value={form.story_type} options={["offer", "product", "reminder", "medical_info", "service", "video", "image"]} onChange={(v) => updateField("story_type", v)} />
            <Select label="العرض المرتبط" value={form.related_offer_id} options={["", ...offers.map((offer) => String(offer.id))]} labels={["بدون عرض", ...offers.map((offer) => text(offer, "title", text(offer, "item_name", "عرض")))]} onChange={(v) => updateField("related_offer_id", v)} />
            <Field label="الصنف المرتبط" value={form.related_item_name} onChange={(v) => updateField("related_item_name", v)} />
            <Field label="كود الصنف" value={form.related_item_code} onChange={(v) => updateField("related_item_code", v)} />
            <Field label="الكمية المخططة" type="number" value={form.planned_quantity} onChange={(v) => updateField("planned_quantity", Number(v))} />
            <Select label="الفرع" value={form.branch} options={["كل الفروع", ...BRANCHES]} onChange={(v) => updateField("branch", v)} />
            <Select
              label="تم الرفع بواسطة"
              value={form.uploaded_by_staff_id}
              options={["", ...doctors.map((doctor) => String(doctor.id || doctor.name || ""))]}
              labels={["اختر الدكتور", ...doctors.map((doctor) => `${doctor.name || "دكتور"}${doctor.branch ? ` - ${doctor.branch}` : ""}`)]}
              onChange={(v) => {
                const selected = doctors.find((doctor) => String(doctor.id || doctor.name || "") === v);
                setForm((current) => ({
                  ...current,
                  uploaded_by_staff_id: v,
                  uploaded_by_staff_name: selected?.name || "",
                  branch: selected?.branch || current.branch,
                }));
              }}
            />
            <Textarea label="ملاحظات" value={form.notes} onChange={(v) => updateField("notes", v)} />
          </div>
        </div>
        <button className="btn-primary mt-4 flex items-center gap-2 px-5 py-2" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          حفظ الاستوري
        </button>
      </form>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <label className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input className="input-dark pr-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بعنوان الاستوري أو الصنف..." />
          </label>
          <select className="input-dark" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option>{ALL}</option>
            {["offer", "product", "reminder", "medical_info", "service", "video", "image"].map((type) => <option key={type}>{type}</option>)}
          </select>
          <select className="input-dark" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option>{ALL}</option>
            {["كل الفروع", ...BRANCHES].map((branch) => <option key={branch}>{branch}</option>)}
          </select>
          <button type="button" onClick={load} className="btn-secondary flex items-center gap-2 px-4"><RefreshCw size={15} /> تحديث</button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((story) => (
          <StoryCard key={String(story.id)} story={story} report={reportByStory.get(String(story.id))} sales={sales.filter((sale) => String(sale.story_id) === String(story.id))} onSaveReport={saveReport} />
        ))}
        {filtered.length === 0 && <div className="stat-card py-12 text-center text-slate-400 xl:col-span-2">لا توجد استوريز مطابقة حاليًا.</div>}
      </div>
    </div>
  );
}

function StoryCard({ story, report, sales, onSaveReport }: { story: Row; report?: Row; sales: Row[]; onSaveReport: (story: Row, report: { views: number; inquiries: number; salesCount: number; salesValue: number; notes: string }) => void }) {
  const [views, setViews] = useState(num(report?.views_count));
  const [inquiries, setInquiries] = useState(num(report?.inquiries_count));
  const [salesCount, setSalesCount] = useState(num(report?.sales_count));
  const [salesValue, setSalesValue] = useState(num(report?.sales_value));
  const [notes, setNotes] = useState(text(report || {}, "report_notes"));

  return (
    <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
      <div className="flex gap-4">
        {story.image_url ? <img src={String(story.image_url)} alt="" className="h-28 w-28 rounded-xl object-cover" /> : <div className="h-28 w-28 rounded-xl bg-white/5" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-black text-white">#{text(story, "story_order", "-")} {text(story, "title", "استوري بدون عنوان")}</div>
            <span className="badge-info">{text(story, "story_type", "story")}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Mini label="التاريخ" value={`${text(story, "story_date", "-")} ${text(story, "story_time")}`} />
            <Mini label="الصنف" value={text(story, "related_item_name", "-")} />
            <Mini label="مشاهدات" value={num(report?.views_count).toLocaleString("ar-EG")} />
            <Mini label="مبيعات" value={formatCurrency(num(report?.sales_value))} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <Field label="مشاهدات" type="number" value={views} onChange={(v) => setViews(Number(v))} />
        <Field label="استفسارات" type="number" value={inquiries} onChange={(v) => setInquiries(Number(v))} />
        <Field label="عدد المبيعات" type="number" value={salesCount} onChange={(v) => setSalesCount(Number(v))} />
        <Field label="قيمة المبيعات" type="number" value={salesValue} onChange={(v) => setSalesValue(Number(v))} />
        <button type="button" onClick={() => onSaveReport(story, { views, inquiries, salesCount, salesValue, notes })} className="btn-primary mt-5">حفظ التقرير</button>
        <Textarea label="ملاحظات التقرير" value={notes} onChange={setNotes} />
      </div>
      {sales.length > 0 && <div className="mt-3 text-xs text-slate-400">تم تسجيل {sales.length.toLocaleString("ar-EG")} عملية بيع مرتبطة بهذه الاستوري.</div>}
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className="stat-card text-center"><div className={`num text-2xl font-black ${danger ? "text-red-300" : "text-teal-300"}`}>{value.toLocaleString("ar-EG")}</div><div className="mt-1 text-xs text-slate-400">{label}</div></div>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label className="space-y-1 text-xs text-slate-300"><span>{label}</span><input className="input-dark" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Select({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs text-slate-300"><span>{label}</span><select className="input-dark" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option, index) => <option key={option || "empty"} value={option}>{labels?.[index] || option}</option>)}</select></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs text-slate-300 md:col-span-5"><span>{label}</span><textarea className="input-dark min-h-20" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-xs text-slate-500">{label}</div><div className="truncate font-bold text-white">{value}</div></div>;
}
