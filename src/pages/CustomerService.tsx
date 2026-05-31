import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  HeadphonesIcon,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShoppingBag,
  UserRound,
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
  type FollowupPerformanceRow,
  type FollowupResultPayload,
  type FollowupRow,
} from "@/lib/api/customerServiceCommandCenter";
import { buildCustomerServiceWhatsAppMessage } from "@/lib/whatsappTemplates";
import { cleanEgyptianPhone, generateWhatsAppLink } from "@/lib/whatsapp";
import { normalizeBranchName } from "@/lib/branch";
import { BRANCHES } from "@/lib/constants";
import { logActivity } from "@/lib/activityLog";

const STATUS_OPTIONS = [ALL_FILTER, "معلق", "تم", "لم يرد", "مؤجل", "متأخرة", "يحتاج مدير", "تم الشراء بعد المتابعة"];
const PRIORITY_OPTIONS = ["عاجل", "مهم", "متوسط", "عادي"];
const REQUEST_TYPES = ["متابعة استثنائية", "شكوى", "طلب ناقص", "مشكلة توصيل", "طلب خاص", "استرجاع عميل"];
const CONTACT_METHODS = ["اتصال", "واتساب", "رسالة", "زيارة"];

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
  return row.responsible_name || row.assigned_to || row.assigned_doctor || "غير محدد";
}

function phoneOf(row: FollowupRow) {
  return row.customer_phone || row.phone || "";
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
  const [selectedFollowup, setSelectedFollowup] = useState<FollowupRow | null>(null);
  const [selectedResponsible, setSelectedResponsible] = useState<string>(ALL_FILTER);
  const [staffNames, setStaffNames] = useState<string[]>([]);

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

  const loadFollowups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchCustomerServiceFollowups({
        branch: branchFilter,
        status: statusFilter,
        responsible: responsibleFilter,
        search: debouncedSearch,
      });
      const visibleRows = manager
        ? rows
        : rows.filter((row) => [row.assigned_to, row.responsible_name, row.assigned_doctor].filter(Boolean).includes(user?.name || ""));
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
  const teamPerformance = useMemo(() => calculateTeamPerformance(followups), [followups]);
  const responsibleOptions = useMemo(() => {
    const fromRows = followups.map(responsibleOf).filter((name) => name !== "غير محدد");
    return [ALL_FILTER, ...new Set([...staffNames, ...fromRows])];
  }, [followups, staffNames]);

  const grouped = useMemo(() => {
    const groups = [
      { label: "مهم جدًا", rows: [] as FollowupRow[] },
      { label: "مهم", rows: [] as FollowupRow[] },
      { label: "متوسط", rows: [] as FollowupRow[] },
      { label: "مهدد بالتوقف", rows: [] as FollowupRow[] },
      { label: "متوقف", rows: [] as FollowupRow[] },
      { label: "طلبات خاصة", rows: [] as FollowupRow[] },
      { label: "يحتاج مدير", rows: [] as FollowupRow[] },
    ];
    for (const row of followups) {
      const segment = segmentOf(row);
      const status = customerStatusOf(row);
      if (row.needs_manager || followupStatus(row) === "يحتاج مدير") groups[6].rows.push(row);
      else if (row.request_type || row.request_details) groups[5].rows.push(row);
      else if (status === "متوقف") groups[4].rows.push(row);
      else if (status === "مهدد بالتوقف") groups[3].rows.push(row);
      else if (segment === "متوسط") groups[2].rows.push(row);
      else if (segment === "مهم") groups[1].rows.push(row);
      else if (segment === "مهم جدًا") groups[0].rows.push(row);
      else groups[2].rows.push(row);
    }
    return groups.filter((group) => group.rows.length);
  }, [followups]);

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

  const safeLog = async (action: string, details: Record<string, unknown>) => {
    try {
      await logActivity({
        action,
        description: action,
        target_type: "daily_followups",
        details,
        route_path: "/customer-service",
        user_id: user?.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: branchFilter === ALL_FILTER ? undefined : branchFilter,
      });
    } catch {
      // Activity logging should never block operational followups.
    }
  };

  const quickUpdate = async (row: FollowupRow, payload: FollowupResultPayload, success: string) => {
    try {
      const updated = await updateFollowupResult(row.id, { ...payload, updated_by: user?.id || user?.name || null });
      setFollowups((items) => items.map((item) => item.id === updated.id ? updated : item));
      setSelectedFollowup((current) => current?.id === updated.id ? updated : current);
      toast.success(success);
      await safeLog(success, { followup_id: updated.id, customer_name: updated.customer_name });
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

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="إجمالي متابعات اليوم" value={stats.totalToday} tone="blue" />
        <Kpi label="تمت" value={stats.completed} tone="emerald" />
        <Kpi label="لم يرد" value={stats.noAnswer} tone="amber" />
        <Kpi label="مؤجلة" value={stats.postponed} tone="blue" />
        <Kpi label="متأخرة" value={stats.overdue} tone="red" />
        <Kpi label="يحتاج مدير" value={stats.needsManager} tone="red" />
        <Kpi label="شراء بعد المتابعة" value={stats.purchaseAfterCount} tone="emerald" />
        <Kpi label="قيمة الشراء بعد المتابعة" value={formatMoney(stats.purchaseAfterAmount)} tone="teal" />
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="ml-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.45fr_.85fr]">
        <div className="space-y-4">
          <SectionTitle icon={HeadphonesIcon} title="قائمة المتابعات الذكية" subtitle="مجمعة حسب الأولوية والحالة من daily_followups و customer_metrics_summary" />
          {loading ? <LoadingPanel /> : grouped.length ? grouped.map((group) => (
            <FollowupGroup
              key={group.label}
              title={group.label}
              rows={group.rows}
              onSelect={setSelectedFollowup}
              onResult={setResultFollowup}
              onPostpone={setPostponeFollowup}
              onQuickUpdate={quickUpdate}
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
      </section>

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
            safeLog("إنشاء متابعة استثنائية", { followup_id: row.id, customer_name: row.customer_name });
          }}
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
            safeLog("تسجيل نتيجة متابعة", { followup_id: updated.id, result: updated.followup_result });
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
            safeLog("تأجيل متابعة", { followup_id: updated.id, postponed_until: updated.postponed_until });
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone: "blue" | "emerald" | "amber" | "red" | "teal" }) {
  const classes = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    teal: "border-teal-200 bg-teal-50 text-teal-700",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${classes[tone]}`}>
      <div className="num text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-black">{label}</div>
    </div>
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
}: {
  title: string;
  rows: FollowupRow[];
  selectedId?: string;
  onSelect: (row: FollowupRow) => void;
  onResult: (row: FollowupRow) => void;
  onPostpone: (row: FollowupRow) => void;
  onQuickUpdate: (row: FollowupRow, payload: FollowupResultPayload, success: string) => void;
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
          />
        ))}
      </div>
    </section>
  );
}

function FollowupCard({ row, active, onSelect, onResult, onPostpone, onQuickUpdate }: {
  row: FollowupRow;
  active: boolean;
  onSelect: () => void;
  onResult: () => void;
  onPostpone: () => void;
  onQuickUpdate: (row: FollowupRow, payload: FollowupResultPayload, success: string) => void;
}) {
  const phone = phoneOf(row);
  const cleanPhone = cleanEgyptianPhone(phone);
  const message = buildCustomerServiceWhatsAppMessage({
    customerName: row.customer_name || row.name,
    staffName: responsibleOf(row),
    branch: row.branch,
    reason: row.followup_reason || row.suggested_action || row.request_type,
  });
  const wa = cleanPhone ? generateWhatsAppLink(cleanPhone, message) : "";
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${active ? "border-teal-300 ring-2 ring-teal-100" : "border-slate-200"}`} onClick={onSelect}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-black text-slate-950">{row.customer_name || row.name || "عميل بدون اسم"}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span>كود: {row.customer_code || "بدون كود"}</span>
            <span>هاتف: {phone || "لا يوجد"}</span>
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
        <span>المسؤول: {responsibleOf(row)}</span>
        <span>الموعد: {formatDateTime(row.followup_datetime || row.followup_date)}</span>
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
        {row.suggested_action || row.followup_reason || row.request_details || "تواصل مع العميل وسجل نتيجة المتابعة."}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
        <a href={wa || undefined} target="_blank" rel="noopener noreferrer" className={`btn-secondary inline-flex items-center gap-1 px-3 py-2 ${!wa ? "pointer-events-none opacity-50" : ""}`} title={wa ? "فتح واتساب" : "لا يوجد رقم هاتف"}>
          <MessageSquare size={14} /> واتساب
        </a>
        {cleanPhone ? <a href={`tel:${cleanPhone}`} className="btn-secondary inline-flex items-center gap-1 px-3 py-2"><PhoneCall size={14} /> اتصال</a> : null}
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
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold leading-6 text-teal-800">
            {recommendedAction(customer)}
          </div>
        </div>
      ) : <Empty text="اختر متابعة لعرض القرار المقترح" />}
    </section>
  );
}

function ExceptionalFollowupModal({ branch, staffNames, userName, userId, onClose, onCreated }: {
  branch: string;
  staffNames: string[];
  userName: string;
  userId: string;
  onClose: () => void;
  onCreated: (row: FollowupRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerMetric[]>([]);
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
    assignedDoctor: userName || "",
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
    setSelected(customer);
    setUnregistered(false);
    setForm((current) => ({
      ...current,
      customerName: customer.customer_name || "",
      phone: customer.customer_phone || "",
      branch: customer.branch || current.branch,
      reason: recommendedAction(customer),
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
                <button key={customer.id} type="button" className="block w-full border-b border-slate-100 p-3 text-right hover:bg-teal-50" onClick={() => pickCustomer(customer)}>
                  <div className="font-black text-slate-950">{customer.customer_name || "عميل بدون اسم"}</div>
                  <div className="text-xs font-bold text-slate-500">كود: {customer.customer_code || "بدون"} · هاتف: {customer.customer_phone || "بدون"} · {customer.segment} · {customer.customer_status}</div>
                </button>
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
          <Field label="الفرع"><select className="dawaa-input w-full" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="الأولوية"><select className="dawaa-input w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITY_OPTIONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="نوع الطلب"><select className="dawaa-input w-full" value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value })}>{REQUEST_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="المسؤول"><select className="dawaa-input w-full" value={form.assignedDoctor} onChange={(e) => setForm({ ...form, assignedDoctor: e.target.value })}><option value="">غير محدد</option>{staffNames.map((x) => <option key={x}>{x}</option>)}</select></Field>
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

function ResultModal({ row, userId, onClose, onSaved }: { row: FollowupRow; userId: string; onClose: () => void; onSaved: (row: FollowupRow) => void }) {
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    try {
      const status = quickStatus || form.contact_status || "تم";
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
