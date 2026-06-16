import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, MessageSquare, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ALL_FILTER } from "@/lib/api/customers";
import { BRANCHES } from "@/lib/constants";
import { cleanEgyptianPhone, generateWhatsAppLink } from "@/lib/whatsapp";
import CustomerQuickDetailsModal from "@/components/customers/CustomerQuickDetailsModal";

type WelcomeRow = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  whatsapp_phone: string | null;
  branch: string | null;
  assigned_to_name: string | null;
  status: string | null;
  coding_status: string | null;
  welcome_message_status: string | null;
  customer_reply_status: string | null;
  coded_on_phone_at: string | null;
  welcome_message_sent_at: string | null;
  customer_replied_at: string | null;
  welcome_message_text: string | null;
  notes: string | null;
  created_at: string | null;
  task_date: string | null;
};

const RESPONSIBLES: Record<string, string> = {
  "فرع الشامي": "د ضحى",
  "الشامي": "د ضحى",
  "فرع شكري": "د دنيا",
  "شكري": "د دنيا",
};

function formatDate(value?: string | null) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("ar-EG");
}

function statusLabel(status?: string | null) {
  switch (String(status || "pending")) {
    case "completed": return "مكتملة";
    case "replied": return "رد العميل";
    case "message_sent": return "تم إرسال الترحيب";
    case "coded": return "تم التكويد";
    case "pending": return "لم تبدأ";
    default: return String(status || "لم تبدأ");
  }
}

function statusTone(status?: string | null) {
  switch (String(status || "pending")) {
    case "completed": return "border-sky-200 bg-sky-50";
    case "replied": return "border-emerald-200 bg-emerald-50";
    case "message_sent": return "border-violet-200 bg-violet-50";
    case "coded": return "border-amber-200 bg-amber-50";
    default: return "border-slate-200 bg-white";
  }
}

function summaryTone(key: string, active: boolean) {
  const base = active ? "ring-2 ring-offset-2 ring-teal-300" : "";
  if (key === "pending") return `border-amber-200 bg-amber-50 text-amber-900 ${base}`;
  if (key === "coded") return `border-amber-200 bg-orange-50 text-orange-900 ${base}`;
  if (key === "message_sent") return `border-violet-200 bg-violet-50 text-violet-900 ${base}`;
  if (key === "completed") return `border-sky-200 bg-sky-50 text-sky-900 ${base}`;
  return `border-teal-200 bg-teal-50 text-teal-900 ${base}`;
}

export default function CustomerWelcomeTasksPanel() {
  const [rows, setRows] = useState<WelcomeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<string>("all");
  const [selected, setSelected] = useState<WelcomeRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("customer_welcome_tasks")
        .select("id,customer_code,customer_name,customer_phone,whatsapp_phone,branch,assigned_to_name,status,coding_status,welcome_message_status,customer_reply_status,coded_on_phone_at,welcome_message_sent_at,customer_replied_at,welcome_message_text,notes,created_at,task_date")
        .order("created_at", { ascending: false })
        .limit(300);
      if (filter === "open") query = query.in("status", ["pending", "coded", "message_sent", "replied"]);
      if (filter === "pending") query = query.eq("status", "pending");
      if (filter === "done") query = query.eq("status", "completed");
      if (branchFilter !== ALL_FILTER) query = query.eq("branch", branchFilter);
      if (search.trim()) query = query.or(`customer_name.ilike.%${search.trim()}%,customer_code.ilike.%${search.trim()}%,customer_phone.ilike.%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as WelcomeRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحميل الرسائل الترحيبية");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, filter, search]);

  useEffect(() => { load(); }, [load]);

  const mark = async (row: WelcomeRow, action: "coded" | "sent" | "replied" | "done") => {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (action === "coded") { updates.coded_on_phone_at = now; updates.coding_status = "completed"; updates.status = "coded"; }
    if (action === "sent") { updates.welcome_message_sent_at = now; updates.welcome_message_status = "sent"; updates.status = "message_sent"; }
    if (action === "replied") { updates.customer_replied_at = now; updates.customer_reply_status = "replied"; updates.status = "replied"; }
    if (action === "done") { updates.status = "completed"; }
    const { error } = await supabase.from("customer_welcome_tasks").update(updates).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث مهمة الترحيب");
    load();
  };

  const copyMessage = async (message: string) => {
    await navigator.clipboard.writeText(message);
    toast.success("تم نسخ الرسالة");
  };

  const addNote = async (row: WelcomeRow) => {
    const note = window.prompt("أضف ملاحظة للمهمة", row.notes || "");
    if (note === null) return;
    const { error } = await supabase.from("customer_welcome_tasks").update({ notes: note, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ الملاحظة");
    load();
  };

  const summary = useMemo(() => {
    const counts = {
      all: rows.length,
      pending: 0,
      coded: 0,
      message_sent: 0,
      completed: 0,
    };
    rows.forEach((row) => {
      const key = String(row.status || "pending");
      if (key in counts) (counts as any)[key] += 1;
    });
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (quickFilter === "all") return rows;
    return rows.filter((row) => String(row.status || "pending") === quickFilter);
  }, [quickFilter, rows]);

  return (
    <section className="space-y-4" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">Welcome & Coding Workflow</span>
          <h1 className="mt-3 text-2xl font-black text-slate-950">الرسائل الترحيبية وتكويد العملاء الجدد</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">صفحة مستقلة وسريعة لمتابعة تكويد العملاء الجدد، إرسال الرسالة الترحيبية، ومتابعة الردود.</p>
        </div>
        <button className="dawaa-button-primary" onClick={load} disabled={loading}>
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} تحديث الصفحة
        </button>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          { key: "all", label: "كل المهام", value: summary.all },
          { key: "pending", label: "لم تبدأ", value: summary.pending },
          { key: "coded", label: "تم التكويد", value: summary.coded },
          { key: "message_sent", label: "تم إرسال الترحيب", value: summary.message_sent },
          { key: "completed", label: "مكتملة", value: summary.completed },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => setQuickFilter(item.key)} className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${summaryTone(item.key, quickFilter === item.key)}`}>
            <div className="text-xs font-bold">{item.label}</div>
            <div className="mt-2 text-2xl font-black">{item.value.toLocaleString("ar-EG")}</div>
            <div className="mt-1 text-xs font-bold opacity-80">اضغط لعرض هذا الملخص فقط</div>
          </button>
        ))}
      </section>

      <section className="dawaa-panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-slate-950">قائمة الترحيب</div>
            <div className="text-xs font-bold text-slate-500">عدد النتائج الحالية: {filteredRows.length.toLocaleString("ar-EG")}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="dawaa-input pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم / الكود / الهاتف" />
            </div>
            <select className="dawaa-input" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value={ALL_FILTER}>كل الفروع</option>
              {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
            <select className="dawaa-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="open">المفتوحة</option>
              <option value="pending">لم تبدأ</option>
              <option value="done">مكتملة</option>
              <option value="all">الكل</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="dawaa-panel flex items-center justify-center gap-2 p-8 text-sm font-black text-slate-500"><RefreshCw className="h-5 w-5 animate-spin text-teal-600" /> جاري تحميل المهام...</div>
        ) : filteredRows.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredRows.map((row) => {
              const phone = String(row.whatsapp_phone || row.customer_phone || "");
              const message = row.welcome_message_text || `أهلاً بحضرتك أ/ ${row.customer_name || "حضرتك"} 🌷\nصيدليات دواء ${row.branch ? `فرع ${row.branch}` : ""} بتتشرف بانضمام حضرتك لعملائنا.\nخدمة العملاء تحت أمر حضرتك في أي وقت.\nصيدليات دواء 🌿`;
              const wa = phone ? generateWhatsAppLink(cleanEgyptianPhone(phone), message) : "";
              const responsible = row.assigned_to_name || RESPONSIBLES[row.branch || ""] || "غير محدد";
              return (
                <div key={row.id} className={`rounded-2xl border p-4 shadow-sm ${statusTone(row.status)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{row.customer_name || "عميل بدون اسم"}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">كود {row.customer_code || "-"} · {row.branch || "-"} · المسؤول {responsible}</div>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-xs font-black text-slate-700">{statusLabel(row.status)}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl bg-white/80 p-2">الهاتف/واتساب: {phone || "بدون رقم"}</div>
                    <div className="rounded-xl bg-white/80 p-2">تكويد الهاتف: {row.coded_on_phone_at || row.coding_status === "completed" ? "تم" : "لم يتم"}</div>
                    <div className="rounded-xl bg-white/80 p-2">رسالة الترحيب: {row.welcome_message_sent_at || row.welcome_message_status === "sent" ? "تم" : "لم يتم"}</div>
                    <div className="rounded-xl bg-white/80 p-2">رد العميل: {row.customer_replied_at || row.customer_reply_status === "replied" ? "نعم" : "لا"}</div>
                  </div>
                  <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs font-bold text-slate-700 whitespace-pre-line">{message}</div>
                  <div className="mt-2 text-xs font-bold text-slate-500">تاريخ المهمة: {formatDate(row.task_date || row.created_at)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" onClick={() => setSelected(row)}><Eye className="inline-block h-4 w-4 ml-1" /> عرض</button>
                    <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" onClick={() => copyMessage(message)}>نسخ الرسالة</button>
                    {wa ? <a className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700" href={wa} target="_blank" rel="noreferrer">فتح واتساب</a> : null}
                    <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800" onClick={() => mark(row, "coded")}>تم التكويد</button>
                    <button className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800" onClick={() => mark(row, "sent")}>تم إرسال الترحيب</button>
                    <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800" onClick={() => mark(row, "replied")}>رد العميل</button>
                    <button className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-700" onClick={() => addNote(row)}>إضافة ملاحظة</button>
                    <button className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-800" onClick={() => mark(row, "done")}><CheckCircle2 className="inline-block h-4 w-4 ml-1" /> إغلاق المهمة</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-black text-slate-500">لا توجد مهام ترحيب مطابقة</div>}
      </section>

      {selected ? (
        <CustomerQuickDetailsModal
          customerCode={selected.customer_code}
          customerPhone={selected.customer_phone || selected.whatsapp_phone}
          customerName={selected.customer_name}
          branch={selected.branch}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
