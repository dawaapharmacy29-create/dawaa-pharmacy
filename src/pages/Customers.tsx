import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  Plus,
  Search,
  AlertTriangle,
  Edit,
} from "lucide-react";
import { supabaseInsert, logActivity } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import {
  getCustomerDetails,
  getCustomers,
  getCustomerStats,
  type CustomerDetails,
  type CustomerStats,
} from "@/lib/api/customers";
import { classifyCustomer, formatCurrency, formatDate } from "@/lib/utils";
import { calcCLV } from "@/lib/customerMetrics";
import {
  getScript,
  SCRIPT_OPTIONS,
  type ScriptKey,
} from "@/lib/followupScripts";
import { copyText, whatsappLink } from "@/lib/whatsapp";
import { BRANCHES } from "@/lib/constants";
import { normalizeBranchName } from "@/lib/branch";
import { CUSTOMER_FLAG_TEMPLATES_2027, mergeFlagsIntoNotes, parseCustomerFlags } from "@/lib/dawaa2027Data";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { User } from "@/types";
import type { Customer } from "@/types/database";

const PAGE_SIZE = 30;
const ALL_FILTER = "الكل";

export default function Customers() {
  const { user, canManage } = useAuth();
  const canCreateCustomer =
    canManage || user?.permissions?.create_customer === true;
  const canEditCustomer =
    canManage || user?.permissions?.edit_customer === true;
  const canDeleteCustomer =
    canManage || user?.permissions?.delete_customer === true;
  const canExportCustomers =
    canManage || user?.permissions?.export_customers === true;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [typeFilter, setTypeFilter] = useState(ALL_FILTER);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const customersCountRef = useRef(0);
  const [stats, setStats] = useState<CustomerStats>({
    total: 0,
    vip: 0,
    atRisk: 0,
    newC: 0,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    customersCountRef.current = customers.length;
  }, [customers.length]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search.replace(/\s+/g, " ").trim()),
      750,
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getCustomerStats());
    } catch (err) {
      console.error("[customers] stats error:", err);
    }
  }, []);

  const loadCustomers = useCallback(
    async (append = false) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (append) setLoadingMore(true);
      else if (customersCountRef.current === 0) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const result = await getCustomers({
          search: debouncedSearch,
          limit: PAGE_SIZE,
          offset: append ? customersCountRef.current : 0,
          branch: branchFilter,
          type: typeFilter,
        });

        if (requestId !== requestIdRef.current) return;
        setCustomers((current) =>
          append ? [...current, ...result.customers] : result.customers,
        );
        setTotalCount(result.count);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(
          err instanceof Error ? err.message : "حدث خطأ أثناء تحميل العملاء",
        );
        if (!append) setCustomers([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [branchFilter, debouncedSearch, typeFilter],
  );

  useEffect(() => {
    loadCustomers(false);
  }, [loadCustomers]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const refetch = useCallback(() => {
    loadCustomers(false);
    loadStats();
  }, [loadCustomers, loadStats]);

  const hasMore = customers.length < totalCount;

  if (loading)
    return (
      <div className="space-y-4">
        <div className="text-slate-300 text-sm">
          جاري تحميل العملاء من Supabase...
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="stat-card h-20 animate-pulse bg-white/5" />
        ))}
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "إجمالي العملاء", value: stats.total, color: "text-white" },
          { label: "عملاء VIP", value: stats.vip, color: "text-purple-400" },
          { label: "عملاء جدد", value: stats.newC, color: "text-teal-400" },
          {
            label: "معرضون للفقدان",
            value: stats.atRisk,
            color: "text-amber-400",
          },
        ].map((s) => (
          <div key={s.label} className="stat-card text-center">
            <div className={`text-3xl font-bold ${s.color} num`}>{s.value}</div>
            <div className="text-slate-400 text-sm mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: كود، اسم، هاتف، أو ا*س*ل*ا*م (أجزاء بالترتيب)"
            className="input-dark pr-10"
          />
          {refreshing && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-400 w-4 h-4 animate-spin" />
          )}
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="input-dark md:w-40"
        >
          <option value={ALL_FILTER}>كل الفروع</option>
          {BRANCHES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-dark md:w-40"
        >
          <option value={ALL_FILTER}>كل التصنيفات</option>
          {["عادي", "متوسط", "مهم", "مهم جداً"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {canCreateCustomer && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> عميل جديد
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-200 rounded-xl p-4 text-sm">
          تعذر تحميل العملاء: {error}
        </div>
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
        {refreshing && (
          <div className="px-4 py-2 border-b border-[#2d4063] text-teal-300 text-xs flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            جاري تحديث نتائج البحث...
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>كود العميل</th>
                <th>الفرع</th>
                <th>التصنيف</th>
                <th>آخر شراء</th>
                <th>متوسط شهري</th>
                <th>إجمالي المشتريات</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const avgMonthly = c.avg_monthly ?? 0;
                const totalPurchases = c.total_purchases ?? 0;
                const cls = classifyCustomer(avgMonthly);
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(c)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold flex-shrink-0">
                          {(c.name || "ع")[0]}
                        </div>
                        <div>
                          <div className="text-white font-medium text-sm">
                            {c.name || "عميل بدون اسم"}
                          </div>
                          <div className="text-slate-400 text-xs flex items-center gap-1">
                            <Phone size={11} />
                            {c.phone || "بدون رقم"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-slate-300 text-sm num">
                        {c.customer_code || "بدون كود"}
                      </span>
                    </td>
                    <td>
                      <span className="text-slate-300 text-sm">
                        {normalizeBranchName(c.branch)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cls.bg} ${cls.color}`}
                      >
                        {c.type || cls.label}
                      </span>
                    </td>
                    <td>
                      <span className="text-slate-300 text-sm">
                        {c.last_purchase ? formatDate(c.last_purchase) : "-"}
                      </span>
                    </td>
                    <td>
                      <span className="text-white font-medium text-sm num">
                        {formatCurrency(avgMonthly)}
                      </span>
                    </td>
                    <td>
                      <span className="text-teal-400 font-bold text-sm num">
                        {formatCurrency(totalPurchases)}
                      </span>
                    </td>
                    <td>
                      <RetentionBadge
                        status={c.retention_status || "غير محدد"}
                      />
                    </td>
                    <td>
                      <button
                        title="عرض تفاصيل العميل"
                        className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!error && customers.length === 0 && (
          <div className="py-12 text-center text-slate-400">
            لا توجد نتائج مطابقة
          </div>
        )}
        {hasMore && (
          <div className="p-4 border-t border-[#2d4063] flex justify-center">
            <button
              onClick={() => loadCustomers(true)}
              disabled={loadingMore}
              className="btn-secondary flex items-center justify-center gap-2 min-w-36"
            >
              {loadingMore && <Loader2 size={16} className="animate-spin" />}
              عرض المزيد
            </button>
          </div>
        )}
      </div>

      {selected && (
        <CustomerModal
          customer={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            setCustomers((current) => current.map((item) => item.id === updated.id ? updated : item));
          }}
        />
      )}
      {showAddModal && (
        <AddCustomerModal
          onClose={() => setShowAddModal(false)}
          onSaved={refetch}
          user={user}
        />
      )}
    </div>
  );
}

function RetentionBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    محتفظ: "badge-success",
    جديد: "badge-info",
    "معرض للفقدان": "badge-warning",
    مفقود: "badge-danger",
  };
  return <span className={map[status] || "badge-info"}>{status}</span>;
}


const CUSTOMER_FLAG_KEY_BY_LABEL: Record<string, string> = {
  "يفضل دكتور معين": "prefers_specific_doctor",
  "كثير الشكاوى": "many_complaints",
  "حساس للسعر": "price_sensitive",
  "لا يحب البدائل": "dislikes_alternatives",
  "يفضل المستورد": "prefers_imported",
  "عميل مزمن": "chronic_customer",
  "يحتاج متابعة شهرية": "needs_monthly_followup",
  "لا يتم التواصل معه كثيرًا": "do_not_contact_often",
  "VIP": "vip_customer",
  "عميل VIP": "vip_customer",
  "مهم جدًا": "vip_customer",
  "لا يحب الترشيحات": "dislikes_recommendations",
  "يحتاج اتصال قبل التوصيل": "call_before_delivery",
};

function flagsToObject(flags: string[]) {
  return flags.reduce<Record<string, boolean>>((acc, label) => {
    const key = CUSTOMER_FLAG_KEY_BY_LABEL[label] || label;
    acc[key] = true;
    return acc;
  }, {});
}

function flagsFromCustomer(customer: Customer) {
  const rawFlags = (customer as unknown as { customer_flags?: unknown }).customer_flags;
  if (rawFlags && typeof rawFlags === "object" && !Array.isArray(rawFlags)) {
    const objectFlags = rawFlags as Record<string, unknown>;
    const byKey = Object.fromEntries(Object.entries(CUSTOMER_FLAG_KEY_BY_LABEL).map(([label, key]) => [key, label]));
    return Object.entries(objectFlags)
      .filter(([, value]) => value === true)
      .map(([key]) => byKey[key] || key);
  }
  return parseCustomerFlags(customer.notes, rawFlags);
}

async function saveCustomerServiceNotes(customer: Customer, notes: string, flags: string[] = []) {
  const mergedNotes = mergeFlagsIntoNotes(notes, flags);
  const payload = {
    notes: mergedNotes,
    team_notes: notes,
    handling_notes: notes,
    customer_flags: flagsToObject(flags),
    updated_at: new Date().toISOString(),
  };
  const code = String(customer.customer_code || "").trim();
  const phone = String(customer.phone || "").trim();
  const id = String(customer.id || "").trim();

  const attempts: Array<() => Promise<{ data?: unknown; error: unknown }>> = [];
  if (code) {
    attempts.push(() => supabase.from("customers").update(payload).eq("customer_code", code).select("*").maybeSingle());
    attempts.push(() => supabase.from("customers").update(payload).eq("code", code).select("*").maybeSingle());
  }
  if (phone) {
    attempts.push(() => supabase.from("customers").update(payload).eq("phone", phone).select("*").maybeSingle());
    attempts.push(() => supabase.from("customers").update(payload).eq("customer_phone", phone).select("*").maybeSingle());
  }
  if (id) {
    attempts.push(() => supabase.from("customers").update(payload).eq("id", id).select("*").maybeSingle());
  }

  let saved: Customer | null = null;
  let lastError: unknown = null;
  for (const attempt of attempts) {
    const { data, error } = await attempt();
    if (!error && data) saved = data as Customer;
    else {
      lastError = error;
      const message = String((error as { message?: string })?.message || error || "");
      if (message.includes("customer_flags") || message.includes("team_notes") || message.includes("handling_notes") || message.includes("schema cache")) {
        const fallbackPayload = { notes: mergedNotes, updated_at: new Date().toISOString() };
        const fallbackAttempts = [
          code ? () => supabase.from("customers").update(fallbackPayload).eq("customer_code", code).select("*").maybeSingle() : null,
          code ? () => supabase.from("customers").update(fallbackPayload).eq("code", code).select("*").maybeSingle() : null,
          phone ? () => supabase.from("customers").update(fallbackPayload).eq("phone", phone).select("*").maybeSingle() : null,
          id ? () => supabase.from("customers").update(fallbackPayload).eq("id", id).select("*").maybeSingle() : null,
        ].filter(Boolean) as Array<() => Promise<{ data?: unknown; error: unknown }>>;
        for (const fallback of fallbackAttempts) {
          const result = await fallback();
          if (!result.error && result.data) saved = result.data as Customer;
        }
      }
    }
  }

  if (!saved && lastError) {
    console.error("[customer notes] save failed:", lastError);
    throw lastError instanceof Error ? lastError : new Error("تعذر حفظ ملاحظات العميل. تأكد من تشغيل SQL الخاص بملاحظات العملاء.");
  }
  return { ...customer, ...(saved || {}), notes: mergedNotes } as Customer;
}

function CustomerModal({
  customer: c,
  onClose,
  onSaved,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const avgMonthly = c.avg_monthly ?? 0;
  const totalPurchases = c.total_purchases ?? 0;
  const totalInvoices = c.total_invoices ?? 0;
  const cls = classifyCustomer(avgMonthly);
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const clv = calcCLV(totalPurchases, avgMonthly);
  const defaultScriptKey: ScriptKey =
    avgMonthly >= 8000
      ? "vip"
      : avgMonthly >= 4000
        ? "important"
        : avgMonthly >= 1500
          ? "medium"
          : "at_risk";
  const [scriptKey, setScriptKey] = useState<ScriptKey>(defaultScriptKey);
  const script = getScript(scriptKey, undefined, {
    customerName: c.name || "",
    staffName: details?.topDoctor || "فريق صيدليات دواء",
    branchName: c.branch || "",
  });
  const wa = whatsappLink(c.phone, script);
  const callHref = c.phone ? `tel:${c.phone}` : "";
  const [notesText, setNotesText] = useState(String((c as unknown as { team_notes?: string; handling_notes?: string }).team_notes || c.notes || "").split("\n").filter((line) => !line.startsWith("FLAGS:")).join("\n"));
  const [customerFlags, setCustomerFlags] = useState<string[]>(flagsFromCustomer(c));
  const [savingNotes, setSavingNotes] = useState(false);
  useEscapeKey(onClose, true);

  useEffect(() => {
    let mounted = true;
    setLoadingDetails(true);
    getCustomerDetails(c)
      .then((result) => {
        if (mounted) setDetails(result);
      })
      .catch((error) => {
        console.error("[customer details] error:", error);
        if (mounted) setDetails(null);
      })
      .finally(() => {
        if (mounted) setLoadingDetails(false);
      });
    return () => {
      mounted = false;
    };
  }, [c]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-5xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#2d4063] flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xl font-bold">
            {(c.name || "ع")[0]}
          </div>
          <div className="flex-1">
            <div className="text-white font-bold text-lg">
              {c.name || "عميل بدون اسم"}
            </div>
            <div className="text-slate-400 text-sm flex items-center gap-2">
              <Phone size={13} />
              {c.phone || "بدون رقم"} - كود {c.customer_code || "بدون كود"} -{" "}
              {normalizeBranchName(c.branch)}
            </div>
          </div>
          <span
            className={`text-sm font-bold px-3 py-1.5 rounded-full border ${cls.bg} ${cls.color}`}
          >
            {c.type || cls.label}
          </span>
          <button type="button" onClick={onClose} className="btn-secondary px-3 py-2" title="إغلاق (Esc)">إغلاق</button>
        </div>
        <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sticky top-0 z-10 bg-[#1B2B4B]/95 backdrop-blur border-b border-[#2d4063]">
          {[
            {
              label: "أول شراء",
              value: c.first_purchase ? formatDate(c.first_purchase) : "-",
            },
            {
              label: "آخر شراء",
              value: c.last_purchase ? formatDate(c.last_purchase) : "-",
            },
            { label: "إجمالي الفواتير", value: String(totalInvoices) },
            {
              label: "متوسط الفاتورة",
              value: formatCurrency(
                c.avg_invoice ||
                  (totalInvoices ? totalPurchases / totalInvoices : 0),
              ),
            },
            { label: "متوسط شهري", value: formatCurrency(avgMonthly) },
            {
              label: "إجمالي المشتريات",
              value: formatCurrency(totalPurchases),
            },
            {
              label: "القيمة العمرية (CLV)",
              value: clv.value ? clv.label : "غير كافٍ لحساب القيمة العمرية",
            },
            { label: "درجة الخطر", value: `${c.risk_score ?? 0}%` },
          ].map((item) => (
            <div key={item.label} className="crm-card">
              <div className="text-slate-400 text-xs">{item.label}</div>
              <div className="text-white font-bold text-sm mt-1 num">
                {item.value}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 pb-4">
          <div className="crm-card">
            <div className="text-white font-bold text-sm mb-3">
              إجراءات سريعة
            </div>
            <select
              value={scriptKey}
              onChange={(event) =>
                setScriptKey(event.target.value as ScriptKey)
              }
              className="input-dark mb-3"
            >
              {SCRIPT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-line mb-3">
              {script}
            </div>
            <div className="flex flex-wrap gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex items-center gap-2"
                >
                  <MessageSquare size={16} /> فتح واتساب
                </a>
              )}
              {callHref && (
                <a
                  href={callHref}
                  className="btn-secondary flex items-center gap-2"
                >
                  <PhoneCall size={16} /> اتصال مباشر
                </a>
              )}
              <button
                onClick={async () => {
                  const ok = await copyText(script);
                  toast[ok ? "success" : "error"](
                    ok ? "تم نسخ السكريبت" : "تعذر النسخ",
                  );
                }}
                className="btn-secondary"
              >
                نسخ السكريبت
              </button>
            </div>
          </div>
        </div>
        <div className="px-6 pb-4">
          <div className="bg-white/5 rounded-xl p-4 space-y-3">
            <div>
              <div className="text-white font-bold text-sm">ملاحظات خدمة العملاء</div>
              <div className="text-slate-400 text-xs mt-1">
                اكتب أي تفاصيل مهمة: يرفض الترشيحات، يفضل المستورد، لا يتم احتساب توصيل، VIP، أو أي ملاحظة تساعد أي موظف جديد.
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {CUSTOMER_FLAG_TEMPLATES_2027.map((flag) => {
                const active = customerFlags.includes(flag);
                return <button
                  key={flag}
                  type="button"
                  onClick={() => setCustomerFlags((current) => active ? current.filter((item) => item !== flag) : [...current, flag])}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${active ? "border-teal-400 bg-teal-500/20 text-teal-100" : "border-white/10 bg-white/5 text-slate-300 hover:border-teal-500/30"}`}
                >
                  {active ? "ON · " : "OFF · "}{flag}
                </button>;
              })}
            </div>
            <textarea
              value={notesText}
              onChange={(event) => setNotesText(event.target.value)}
              className="input-dark min-h-[110px]"
              placeholder="ملاحظات حرة تظهر لكل الفريق عند فتح العميل..."
            />
            <div className="rounded-xl bg-navy-900/40 border border-white/5 p-3 text-xs text-slate-300">
              <div className="font-bold text-white mb-1">الملاحظات الظاهرة دائمًا للفريق</div>
              <div>{customerFlags.length ? customerFlags.join(" · ") : "لا توجد علامات تشغيلية"}</div>
              {notesText.trim() && <div className="mt-2 whitespace-pre-line text-slate-400">{notesText}</div>}
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={savingNotes}
              onClick={async () => {
                setSavingNotes(true);
                try {
                  const updated = await saveCustomerServiceNotes(c, notesText, customerFlags);
                  onSaved(updated);
                  toast.success("تم حفظ ملاحظات العميل وعلامات التعامل");
                } catch (error) {
                  console.error("[customer notes] save error:", error);
                  toast.error(error instanceof Error ? error.message : "تعذر حفظ الملاحظات");
                } finally {
                  setSavingNotes(false);
                }
              }}
            >
              {savingNotes ? "جاري الحفظ..." : "حفظ الملاحظات والعلامات"}
            </button>
          </div>
        </div>
        <div className="px-6 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="crm-card">
            <div className="text-white font-bold text-sm mb-3">
              تحليل التعامل
            </div>
            {loadingDetails ? (
              <div className="text-slate-400 text-sm flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> جاري تحميل
                التفاصيل...
              </div>
            ) : (
              <div className="space-y-3">
                <InfoLine
                  label="أهم دكتور يتعامل معاه"
                  value={details?.topDoctor || "غير محدد"}
                />
                <InfoLine
                  label="آخر دكتور/مسؤول تابع معاه"
                  value={details?.lastServiceDoctor || "لا توجد متابعة مسجلة"}
                />
                <InfoLine
                  label="تاريخ آخر متابعة"
                  value={
                    details?.lastFollowup?.created_at
                      ? formatDate(details.lastFollowup.created_at)
                      : "لا توجد"
                  }
                />
                <InfoLine
                  label="نتيجة آخر متابعة"
                  value={details?.lastFollowup?.status || "غير محدد"}
                />
                <div>
                  <div className="text-slate-400 text-xs mb-1">
                    تقرير آخر متابعة
                  </div>
                  <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">
                    {details?.lastFollowupReport || "لا يوجد تقرير متابعة بعد"}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="crm-card">
            <div className="text-white font-bold text-sm mb-3">
              آخر المتابعات
            </div>
            {loadingDetails ? (
              <div className="text-slate-400 text-sm">جاري التحميل...</div>
            ) : details?.followups.length ? (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {details.followups.slice(0, 6).map((followup) => (
                  <div
                    key={followup.id}
                    className="crm-timeline-item"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="badge-info text-xs">
                        {followup.status || "متابعة"}
                      </span>
                      <span className="text-slate-500 text-xs">
                        {followup.created_at
                          ? formatDate(followup.created_at)
                          : "-"}
                      </span>
                    </div>
                    <div className="text-slate-300 text-xs mt-2 whitespace-pre-line">
                      {followup.notes || "بدون تقرير"}
                    </div>
                    <div className="text-slate-500 text-xs mt-1">
                      المتابع: {followup.assigned_to || "غير محدد"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-sm">
                لا توجد متابعات مسجلة لهذا العميل
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-4">
          <div className="crm-card">
            <div className="text-white font-bold text-sm mb-3">
              آخر الفواتير
            </div>
            {loadingDetails ? (
              <div className="text-slate-400 text-sm">جاري التحميل...</div>
            ) : details?.invoices.length ? (
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>رقم الفاتورة</th>
                      <th>التاريخ</th>
                      <th>القيمة</th>
                      <th>الدكتور</th>
                      <th>الفرع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.invoices.slice(0, 10).map((invoice, index) => (
                      <tr key={`${invoice.invoice_number}-${index}`}>
                        <td className="num">{invoice.invoice_number || "-"}</td>
                        <td>
                          {invoice.invoice_date
                            ? formatDate(invoice.invoice_date)
                            : "-"}
                        </td>
                        <td className="text-teal-400 font-bold num">
                          {formatCurrency(invoice.amount)}
                        </td>
                        <td>{invoice.seller_name || "-"}</td>
                        <td>{invoice.branch || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-sm">
                لا توجد فواتير مرتبطة بهذا العميل
              </div>
            )}
          </div>
        </div>
        <div className="px-6 pb-6">
          <button onClick={onClose} className="btn-secondary w-full">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-white text-sm font-semibold text-left">
        {value}
      </span>
    </div>
  );
}

function AddCustomerModal({
  onClose,
  onSaved,
  user,
}: {
  onClose: () => void;
  onSaved: () => void;
  user: User | null;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    phone: string;
    branch: string;
    notes: string;
    customer_notes: string;
  }>({
    name: "",
    phone: "",
    branch: BRANCHES[0],
    notes: "",
    customer_notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabaseInsert("customers", {
      ...form,
      type: "عادي",
      avg_monthly: 0,
      total_purchases: 0,
      total_invoices: 0,
      avg_invoice: 0,
      clv: 0,
      risk_score: 0,
      retention_status: "جديد",
    });

    if (error) {
      toast.error("خطأ: " + error);
    } else {
      toast.success("تم إضافة العميل");
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user?.name || "النظام",
        "إضافة عميل",
        "العملاء",
        `إضافة ${form.name}`,
        form.branch,
      );
      onSaved();
      onClose();
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[#2d4063]">
          <div className="text-white font-bold text-lg">إضافة عميل جديد</div>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <input
            placeholder="اسم العميل *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-dark"
            required
          />
          <input
            placeholder="رقم الهاتف *"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="input-dark"
            required
          />
          <select
            value={form.branch}
            onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            className="input-dark"
          >
            {BRANCHES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <textarea
            placeholder="ملاحظات عامة"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="input-dark resize-none"
          />
          <textarea
            placeholder="ملاحظات هامة للتعامل (مثل: لا توصيل، خصم خاص، إلخ)"
            value={form.customer_notes}
            onChange={(e) =>
              setForm((f) => ({ ...f, customer_notes: e.target.value }))
            }
            rows={2}
            className="input-dark resize-none bg-amber-500/5 border-amber-500/20"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />} حفظ
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
