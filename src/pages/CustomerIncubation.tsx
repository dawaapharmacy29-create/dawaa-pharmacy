import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, Gift, Loader2, MessageCircle, RefreshCw, Sparkles, Target, TrendingUp, UserRoundCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { BRANCHES } from "@/lib/constants";
import { normalizeBranchName } from "@/lib/branch";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { getCustomerDetails, type CustomerDetails } from "@/lib/api/customers";
import { whatsappLink } from "@/lib/whatsapp";

type CandidateRow = {
  customer_key?: string | null;
  final_customer_key?: string | null;
  case_id?: string | null;
  incubation_status?: string | null;
  incubation_priority?: string | null;
  incubation_recommendation?: string | null;
  branch_rank?: number | string | null;
  recommended_for_incubation?: boolean | null;
  assigned_customer_service?: string | null;
  target_note?: string | null;
  completed_steps_count?: number | string | null;
  recent_steps?: string | null;
  next_best_action?: string | null;
  incubation_priority_score?: number | string | null;
  selection_reason?: string | null;
  has_valid_phone?: boolean | null;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
  branch?: string | null;
  total_spent?: number | string | null;
  total_invoice_count?: number | string | null;
  after_total_spent?: number | string | null;
  after_invoice_count?: number | string | null;
  avg_monthly?: number | string | null;
  avg_invoice?: number | string | null;
  invoices_count?: number | string | null;
  first_purchase?: string | null;
  last_purchase?: string | null;
  segment?: string | null;
  customer_status?: string | null;
  purchase_count_current_month?: number | string | null;
  purchase_count_previous_month?: number | string | null;
  purchase_count_previous_same_period?: number | string | null;
  expected_current_month_purchase_count?: number | string | null;
  average_monthly_purchase_count?: number | string | null;
  purchase_frequency_status?: string | null;
  smart_purchase_status?: string | null;
  matched_customer_master?: boolean | null;
  incubation_rank?: number | string | null;
  active_case_id?: string | null;
  stage?: string | null;
  assigned_doctor?: string | null;
  assigned_service_staff?: string | null;
  before_purchase_count?: number | string | null;
  after_purchase_count?: number | string | null;
  before_purchase_value?: number | string | null;
  after_purchase_value?: number | string | null;
};

type IncubationCase = {
  id: string;
  customer_key: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  assigned_doctor: string | null;
  assigned_customer_service: string | null;
  status: string | null;
  priority: string | null;
  target_note: string | null;
  voucher_code: string | null;
  voucher_value: number | null;
  discount_percent: number | null;
  baseline_invoice_count: number | null;
  baseline_total_spent: number | null;
  baseline_purchase_count_current_month: number | null;
  baseline_purchase_count_previous_month: number | null;
  after_invoice_count: number | null;
  after_total_spent: number | null;
  after_purchase_count: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type IncubationAction = {
  id: string;
  case_id: string;
  customer_key?: string | null;
  step_type: string;
  step_title: string | null;
  step_note: string | null;
  step_status: string | null;
  doctor_name: string | null;
  customer_service_name: string | null;
  created_by: string | null;
  created_at: string | null;
};

type MonthlyTrackingRow = {
  customer_key: string;
  customer_code: string | null;
  customer_name: string | null;
  branch: string | null;
  month_start: string;
  invoice_count: number | string | null;
  total_spent: number | string | null;
  avg_invoice: number | string | null;
  month_rank_desc: number | string | null;
};

const ALL_BRANCHES = "كل الفروع";
const ACTIVE_CASE_STAGES = ["active", "vip_care", "voucher_sent", "followup", "measuring"];

const STAGE_LABELS: Record<string, string> = {
  active: "داخل مرحلة الدلع",
  vip_care: "خدمة VIP",
  voucher_sent: "تم إرسال فاوچر",
  followup: "متابعة مستمرة",
  measuring: "قياس النتيجة",
  completed: "اكتملت المرحلة",
  paused: "متوقفة مؤقتًا",
};

const ACTION_TEMPLATES = [
  { key: "welcome_call", label: "اتصال ترحيبي", hint: "التعريف بأن العميل ضمن مرحلة الدلع وتأكيد احتياجاته" },
  { key: "needs_review", label: "مراجعة احتياجات العميل", hint: "الأدوية الشهرية، مستحضرات متكررة، طريقة تواصل مناسبة" },
  { key: "personal_offer", label: "عرض شخصي", hint: "عرض مناسب حسب تاريخ شراء العميل وليس خصم عشوائي" },
  { key: "voucher", label: "فاوچر / كاش باك", hint: "فاوچر محدد القيمة أو نسبة خصم على طلب قادم" },
  { key: "whatsapp", label: "رسالة واتساب مخصصة", hint: "رسالة قصيرة باسم العميل وبأسلوب راقٍ" },
  { key: "doctor_followup", label: "متابعة دكتور", hint: "دكتور محدد مسؤول عن الحفاظ على العلاقة" },
  { key: "purchase_check", label: "قياس شراء بعد المتابعة", hint: "تسجيل هل حدث شراء بعد المتابعة وقيمته" },
  { key: "feedback", label: "قياس رضا العميل", hint: "سؤال بسيط عن التجربة وما الذي يمكن تحسينه" },
];

function toNumber(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function text(value: unknown, fallback = "غير محدد") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function rowKey(row: CandidateRow) {
  return String(row.customer_key || row.final_customer_key || row.customer_id || row.customer_code || row.customer_phone || row.customer_name || "");
}

function customerPhone(row: CandidateRow) {
  return String(row.customer_phone || row.phone || "").trim();
}

function purchaseStatus(row: CandidateRow) {
  return text(row.smart_purchase_status || row.purchase_frequency_status || row.customer_status, "غير محدد");
}

function purchaseStatusTone(row: CandidateRow): "slate" | "emerald" | "amber" | "rose" | "sky" {
  const status = purchaseStatus(row);
  if (status.includes("توقف") || status.includes("انخفاض متوقع") || status.includes("انخفض")) return "rose";
  if (status.includes("أقل") || status.includes("متابعة")) return "amber";
  if (status.includes("طبيعي")) return "emerald";
  return "slate";
}

function toCustomerMetric(row: CandidateRow) {
  return {
    id: rowKey(row),
    final_customer_key: row.final_customer_key || rowKey(row),
    customer_id: row.customer_id || null,
    customer_code: row.customer_code || null,
    customer_name: row.customer_name || null,
    customer_phone: row.customer_phone || row.phone || null,
    phone: row.phone || row.customer_phone || null,
    name: row.customer_name || null,
    branch: normalizeBranchName(row.branch || null),
    invoices_count: toNumber(row.invoices_count),
    total_spent: toNumber(row.total_spent),
    total_purchases: toNumber(row.total_spent),
    avg_invoice: toNumber(row.avg_invoice),
    first_purchase: row.first_purchase || null,
    last_purchase: row.last_purchase || null,
    active_months: 0,
    avg_monthly: toNumber(row.avg_monthly),
    segment: row.segment || "غير محدد",
    type: row.segment || "غير محدد",
    customer_status: row.customer_status || "غير محدد",
    status: row.customer_status || "غير محدد",
    retention_status: row.customer_status || "غير محدد",
  };
}

function Metric({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "emerald" | "amber" | "rose" | "sky" }) {
  const classes = {
    slate: "border-slate-700/50 bg-slate-900/70 text-slate-100",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-100",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-100",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function CustomerDetailsModal({ customer, onClose }: { customer: CandidateRow; onClose: () => void }) {
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getCustomerDetails(toCustomerMetric(customer), 30)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "تعذر تحميل تفاصيل العميل");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="text-2xl font-black">{text(customer.customer_name, "عميل بدون اسم")}</div>
            <div className="mt-1 text-sm text-slate-400">كود: {text(customer.customer_code)} • هاتف: {text(customerPhone(customer))}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-300"><Loader2 className="animate-spin" /> جاري تحميل التفاصيل...</div>
        ) : error ? (
          <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-100">{error}</div>
        ) : details ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="شراء الشهر الحالي" value={details.purchaseAnalysis?.purchaseCountCurrentMonth ?? 0} tone="emerald" />
              <Metric label="شراء الشهر السابق" value={details.purchaseAnalysis?.purchaseCountPreviousMonth ?? 0} tone="sky" />
              <Metric label="متوسط مرات الشراء" value={details.purchaseAnalysis?.averageMonthlyPurchaseCount ?? 0} tone="amber" />
              <Metric label="حالة التكرار" value={purchaseStatus(customer)} tone={purchaseStatusTone(customer)} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="نفس الفترة السابقة" value={toNumber(customer.purchase_count_previous_same_period)} tone="sky" />
              <Metric label="توقع نهاية الشهر" value={toNumber(customer.expected_current_month_purchase_count)} tone="amber" />
              <Metric label="متوسط مرات الشراء" value={toNumber(customer.average_monthly_purchase_count)} tone="slate" />
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="font-black text-white">توصية المتابعة</div>
              <div className="mt-2 text-sm leading-7 text-slate-300">{details.purchaseAnalysis?.recommendation || details.purchaseFrequencyRecommendation || "لا توجد توصية"}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="font-black text-white">آخر الفواتير</div>
                <div className="mt-3 space-y-2">
                  {details.invoices.length ? details.invoices.slice(0, 10).map((invoice, index) => (
                    <div key={`${invoice.invoice_number || index}`} className="rounded-xl bg-slate-950 p-3 text-sm">
                      <div className="font-bold">{invoice.invoice_number || "فاتورة"} — {formatCurrency(invoice.amount)}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatDate(invoice.invoice_date || "")} • {invoice.seller_name || "بدون دكتور"} • {invoice.branch || "بدون فرع"}</div>
                    </div>
                  )) : <div className="text-sm text-slate-400">لا توجد فواتير ظاهرة.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="font-black text-white">آخر المتابعات والملاحظات</div>
                <div className="mt-3 space-y-2">
                  {details.followups.length ? details.followups.slice(0, 10).map((followup) => (
                    <div key={followup.id} className="rounded-xl bg-slate-950 p-3 text-sm">
                      <div className="font-bold">{followup.responsible_name || followup.assigned_to || "متابعة"} — {followup.status || "بدون حالة"}</div>
                      <div className="mt-1 whitespace-pre-line text-xs leading-6 text-slate-400">{followup.followup_result || followup.notes || "بدون ملخص"}</div>
                    </div>
                  )) : <div className="text-sm text-slate-400">لا توجد متابعات ظاهرة.</div>}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomerIncubation() {
  const { user } = useAuth();
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [searchRows, setSearchRows] = useState<CandidateRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [caseRow, setCaseRow] = useState<IncubationCase | null>(null);
  const [actions, setActions] = useState<IncubationAction[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<MonthlyTrackingRow[]>([]);
  const [detailsCustomer, setDetailsCustomer] = useState<CandidateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ doctor: "", serviceStaff: "", targetNotes: "", voucherCode: "", voucherValue: "", discountPercent: "", actionType: "welcome_call", actionNotes: "" });

  const branchOptions = useMemo(() => [ALL_BRANCHES, ...BRANCHES], []);

  const filteredRows = useMemo(() => {
    const normalized = normalizeBranchName(branch);
    const base = branch === ALL_BRANCHES ? rows : rows.filter((row) => normalizeBranchName(row.branch || null) === normalized);
    const visible = base.filter((row) => row.recommended_for_incubation === true || String(row.incubation_status || "") === "active" || toNumber(row.branch_rank) <= 10);
    return visible.sort((a, b) => {
      const aActive = String(a.incubation_status || "") === "active" ? 0 : 1;
      const bActive = String(b.incubation_status || "") === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return toNumber(a.branch_rank) - toNumber(b.branch_rank);
    });
  }, [branch, rows]);

  const stats = useMemo(() => {
    const active = filteredRows.filter((row) => row.case_id || String(row.incubation_status || "") === "active").length;
    const beforeValue = filteredRows.reduce((sum, row) => sum + toNumber(row.total_spent), 0);
    const afterValue = filteredRows.reduce((sum, row) => sum + toNumber(row.after_total_spent), 0);
    return { total: filteredRows.length, active, beforeValue, afterValue };
  }, [filteredRows]);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("dawaa_incubation_candidates_v1")
        .select("*")
        .order("branch", { ascending: true })
        .order("branch_rank", { ascending: true })
        .limit(200);

      if (error) throw error;
      const nextRows = (data || []) as CandidateRow[];
      setRows(nextRows);
      setSelected((current) => current ? nextRows.find((row) => rowKey(row) === rowKey(current)) || nextRows[0] || null : nextRows[0] || null);
    } catch (error) {
      toast.error(`تعذر تحميل عملاء مرحلة الدلع: ${error instanceof Error ? error.message : "خطأ غير متوقع"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchCustomers = useCallback(async () => {
    const term = customerSearch.trim();
    if (term.length < 2) {
      setSearchRows([]);
      return;
    }
    setSearching(true);
    try {
      const safeTerm = term.replace(/[%_]/g, "");
      const { data, error } = await supabase
        .from("dawaa_customer_purchase_frequency_v2")
        .select("*")
        .or(`customer_name.ilike.%${safeTerm}%,customer_code.ilike.%${safeTerm}%,customer_phone.ilike.%${safeTerm}%`)
        .order("total_spent", { ascending: false })
        .limit(20);
      if (error) throw error;
      setSearchRows((data || []) as CandidateRow[]);
    } catch (error) {
      toast.error(`تعذر البحث في قاعدة العملاء: ${error instanceof Error ? error.message : "خطأ غير متوقع"}`);
    } finally {
      setSearching(false);
    }
  }, [customerSearch]);

  const pickSearchCustomer = (row: CandidateRow) => {
    const normalizedRow: CandidateRow = {
      ...row,
      branch_rank: row.branch_rank || "يدوي",
      recommended_for_incubation: true,
      incubation_recommendation: row.incubation_recommendation || "إضافة يدوية من قاعدة العملاء",
    };
    setSelected(normalizedRow);
    setRows((current) => {
      const key = rowKey(normalizedRow);
      return current.some((item) => rowKey(item) === key) ? current : [normalizedRow, ...current];
    });
    toast.success("تم اختيار العميل. راجع الخطة ثم اضغط إدخال/تحديث مرحلة الدلع.");
  };

  const loadCaseDetails = useCallback(async (customer: CandidateRow | null) => {
    setCaseRow(null);
    setActions([]);
    setMonthlyRows([]);
    if (!customer) return;
    const key = rowKey(customer);
    const code = customer.customer_code || null;
    const phone = customerPhone(customer) || null;
    const orParts = [
      key ? `customer_key.eq.${key}` : "",
      code ? `customer_code.eq.${code}` : "",
      phone ? `customer_phone.eq.${phone}` : "",
    ].filter(Boolean);
    if (!orParts.length) return;

    const monthly = await supabase
      .from("dawaa_customer_monthly_tracking_v1")
      .select("*")
      .eq("customer_key", key)
      .order("month_start", { ascending: false })
      .limit(6);
    if (!monthly.error) setMonthlyRows((monthly.data || []) as MonthlyTrackingRow[]);

    const { data, error } = await supabase
      .from("customer_incubation_cases")
      .select("*")
      .or(orParts.join(","))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const found = data as IncubationCase;
      setCaseRow(found);
      setForm((current) => ({
        ...current,
        doctor: found.assigned_doctor || "",
        serviceStaff: found.assigned_customer_service || "",
        targetNotes: found.target_note || "",
        voucherCode: found.voucher_code || "",
        voucherValue: found.voucher_value ? String(found.voucher_value) : "",
        discountPercent: found.discount_percent ? String(found.discount_percent) : "",
      }));
      const events = await supabase
        .from("customer_incubation_steps")
        .select("*")
        .eq("case_id", found.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!events.error) setActions((events.data || []) as IncubationAction[]);
    }
  }, []);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  useEffect(() => {
    void loadCaseDetails(selected);
  }, [selected, loadCaseDetails]);

  const upsertCase = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = {
        customer_key: rowKey(selected),
        customer_code: selected.customer_code || null,
        customer_name: selected.customer_name || null,
        customer_phone: customerPhone(selected) || null,
        branch: normalizeBranchName(selected.branch || null),
        assigned_doctor: form.doctor || null,
        assigned_customer_service: form.serviceStaff || user?.name || null,
        status: "active",
        priority: "high",
        target_note: form.targetNotes || null,
        voucher_code: form.voucherCode || null,
        voucher_value: form.voucherValue ? Number(form.voucherValue) : null,
        discount_percent: form.discountPercent ? Number(form.discountPercent) : null,
        baseline_invoice_count: toNumber(selected.total_invoice_count ?? selected.invoices_count),
        baseline_total_spent: toNumber(selected.total_spent),
        baseline_purchase_count_current_month: toNumber(selected.purchase_count_current_month),
        baseline_purchase_count_previous_month: toNumber(selected.purchase_count_previous_month),
        updated_at: new Date().toISOString(),
      };

      const saveQuery = caseRow?.id
        ? supabase.from("customer_incubation_cases").update(payload).eq("id", caseRow.id).select("*").maybeSingle()
        : supabase.from("customer_incubation_cases").insert({ ...payload, created_by: user?.name || user?.id || null }).select("*").maybeSingle();

      const { data, error } = await saveQuery;
      if (error) throw error;
      setCaseRow(data as IncubationCase);
      toast.success("تم إدخال/تحديث العميل في مرحلة الدلع");
      await loadCases();
    } catch (error) {
      toast.error(`تعذر حفظ مرحلة الدلع: ${error instanceof Error ? error.message : "خطأ غير متوقع"}`);
    } finally {
      setSaving(false);
    }
  };

  const addAction = async () => {
    if (!caseRow) return toast.error("أدخل العميل المرحلة أولًا");
    const template = ACTION_TEMPLATES.find((item) => item.key === form.actionType) || ACTION_TEMPLATES[0];
    setSaving(true);
    try {
      const { error } = await supabase.from("customer_incubation_steps").insert({
        case_id: caseRow.id,
        customer_key: caseRow.customer_key || rowKey(selected!),
        step_type: template.key,
        step_title: template.label,
        step_note: form.actionNotes || template.hint,
        step_status: "done",
        doctor_name: form.doctor || null,
        customer_service_name: form.serviceStaff || user?.name || null,
        created_by: user?.name || user?.id || null,
      });
      if (error) throw error;
      setForm((current) => ({ ...current, actionNotes: "" }));
      await loadCaseDetails(selected);
      toast.success("تم تسجيل خطوة المتابعة");
    } catch (error) {
      toast.error(`تعذر تسجيل الخطوة: ${error instanceof Error ? error.message : "خطأ غير متوقع"}`);
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = () => {
    if (!selected) return;
    const phone = customerPhone(selected);
    if (!phone) return toast.error("لا يوجد رقم هاتف للعميل");
    const message = `أهلًا ${selected.customer_name || "حضرتك"}، مع حضرتك صيدليات دواء. حضرتك من عملائنا المميزين، وحابين نتابع احتياجاتك ونقدم لحضرتك خدمة خاصة وعرض مناسب.`;
    window.open(whatsappLink(phone, message), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/60 to-slate-950 p-5 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-200"><Sparkles size={24} /><span className="text-sm font-black">INCUBATION — مرحلة الدلع</span></div>
            <h1 className="mt-2 text-3xl font-black text-white">أفضل 10 عملاء لكل فرع تحت رعاية خاصة</h1>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-300">
              الهدف هو اختيار 10 عملاء من كل فرع، ومتابعتهم بخدمة عملاء VIP: مكالمة ترحيبية، مراجعة احتياجات، خصم أو فاوچر مناسب، رسالة واتساب مخصصة، متابعة شراء بعد الخدمة، وقياس قيمة الشراء قبل وبعد دخول المرحلة.
            </p>
          </div>
          <button type="button" onClick={loadCases} disabled={loading} className="btn-primary flex items-center gap-2"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /> تحديث</button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="عملاء ظاهرين" value={stats.total} tone="sky" />
        <Metric label="داخل المرحلة" value={stats.active} tone="emerald" />
        <Metric label="قيمة قبل المرحلة" value={formatCurrency(stats.beforeValue)} tone="amber" />
        <Metric label="قيمة بعد المرحلة" value={formatCurrency(stats.afterValue)} tone="rose" />
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
        <div className="flex flex-wrap gap-2">
          {branchOptions.map((item) => (
            <button key={item} type="button" onClick={() => setBranch(item)} className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${branch === item ? "border-emerald-400 bg-emerald-500/20 text-emerald-100" : "border-slate-800 bg-slate-900 text-slate-300 hover:border-emerald-700"}`}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-emerald-500/20 bg-slate-950/80 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="text-sm font-black text-white">إضافة عميل من قاعدة العملاء</div>
            <div className="mt-1 text-xs text-slate-400">ابحث بالاسم أو الكود أو رقم الهاتف، ثم اختر العميل وأدخله مرحلة الدلع تحت إشراف خدمة العملاء.</div>
          </div>
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchCustomers(); }} placeholder="بحث عن عميل من قاعدة العملاء..." className="input min-w-[280px]" />
          <button type="button" onClick={searchCustomers} disabled={searching} className="btn-secondary flex items-center gap-2">
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Target size={16} />} بحث
          </button>
        </div>
        {searchRows.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {searchRows.map((row) => (
              <button key={`search-${rowKey(row)}`} type="button" onClick={() => pickSearchCustomer(row)} className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-right hover:border-emerald-500">
                <div className="font-black text-white">{text(row.customer_name, "عميل بدون اسم")}</div>
                <div className="mt-1 text-xs text-slate-400">كود {text(row.customer_code)} • {text(customerPhone(row), "بدون هاتف")} • {normalizeBranchName(row.branch || null)}</div>
                <div className="mt-2 text-xs text-emerald-200">{formatCurrency(toNumber(row.total_spent))} • {toNumber(row.total_invoice_count ?? row.invoices_count)} فاتورة • {purchaseStatus(row)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="stat-card flex items-center justify-center gap-3 py-16 text-slate-300"><Loader2 className="animate-spin" /> جاري تحميل العملاء...</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
          <div className="space-y-3">
            {!filteredRows.length && (
              <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm leading-7 text-amber-100">
                لا توجد عملاء ظاهرين لهذا الفرع. تأكد من تشغيل SQL الخاص بمرحلة الدلع ومن وجود `recommended_for_incubation = true` أو حالات `active`.
              </div>
            )}
            {filteredRows.map((row) => {
              const active = selected && rowKey(selected) === rowKey(row);
              const inCase = Boolean(row.case_id || String(row.incubation_status || "") === "active");
              return (
                <button key={`${rowKey(row)}-${row.branch}`} type="button" onClick={() => setSelected(row)} className={`w-full rounded-3xl border p-4 text-right transition ${active ? "border-emerald-400 bg-emerald-500/15" : "border-slate-800 bg-slate-950 hover:border-emerald-700"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-white">{text(row.customer_name, "عميل بدون اسم")}</div>
                      <div className="mt-1 text-xs text-slate-400">كود {text(row.customer_code)} • {text(customerPhone(row))}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${inCase ? "bg-emerald-500/20 text-emerald-100" : "bg-slate-800 text-slate-300"}`}>{inCase ? "داخل المرحلة" : `#${row.branch_rank || ""}`}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-900 p-2"><span className="block text-slate-500">إجمالي</span><b>{formatCurrency(toNumber(row.total_spent))}</b></div>
                    <div className="rounded-xl bg-slate-900 p-2"><span className="block text-slate-500">فواتير</span><b>{toNumber(row.total_invoice_count ?? row.invoices_count)}</b></div>
                    <div className="rounded-xl bg-slate-900 p-2"><span className="block text-slate-500">حالة</span><b>{purchaseStatus(row)}</b></div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="space-y-5">
            {!selected ? (
              <div className="stat-card py-16 text-center text-slate-300">اختر عميلًا لعرض تفاصيل مرحلة الدلع.</div>
            ) : (
              <>
                <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-2xl font-black text-white">{text(selected.customer_name, "عميل بدون اسم")}</div>
                      <div className="mt-1 text-sm text-slate-400">{normalizeBranchName(selected.branch || null)} • كود {text(selected.customer_code)} • {text(customerPhone(selected))}</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        <span className="rounded-full bg-purple-500/15 px-3 py-1 text-purple-100">{selected.segment || "غير مصنف"}</span>
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-100">{selected.customer_status || "بدون حالة"}</span>
                        <span className="rounded-full bg-sky-500/15 px-3 py-1 text-sky-100">{purchaseStatus(selected)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setDetailsCustomer(selected)} className="btn-secondary flex items-center gap-2"><Eye size={16} /> عين التفاصيل</button>
                      <button type="button" onClick={openWhatsApp} className="btn-primary flex items-center gap-2"><MessageCircle size={16} /> واتساب</button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <Metric label="إجمالي مشتريات قبل" value={formatCurrency(toNumber(caseRow?.baseline_total_spent ?? selected.total_spent))} tone="amber" />
                    <Metric label="عدد فواتير قبل" value={toNumber(caseRow?.baseline_invoice_count ?? selected.total_invoice_count ?? selected.invoices_count)} tone="sky" />
                    <Metric label="إجمالي بعد المرحلة" value={formatCurrency(toNumber(caseRow?.after_total_spent))} tone="emerald" />
                    <Metric label="عدد فواتير بعد" value={toNumber(caseRow?.after_invoice_count ?? caseRow?.after_purchase_count)} tone="emerald" />
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <Metric label="شراء الشهر الحالي" value={toNumber(selected.purchase_count_current_month)} tone="emerald" />
                    <Metric label="نفس الفترة السابقة" value={toNumber(selected.purchase_count_previous_same_period)} tone="sky" />
                    <Metric label="توقع نهاية الشهر" value={toNumber(selected.expected_current_month_purchase_count)} tone="amber" />
                    <Metric label="الحالة الذكية" value={purchaseStatus(selected)} tone={purchaseStatusTone(selected)} />
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs leading-6 text-slate-300">
                    يتم تقييم تكرار الشراء بعد V9.7 بمقارنة الشهر الحالي حتى اليوم مع نفس الفترة من الشهر السابق، وليس مع الشهر السابق كاملًا.
                    {selected.matched_customer_master ? " تم ربط العميل بجدول العملاء وجلب الهاتف الحقيقي." : " لم يتم تأكيد الربط بجدول العملاء لهذا العميل."}
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <div className="mb-3 font-black text-white">تتبع مشتريات آخر 3 شهور</div>
                    {monthlyRows.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="text-slate-400">
                            <tr className="border-b border-slate-800">
                              <th className="py-2 text-right">الشهر</th>
                              <th className="py-2 text-right">عدد الفواتير</th>
                              <th className="py-2 text-right">إجمالي الشراء</th>
                              <th className="py-2 text-right">متوسط الفاتورة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyRows.slice(0, 3).map((item) => (
                              <tr key={item.month_start} className="border-b border-slate-900 text-slate-200">
                                <td className="py-2">{formatDate(item.month_start)}</td>
                                <td className="py-2">{toNumber(item.invoice_count)}</td>
                                <td className="py-2">{formatCurrency(toNumber(item.total_spent))}</td>
                                <td className="py-2">{formatCurrency(toNumber(item.avg_invoice))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <div className="text-sm text-slate-400">لا يوجد تتبع شهري متاح. شغّل SQL دعم V12 لإنشاء view التتبع الشهري.</div>}
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                    <div className="mb-4 flex items-center gap-2 text-white"><Target size={20} className="text-emerald-300" /><b>إعداد خطة الدلع</b></div>
                    <div className="space-y-3">
                      <input value={form.doctor} onChange={(e) => setForm({ ...form, doctor: e.target.value })} placeholder="الدكتور المسؤول" className="input" />
                      <input value={form.serviceStaff} onChange={(e) => setForm({ ...form, serviceStaff: e.target.value })} placeholder="مسؤول خدمة العملاء" className="input" />
                      <textarea value={form.targetNotes} onChange={(e) => setForm({ ...form, targetNotes: e.target.value })} placeholder="هدف العميل وخطة التعامل" className="input min-h-[90px]" />
                      <div className="grid grid-cols-3 gap-2">
                        <input value={form.voucherCode} onChange={(e) => setForm({ ...form, voucherCode: e.target.value })} placeholder="كود الفاوچر" className="input" />
                        <input value={form.voucherValue} onChange={(e) => setForm({ ...form, voucherValue: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="قيمة" className="input" />
                        <input value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="خصم %" className="input" />
                      </div>
                      <button type="button" onClick={upsertCase} disabled={saving} className="btn-primary w-full justify-center">{saving ? "جاري الحفظ..." : "إدخال/تحديث مرحلة الدلع"}</button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                    <div className="mb-4 flex items-center gap-2 text-white"><CheckCircle2 size={20} className="text-emerald-300" /><b>خطوات الخدمة المقترحة</b></div>
                    <div className="space-y-2">
                      {ACTION_TEMPLATES.map((item) => (
                        <label key={item.key} className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-sm">
                          <input type="radio" name="actionType" checked={form.actionType === item.key} onChange={() => setForm({ ...form, actionType: item.key })} />
                          <span><b className="block text-white">{item.label}</b><span className="text-xs text-slate-400">{item.hint}</span></span>
                        </label>
                      ))}
                      <textarea value={form.actionNotes} onChange={(e) => setForm({ ...form, actionNotes: e.target.value })} placeholder="ملخص الخطوة التي تمت" className="input min-h-[90px]" />
                      <button type="button" onClick={addAction} disabled={saving || !caseRow} className="btn-secondary w-full justify-center">تسجيل خطوة تمت</button>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <div className="mb-4 flex items-center gap-2 text-white"><TrendingUp size={20} className="text-emerald-300" /><b>تاريخ الخطوات والمتابعة</b></div>
                  {caseRow ? (
                    <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                      الحالة الحالية: {caseRow.status === "active" ? "داخل مرحلة الدلع" : caseRow.status || "داخل المرحلة"} • بدأ في {formatDate(caseRow.started_at || caseRow.created_at || "")}
                    </div>
                  ) : (
                    <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100"><AlertTriangle size={16} className="inline" /> العميل لم يدخل المرحلة رسميًا بعد.</div>
                  )}
                  <div className="space-y-3">
                    {actions.length ? actions.map((action) => (
                      <div key={action.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <b className="text-white">{action.step_title || action.step_type}</b>
                          <span className="text-xs text-slate-500">{formatDate(action.created_at || "")}</span>
                        </div>
                        <div className="mt-2 whitespace-pre-line text-sm text-slate-300">{action.step_note || "بدون ملاحظات"}</div>
                        <div className="mt-2 text-xs text-slate-500">بواسطة: {action.customer_service_name || action.created_by || "غير محدد"}</div>
                      </div>
                    )) : <div className="text-sm text-slate-400">لم يتم تسجيل خطوات بعد.</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {detailsCustomer && <CustomerDetailsModal customer={detailsCustomer} onClose={() => setDetailsCustomer(null)} />}
    </div>
  );
}
