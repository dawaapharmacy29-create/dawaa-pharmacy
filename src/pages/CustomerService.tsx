import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  AlertTriangle,
  CalendarClock,
  Clipboard,
  Eye,
  HeadphonesIcon,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ALL_FILTER, type CustomerMetric } from "@/lib/api/customers";
import {
  calculateFollowupStats,
  calculateTeamPerformance,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  generateTodayFollowupsFromCustomerMetrics,
  recommendedAction,
  riskLevel,
  searchCustomerMetrics,
  updateFollowupResult,
  type CustomerServiceSearchResult,
  type FollowupPerformanceRow,
  type FollowupResultPayload,
  type FollowupRow,
} from "@/lib/api/customerServiceCommandCenter";
import { buildCustomerCareScript, chooseCustomerCareScriptType } from "@/lib/whatsappTemplates";
import { cleanEgyptianPhone, generateWhatsAppLink } from "@/lib/whatsapp";
import { isValidEgyptPhone, getBestCustomerPhone } from "@/lib/customerAnalyticsService";
import { getCustomerFullProfile, type CustomerFullProfile } from "@/lib/customerProfileService";
import { normalizeBranchName } from "@/lib/branch";
import { BRANCHES } from "@/lib/constants";
import { logActivity } from "@/lib/activityLog";
import { notifyCustomerServiceResponsible } from "@/lib/notificationService";
import {
  getActiveCustomerFlags,
} from "@/lib/customerFlags";
import { CustomerFlagsBadges } from "@/components/CustomerFlagsBadges";

const STATUS_OPTIONS = [ALL_FILTER, "معلق", "تم", "لم يرد", "مؤجل", "متأخرة", "يحتاج مدير", "تم الشراء بعد المتابعة"];
const PRIORITY_OPTIONS = ["عاجل", "مهم", "متوسط", "عادي"];
const REQUEST_TYPES = ["متابعة استثنائية", "شكوى", "طلب ناقص", "مشكلة توصيل", "طلب خاص", "استرجاع عميل"];
const CONTACT_METHODS = ["اتصال", "واتساب", "رسالة", "زيارة"];
const PAGE_TABS = [
  { id: "today", label: "قائمة اليوم" },
  { id: "requests", label: "طلبات متابعة من الفريق" },
  { id: "history", label: "سجل المتابعات" },
  { id: "performance", label: "أداء خدمة العملاء" },
  { id: "alerts", label: "تنبيهات العملاء" },
  { id: "scripts", label: "سكريبتات التواصل" },
  { id: "evaluation", label: "تقييم التعاملات" },
] as const;
type PageTab = (typeof PAGE_TABS)[number]["id"];
const CUSTOMER_CARE_RESPONSIBLES = [
  { branch: "فرع الشامي", name: "د ضحى" },
  { branch: "فرع شكري", name: "د دنيا" },
];

function todayInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function formatDate(value?: string | null) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("ar-EG");
}

function formatMoney(value?: number | null) {
  const numeric = Number(value ?? 0);
  return `${numeric.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج`;
}

function followupStatus(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || row.status || "تم";
  if (row.postponed_until) return "مؤجل";
  if (row.needs_manager) return "يحتاج مدير";
  return row.followup_status || row.status || row.contact_status || "معلق";
}

function responsibleOf(row: FollowupRow) {
  const explicit = row.responsible_name || row.assigned_to || row.assigned_doctor;
  if (explicit) return explicit;
  const normalizedBranch = normalizeBranchName(row.branch);
  return CUSTOMER_CARE_RESPONSIBLES.find((item) => normalizeBranchName(item.branch) === normalizedBranch)?.name || "غير محدد";
}

function customerCareResponsibleForBranch(branch?: string | null) {
  const normalizedBranch = normalizeBranchName(branch);
  return CUSTOMER_CARE_RESPONSIBLES.find((item) => normalizeBranchName(item.branch) === normalizedBranch)?.name || "";
}

function phoneOf(row: FollowupRow) {
  const bestPhone = getBestCustomerPhone(
    row,
    row.customer_metrics,
    row
  );
  return bestPhone || "";
}

function phoneDisplay(phone: string | null | undefined, customerCode?: string | null) {
  return phone && isValidEgyptPhone(phone, customerCode) ? phone : "بدون رقم صحيح";
}

function importantHandlingNote(row: FollowupRow) {
  return row.handling_notes || row.service_notes || row.whatsapp_notes || row.customer_notes || row.notes || "";
}

function segmentOf(row: FollowupRow) {
  return row.customer_metrics?.segment || row.segment || row.classification || "غير محدد";
}

function customerStatusOf(row: FollowupRow) {
  return row.customer_metrics?.customer_status || row.customer_status || "غير محدد";
}

function avgMonthlyOf(row: FollowupRow) {
  return row.customer_metrics?.avg_monthly ?? null;
}

function lastPurchaseOf(row: FollowupRow) {
  return row.customer_metrics?.last_purchase || row.last_purchase_date || null;
}

function isManagerUser(user: ReturnType<typeof useAuth>["user"], canManage?: boolean) {
  const role = String(user?.role || "").toLowerCase();
  return Boolean(canManage || ["admin", "manager", "general_manager", "owner"].includes(role) || user?.permissions?.view_full_team_analytics);
}

function isOverdueFollowup(row: FollowupRow) {
  if (row.completed_at || row.postponed_until) return false;
  const due = row.followup_datetime || row.followup_date || row.date;
  return due ? new Date(due).getTime() < Date.now() : false;
}

function compareFollowupPriority(a: FollowupRow, b: FollowupRow) {
  const score = (row: FollowupRow) => {
    let value = 0;
    if (row.needs_manager) value += 1000;
    if (isOverdueFollowup(row)) value += 800;
    if (segmentOf(row) === "مهم جدًا") value += 500;
    if (segmentOf(row) === "مهم") value += 350;
    if (["stopped", "decreased", "توقف عن الشراء", "انخفض الشراء"].includes(row.purchase_frequency_status || "")) value += 300;
    value += Number(avgMonthlyOf(row) || 0) / 100;
    return value;
  };
  const scoreDiff = score(b) - score(a);
  if (scoreDiff) return scoreDiff;
  return new Date(lastPurchaseOf(a) || "2100-01-01").getTime() - new Date(lastPurchaseOf(b) || "2100-01-01").getTime();
}

export default function CustomerService() {
  const { user, canManage } = useAuth();
  const manager = isManagerUser(user, canManage);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [responsibleFilter, setResponsibleFilter] = useState(ALL_FILTER);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExceptional, setShowExceptional] = useState(false);
  const [resultFollowup, setResultFollowup] = useState<FollowupRow | null>(null);
  const [postponeFollowup, setPostponeFollowup] = useState<FollowupRow | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<CustomerMetric | FollowupRow | null>(null);
  const [selectedFollowup, setSelectedFollowup] = useState<FollowupRow | null>(null);
  const [selectedResponsible, setSelectedResponsible] = useState<string>(ALL_FILTER);
  const [staffNames, setStaffNames] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<PageTab>("today");
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [showDoctorRequest, setShowDoctorRequest] = useState(false);
  const [interactionReviews, setInteractionReviews] = useState<Record<string, unknown>[]>([]);
  const [reviewsAvailable, setReviewsAvailable] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    supabase
      .from("staff")
      .select("name,role,branch")
      .limit(200)
      .then(({ data }) => {
        const names = [...new Set((data || []).map((row) => String(row.name || "").trim()).filter(Boolean))];
        setStaffNames(names);
      });
  }, []);

  useEffect(() => {
    supabase
      .from("conversation_sales_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(120)
      .then(({ data, error }) => {
        setReviewsAvailable(!error);
        setInteractionReviews((data || []) as Record<string, unknown>[]);
      });
  }, []);

  const loadFollowups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchCustomerServiceFollowups({
        branch: branchFilter,
        status: statusFilter,
        responsible: CUSTOMER_CARE_RESPONSIBLES.some((item) => item.name === responsibleFilter) ? ALL_FILTER : responsibleFilter,
        search: debouncedSearch,
      });
      const responsibleRows = responsibleFilter !== ALL_FILTER
        ? rows.filter((row) => responsibleOf(row) === responsibleFilter)
        : rows;
      const visibleRows = manager
        ? responsibleRows
        : responsibleRows.filter((row) => [row.assigned_to, row.responsible_name, row.assigned_doctor, responsibleOf(row)].filter(Boolean).includes(user?.name || ""));
      setFollowups(visibleRows);
      setSelectedFollowup((current) => current && visibleRows.find((row) => row.id === current.id) || visibleRows[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل المتابعات");
      setFollowups([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, debouncedSearch, manager, responsibleFilter, statusFilter, user?.name]);

  useEffect(() => {
    loadFollowups();
  }, [loadFollowups]);

  const stats = useMemo(() => calculateFollowupStats(followups), [followups]);
  const recoveredCount = useMemo(
    () => followups.filter((row) => row.purchase_after_followup && ["متوقف", "مهدد بالتوقف"].includes(customerStatusOf(row))).length,
    [followups],
  );
  const invalidPhoneCount = useMemo(
    () => followups.filter((row) => !isValidEgyptPhone(phoneOf(row), row.customer_code)).length,
    [followups],
  );
  const teamPerformance = useMemo(() => calculateTeamPerformance(followups), [followups]);
  const responsibleOptions = useMemo(() => {
    const fromRows = followups.map(responsibleOf).filter((name) => name !== "غير محدد");
    return [ALL_FILTER, ...new Set([...CUSTOMER_CARE_RESPONSIBLES.map((item) => item.name), ...staffNames, ...fromRows])];
  }, [followups, staffNames]);

  const quickFilteredFollowups = useMemo(() => {
    if (!quickFilter) return followups;
    if (quickFilter === "total") return followups;
    if (quickFilter === "done") return followups.filter((row) => followupStatus(row).includes("تم"));
    if (quickFilter === "no_answer") return followups.filter((row) => followupStatus(row) === "لم يرد");
    if (quickFilter === "postponed") return followups.filter((row) => followupStatus(row) === "مؤجل" || Boolean(row.postponed_until));
    if (quickFilter === "overdue") return followups.filter(isOverdueFollowup);
    if (quickFilter === "needs_manager") return followups.filter((row) => Boolean(row.needs_manager) || followupStatus(row) === "يحتاج مدير");
    if (quickFilter === "purchase_after") return followups.filter((row) => Boolean(row.purchase_after_followup));
    if (quickFilter === "invalid_phone") return followups.filter((row) => !isValidEgyptPhone(phoneOf(row), row.customer_code));
    return followups;
  }, [followups, quickFilter]);

  const grouped = useMemo(() => {
    const groups = [
      { label: "أولوية قصوى", rows: [] as FollowupRow[] },
      { label: "مهم جدًا", rows: [] as FollowupRow[] },
      { label: "مهم", rows: [] as FollowupRow[] },
      { label: "متوسط", rows: [] as FollowupRow[] },
      { label: "مهدد بالتوقف", rows: [] as FollowupRow[] },
      { label: "متوقف", rows: [] as FollowupRow[] },
      { label: "بدون رقم صحيح", rows: [] as FollowupRow[] },
      { label: "طلبات خاصة / يحتاج مدير", rows: [] as FollowupRow[] },
    ];
    const sortedRows = [...quickFilteredFollowups].sort(compareFollowupPriority);
    for (const row of sortedRows) {
      const segment = segmentOf(row);
      const status = customerStatusOf(row);
      const purchaseStatus = row.purchase_frequency_status;

      if (!isValidEgyptPhone(phoneOf(row), row.customer_code)) groups[6].rows.push(row);
      else if (row.needs_manager || followupStatus(row) === "يحتاج مدير" || row.request_type || row.request_details) groups[7].rows.push(row);
      else if (
        (segment === "مهم جدًا" && ["متوقف", "مهدد بالتوقف"].includes(status)) ||
        ["stopped", "decreased", "توقف عن الشراء", "انخفض الشراء"].includes(purchaseStatus || "")
      ) {
        groups[0].rows.push(row);
      }
      else if (status === "متوقف") groups[5].rows.push(row);
      else if (status === "مهدد بالتوقف") groups[4].rows.push(row);
      else if (segment === "مهم جدًا") groups[1].rows.push(row);
      else if (segment === "مهم") groups[2].rows.push(row);
      else if (segment === "متوسط") groups[3].rows.push(row);
      else groups[3].rows.push(row);
    }
    return groups.filter((group) => group.rows.length);
  }, [quickFilteredFollowups]);

  const applyQuickFilter = (filter: string | null) => {
    setQuickFilter(filter);
    setActiveTab("today");
    window.setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const rows = await generateTodayFollowupsFromCustomerMetrics(branchFilter, user?.name);
      toast.success(rows.length ? `تم إنشاء ${rows.length} متابعة` : "لا توجد متابعات جديدة مطلوبة");
      await loadFollowups();
      await safeLog("إنشاء قائمة متابعات يومية", { count: rows.length });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر إنشاء قائمة المتابعات");
    } finally {
      setGenerating(false);
    }
  };

  const noopLog = async () => {
    // no-op logger for missing callbacks and defensive rendering
  };

  const safeLog = async (action: string, details: Record<string, unknown>) => {
    try {
      await logActivity({
        action,
        module: "customer_service",
        target_type: "daily_followups",
        details,
        route_path: "/customer-service",
        user_id: user?.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: branchFilter === ALL_FILTER ? undefined : branchFilter,
      });
    } catch (error) {
      console.warn("activity log failed", error);
    }
  };

  const quickUpdate = async (row: FollowupRow, payload: FollowupResultPayload, success: string) => {
    try {
      const updated = await updateFollowupResult(row.id, { ...payload, updated_by: user?.id || user?.name || null });
      setFollowups((items) => items.map((item) => item.id === updated.id ? updated : item));
      setSelectedFollowup((current) => current?.id === updated.id ? updated : current);
      toast.success(success);
      const activityAction =
        payload.needs_manager ? "followup_needs_manager"
          : payload.followup_status === "لم يرد" || payload.contact_status === "لم يرد" ? "mark_followup_no_answer"
          : payload.postponed_until || payload.followup_status === "مؤجل" || payload.contact_status === "مؤجل" ? "postpone_followup"
          : "save_followup_result";
      await safeLog(activityAction, {
        followup_id: updated.id,
        customer_name: updated.customer_name,
        followup_status: updated.followup_status,
        contact_status: updated.contact_status,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المتابعة");
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">Customer Service Command Center</span>
          <h1 className="mt-3 text-2xl font-black text-slate-950">مركز خدمة العملاء</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">إدارة المتابعات اليومية والاستثنائية وقياس أداء خدمة العملاء</p>
        </div>
        <div className="dawaa-controls">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={loadFollowups} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> تحديث
          </button>
          <button type="button" className="dawaa-button-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            إنشاء/تحديث قائمة اليوم
          </button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowExceptional(true)}>
            <Plus size={16} /> متابعة استثنائية
          </button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowDoctorRequest(true)}>
            <Plus size={16} /> طلب متابعة خدمة عملاء
          </button>
        </div>
      </section>

      <section className="dawaa-panel py-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-black transition ${
                activeTab === tab.id
                  ? "border-teal-300 bg-teal-50 text-teal-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <section className="dawaa-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_170px_170px_210px]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="dawaa-input w-full pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم العميل، الكود، الهاتف، المسؤول..." />
          </div>
          <select className="dawaa-input w-full" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value={ALL_FILTER}>كل الفروع</option>
            {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <select className="dawaa-input w-full" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status === ALL_FILTER ? "كل الحالات" : status}</option>)}
          </select>
          <select className="dawaa-input w-full" value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}>
            {responsibleOptions.map((name) => <option key={name} value={name}>{name === ALL_FILTER ? "كل المسؤولين" : name}</option>)}
          </select>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
        <Kpi label="إجمالي متابعات اليوم" value={stats.totalToday} tone="blue" active={quickFilter === "total"} onClick={() => applyQuickFilter("total")} />
        <Kpi label="تمت" value={stats.completed} tone="emerald" active={quickFilter === "done"} onClick={() => applyQuickFilter("done")} />
        <Kpi label="لم يرد" value={stats.noAnswer} tone="amber" active={quickFilter === "no_answer"} onClick={() => applyQuickFilter("no_answer")} />
        <Kpi label="مؤجلة" value={stats.postponed} tone="blue" active={quickFilter === "postponed"} onClick={() => applyQuickFilter("postponed")} />
        <Kpi label="متأخرة" value={stats.overdue} tone="red" active={quickFilter === "overdue"} onClick={() => applyQuickFilter("overdue")} />
        <Kpi label="يحتاج مدير" value={stats.needsManager} tone="red" active={quickFilter === "needs_manager"} onClick={() => applyQuickFilter("needs_manager")} />
        <Kpi label="شراء بعد المتابعة" value={stats.purchaseAfterCount} tone="emerald" active={quickFilter === "purchase_after"} onClick={() => applyQuickFilter("purchase_after")} />
        <Kpi label="قيمة الشراء بعد المتابعة" value={formatMoney(stats.purchaseAfterAmount)} tone="teal" />
        <Kpi label="عملاء تم استرجاعهم" value={recoveredCount} tone="emerald" />
        <Kpi label="بدون رقم صحيح" value={invalidPhoneCount} tone="amber" active={quickFilter === "invalid_phone"} onClick={() => applyQuickFilter("invalid_phone")} />
      </section>

      {activeTab === "performance" && <CustomerCareIncentivePanel followups={followups} />}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="ml-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {activeTab === "today" && <section ref={listRef} className="grid gap-4 xl:grid-cols-[1.45fr_.85fr]">
        <div className="space-y-4">
          <SectionTitle icon={HeadphonesIcon} title="قائمة المتابعات الذكية" subtitle="مجمعة حسب الأولوية والحالة من daily_followups و customer_metrics_summary" />
          {quickFilter && (
            <div className="flex items-center justify-between rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-black text-teal-800">
              <span>فلتر نشط: {quickFilterLabel(quickFilter)} · {quickFilteredFollowups.length} نتيجة</span>
              <button type="button" className="rounded-xl bg-white px-3 py-1 text-teal-700 shadow-sm" onClick={() => applyQuickFilter(null)}>مسح الفلتر</button>
            </div>
          )}
          {loading ? <LoadingPanel /> : grouped.length ? grouped.map((group) => (
            <FollowupGroup
              key={group.label}
              title={group.label}
              rows={group.rows}
              onSelect={setSelectedFollowup}
              onResult={setResultFollowup}
              onPostpone={setPostponeFollowup}
              onQuickUpdate={quickUpdate}
              onLog={safeLog}
              onProfile={setProfileCustomer}
              selectedId={selectedFollowup?.id}
            />
          )) : <Empty text="لا توجد متابعات مطابقة للفلاتر الحالية" />}
        </div>

        <div className="space-y-4">
          <CustomerDecisionPanel row={selectedFollowup} />
          <TeamAnalytics
            rows={teamPerformance}
            manager={manager}
            selected={selectedResponsible}
            onSelect={setSelectedResponsible}
          />
        </div>
      </section>}

      {activeTab === "history" && <section className="grid gap-4 xl:grid-cols-2">
        <FollowupHistoryPanel followups={followups} />
        <CustomerHistoryCenter followup={selectedFollowup} />
      </section>}

      {activeTab === "requests" && <section className="grid gap-4 xl:grid-cols-2">
        <DoctorRequestedFollowupsPanel followups={followups} onCreate={() => setShowDoctorRequest(true)} />
        <CustomerDecisionPanel row={selectedFollowup} />
      </section>}

      {activeTab === "alerts" && <section className="grid gap-4 xl:grid-cols-2">
        <CustomerAlertsPanel followups={followups} />
        <CustomerDecisionPanel row={selectedFollowup} />
      </section>}

      {activeTab === "scripts" && <section className="grid gap-4 xl:grid-cols-2">
        <ScriptPreviewPanel row={selectedFollowup} onLog={(action, details) => safeLog(action, details)} />
        <CustomerDecisionPanel row={selectedFollowup} />
      </section>}

      {activeTab === "evaluation" && <section className="grid gap-4 xl:grid-cols-2">
        <CustomerHandlingEvaluationPanel reviews={interactionReviews} available={reviewsAvailable} />
        <TeamAnalytics rows={teamPerformance} manager={manager} selected={selectedResponsible} onSelect={setSelectedResponsible} />
      </section>}

      {showExceptional && (
        <ExceptionalFollowupModal
          branch={branchFilter === ALL_FILTER ? "" : branchFilter}
          staffNames={staffNames}
          userName={user?.name || ""}
          userId={user?.id || ""}
          onClose={() => setShowExceptional(false)}
          onCreated={(row) => {
            setFollowups((items) => [row, ...items]);
            setSelectedFollowup(row);
            setShowExceptional(false);
            safeLog("create_followup", { followup_id: row.id, customer_name: row.customer_name });
          }}
          onProfile={setProfileCustomer}
        />
      )}

      {showDoctorRequest && (
        <DoctorFollowupRequestModal
          branch={branchFilter === ALL_FILTER ? "" : branchFilter}
          staffNames={staffNames}
          userName={user?.name || ""}
          userId={user?.id || ""}
          onClose={() => setShowDoctorRequest(false)}
          onCreated={(row) => {
            setFollowups((items) => [row, ...items]);
            setSelectedFollowup(row);
            setShowDoctorRequest(false);
            safeLog("create_customer_followup_request", { followup_id: row.id, customer_name: row.customer_name });
          }}
          onProfile={setProfileCustomer}
        />
      )}

      {resultFollowup && (
        <ResultModal
          row={resultFollowup}
          userId={user?.id || user?.name || ""}
          onClose={() => setResultFollowup(null)}
          onSaved={(updated) => {
            setFollowups((items) => items.map((item) => item.id === updated.id ? updated : item));
            setSelectedFollowup((current) => current?.id === updated.id ? updated : current);
            setResultFollowup(null);
            safeLog("save_followup_result", { followup_id: updated.id, result: updated.followup_result });
          }}
        />
      )}

      {postponeFollowup && (
        <PostponeModal
          row={postponeFollowup}
          userId={user?.id || user?.name || ""}
          onClose={() => setPostponeFollowup(null)}
          onSaved={(updated) => {
            setFollowups((items) => items.map((item) => item.id === updated.id ? updated : item));
            setSelectedFollowup((current) => current?.id === updated.id ? updated : current);
            setPostponeFollowup(null);
            safeLog("postpone_followup", { followup_id: updated.id, postponed_until: updated.postponed_until });
          }}
        />
      )}

      {profileCustomer && (
        <CustomerProfileModal
          customer={profileCustomer}
          onClose={() => setProfileCustomer(null)}
        />
      )}
    </div>
  );
}

function quickFilterLabel(filter: string) {
  const labels: Record<string, string> = {
    total: "كل متابعات اليوم",
    done: "تمت",
    no_answer: "لم يرد",
    postponed: "مؤجلة",
    overdue: "متأخرة",
    needs_manager: "يحتاج مدير",
    purchase_after: "شراء بعد المتابعة",
    invalid_phone: "بدون رقم صحيح",
  };
  return labels[filter] || filter;
}

function Kpi({ label, value, tone, onClick, active = false }: { label: string; value: ReactNode; tone: "blue" | "emerald" | "amber" | "red" | "teal"; onClick?: () => void; active?: boolean }) {
  const classes = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    teal: "border-teal-200 bg-teal-50 text-teal-700",
  };
  const Element = onClick ? "button" : "div";
  return (
    <Element type={onClick ? "button" : undefined} onClick={onClick} className={`rounded-2xl border p-4 text-right shadow-sm transition ${classes[tone]} ${onClick ? "hover:-translate-y-0.5 hover:shadow-md" : ""} ${active ? "ring-2 ring-teal-300" : ""}`}>
      <div className="num text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-black">{label}</div>
    </Element>
  );
}

function calculateCareScore(rows: FollowupRow[]) {
  const completed = rows.filter((row) => Boolean(row.completed_at) || ["تم", "تم التواصل", "تم الشراء بعد المتابعة"].includes(followupStatus(row))).length;
  const overdue = rows.filter(isOverdueFollowup).length;
  const noAnswer = rows.filter((row) => followupStatus(row) === "لم يرد").length;
  const postponed = rows.filter((row) => Boolean(row.postponed_until) || followupStatus(row) === "مؤجل").length;
  const needsManager = rows.filter((row) => Boolean(row.needs_manager)).length;
  const purchaseRows = rows.filter((row) => Boolean(row.purchase_after_followup));
  const recovered = purchaseRows.filter((row) => ["متوقف", "مهدد بالتوقف"].includes(customerStatusOf(row))).length;
  const improved = purchaseRows.filter((row) => ["stopped", "decreased", "توقف عن الشراء", "انخفض الشراء"].includes(row.purchase_frequency_status || "")).length;
  const qualityRows = rows.filter((row) => Number(row.quality_rating || 0) > 0);
  const avgQuality = qualityRows.length ? qualityRows.reduce((sum, row) => sum + Number(row.quality_rating || 0), 0) / qualityRows.length : null;
  const excellentSatisfaction = rows.filter((row) => String(row.customer_satisfaction || "").includes("ممتاز") || String(row.customer_satisfaction || "").includes("راض")).length;
  const sameDay = rows.filter((row) => row.completed_at && row.followup_date && String(row.completed_at).slice(0, 10) === String(row.followup_date).slice(0, 10)).length;
  const contactedWithoutResult = rows.filter((row) => row.contacted_at && !row.followup_result && !row.followup_summary).length;
  const points =
    completed * 2 +
    purchaseRows.length * 5 +
    recovered * 10 +
    improved * 5 +
    qualityRows.filter((row) => Number(row.quality_rating || 0) >= 5).length * 3 +
    excellentSatisfaction * 3 +
    sameDay * 2 -
    overdue * 3 -
    contactedWithoutResult * 2;
  const safePoints = Math.max(0, points);
  return {
    assigned: rows.length,
    completed,
    completionRate: rows.length ? (completed / rows.length) * 100 : 0,
    overdue,
    noAnswer,
    postponed,
    needsManager,
    purchaseAfterCount: purchaseRows.length,
    purchaseAfterAmount: purchaseRows.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0),
    recovered,
    improved,
    avgQuality,
    points: safePoints,
    incentive: Math.min(safePoints / 500, 1) * 1500,
  };
}

function CustomerCareIncentivePanel({ followups }: { followups: FollowupRow[] }) {
  return (
    <section className="dawaa-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">أداء مسؤولي خدمة العملاء والحافز</h2>
          <p className="text-sm font-semibold text-slate-500">الهدف الشهري: 500 نقطة = 1500 جنيه. الحساب للعرض فقط ولا يكتب في النقاط.</p>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-black text-teal-700">دورة 26 إلى 25</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {CUSTOMER_CARE_RESPONSIBLES.map((responsible) => {
          const rows = followups.filter((row) => responsibleOf(row) === responsible.name || normalizeBranchName(row.branch) === normalizeBranchName(responsible.branch));
          const score = calculateCareScore(rows);
          const strengths = score.purchaseAfterCount > 0 ? "تحويل جيد للمتابعات إلى شراء" : score.completionRate >= 80 ? "التزام جيد بإنهاء المتابعات" : "يحتاج تسجيل نتائج أكثر";
          const improvement = score.overdue > 0 ? "تقليل المتأخرات قبل نهاية الوردية" : score.noAnswer > 0 ? "إعادة الاتصال في وقت مختلف" : "الحفاظ على جودة التسجيل";
          return (
            <div key={responsible.name} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-slate-950">{responsible.name}</div>
                  <div className="text-xs font-bold text-slate-500">{responsible.branch}</div>
                </div>
                <div className="rounded-2xl bg-teal-50 px-3 py-2 text-center text-teal-700">
                  <div className="text-xl font-black">{score.points}</div>
                  <div className="text-[11px] font-bold">نقطة</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Info label="المسند" value={score.assigned} />
                <Info label="المكتمل" value={score.completed} />
                <Info label="نسبة الإنجاز" value={`${score.completionRate.toFixed(0)}%`} />
                <Info label="المتأخر" value={score.overdue} />
                <Info label="شراء بعد المتابعة" value={score.purchaseAfterCount} />
                <Info label="قيمة الشراء" value={formatMoney(score.purchaseAfterAmount)} />
                <Info label="عملاء تم استرجاعهم" value={score.recovered} />
                <Info label="متوسط الجودة" value={score.avgQuality === null ? "غير متاح" : score.avgQuality.toFixed(1)} />
              </div>
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-700">
                الحافز المتوقع: {formatMoney(score.incentive)}
              </div>
              <div className="mt-2 grid gap-2 text-xs font-bold text-slate-600 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-2">نقطة قوة: {strengths}</div>
                <div className="rounded-xl bg-slate-50 p-2">يحتاج تحسين: {improvement}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof HeadphonesIcon; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20} /></span>
      <div>
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <p className="text-sm font-semibold text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function FollowupGroup({
  title,
  rows,
  selectedId,
  onSelect,
  onResult,
  onPostpone,
  onQuickUpdate,
  onLog = noopLog,
  onProfile,
}: {
  title: string;
  rows: FollowupRow[];
  selectedId?: string;
  onSelect: (row: FollowupRow) => void;
  onResult: (row: FollowupRow) => void;
  onPostpone: (row: FollowupRow) => void;
  onQuickUpdate: (row: FollowupRow, payload: FollowupResultPayload, success: string) => void;
  onLog?: (action: string, details: Record<string, unknown>) => void;
  onProfile: (row: FollowupRow) => void;
}) {
  return (
    <section className="dawaa-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-black text-slate-950">{title}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{rows.length}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <FollowupCard
            key={row.id}
            row={row}
            active={row.id === selectedId}
            onSelect={() => onSelect(row)}
            onResult={() => onResult(row)}
            onPostpone={() => onPostpone(row)}
            onQuickUpdate={onQuickUpdate}
            onLog={onLog}
            onProfile={() => onProfile(row)}
          />
        ))}
      </div>
    </section>
  );
}

function FollowupCard({ row, active, onSelect, onResult, onPostpone, onQuickUpdate, onLog = noopLog, onProfile }: {
  row: FollowupRow;
  active: boolean;
  onSelect: () => void;
  onResult: () => void;
  onPostpone: () => void;
  onQuickUpdate: (row: FollowupRow, payload: FollowupResultPayload, success: string) => void;
  onLog?: (action: string, details: Record<string, unknown>) => void;
  onProfile: () => void;
}) {
  const phone = phoneOf(row);
  const cleanPhone = cleanEgyptianPhone(phone);
  const hasValidPhone = phone && isValidEgyptPhone(phone, row.customer_code);
  const activeFlags = getActiveCustomerFlags(row.customer_flags);
  const handlingNote = importantHandlingNote(row);
  const scriptType = chooseCustomerCareScriptType({
    segment: segmentOf(row),
    customerStatus: customerStatusOf(row),
    purchaseFrequencyStatus: row.purchase_frequency_status,
    flags: row.customer_flags,
    hasValidPhone: Boolean(hasValidPhone),
  });
  const message = buildCustomerCareScript({
    customerName: row.customer_name || row.name,
    responsibleName: responsibleOf(row),
    branch: row.branch,
    followupReason: row.followup_reason || row.request_type,
    suggestedAction: row.suggested_action,
    segment: segmentOf(row),
    customerStatus: customerStatusOf(row),
    flags: row.customer_flags,
    purchaseFrequencyStatus: row.purchase_frequency_status ? (row.purchase_frequency_status === "stopped" ? "توقف عن الشراء" : row.purchase_frequency_status === "decreased" ? "انخفض الشراء" : row.purchase_frequency_status === "normal" ? "طبيعي" : row.purchase_frequency_status) : undefined,
    scriptType,
    hasValidPhone: Boolean(hasValidPhone),
  });
  const wa = hasValidPhone && cleanPhone ? generateWhatsAppLink(cleanPhone, message) : "";
  const copyScript = async () => {
    await navigator.clipboard.writeText(message);
    toast.success("تم نسخ رسالة المتابعة");
    onLog("whatsapp_message_copied", { followup_id: row.id, customer_code: row.customer_code, script_type: scriptType });
  };
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${active ? "border-teal-300 ring-2 ring-teal-100" : "border-slate-200"}`} onClick={onSelect}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-black text-slate-950">{row.customer_name || row.name || "عميل بدون اسم"}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span>كود: {row.customer_code || "بدون كود"}</span>
            <span>هاتف: {phoneDisplay(phone, row.customer_code)}</span>
            <span>{normalizeBranchName(row.branch)}</span>
          </div>
        </div>
        <StatusBadge status={followupStatus(row)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
        <span>التصنيف: {segmentOf(row)}</span>
        <span>الحالة: {customerStatusOf(row)}</span>
        <span>آخر شراء: {formatDate(lastPurchaseOf(row))}</span>
        <span>متوسط شهري: {avgMonthlyOf(row) === null ? "غير متاح" : formatMoney(avgMonthlyOf(row))}</span>
        <span>مسؤول خدمة العملاء: {responsibleOf(row)}</span>
        <span>الموعد: {formatDateTime(row.followup_datetime || row.followup_date)}</span>
        <span>شراء الشهر الحالي: {row.purchase_count_current_month ?? "غير متاح"}</span>
        <span>متوسط مرات الشراء: {row.average_monthly_purchase_count ?? "غير متاح"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
        {!hasValidPhone ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">رقم غير صالح</span> : null}
        {row.purchase_frequency_status ? (
          <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-teal-700">
            {row.purchase_frequency_status === "stopped" ? "توقف عن الشراء" : row.purchase_frequency_status === "decreased" ? "انخفض الشراء" : row.purchase_frequency_status === "normal" ? "طبيعي" : row.purchase_frequency_status}
          </span>
        ) : null}
        <CustomerFlagsBadges customerFlags={row.customer_flags} limit={3} compact />
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
        {row.suggested_action || row.followup_reason || row.request_details || "تواصل مع العميل وسجل نتيجة المتابعة."}
      </div>
      <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-bold leading-5 text-teal-800">
        سكريبت مقترح: {message.split("\n").slice(0, 2).join(" ")}
      </div>
      {handlingNote ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-bold leading-5 text-amber-800">
          ملاحظة مهمة قبل التواصل: {handlingNote}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
        <a href={wa || undefined} target="_blank" rel="noopener noreferrer" onClick={() => onLog("whatsapp_opened", { followup_id: row.id, customer_code: row.customer_code })} className={`btn-secondary inline-flex items-center gap-1 px-3 py-2 ${!wa ? "pointer-events-none opacity-50" : ""}`} title={wa ? "فتح واتساب" : "لا يوجد رقم هاتف صحيح"}>
          <MessageSquare size={14} /> واتساب
        </a>
        <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-2" onClick={copyScript}><Clipboard size={14} /> نسخ رسالة</button>
        <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-2" onClick={onProfile}><Eye size={14} /> عرض ملف العميل</button>
        {hasValidPhone && cleanPhone ? <a href={`tel:${cleanPhone}`} onClick={() => onLog("call_clicked", { followup_id: row.id, customer_code: row.customer_code })} className="btn-secondary inline-flex items-center gap-1 px-3 py-2"><PhoneCall size={14} /> اتصال</a> : null}
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => onQuickUpdate(row, { status: "تم", followup_status: "تم", contact_status: "تم التواصل", completed_at: new Date().toISOString() }, "تم تسجيل المتابعة")}>تم</button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => onQuickUpdate(row, { status: "لم يرد", followup_status: "لم يرد", contact_status: "لم يرد", contact_result: "لم يرد" }, "تم تسجيل لم يرد")}>لم يرد</button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={onPostpone}>تأجيل</button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => onQuickUpdate(row, { status: "يحتاج مدير", followup_status: "يحتاج مدير", needs_manager: true, response_status: "manager_required" }, "تم تحويلها للمدير")}>يحتاج مدير</button>
        <button type="button" className="dawaa-button-primary px-3" onClick={onResult}>تسجيل نتيجة</button>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status.includes("تم") ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    status.includes("لم يرد") ? "border-amber-200 bg-amber-50 text-amber-700" :
    status.includes("مؤجل") ? "border-blue-200 bg-blue-50 text-blue-700" :
    status.includes("مدير") ? "border-red-200 bg-red-50 text-red-700" :
    "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${cls}`}>{status}</span>;
}

function TeamAnalytics({ rows, manager, selected, onSelect }: { rows: FollowupPerformanceRow[]; manager: boolean; selected: string; onSelect: (value: string) => void }) {
  const visible = manager ? rows : rows.slice(0, 3);
  const selectedRow = rows.find((row) => row.responsible === selected) || visible[0] || null;
  return (
    <section className="dawaa-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-slate-950">تحليل أداء خدمة العملاء</h3>
        {!manager && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">عرض محدود</span>}
      </div>
      {visible.length ? (
        <div className="space-y-3">
          <select className="dawaa-input w-full" value={selectedRow?.responsible || selected} onChange={(event) => onSelect(event.target.value)}>
            {visible.map((row) => <option key={row.responsible} value={row.responsible}>{row.responsible}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <SmallMetric label="المسند" value={selectedRow?.assigned || 0} />
            <SmallMetric label="المكتمل" value={selectedRow?.completed || 0} />
            <SmallMetric label="المتأخر" value={selectedRow?.overdue || 0} danger />
            <SmallMetric label="لم يرد" value={selectedRow?.noAnswer || 0} />
            <SmallMetric label="تحويل شراء" value={selectedRow?.purchaseAfterCount || 0} />
            <SmallMetric label="قيمة الشراء" value={formatMoney(selectedRow?.purchaseAfterAmount || 0)} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">
            {performanceSuggestion(selectedRow)}
          </div>
        </div>
      ) : <Empty text="لا توجد بيانات أداء متاحة للفلاتر الحالية" />}
    </section>
  );
}

function performanceSuggestion(row: FollowupPerformanceRow | null) {
  if (!row) return "غير متاح حاليًا";
  if (row.overdue >= 5) return "يحتاج تقليل المتأخرات وتوزيع المتابعات على وقت أبكر.";
  if (row.assigned && row.completionRate < 50) return "يحتاج متابعة أسرع ورفع معدل الإغلاق.";
  if (row.noAnswer >= 5) return "نسبة عدم الرد عالية، جرب إعادة الاتصال في وقت مختلف.";
  if (row.purchaseAfterCount >= 3) return "أداء جيد في تحويل المتابعة إلى شراء.";
  return "الأداء مستقر، استمر في تسجيل النتائج بوضوح.";
}

function CustomerDecisionPanel({ row }: { row: FollowupRow | null }) {
  const customer = row?.customer_metrics || null;
  return (
    <section className="dawaa-panel">
      <h3 className="mb-3 text-base font-black text-slate-950">تحليل قرار العميل</h3>
      {row ? (
        <div className="space-y-2">
          <Info label="الأهمية" value={segmentOf(row)} />
          <Info label="الحالة" value={customerStatusOf(row)} />
          <Info label="متوسط شهري" value={customer?.avg_monthly != null ? formatMoney(customer.avg_monthly) : "غير متاح"} />
          <Info label="آخر شراء" value={formatDate(lastPurchaseOf(row))} />
          <Info label="درجة الخطورة" value={riskLevel(customer)} />
          <Info label="الهاتف" value={phoneDisplay(phoneOf(row), row.customer_code)} />
          <Info label="مسؤول خدمة العملاء" value={responsibleOf(row)} />
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold leading-6 text-teal-800">
            {recommendedAction(customer)}
          </div>
          <CustomerFlagsBadges customerFlags={row.customer_flags} limit={5} compact />
          {importantHandlingNote(row) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-800">
              {importantHandlingNote(row)}
            </div>
          ) : null}
        </div>
      ) : <Empty text="اختر متابعة لعرض القرار المقترح" />}
    </section>
  );
}

function FollowupHistoryPanel({ followups }: { followups: FollowupRow[] }) {
  const latest = [...followups]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .slice(0, 12);
  return (
    <section className="dawaa-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-slate-950">سجل المتابعات</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">آخر {latest.length}</span>
      </div>
      {latest.length ? (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {latest.map((row) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-slate-950">{row.customer_name || row.name || "عميل"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{normalizeBranchName(row.branch)} · {responsibleOf(row)} · {formatDateTime(row.followup_datetime || row.created_at)}</div>
                </div>
                <StatusBadge status={followupStatus(row)} />
              </div>
              <div className="mt-2 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-3">
                <span>النتيجة: {row.followup_result || row.contact_result || "غير محدد"}</span>
                <span>شراء: {row.purchase_after_followup ? "نعم" : "لا"}</span>
                <span>القيمة: {row.purchase_after_followup ? formatMoney(row.purchase_amount || 0) : "غير متاح"}</span>
              </div>
              {row.followup_notes || row.notes ? <div className="mt-2 rounded-xl bg-slate-50 p-2 text-xs text-slate-600">{row.followup_notes || row.notes}</div> : null}
            </div>
          ))}
        </div>
      ) : <Empty text="لا توجد متابعات مسجلة في الفلاتر الحالية" />}
    </section>
  );
}

function CustomerHandlingEvaluationPanel({ reviews, available }: { reviews: Record<string, unknown>[]; available: boolean }) {
  const scoreOf = (row: Record<string, unknown>) => Number(row.finalScore ?? row.final_score ?? row.score ?? row.total_score ?? 0);
  const scored = reviews.filter((row) => scoreOf(row) > 0);
  const avgScore = scored.length ? scored.reduce((sum, row) => sum + scoreOf(row), 0) / scored.length : null;
  const byDoctor = new Map<string, { count: number; total: number }>();
  for (const row of scored) {
    const name = String(row.staff_name || row.doctor_name || row.employee_name || row.user_name || "غير محدد");
    const current = byDoctor.get(name) || { count: 0, total: 0 };
    current.count += 1;
    current.total += scoreOf(row);
    byDoctor.set(name, current);
  }
  const topDoctor = [...byDoctor.entries()].sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))[0] || null;
  return (
    <section className="dawaa-panel">
      <h3 className="text-base font-black text-slate-950">تقييم تعاملات العملاء</h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">
        مركز تقييم واتساب، المكالمات، التعامل داخل الفرع، الشكاوى، وجودة إغلاق المتابعة.
      </p>
      {available ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <SmallMetric label="عدد التقييمات" value={reviews.length} />
          <SmallMetric label="متوسط التقييم" value={avgScore === null ? "غير متاح" : `${avgScore.toFixed(1)} / 100`} />
          <SmallMetric label="أفضل أداء" value={topDoctor ? topDoctor[0] : "غير متاح"} />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          مصدر تقييمات التعامل مع العملاء غير متاح حاليًا.
        </div>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {["سرعة الرد", "استخدام اسم العميل", "فهم طلب العميل", "جودة الترشيح", "التعامل مع السعر", "التعامل مع البدائل", "حل المشكلة", "إغلاق المتابعة", "رضا العميل", "الالتزام بملاحظات العميل"].map((item) => (
          <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">{item}</div>
        ))}
      </div>
      {!reviews.length && available ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
        سيتم ربط تقييم المحادثات والتعاملات هنا بعد تفعيل مصدر التقييمات.
      </div> : null}
    </section>
  );
}

function DoctorRequestedFollowupsPanel({ followups, onCreate }: { followups: FollowupRow[]; onCreate: () => void }) {
  const requests = followups.filter((row) => row.request_type === "doctor_requested_followup" || row.request_status);
  return (
    <section className="dawaa-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-slate-950">طلبات متابعة من الفريق</h3>
        <button type="button" className="dawaa-button-primary px-3 py-2" onClick={onCreate}>طلب متابعة جديد</button>
      </div>
      {requests.length ? (
        <div className="space-y-2">
          {requests.slice(0, 20).map((row) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-slate-950">{row.customer_name || row.name}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">طلب من: {row.created_by_name || "غير محدد"} · المسؤول: {responsibleOf(row)}</div>
                </div>
                <StatusBadge status={followupStatus(row)} />
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-600">{row.request_details || row.followup_reason || row.suggested_action || "طلب متابعة خدمة عملاء"}</div>
            </div>
          ))}
        </div>
      ) : <Empty text="لا توجد طلبات متابعة من الفريق في الفلاتر الحالية" />}
    </section>
  );
}

function CustomerAlertsPanel({ followups }: { followups: FollowupRow[] }) {
  const alerts = followups
    .filter((row) => row.needs_manager || isOverdueFollowup(row) || !isValidEgyptPhone(phoneOf(row), row.customer_code) || ["متوقف", "مهدد بالتوقف"].includes(customerStatusOf(row)) || ["stopped", "decreased"].includes(row.purchase_frequency_status || ""))
    .sort(compareFollowupPriority)
    .slice(0, 25);
  return (
    <section className="dawaa-panel">
      <h3 className="mb-3 text-base font-black text-slate-950">تنبيهات العملاء</h3>
      {alerts.length ? (
        <div className="space-y-2">
          {alerts.map((row) => {
            const critical = segmentOf(row) === "مهم جدًا" && (customerStatusOf(row) === "متوقف" || row.purchase_frequency_status === "stopped");
            return (
              <div key={row.id} className={`rounded-2xl border p-3 shadow-sm ${critical ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="font-black text-slate-950">{row.customer_name || row.name || "عميل"}</div>
                <div className="mt-1 text-xs font-bold text-slate-600">{normalizeBranchName(row.branch)} · {responsibleOf(row)} · {phoneDisplay(phoneOf(row), row.customer_code)}</div>
                <div className="mt-2 text-sm font-bold text-slate-700">{critical ? "عميل مهم جدًا يحتاج تدخل سريع" : recommendedAction(row.customer_metrics)}</div>
              </div>
            );
          })}
        </div>
      ) : <Empty text="لا توجد تنبيهات عملاء في الفلاتر الحالية" />}
    </section>
  );
}

function CustomerHistoryCenter({ followup }: { followup: FollowupRow | null }) {
  if (!followup) return <section className="dawaa-panel"><Empty text="اختر عميلًا لعرض سجل العلاقة الكامل" /></section>;
  return (
    <section className="dawaa-panel">
      <h3 className="mb-3 text-base font-black text-slate-950">سجل العميل الكامل</h3>
      <div className="grid gap-2 text-sm">
        <Info label="العميل" value={followup.customer_name || followup.name || "غير محدد"} />
        <Info label="الكود" value={followup.customer_code || "بدون"} />
        <Info label="الهاتف" value={phoneDisplay(phoneOf(followup), followup.customer_code)} />
        <Info label="الفرع" value={normalizeBranchName(followup.branch)} />
        <Info label="التصنيف والحالة" value={`${segmentOf(followup)} · ${customerStatusOf(followup)}`} />
        <Info label="إجمالي المشتريات" value={followup.customer_metrics ? formatMoney(followup.customer_metrics.total_spent) : "غير متاح"} />
        <Info label="متوسط شهري" value={avgMonthlyOf(followup) === null ? "غير متاح" : formatMoney(avgMonthlyOf(followup))} />
        <Info label="آخر شراء" value={formatDate(lastPurchaseOf(followup))} />
      </div>
      <div className="mt-3">
        <CustomerFlagsBadges customerFlags={followup.customer_flags} limit={8} compact />
      </div>
      {importantHandlingNote(followup) ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{importantHandlingNote(followup)}</div> : null}
      <div className="mt-3 rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold text-teal-800">
        {buildCustomerCareRecommendations(followup).join(" • ")}
      </div>
    </section>
  );
}

function metricFromCustomer(value: CustomerMetric | FollowupRow): CustomerMetric {
  if ("final_customer_key" in value && "avg_monthly" in value) return value as CustomerMetric;
  const row = value as FollowupRow;
  const metric = row.customer_metrics;
  return {
    id: metric?.id || row.customer_id || row.customer_code || row.id,
    final_customer_key: metric?.final_customer_key || row.customer_code || row.id,
    customer_id: row.customer_id || metric?.customer_id || null,
    customer_code: row.customer_code || metric?.customer_code || null,
    customer_name: row.customer_name || row.name || metric?.customer_name || null,
    customer_phone: phoneOf(row) || metric?.customer_phone || null,
    phone: phoneOf(row) || metric?.phone || null,
    name: row.customer_name || row.name || metric?.name || null,
    branch: normalizeBranchName(row.branch || metric?.branch),
    invoices_count: metric?.invoices_count || 0,
    total_spent: row.total_spent || metric?.total_spent || 0,
    total_purchases: metric?.total_purchases || row.total_spent || 0,
    avg_invoice: metric?.avg_invoice || 0,
    first_purchase: metric?.first_purchase || null,
    last_purchase: row.last_purchase_date || metric?.last_purchase || null,
    active_months: metric?.active_months || 0,
    avg_monthly: metric?.avg_monthly || 0,
    segment: segmentOf(row),
    type: segmentOf(row),
    customer_status: customerStatusOf(row),
    status: customerStatusOf(row),
    retention_status: customerStatusOf(row),
  };
}

function CustomerProfileModal({ customer, onClose }: { customer: CustomerMetric | FollowupRow; onClose: () => void }) {
  const metric = useMemo(() => metricFromCustomer(customer), [customer]);
  const [details, setDetails] = useState<CustomerFullProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");
    getCustomerFullProfile({
      customer_code: metric.customer_code,
      customer_id: metric.customer_id,
      final_customer_key: metric.final_customer_key,
      customer_phone: metric.customer_phone || metric.phone,
      customer_name: metric.customer_name || metric.name,
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch((err) => {
        if (!cancelled && !controller.signal.aborted) setError(err instanceof Error ? err.message : "تعذر تحميل ملف العميل");
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [metric]);

  const profile = details?.profile || {};
  const profileMetric = details?.metrics || metric;
  const displayPhone = details?.displayPhone || getBestCustomerPhone(
    { customer_code: metric.customer_code, customer_phone: metric.customer_phone, phone: metric.phone } as FollowupRow,
    profileMetric,
    profile as Record<string, unknown>,
  );
  const notes = [
    details?.notes.customerNotes,
    details?.notes.serviceNotes,
    details?.notes.teamNotes,
    details?.notes.handlingNotes,
    details?.notes.whatsappNotes,
    profile.customer_notes,
    profile.service_notes,
    profile.team_notes,
    profile.handling_notes,
    profile.whatsapp_notes,
    "notes" in customer ? customer.notes : "",
  ].filter(Boolean).join(" | ");

  return (
    <Modal title="ملف العميل الكامل" onClose={onClose}>
      <div className="space-y-4">
        {loading ? <LoadingPanel /> : null}
        {error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{error}</div> : null}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">{metric.customer_name || metric.name || "عميل بدون اسم"}</h3>
              <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                <span>كود: {metric.customer_code || "بدون كود"}</span>
                <span>هاتف: {displayPhone || "بدون رقم صحيح"}</span>
                <span>واتساب: {String(profile.whatsapp_phone || "غير متاح")}</span>
                <span>بديل: {String(profile.phone_alt || "غير متاح")}</span>
                <span>{normalizeBranchName(metric.branch)}</span>
              </div>
            </div>
            {displayPhone ? <a className="dawaa-button-primary px-4 py-2" href={generateWhatsAppLink(cleanEgyptianPhone(displayPhone), "أهلاً بحضرتك، مع حضرتك صيدليات دواء 🌿")} target="_blank" rel="noreferrer">واتساب</a> : null}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <SmallMetric label="التصنيف" value={metric.segment} />
            <SmallMetric label="الحالة" value={metric.customer_status} />
            <SmallMetric label="إجمالي المشتريات" value={formatMoney(metric.total_spent)} />
            <SmallMetric label="متوسط شهري" value={formatMoney(metric.avg_monthly)} />
            <SmallMetric label="متوسط الفاتورة" value={formatMoney(metric.avg_invoice)} />
            <SmallMetric label="عدد الفواتير" value={metric.invoices_count} />
            <SmallMetric label="أول شراء" value={formatDate(metric.first_purchase)} />
            <SmallMetric label="آخر شراء" value={formatDate(metric.last_purchase)} />
            <SmallMetric label="شراء الشهر الحالي" value={"purchase_count_current_month" in customer ? customer.purchase_count_current_month ?? "غير متاح" : "غير متاح"} />
            <SmallMetric label="متوسط مرات الشراء" value={"average_monthly_purchase_count" in customer ? customer.average_monthly_purchase_count ?? "غير متاح" : "غير متاح"} />
            <SmallMetric label="تكرار الشراء" value={"purchase_frequency_status" in customer ? customer.purchase_frequency_status || "غير متاح" : "غير متاح"} />
            <SmallMetric label="أشهر النشاط" value={metric.active_months} />
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="mb-2 font-black text-slate-950">العلامات والملاحظات</h4>
          <CustomerFlagsBadges customerFlags={(profile.customer_flags as Record<string, boolean> | null) || ("customer_flags" in customer ? customer.customer_flags : null)} limit={20} />
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{notes || "لا توجد ملاحظات مسجلة"}</p>
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 font-black text-slate-950">آخر 10 فواتير</h4>
            <div className="space-y-2">
              {details?.errorsBySection.latestInvoices ? <div className="mb-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">{details.errorsBySection.latestInvoices}</div> : null}
              {(details?.latestInvoices || []).slice(0, 10).map((invoice, index) => (
                <div key={`${invoice.invoice_number}-${index}`} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="font-bold text-slate-900">{invoice.invoice_number || "فاتورة"}</div>
                  <div className="text-xs text-slate-500">{formatDate(invoice.invoice_date)} · {formatMoney(invoice.amount)} · {invoice.seller_name || "غير محدد"}</div>
                </div>
              ))}
              {!details?.latestInvoices?.length && <Empty text="لا توجد فواتير متاحة أو تعذر تحميلها" />}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 font-black text-slate-950">آخر 10 متابعات</h4>
            <div className="space-y-2">
              {details?.errorsBySection.latestFollowups ? <div className="mb-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">{details.errorsBySection.latestFollowups}</div> : null}
              {(details?.latestFollowups || []).slice(0, 10).map((followup) => (
                <div key={followup.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="font-bold text-slate-900">{followup.followup_result || followup.status || "متابعة"}</div>
                  <div className="text-xs text-slate-500">{formatDate(followup.followup_date)} · {followup.responsible_name || followup.assigned_to || "غير محدد"}</div>
                  <div className="mt-1 text-xs text-slate-600">{followup.notes || "لا توجد ملاحظات"}</div>
                </div>
              ))}
              {!details?.latestFollowups?.length && <Empty text="لا توجد متابعات سابقة" />}
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
          <h4 className="mb-2 font-black text-teal-950">توصيات التواصل</h4>
          <ul className="space-y-1 text-sm font-bold text-teal-800">
            {buildCustomerCareRecommendations({
              ...("id" in customer ? customer : {}),
              customer_metrics: metric,
              customer_flags: (profile.customer_flags as Record<string, boolean> | null) || ("customer_flags" in customer ? customer.customer_flags : null),
            } as FollowupRow).map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

function ScriptPreviewPanel({ row, onLog = noopLog }: { row: FollowupRow | null; onLog?: (action: string, details: Record<string, unknown>) => void }) {
  const [scriptType, setScriptType] = useState<string>("");
  if (!row) return <section className="dawaa-panel"><Empty text="اختر متابعة لعرض سكريبت التواصل" /></section>;
  const phone = phoneOf(row);
  const hasValidPhone = Boolean(phone && isValidEgyptPhone(phone, row.customer_code));
  const selectedType = scriptType || chooseCustomerCareScriptType({
    segment: segmentOf(row),
    customerStatus: customerStatusOf(row),
    purchaseFrequencyStatus: row.purchase_frequency_status,
    flags: row.customer_flags,
    hasValidPhone,
  });
  const message = buildCustomerCareScript({
    customerName: row.customer_name || row.name,
    segment: segmentOf(row),
    customerStatus: customerStatusOf(row),
    purchaseFrequencyStatus: row.purchase_frequency_status,
    flags: row.customer_flags,
    followupReason: row.followup_reason,
    suggestedAction: row.suggested_action,
    branch: row.branch,
    responsibleName: responsibleOf(row),
    scriptType: selectedType as any,
    hasValidPhone,
  });
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    toast.success("تم نسخ السكريبت");
    onLog("whatsapp_message_copied", { followup_id: row.id, script_type: selectedType });
  };
  return (
    <section className="dawaa-panel">
      <h3 className="mb-3 text-base font-black text-slate-950">سكريبتات التواصل</h3>
      <select className="dawaa-input mb-3 w-full" value={selectedType} onChange={(event) => setScriptType(event.target.value)}>
        <option value="friendly_general">متابعة ودية عامة</option>
        <option value="vip">عميل مهم جدًا / VIP</option>
        <option value="stopped">عميل متوقف</option>
        <option value="reduced">عميل قلل شراءه</option>
        <option value="price_sensitive">حساس للسعر</option>
        <option value="no_substitutes">لا يفضل البدائل</option>
        <option value="complaint_manager">شكوى / يحتاج مدير</option>
        <option value="periodic_reminder">تذكير دوري</option>
        <option value="usage_explanation">شرح استخدام</option>
        <option value="data_completion">استكمال بيانات</option>
      </select>
      <div className="whitespace-pre-line rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-7 text-slate-700">{message}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="dawaa-button-primary px-4 py-2" onClick={copy}>نسخ الرسالة</button>
        {hasValidPhone ? <a className="btn-secondary px-4 py-2" target="_blank" rel="noopener noreferrer" href={generateWhatsAppLink(cleanEgyptianPhone(phone), message)} onClick={() => onLog("whatsapp_opened", { followup_id: row.id })}>فتح واتساب</a> : <span className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">لا يوجد رقم صحيح</span>}
      </div>
    </section>
  );
}

function buildCustomerCareRecommendations(row: FollowupRow) {
  const recommendations: string[] = [];
  if (!isValidEgyptPhone(phoneOf(row), row.customer_code)) recommendations.push("العميل بدون رقم صحيح، ابدأ باستكمال البيانات.");
  if (segmentOf(row) === "مهم جدًا") recommendations.push("ابدأ برسالة تقدير لأن العميل مهم جدًا.");
  if (customerStatusOf(row) === "متوقف") recommendations.push("العميل متوقف، اسأله بلطف عن سبب التوقف.");
  if (["stopped", "decreased"].includes(row.purchase_frequency_status || "")) recommendations.push("العميل قلل شراءه، راجع لو كان فيه مشكلة أو صنف ناقص.");
  if (row.customer_flags?.no_delivery) recommendations.push("لا تضف توصيل لهذا العميل.");
  if (row.customer_flags?.no_substitutes) recommendations.push("لا تقترح بدائل إلا بعد موافقة العميل.");
  if (row.customer_flags?.price_sensitive) recommendations.push("وضح السعر والقيمة قبل عرض الاختيارات.");
  if (row.customer_flags?.prefers_call) recommendations.push("يفضل الاتصال بدل واتساب.");
  if (row.needs_manager) recommendations.push("راجع آخر شكوى قبل التواصل.");
  recommendations.push("حدد متابعة قادمة حتى لا يسقط العميل.");
  return recommendations.slice(0, 5);
}

function ExceptionalFollowupModal({ branch, staffNames, userName, userId, onClose, onCreated, onProfile }: {
  branch: string;
  staffNames: string[];
  userName: string;
  userId: string;
  onClose: () => void;
  onCreated: (row: FollowupRow) => void;
  onProfile: (customer: CustomerMetric) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerServiceSearchResult[]>([]);
  const [selected, setSelected] = useState<CustomerMetric | null>(null);
  const [unregistered, setUnregistered] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    branch: branch || BRANCHES[0] || "",
    priority: "مهم",
    requestType: "متابعة استثنائية",
    reason: "",
    assignedDoctor: customerCareResponsibleForBranch(branch) || userName || "",
    followupDatetime: todayInput(),
    requestDetails: "",
    notes: "",
  });

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      setLoadingSearch(true);
      try {
        setResults(await searchCustomerMetrics(query, form.branch));
      } finally {
        setLoadingSearch(false);
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [form.branch, query]);

  const pickCustomer = (customer: CustomerMetric) => {
    const validPhone = getBestCustomerPhone(
      { customer_phone: customer.customer_phone, phone: customer.phone, customer_code: customer.customer_code },
      customer,
      null,
    );
    setSelected(customer);
    setUnregistered(false);
    setForm((current) => ({
      ...current,
      customerName: customer.customer_name || "",
      phone: validPhone || "",
      branch: customer.branch || current.branch,
      reason: recommendedAction(customer),
      assignedDoctor: customerCareResponsibleForBranch(customer.branch || current.branch) || current.assignedDoctor,
    }));
  };

  const submit = async () => {
    if (!form.customerName.trim()) {
      toast.error("اسم العميل مطلوب");
      return;
    }
    setSaving(true);
    try {
      const row = await createExceptionalFollowup({
        customer: selected,
        customerName: form.customerName,
        customerPhone: form.phone,
        branch: form.branch,
        priority: form.priority,
        requestType: form.requestType,
        followupReason: form.reason,
        assignedDoctor: form.assignedDoctor,
        followupDatetime: form.followupDatetime ? new Date(form.followupDatetime).toISOString() : null,
        requestDetails: form.requestDetails,
        notes: form.notes,
        createdBy: userId,
        createdByName: userName,
      });
      toast.success("تم إنشاء المتابعة الاستثنائية");
      onCreated(row);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر إنشاء المتابعة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="متابعة استثنائية" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="dawaa-input w-full pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث في customer_metrics_summary: احمد* أو *احمد* أو 010*" />
          </div>
          {loadingSearch && <div className="mt-2 text-sm font-bold text-slate-500">جاري البحث...</div>}
          {results.length > 0 && (
            <div className="mt-2 max-h-52 overflow-auto rounded-2xl border border-slate-200 bg-white">
              {results.map((customer) => (
                <div key={customer.id} className="border-b border-slate-100 p-3">
                  <div className="font-black text-slate-950">{customer.customer_name || "عميل بدون اسم"}</div>
                  <div className="text-xs font-bold text-slate-500">كود: {customer.customer_code || "بدون"} · هاتف: {phoneDisplay(customer.displayPhone || customer.customer_phone, customer.customer_code)} · {customer.segment} · {customer.customer_status}</div>
                  {!customer.hasTodayFollowup && <div className="mt-1 text-xs font-black text-amber-700">العميل موجود لكن لا توجد متابعة حالية</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => onProfile(customer)}>عرض ملف العميل</button>
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => pickCustomer(customer)}>إنشاء متابعة استثنائية</button>
                    {customer.displayPhone ? <a className="btn-secondary px-2 py-1 text-xs" href={generateWhatsAppLink(cleanEgyptianPhone(customer.displayPhone), "أهلاً بحضرتك، مع حضرتك صيدليات دواء 🌿")} target="_blank" rel="noreferrer">واتساب</a> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-700" onClick={() => { setSelected(null); setUnregistered(true); }}>
            عميل غير مسجل
          </button>
          {selected && <div className="mt-2 rounded-xl bg-teal-50 p-2 text-xs font-black text-teal-800">تم اختيار: {selected.customer_name} · {selected.segment} · {selected.customer_status}</div>}
          {unregistered && <div className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-black text-amber-800">عميل غير مسجل</div>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="اسم العميل"><input className="dawaa-input w-full" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
          <Field label="الهاتف"><input className="dawaa-input w-full" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="الفرع"><select className="dawaa-input w-full" value={form.branch} onChange={(e) => {
            const nextBranch = e.target.value;
            setForm({ ...form, branch: nextBranch, assignedDoctor: customerCareResponsibleForBranch(nextBranch) || form.assignedDoctor });
          }}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="الأولوية"><select className="dawaa-input w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITY_OPTIONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="نوع الطلب"><select className="dawaa-input w-full" value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value })}>{REQUEST_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="المسؤول"><select className="dawaa-input w-full" value={form.assignedDoctor} onChange={(e) => setForm({ ...form, assignedDoctor: e.target.value })}><option value="">غير محدد</option>{[...new Set([...CUSTOMER_CARE_RESPONSIBLES.map((item) => item.name), ...staffNames])].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="موعد المتابعة"><input type="datetime-local" className="dawaa-input w-full" value={form.followupDatetime} onChange={(e) => setForm({ ...form, followupDatetime: e.target.value })} /></Field>
          <Field label="سبب المتابعة"><input className="dawaa-input w-full" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
        <Field label="تفاصيل الطلب"><textarea className="dawaa-input min-h-24 w-full" value={form.requestDetails} onChange={(e) => setForm({ ...form, requestDetails: e.target.value })} /></Field>
        <Field label="ملاحظات"><textarea className="dawaa-input min-h-24 w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex gap-2">
          <button type="button" className="dawaa-button-primary flex-1" onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ المتابعة"}</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}

function DoctorFollowupRequestModal({ branch, staffNames, userName, userId, onClose, onCreated, onProfile }: {
  branch: string;
  staffNames: string[];
  userName: string;
  userId: string;
  onClose: () => void;
  onCreated: (row: FollowupRow) => void;
  onProfile: (customer: CustomerMetric) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerServiceSearchResult[]>([]);
  const [selected, setSelected] = useState<CustomerMetric | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch: branch || BRANCHES[0] || "",
    requestedBy: userName || "",
    priority: "مهم",
    reason: "تقدير عميل مهم",
    preferredContactMethod: "أي طريقة",
    personalityNote: "",
    followupDatetime: todayInput(),
    notes: "",
  });

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      setLoadingSearch(true);
      try {
        setResults(await searchCustomerMetrics(query, form.branch));
      } finally {
        setLoadingSearch(false);
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [form.branch, query]);

  const responsible = customerCareResponsibleForBranch(form.branch) || "خدمة العملاء";

  const submit = async () => {
    if (!selected) {
      toast.error("اختيار العميل مطلوب");
      return;
    }
    setSaving(true);
    try {
      const row = await createExceptionalFollowup({
        customer: selected,
        customerName: selected.customer_name || "عميل",
        customerPhone: phoneOf({
          id: selected.id,
          customer_code: selected.customer_code,
          customer_phone: selected.customer_phone,
          phone: selected.phone,
        } as FollowupRow),
        branch: form.branch || selected.branch,
        priority: form.priority,
        requestType: "doctor_requested_followup",
        followupReason: form.reason,
        assignedDoctor: responsible,
        followupDatetime: form.followupDatetime ? new Date(form.followupDatetime).toISOString() : null,
        requestDetails: `طلب من: ${form.requestedBy || userName || "غير محدد"} | طريقة مفضلة: ${form.preferredContactMethod} | ملاحظة شخصية: ${form.personalityNote || "لا توجد"}`,
        notes: form.notes,
        createdBy: userId,
        createdByName: form.requestedBy || userName,
      });
      await notifyCustomerServiceResponsible({
        title: "طلب متابعة جديد",
        message: `طلب متابعة جديد للعميل ${selected.customer_name || selected.customer_code} من ${form.requestedBy || userName}`,
        type: "followup",
        priority: form.priority === "عاجل" || form.priority === "مهم جدًا" ? "high" : "normal",
        branch: form.branch || selected.branch,
        target_type: "daily_followups",
        target_id: row.id,
        target_route: `/customer-service?followupId=${row.id}`,
        requires_action: true,
        created_by: userId,
        created_by_name: form.requestedBy || userName,
        metadata: {
          requested_by: form.requestedBy || userName,
          responsible_name: responsible,
          customer_code: selected.customer_code,
        },
      });
      toast.success("تم إنشاء طلب المتابعة");
      onCreated(row);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر إنشاء طلب المتابعة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="طلب متابعة خدمة عملاء" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="dawaa-input w-full pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف، مثال: *ا*س*لا*م" />
          </div>
          {loadingSearch && <div className="mt-2 text-sm font-bold text-slate-500">جاري البحث...</div>}
          {results.length > 0 && (
            <div className="mt-2 max-h-52 overflow-auto rounded-2xl border border-slate-200 bg-white">
              {results.map((customer) => (
                <div key={customer.id} className="border-b border-slate-100 p-3">
                  <div className="font-black text-slate-950">{customer.customer_name || "عميل بدون اسم"}</div>
                  <div className="text-xs font-bold text-slate-500">كود: {customer.customer_code || "بدون"} · هاتف: {phoneDisplay(customer.displayPhone || customer.customer_phone, customer.customer_code)} · {customer.segment} · {customer.customer_status}</div>
                  {!customer.hasTodayFollowup && <div className="mt-1 text-xs font-black text-amber-700">العميل موجود لكن لا توجد متابعة حالية</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => onProfile(customer)}>عرض ملف العميل</button>
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => {
                      setSelected(customer);
                      setForm((current) => ({ ...current, branch: customer.branch || current.branch }));
                    }}>طلب متابعة خدمة عملاء</button>
                    {customer.displayPhone ? <a className="btn-secondary px-2 py-1 text-xs" href={generateWhatsAppLink(cleanEgyptianPhone(customer.displayPhone), "أهلاً بحضرتك، مع حضرتك صيدليات دواء 🌿")} target="_blank" rel="noreferrer">واتساب</a> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {selected && <div className="mt-2 rounded-xl bg-teal-50 p-2 text-xs font-black text-teal-800">تم اختيار: {selected.customer_name} · المسؤول: {customerCareResponsibleForBranch(form.branch) || "غير محدد"}</div>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="الفرع"><select className="dawaa-input w-full" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="الطبيب/الموظف الطالب"><input className="dawaa-input w-full" value={form.requestedBy} onChange={(e) => setForm({ ...form, requestedBy: e.target.value })} list="staff-names" /><datalist id="staff-names">{staffNames.map((name) => <option key={name} value={name} />)}</datalist></Field>
          <Field label="مسؤول خدمة العملاء"><input className="dawaa-input w-full" value={responsible} readOnly /></Field>
          <Field label="الأولوية"><select className="dawaa-input w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["عادي", "مهم", "عاجل", "مهم جدًا"].map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="سبب المتابعة"><select className="dawaa-input w-full" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{["تقدير عميل مهم", "عميل محتاج متابعة", "شكوى", "صنف ناقص", "طلب خاص", "استكمال بيانات", "متابعة بعد زيارة الفرع", "أخرى"].map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="طريقة التواصل المفضلة"><select className="dawaa-input w-full" value={form.preferredContactMethod} onChange={(e) => setForm({ ...form, preferredContactMethod: e.target.value })}>{["واتساب", "اتصال", "أي طريقة"].map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="موعد المتابعة"><input type="datetime-local" className="dawaa-input w-full" value={form.followupDatetime} onChange={(e) => setForm({ ...form, followupDatetime: e.target.value })} /></Field>
          <Field label="ملاحظة شخصية"><input className="dawaa-input w-full" value={form.personalityNote} onChange={(e) => setForm({ ...form, personalityNote: e.target.value })} placeholder="حساس للسعر، لا يحب البدائل..." /></Field>
        </div>
        <Field label="ملاحظات"><textarea className="dawaa-input min-h-24 w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex gap-2">
          <button type="button" className="dawaa-button-primary flex-1" onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : "إرسال طلب المتابعة"}</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}

function ResultModal({ row, userId, onClose, onSaved }: { row: FollowupRow; userId: string; onClose: () => void; onSaved: (row: FollowupRow) => void }) {
  const [saving, setSaving] = useState(false);
  const phone = phoneOf(row);
  const hasValidPhone = phone && isValidEgyptPhone(phone, row.customer_code);
  const activeFlags = getActiveCustomerFlags(row.customer_flags);
  const handlingNote = importantHandlingNote(row);
  const script = buildCustomerCareScript({
    customerName: row.customer_name || row.name,
    segment: segmentOf(row),
    customerStatus: customerStatusOf(row),
    purchaseFrequencyStatus: row.purchase_frequency_status,
    flags: row.customer_flags,
    followupReason: row.followup_reason,
    suggestedAction: row.suggested_action,
    branch: row.branch,
    responsibleName: responsibleOf(row),
    hasValidPhone: Boolean(hasValidPhone),
  });
  const [form, setForm] = useState({
    contact_method: row.contact_method || "اتصال",
    contact_status: row.contact_status || "تم التواصل",
    followup_result: row.followup_result || "",
    followup_summary: row.followup_summary || "",
    followup_notes: row.followup_notes || "",
    purchase_after_followup: Boolean(row.purchase_after_followup),
    purchase_amount: String(row.purchase_amount || ""),
    purchase_invoice_no: row.purchase_invoice_no || "",
    purchase_date: row.purchase_date || new Date().toISOString().slice(0, 10),
    next_followup_date: row.next_followup_date || "",
    quality_rating: String(row.quality_rating || ""),
    customer_satisfaction: row.customer_satisfaction || "",
    needs_manager: Boolean(row.needs_manager),
    response_status: row.response_status || "",
  });
  const save = async (quickStatus?: string) => {
    const status = quickStatus || form.contact_status || "تم";
    const isCompleted = !["لم يرد", "مؤجل"].includes(status);
    if (isCompleted && !form.followup_result.trim() && !form.followup_summary.trim()) {
      toast.error("سجل نتيجة أو ملخص المتابعة قبل إغلاقها");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateFollowupResult(row.id, {
        contact_method: form.contact_method,
        contact_status: status,
        contact_result: form.followup_result || status,
        followup_result: form.followup_result || status,
        followup_summary: form.followup_summary,
        followup_notes: form.followup_notes,
        purchase_after_followup: form.purchase_after_followup,
        purchase_amount: form.purchase_after_followup ? Number(form.purchase_amount || 0) : null,
        purchase_invoice_no: form.purchase_after_followup ? form.purchase_invoice_no || null : null,
        purchase_date: form.purchase_after_followup ? form.purchase_date || null : null,
        next_followup_date: form.next_followup_date || null,
        quality_rating: form.quality_rating ? Number(form.quality_rating) : null,
        customer_satisfaction: form.customer_satisfaction || null,
        needs_manager: form.needs_manager || status === "يحتاج مدير",
        response_status: form.response_status || status,
        completed_at: status === "لم يرد" || status === "مؤجل" ? null : new Date().toISOString(),
        status,
        followup_status: status,
        updated_by: userId || null,
      });
      toast.success("تم حفظ نتيجة المتابعة");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ النتيجة");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`تسجيل نتيجة: ${row.customer_name || "عميل"}`} onClose={onClose}>
      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 text-sm font-black text-slate-700">معلومات العميل</h3>
        <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
          <span>الكود: {row.customer_code || "بدون"}</span>
          <span>الهاتف: {phoneDisplay(phone, row.customer_code)}</span>
          <span>الفرع: {normalizeBranchName(row.branch)}</span>
          <span>مسؤول خدمة العملاء: {responsibleOf(row)}</span>
          <span>التصنيف: {segmentOf(row)}</span>
          <span>الحالة: {customerStatusOf(row)}</span>
          <span>متوسط شهري: {avgMonthlyOf(row) === null ? "غير متاح" : formatMoney(avgMonthlyOf(row))}</span>
          <span>تحذير التكرار: {row.purchase_frequency_status || "غير متاح"}</span>
        </div>
        <div className="mt-3 whitespace-pre-line rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-bold leading-5 text-teal-800">
          سكريبت مقترح: {script}
        </div>
        {activeFlags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <CustomerFlagsBadges customerFlags={row.customer_flags} limit={5} compact />
          </div>
        )}
        {handlingNote ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
            تنبيهات التعامل مع العميل: {handlingNote}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="طريقة التواصل"><select className="dawaa-input w-full" value={form.contact_method} onChange={(e) => setForm({ ...form, contact_method: e.target.value })}>{CONTACT_METHODS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="حالة التواصل"><select className="dawaa-input w-full" value={form.contact_status} onChange={(e) => setForm({ ...form, contact_status: e.target.value })}>{["تم التواصل", "لم يرد", "مؤجل", "يحتاج مدير", "تم الشراء بعد المتابعة"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="نتيجة المتابعة"><input className="dawaa-input w-full" value={form.followup_result} onChange={(e) => setForm({ ...form, followup_result: e.target.value })} /></Field>
        <Field label="ملخص المتابعة"><input className="dawaa-input w-full" value={form.followup_summary} onChange={(e) => setForm({ ...form, followup_summary: e.target.value })} /></Field>
        <Field label="تقييم الجودة"><input type="number" min="1" max="5" className="dawaa-input w-full" value={form.quality_rating} onChange={(e) => setForm({ ...form, quality_rating: e.target.value })} /></Field>
        <Field label="رضا العميل"><select className="dawaa-input w-full" value={form.customer_satisfaction} onChange={(e) => setForm({ ...form, customer_satisfaction: e.target.value })}><option value="">غير محدد</option><option>راضٍ</option><option>محايد</option><option>غير راضٍ</option></select></Field>
        <Field label="تاريخ المتابعة القادمة"><input type="date" className="dawaa-input w-full" value={form.next_followup_date} onChange={(e) => setForm({ ...form, next_followup_date: e.target.value })} /></Field>
        <Field label="حالة الرد"><input className="dawaa-input w-full" value={form.response_status} onChange={(e) => setForm({ ...form, response_status: e.target.value })} /></Field>
      </div>
      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm font-black text-slate-700">
          <input type="checkbox" checked={form.purchase_after_followup} onChange={(e) => setForm({ ...form, purchase_after_followup: e.target.checked })} />
          تم الشراء بعد المتابعة
        </label>
        {form.purchase_after_followup && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input className="dawaa-input w-full" placeholder="قيمة الشراء" value={form.purchase_amount} onChange={(e) => setForm({ ...form, purchase_amount: e.target.value })} />
            <input className="dawaa-input w-full" placeholder="رقم الفاتورة" value={form.purchase_invoice_no} onChange={(e) => setForm({ ...form, purchase_invoice_no: e.target.value })} />
            <input type="date" className="dawaa-input w-full" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
          </div>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-black text-red-700">
        <input type="checkbox" checked={form.needs_manager} onChange={(e) => setForm({ ...form, needs_manager: e.target.checked })} />
        يحتاج مدير
      </label>
      <Field label="ملاحظات المتابعة"><textarea className="dawaa-input min-h-24 w-full" value={form.followup_notes} onChange={(e) => setForm({ ...form, followup_notes: e.target.value })} /></Field>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        <button className="dawaa-button-primary" disabled={saving} onClick={() => save()}>حفظ النتيجة</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save("تم التواصل")}>تم التواصل</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save("لم يرد")}>لم يرد</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save("مؤجل")}>تأجيل</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save("يحتاج مدير")}>يحتاج مدير</button>
      </div>
    </Modal>
  );
}

function PostponeModal({ row, userId, onClose, onSaved }: { row: FollowupRow; userId: string; onClose: () => void; onSaved: (row: FollowupRow) => void }) {
  const [custom, setCustom] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const optionDate = (kind: string) => {
    const date = new Date();
    if (kind === "tonight") date.setHours(21, 0, 0, 0);
    if (kind === "tomorrow") { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); }
    if (kind === "twoDays") { date.setDate(date.getDate() + 2); date.setHours(9, 0, 0, 0); }
    return date.toISOString();
  };
  const save = async (date: string) => {
    setSaving(true);
    try {
      const updated = await updateFollowupResult(row.id, {
        status: "مؤجل",
        followup_status: "مؤجل",
        contact_status: "مؤجل",
        postponed_until: date,
        updated_by: userId || null,
      });
      toast.success("تم تأجيل المتابعة");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر التأجيل");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="تأجيل المتابعة" onClose={onClose}>
      <div className="grid gap-2">
        <button className="btn-secondary" disabled={saving} onClick={() => save(optionDate("tonight"))}>الليلة الساعة 9 مساءً</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save(optionDate("tomorrow"))}>بكرة الساعة 9 صباحًا</button>
        <button className="btn-secondary" disabled={saving} onClick={() => save(optionDate("twoDays"))}>بعد يومين الساعة 9 صباحًا</button>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <Field label="اختيار تاريخ ووقت"><input type="datetime-local" className="dawaa-input w-full" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>
          <button className="dawaa-button-primary mt-3 w-full" disabled={saving} onClick={() => save(new Date(custom).toISOString())}>حفظ التأجيل</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEscapeKey(onClose, true);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-4xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <h2 className="text-xl font-black text-slate-950">{title}</h2>
          <button className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-black text-slate-700"><span className="mb-1 block">{label}</span>{children}</label>;
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-bold text-slate-500">{label}</span><span className="font-black text-slate-900">{value}</span></div>;
}

function SmallMetric({ label, value, danger = false }: { label: string; value: ReactNode; danger?: boolean }) {
  return <div className={`rounded-2xl border p-3 ${danger ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-teal-50 text-teal-700"}`}><div className="text-xs font-bold">{label}</div><div className="mt-1 text-xl font-black">{value}</div></div>;
}

function LoadingPanel() {
  return <div className="dawaa-panel flex items-center justify-center gap-2 p-8 text-sm font-black text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-teal-600" /> جاري تحميل المتابعات...</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">{text}</div>;
}
