import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  clearTodayTrialFollowups,
  createDailyFollowup,
  generateTodayFollowups,
  getFollowupHistory,
  getTodayFollowups,
  updateFollowupStatus,
} from "@/lib/api/followups";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import {
  getScript,
  SCRIPT_OPTIONS,
  type ScriptKey,
} from "@/lib/followupScripts";
import {
  cleanEgyptianPhone,
  copyText,
  displayEgyptianPhone,
  generateWhatsAppLink,
} from "@/lib/whatsapp";
import { logActivity } from "@/lib/activityLog";
import { selectableStaffChoices } from "@/lib/staffFallback";
import { normalizeBranchName as displayBranch, branchMatches } from "@/lib/branch";
import FollowupResultForm from "@/components/followups/FollowupResultForm";
import { toast } from "sonner";
import type { DailyFollowup } from "@/types/database";

interface StaffOption {
  id: string;
  name: string;
  role: string;
  branch: string;
}

const NOTE_LABELS = {
  category: ["الفئة", "Ø§Ù„ÙØ¦Ø©"],
  action: ["المطلوب", "Ø§Ù„Ù…Ø·Ù„ÙˆØ¨"],
  script: ["السكريبت المقترح", "Ø§Ù„Ø³ÙƒØ±ÙŠØ¨Øª Ø§Ù„Ù…Ù‚ØªØ±Ø­"],
  assignee: [
    "الدكتور الأنسب للمتابعة",
    "Ø§Ù„Ø¯ÙƒØªÙˆØ± Ø§Ù„Ø£Ù†Ø³Ø¨ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©",
  ],
  avgMonthly: ["متوسط شهري", "Ù…ØªÙˆØ³Ø· Ø´Ù‡Ø±ÙŠ"],
  lastPurchase: ["آخر شراء", "Ø¢Ø®Ø± Ø´Ø±Ø§Ø¡"],
  firstPurchase: ["أول شراء", "Ø£ÙˆÙ„ Ø´Ø±Ø§Ø¡"],
};

function readNoteValue(
  notes: string | null | undefined,
  labels: string | string[],
) {
  const allLabels = Array.isArray(labels) ? labels : [labels];
  const lines = (notes || "").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    for (const label of allLabels) {
      if (trimmed.startsWith(`${label}:`))
        return trimmed.split(":").slice(1).join(":").trim();
    }
  }

  return "";
}

function followupCategory(followup: DailyFollowup) {
  return (
    followup.category ||
    readNoteValue(followup.notes, NOTE_LABELS.category) ||
    "متابعة"
  );
}

function suggestedAction(followup: DailyFollowup) {
  return (
    followup.suggested_action ||
    readNoteValue(followup.notes, NOTE_LABELS.action) ||
    "تواصل مع العميل وسجل نتيجة المتابعة."
  );
}

function assignedDoctor(followup: DailyFollowup | null) {
  if (!followup) return "غير محدد";
  return (
    followup.assigned_to ||
    readNoteValue(followup.notes, NOTE_LABELS.assignee) ||
    "غير محدد"
  );
}

function scriptKeyFromCategory(category: string): ScriptKey {
  if (/vip|مهم جدًا|مهم جدا|Ø¬Ø¯/.test(category)) return "vip";
  if (/مهم|Ù…Ù‡Ù…/.test(category)) return "important";
  if (/متوسط|Ù…ØªÙˆØ³Ø·/.test(category)) return "medium";
  if (/متوقف|Ù…ØªÙˆÙ‚Ù/.test(category)) return "stopped";
  return "at_risk";
}

function suggestedScript(followup: DailyFollowup) {
  const stored = readNoteValue(followup.notes, NOTE_LABELS.script);
  if (stored) return stored;

  return getScript(
    scriptKeyFromCategory(followupCategory(followup)),
    undefined,
    {
      customerName: followup.customer_name || "",
      staffName: assignedDoctor(followup),
      branchName: followup.branch || "",
    },
  );
}

function statusClass(status?: string | null) {
  if (
    !status ||
    status === "pending" ||
    status === "معلق" ||
    status.includes("Ù…Ø¹Ù„Ù‚")
  )
    return "badge-info";
  if (
    status.includes("تم") ||
    status.includes("مهتم") ||
    status.includes("طلب أوردر")
  )
    return "badge-success";
  if (
    status.includes("شكوى") ||
    status.includes("رفض") ||
    status.includes("غير صحيح")
  )
    return "badge-danger";
  return "badge-info";
}

function displayStatus(status?: string | null) {
  if (!status || status === "pending") return "معلق";
  if (status.includes("Ù…Ø¹Ù„Ù‚")) return "معلق";
  return status;
}



function followupSummary(row: DailyFollowup) {
  return (
    row.followup_summary ||
    readNoteValue(row.notes, ["ملخص ما حدث", "ملخص المتابعة", "summary"]) ||
    suggestedAction(row)
  );
}

function followupResult(row: DailyFollowup) {
  return (
    row.followup_result ||
    readNoteValue(row.notes, ["رد فعل العميل", "نتيجة المتابعة", "result"]) ||
    displayStatus(row.status)
  );
}

function contactMethod(row: DailyFollowup) {
  return (
    row.contact_method ||
    readNoteValue(row.notes, ["قناة التواصل", "طريقة التواصل", "method"]) ||
    "غير محدد"
  );
}

function requestDetails(row: DailyFollowup) {
  return (
    row.request_details ||
    readNoteValue(row.notes, ["طلب العميل", "تفاصيل الطلب", "ملاحظات"]) ||
    "لا يوجد طلب محدد مسجل"
  );
}

function dateLabel(value?: string | null) {
  if (!value) return "غير محدد";
  try {
    return formatDate(value);
  } catch {
    return String(value).slice(0, 10);
  }
}

function customerCodeOf(row: DailyFollowup) {
  return String(row.customer_code || "").trim();
}

function customerPhoneOf(row: DailyFollowup) {
  return String(row.customer_phone || row.phone || "").trim();
}

function lastPurchaseOf(row: DailyFollowup) {
  return row.last_purchase_date || readNoteValue(row.notes, NOTE_LABELS.lastPurchase) || "";
}

function currentPurchaseCountOf(row: DailyFollowup) {
  return Number(row.purchase_count_current_month ?? 0) || 0;
}

function averagePurchaseCountOf(row: DailyFollowup) {
  const direct = Number(row.average_monthly_purchase_count ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromNotes = Number(readNoteValue(row.notes, NOTE_LABELS.avgMonthly) || 0);
  return Number.isFinite(fromNotes) ? fromNotes : 0;
}

function wildcardMatch(value: unknown, query: string) {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const text = String(value ?? "").toLowerCase();
  const pattern = raw
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern || ".*").test(text);
}

function followupMatchesSearch(row: DailyFollowup, query: string) {
  return [
    row.customer_name,
    customerCodeOf(row),
    customerPhoneOf(row),
    cleanEgyptianPhone(customerPhoneOf(row)),
    row.branch,
    row.category,
    row.status,
    row.followup_status,
    row.contact_result,
    row.responsible_name,
    row.assigned_to,
  ].some((value) => wildcardMatch(value, query));
}

export default function CustomerService() {
  const [followups, setFollowups] = useState<DailyFollowup[]>([]);
  const [selected, setSelected] = useState<DailyFollowup | null>(null);
  const [customer360, setCustomer360] = useState<DailyFollowup | null>(null);
  const [followupSearch, setFollowupSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [clearingTrial, setClearingTrial] = useState(false);
  const [bulkDoctor, setBulkDoctor] = useState("");
  const [shamyDoctor, setShamyDoctor] = useState("");
  const [shokryDoctor, setShokryDoctor] = useState("");
  const [scriptKey, setScriptKey] = useState<ScriptKey>("medium");
  const [history, setHistory] = useState<DailyFollowup[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyBranch, setHistoryBranch] = useState("all");
  const [showExceptional, setShowExceptional] = useState(false);
  const [exceptionalSaving, setExceptionalSaving] = useState(false);
  const [exceptionalForm, setExceptionalForm] = useState({
    customerName: "",
    customerCode: "",
    customerPhone: "",
    branch: "فرع شكري",
    assignedTo: "",
    type: "متابعة استثنائية",
    priority: "مهم",
    reason: "",
    requestType: "",
    requestDetails: "",
    nextFollowupDate: "",
  });
  const { user } = useAuth();
  const { data: staff } = useSupabaseQuery<StaffOption>({
    table: "staff",
    realtimeEnabled: false,
  });

  const staffChoices = useMemo(
    () => selectableStaffChoices(staff as unknown as Record<string, unknown>[]),
    [staff],
  );
  const doctors = useMemo(
    () =>
      staffChoices.filter(
        (item) =>
          item.name.includes("د/") ||
          /صيدلي|صيدلاني|دكتور|doctor|pharmacist/i.test(item.role),
      ),
    [staffChoices],
  );

  const loadFollowups = async () => {
    setLoading(true);
    try {
      const data = await getTodayFollowups();
      setFollowups(data);
      setSelected((current) =>
        current
          ? data.find((item) => item.id === current.id) || current
          : data[0] || null,
      );
    } catch (error) {
      toast.error(`تعذر تحميل قائمة المتابعة: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };


  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await getFollowupHistory({ limit: 700, status: historyStatus });
      setHistory(data);
    } catch (error) {
      toast.error(`تعذر تحميل سجل المتابعات: ${(error as Error).message}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleCreateExceptional = async () => {
    if (!exceptionalForm.customerName.trim()) {
      toast.error("اكتب اسم العميل أولًا");
      return;
    }
    if (!exceptionalForm.reason.trim()) {
      toast.error("اكتب سبب المتابعة الاستثنائية");
      return;
    }

    setExceptionalSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const notes = [
        "متابعة استثنائية من خدمة العملاء",
        `نوع المتابعة: ${exceptionalForm.type}`,
        `الأولوية: ${exceptionalForm.priority}`,
        `سبب المتابعة: ${exceptionalForm.reason}`,
        `المطلوب: ${exceptionalForm.reason}`,
        exceptionalForm.requestType ? `نوع طلب العميل: ${exceptionalForm.requestType}` : "",
        exceptionalForm.requestDetails ? `تفاصيل الطلب: ${exceptionalForm.requestDetails}` : "",
        exceptionalForm.nextFollowupDate ? `المتابعة القادمة: ${exceptionalForm.nextFollowupDate}` : "",
        `تم الإنشاء بواسطة: ${user?.name || "غير محدد"}`,
      ].filter(Boolean).join("\n");

      const created = await createDailyFollowup({
        customer_id: exceptionalForm.customerCode || exceptionalForm.customerPhone || exceptionalForm.customerName,
        customer_code: exceptionalForm.customerCode || null,
        customer_name: exceptionalForm.customerName,
        customer_phone: exceptionalForm.customerPhone || null,
        branch: exceptionalForm.branch,
        assigned_to: exceptionalForm.assignedTo || user?.name || "خدمة العملاء",
        category: exceptionalForm.type,
        suggested_action: exceptionalForm.reason,
        status: "معلق",
        date: today,
        followup_date: today,
        followup_type: "exceptional",
        priority: exceptionalForm.priority,
        request_type: exceptionalForm.requestType || null,
        request_details: exceptionalForm.requestDetails || null,
        request_status: exceptionalForm.requestType ? "open" : null,
        next_followup_date: exceptionalForm.nextFollowupDate || null,
        created_by: user?.id || null,
        created_by_name: user?.name || null,
        notes,
      });

      setFollowups((items) => [created, ...items]);
      setHistory((items) => [created, ...items]);
      setSelected(created);
      setExceptionalForm({
        customerName: "",
        customerCode: "",
        customerPhone: "",
        branch: "فرع شكري",
        assignedTo: "",
        type: "متابعة استثنائية",
        priority: "مهم",
        reason: "",
        requestType: "",
        requestDetails: "",
        nextFollowupDate: "",
      });
      setShowExceptional(false);
      toast.success("تم تسجيل المتابعة الاستثنائية وإضافتها لسجل خدمة العملاء");
      await logActivity({
        action: "إضافة متابعة استثنائية",
        module: "خدمة العملاء",
        target_type: "customer_followup",
        target_id: created.id,
        user_id: user?.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: exceptionalForm.branch,
        details: {
          customer_name: created.customer_name,
          customer_code: created.customer_code,
          reason: exceptionalForm.reason,
          request_type: exceptionalForm.requestType,
        },
      });
    } catch (error) {
      toast.error(`تعذر إنشاء المتابعة الاستثنائية: ${(error as Error).message}`);
    } finally {
      setExceptionalSaving(false);
    }
  };

  useEffect(() => {
    loadFollowups();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyStatus]);

  const stats = useMemo(() => {
    const byCategory = (name: string) =>
      followups.filter((item) => followupCategory(item) === name).length;
    const risk = followups.filter((item) =>
      /مهدد|متوقف|Ù…Ù‡Ø¯Ø¯|Ù…ØªÙˆÙ‚Ù/.test(followupCategory(item)),
    ).length;

    return {
      total: followups.length,
      important: byCategory("مهم"),
      medium: byCategory("متوسط"),
      risk,
      done: followups.filter(
        (item) =>
          item.status &&
          !["معلق", "pending"].includes(displayStatus(item.status)),
      ).length,
    };
  }, [followups]);

  const filteredFollowups = useMemo(
    () => followups.filter((item) => followupMatchesSearch(item, followupSearch)),
    [followups, followupSearch],
  );

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return history.filter((item) => {
      const matchesBranch = historyBranch === "all" || branchMatches(historyBranch, item.branch);
      const haystack = [
        item.customer_name,
        customerCodeOf(item),
        customerPhoneOf(item),
        cleanEgyptianPhone(customerPhoneOf(item)),
        item.assigned_to,
        item.status,
        followupCategory(item),
        followupSummary(item),
        requestDetails(item),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesBranch && (!q || wildcardMatch(haystack, q));
    });
  }, [history, historySearch, historyBranch]);

  const historyStats = useMemo(() => {
    const done = history.filter((item) => !["معلق", "pending"].includes(displayStatus(item.status))).length;
    const noAnswer = history.filter((item) => displayStatus(item.status).includes("لم يرد")).length;
    const withOrders = history.filter((item) => item.purchase_after_followup || item.request_type || /أوردر|طلب/.test(item.notes || "")).length;
    const needsNext = history.filter((item) => item.next_followup_date || /يحتاج متابعة أخرى: نعم/.test(item.notes || "")).length;
    const complaints = history.filter((item) => /شكوى|مشكلة|complaint/.test([item.category, item.request_type, item.notes].join(" "))).length;
    const purchaseValue = history.reduce((sum, item) => sum + Number(item.purchase_amount || readNoteValue(item.notes, ["قيمة الأوردر"]) || 0), 0);
    return { done, noAnswer, withOrders, needsNext, complaints, purchaseValue };
  }, [history]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const data = await generateTodayFollowups();
      setFollowups(data);
      setSelected(data[0] || null);
      toast.success(
        data.length
          ? "تم تجهيز قائمة المتابعة اليومية أو تحميل قائمة اليوم الموجودة"
          : "لا توجد بيانات كافية لإنشاء قائمة اليوم",
      );
    } catch (error) {
      toast.error(`تعذر إنشاء القائمة: ${(error as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleClearTrial = async () => {
    const confirmed = window.confirm("سيتم مسح قائمة المتابعة التجريبية/الذكية الخاصة باليوم الحالي فقط. هل تريد المتابعة؟");
    if (!confirmed) return;

    setClearingTrial(true);
    try {
      const deleted = await clearTodayTrialFollowups();
      setFollowups([]);
      setSelected(null);
      await loadHistory();
      toast.success(deleted ? `تم مسح ${deleted} متابعة تجريبية من قائمة اليوم` : "لا توجد بيانات تجريبية اليوم");
    } catch (error) {
      toast.error(`تعذر مسح بيانات المتابعة التجريبية: ${(error as Error).message}`);
    } finally {
      setClearingTrial(false);
    }
  };

  const setFollowupDoctor = async (
    followup: DailyFollowup,
    doctorName: string,
  ) => {
    if (!doctorName) return;

    const lines = (followup.notes || "").split("\n").filter((line) => {
      const trimmed = line.trim();
      return !NOTE_LABELS.assignee.some((label) =>
        trimmed.startsWith(`${label}:`),
      );
    });

    const notes = [...lines, `الدكتور الأنسب للمتابعة: ${doctorName}`]
      .filter(Boolean)
      .join("\n");
    const updated = await updateFollowupStatus(followup.id, { notes });
    setFollowups((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelected((current) => (current?.id === updated.id ? updated : current));
    toast.success("تم تحديث المتابع المقترح");
  };

  const applyDoctorToList = async (mode: "all" | "branch") => {
    const updates =
      mode === "all"
        ? followups.map((item) => ({ item, doctor: bulkDoctor }))
        : followups.map((item) => ({
            item,
            doctor: displayBranch(item.branch).includes("الشامي")
              ? shamyDoctor
              : shokryDoctor,
          }));

    for (const update of updates) {
      if (update.doctor) await setFollowupDoctor(update.item, update.doctor);
    }

    toast.success("تم تحديث المتابعين المقترحين");
  };

  useEffect(() => {
    if (!selected) return;
    setScriptKey(scriptKeyFromCategory(followupCategory(selected)));
    // Intentionally depend only on the ID — changing script key when selection changes, not on every re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const message = selected
    ? getScript(scriptKey, undefined, {
        customerName: selected.customer_name || "",
        staffName:
          assignedDoctor(selected) === "غير محدد"
            ? "فريق صيدليات دواء"
            : assignedDoctor(selected),
        branchName: displayBranch(selected.branch),
      })
    : "";
  const whatsappHref = selected
    ? generateWhatsAppLink(customerPhoneOf(selected), message)
    : "";
  const cleanSelectedPhone = selected
    ? cleanEgyptianPhone(customerPhoneOf(selected))
    : "";
  const phoneHref = cleanSelectedPhone ? `tel:+${cleanSelectedPhone}` : "";

  const openSelectedWhatsApp = async () => {
    if (!selected) return;
    if (!whatsappHref) {
      toast.error("لا يمكن فتح واتساب بدون رقم هاتف صحيح");
      return;
    }

    window.open(whatsappHref, "_blank", "noopener,noreferrer");
    await logActivity({
      action: "فتح واتساب للعميل",
      module: "خدمة العملاء",
      target_type: "customer",
      target_id: selected.customer_id || selected.id,
      user_id: user?.id,
      user_name: user?.name,
      user_role: user?.role,
      branch_name: displayBranch(selected.branch),
      details: {
        customer_name: selected.customer_name,
        customer_code: selected.customer_code,
        phone: customerPhoneOf(selected),
        staff_name: assignedDoctor(selected),
      },
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-slate-300 text-sm">
          جاري تحميل قائمة المتابعة اليومية...
        </div>
        {[1, 2, 3].map((item) => (
          <div key={item} className="stat-card h-20 animate-pulse bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-4 text-sm text-slate-300 leading-relaxed">
        <span className="text-blue-300 font-semibold">
          تجديد القائمة يوميًا:{" "}
        </span>
        كل يوم جديد يمكنك الضغط على إنشاء/تحديث قائمة اليوم لاختيار عملاء جدد من
        قاعدة التحليل. إذا ظلت متابعات كثيرة معلقة بعد الظهر، ستظهر تذكيرات في{" "}
        <span className="text-white font-medium">جرس الإشعارات</span> في الأعلى.
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <div className="section-title">قائمة المتابعة اليومية الذكية</div>
          <div className="text-slate-400 text-sm mt-1">
            تضم عملاء مهمين ومتوسطين ومهددين أو متوقفين حسب قيمة العميل وآخر
            شراء وآخر متابعة.
          </div>
        </div>
        <Link
          to="/customer-requests"
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <MessageSquare size={16} />
          طلبات العملاء
        </Link>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Wand2 size={16} />
          )}
          إنشاء/تحديث قائمة اليوم
        </button>
        <button
          onClick={handleClearTrial}
          disabled={clearingTrial || generating}
          className="btn-secondary flex items-center justify-center gap-2 border-red-400/30 text-red-200 hover:bg-red-500/10"
        >
          {clearingTrial ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          مسح البيانات التجريبية
        </button>
        <button
          onClick={loadFollowups}
          disabled={generating}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          تحديث العرض
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="إجمالي اليوم" value={stats.total} color="text-white" />
        <Stat label="مهمين" value={stats.important} color="text-purple-400" />
        <Stat label="متوسط" value={stats.medium} color="text-teal-400" />
        <Stat label="مهدد/متوقف" value={stats.risk} color="text-amber-400" />
        <Stat label="تمت متابعتهم" value={stats.done} color="text-green-400" />
      </div>


      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div>
              <div className="section-title flex items-center gap-2">
                <FileText size={20} className="text-teal-300" /> سجل المتابعات الكامل
              </div>
              <div className="text-slate-400 text-sm mt-1">
                كل تواصل تم مع العملاء: مكالمة، واتساب، طلب أوردر، شكوى، متابعة استثنائية، ونتيجة المتابعة.
              </div>
            </div>
            <button onClick={loadHistory} disabled={historyLoading} className="btn-secondary flex items-center justify-center gap-2">
              {historyLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              تحديث السجل
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="relative md:col-span-2">
              <Search size={16} className="absolute right-3 top-3 text-slate-400" />
              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                className="input-dark pr-9"
                placeholder="بحث باسم العميل، الكود، الهاتف، المسؤول، النتيجة أو الطلب..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)} className="input-dark">
                <option value="all">كل الحالات</option>
                <option value="معلق">معلق</option>
                <option value="تم التواصل">تم التواصل</option>
                <option value="طلب أوردر">طلب أوردر</option>
                <option value="لم يرد">لم يرد</option>
              </select>
              <select value={historyBranch} onChange={(event) => setHistoryBranch(event.target.value)} className="input-dark">
                <option value="all">كل الفروع</option>
                <option value="شكري">فرع شكري</option>
                <option value="الشامي">فرع الشامي</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-4">
            <MiniStat label="تمت" value={historyStats.done} color="text-green-300" />
            <MiniStat label="لم يرد" value={historyStats.noAnswer} color="text-amber-300" />
            <MiniStat label="طلبات" value={historyStats.withOrders} color="text-cyan-300" />
            <MiniStat label="متابعة قادمة" value={historyStats.needsNext} color="text-purple-300" />
            <MiniStat label="شكاوى/مشاكل" value={historyStats.complaints} color="text-red-300" />
            <MiniStat label="قيمة بعد المتابعة" value={Math.round(historyStats.purchaseValue)} color="text-teal-300" suffix=" ج" />
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredHistory.length === 0 ? (
              <div className="bg-white/5 rounded-xl p-8 text-center text-slate-400">
                لا توجد متابعات مطابقة للفلاتر الحالية.
              </div>
            ) : (
              filteredHistory.slice(0, 120).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className={`w-full text-right rounded-xl border p-3 transition-all ${selected?.id === item.id ? "bg-teal-500/10 border-teal-400/40" : "bg-white/[0.03] border-white/10 hover:border-teal-400/25"}`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-white font-bold text-sm truncate">
                        {item.customer_name || "عميل بدون اسم"}
                        <span className="text-slate-400 font-normal"> — كود {item.customer_code || "بدون كود"}</span>
                      </div>
                      <div className="text-slate-400 text-xs mt-1 flex flex-wrap gap-2">
                        <span>{displayEgyptianPhone(item.customer_phone)}</span>
                        <span>{displayBranch(item.branch)}</span>
                        <span>المسؤول: {assignedDoctor(item)}</span>
                        <span>التاريخ: {dateLabel(item.closed_at || item.updated_at || item.created_at)}</span>
                      </div>
                      <div className="text-slate-300 text-xs mt-2 line-clamp-2">
                        {followupSummary(item)}
                      </div>
                      {(item.request_type || item.request_details || /أوردر|طلب/.test(item.notes || "")) && (
                        <div className="mt-2 text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-400/20 rounded-lg px-2 py-1 inline-flex items-center gap-1">
                          <ShoppingBag size={13} /> {requestDetails(item)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-row md:flex-col items-end gap-2 shrink-0">
                      <span className={statusClass(item.status)}>{displayStatus(item.status)}</span>
                      <span className="badge-info text-xs">{contactMethod(item)}</span>
                      <span className="text-xs text-slate-500">{followupCategory(item)}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="section-title flex items-center gap-2">
                <Plus size={20} className="text-teal-300" /> متابعة استثنائية
              </div>
              <div className="text-slate-400 text-xs mt-1">
                للشكاوى، الكاش باك، طلب صنف، مشكلة توصيل، أو أي تواصل خارج قائمة اليوم.
              </div>
            </div>
            <button className="btn-secondary text-xs" onClick={() => setShowExceptional((value) => !value)}>
              {showExceptional ? "إغلاق" : "إضافة"}
            </button>
          </div>

          {showExceptional ? (
            <div className="space-y-3">
              <input className="input-dark" placeholder="اسم العميل" value={exceptionalForm.customerName} onChange={(event) => setExceptionalForm((f) => ({ ...f, customerName: event.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input-dark" placeholder="كود العميل" value={exceptionalForm.customerCode} onChange={(event) => setExceptionalForm((f) => ({ ...f, customerCode: event.target.value }))} />
                <input className="input-dark" placeholder="رقم الهاتف" value={exceptionalForm.customerPhone} onChange={(event) => setExceptionalForm((f) => ({ ...f, customerPhone: event.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="input-dark" value={exceptionalForm.branch} onChange={(event) => setExceptionalForm((f) => ({ ...f, branch: event.target.value }))}>
                  <option>فرع شكري</option>
                  <option>فرع الشامي</option>
                </select>
                <select className="input-dark" value={exceptionalForm.priority} onChange={(event) => setExceptionalForm((f) => ({ ...f, priority: event.target.value }))}>
                  <option>عادي</option>
                  <option>مهم</option>
                  <option>عاجل</option>
                  <option>خطر</option>
                </select>
              </div>
              <select className="input-dark" value={exceptionalForm.type} onChange={(event) => setExceptionalForm((f) => ({ ...f, type: event.target.value }))}>
                <option>متابعة استثنائية</option>
                <option>شكوى عميل</option>
                <option>تسوية / كاش باك</option>
                <option>تأخير أوردر</option>
                <option>طلب صنف ناقص</option>
                <option>عميل VIP</option>
                <option>متابعة من المدير</option>
                <option>مشكلة في التوصيل</option>
              </select>
              <select className="input-dark" value={exceptionalForm.assignedTo} onChange={(event) => setExceptionalForm((f) => ({ ...f, assignedTo: event.target.value }))}>
                <option value="">المسؤول عن المتابعة</option>
                {staffChoices.map((person) => (
                  <option key={person.id} value={person.name}>{person.name} - {displayBranch(person.branch)}</option>
                ))}
              </select>
              <textarea className="input-dark resize-none" rows={3} placeholder="سبب المتابعة والمطلوب من خدمة العملاء" value={exceptionalForm.reason} onChange={(event) => setExceptionalForm((f) => ({ ...f, reason: event.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <select className="input-dark" value={exceptionalForm.requestType} onChange={(event) => setExceptionalForm((f) => ({ ...f, requestType: event.target.value }))}>
                  <option value="">بدون طلب محدد</option>
                  <option value="missing_medicine">صنف ناقص</option>
                  <option value="cashback">كاش باك / تسوية</option>
                  <option value="complaint">شكوى</option>
                  <option value="delivery">طلب توصيل</option>
                  <option value="refund_exchange">استبدال / مرتجع</option>
                  <option value="reservation">حجز صنف</option>
                </select>
                <input type="date" className="input-dark" value={exceptionalForm.nextFollowupDate} onChange={(event) => setExceptionalForm((f) => ({ ...f, nextFollowupDate: event.target.value }))} />
              </div>
              <textarea className="input-dark resize-none" rows={2} placeholder="تفاصيل طلب العميل إن وجدت" value={exceptionalForm.requestDetails} onChange={(event) => setExceptionalForm((f) => ({ ...f, requestDetails: event.target.value }))} />
              <button onClick={handleCreateExceptional} disabled={exceptionalSaving} className="btn-primary w-full flex items-center justify-center gap-2">
                {exceptionalSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                حفظ المتابعة الاستثنائية
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white/5 rounded-xl p-4 text-slate-300 text-sm leading-relaxed">
                استخدمها عند وجود مشكلة عاجلة، طلب صنف ناقص، شكوى، تسوية كاش باك، أو تواصل مطلوب من المدير خارج قائمة اليوم.
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-red-500/10 border border-red-400/20 rounded-xl p-3 text-red-200 flex items-center gap-2"><AlertTriangle size={16} /> شكاوى عاجلة</div>
                <div className="bg-cyan-500/10 border border-cyan-400/20 rounded-xl p-3 text-cyan-200 flex items-center gap-2"><ShoppingBag size={16} /> طلبات أصناف</div>
                <div className="bg-purple-500/10 border border-purple-400/20 rounded-xl p-3 text-purple-200 flex items-center gap-2"><MessageSquare size={16} /> متابعة مدير</div>
                <div className="bg-green-500/10 border border-green-400/20 rounded-xl p-3 text-green-200 flex items-center gap-2"><CheckCircle2 size={16} /> كاش باك</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div>
          <div className="text-slate-300 text-xs mb-1">
            تعيين دكتور لكل قائمة اليوم
          </div>
          <select
            value={bulkDoctor}
            onChange={(event) => setBulkDoctor(event.target.value)}
            className="input-dark"
          >
            <option value="">اختر الدكتور</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.name}>
                {doctor.name} - {displayBranch(doctor.branch)}
              </option>
            ))}
          </select>
          <button
            onClick={() => applyDoctorToList("all")}
            disabled={!bulkDoctor}
            className="btn-secondary mt-2 w-full"
          >
            تطبيق على كل العملاء
          </button>
        </div>
        <div>
          <div className="text-slate-300 text-xs mb-1">عملاء فرع الشامي</div>
          <select
            value={shamyDoctor}
            onChange={(event) => setShamyDoctor(event.target.value)}
            className="input-dark"
          >
            <option value="">اختر الدكتور</option>
            {doctors
              .filter((doctor) =>
                displayBranch(doctor.branch).includes("الشامي"),
              )
              .map((doctor) => (
                <option key={doctor.id} value={doctor.name}>
                  {doctor.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <div className="text-slate-300 text-xs mb-1">عملاء فرع شكري</div>
          <select
            value={shokryDoctor}
            onChange={(event) => setShokryDoctor(event.target.value)}
            className="input-dark"
          >
            <option value="">اختر الدكتور</option>
            {doctors
              .filter((doctor) => displayBranch(doctor.branch).includes("شكري"))
              .map((doctor) => (
                <option key={doctor.id} value={doctor.name}>
                  {doctor.name}
                </option>
              ))}
          </select>
          <button
            onClick={() => applyDoctorToList("branch")}
            disabled={!shamyDoctor && !shokryDoctor}
            className="btn-secondary mt-2 w-full"
          >
            توزيع حسب الفرع
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={followupSearch}
          onChange={(event) => setFollowupSearch(event.target.value)}
          className="input-dark pr-9"
          placeholder="بحث باسم العميل أو الكود أو الهاتف... يمكن استخدام *"
        />
      </div>

      {filteredFollowups.length === 0 ? (
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl py-16 text-center">
          <CalendarClock size={42} className="mx-auto text-slate-500 mb-3" />
          <div className="text-white font-bold">لا توجد قائمة متابعة لليوم</div>
          <div className="text-slate-400 text-sm mt-1">
            اضغط إنشاء قائمة اليوم ليتم اختيار العملاء تلقائيًا.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="space-y-2 max-h-[calc(100vh-310px)] overflow-y-auto">
            {filteredFollowups.map((item) => {
              const validPhone = Boolean(
                cleanEgyptianPhone(customerPhoneOf(item)),
              );

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelected(item);
                    setCustomer360(item);
                  }}
                  className={`w-full text-right p-3 rounded-xl border transition-all ${selected?.id === item.id ? "bg-teal-500/10 border-teal-500/30" : "bg-[#1B2B4B] border-[#2d4063] hover:border-teal-500/20"}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold">
                      {(item.customer_name || "ع")[0]}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-white text-sm font-semibold truncate">
                        {item.customer_name || "عميل بدون اسم"}
                      </span>
                      <span className="block text-slate-400 text-xs truncate">
                        كود: {customerCodeOf(item) || "بدون كود"} - هاتف:{" "}
                        {displayEgyptianPhone(customerPhoneOf(item))} -{" "}
                        {displayBranch(item.branch)}
                      </span>
                    </span>
                    <span className="badge-info text-xs">
                      {followupCategory(item)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={statusClass(item.status)}>
                      {displayStatus(item.status)}
                    </span>
                    <span
                      className={`text-xs ${validPhone ? "text-green-300" : "text-amber-300"}`}
                    >
                      {validPhone ? "رقم صالح للواتساب" : "بدون رقم صالح"}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {assignedDoctor(item)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <span>آخر شراء: {lastPurchaseOf(item) ? dateLabel(lastPurchaseOf(item)) : "لا يوجد"}</span>
                    <span>شراء الشهر: {currentPurchaseCountOf(item).toLocaleString("ar-EG")}</span>
                    <span>المتوسط الشهري: {averagePurchaseCountOf(item).toLocaleString("ar-EG")}</span>
                    <span>{displayBranch(item.branch)}</span>
                  </div>
                  {item.purchase_frequency_status === "decreased" && <div className="mt-2 badge-warning w-fit">انخفاض في تكرار الشراء</div>}
                  {item.purchase_frequency_status === "stopped" && <div className="mt-2 badge-danger w-fit">توقف عن الشراء</div>}
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-2">
            {selected && (
              <div className="space-y-4">
                <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xl font-bold">
                      {(selected.customer_name || "ع")[0]}
                    </div>
                    <div className="flex-1 min-w-[240px]">
                      <div className="text-white font-bold text-lg">
                        {selected.customer_name || "عميل بدون اسم"}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-slate-400 text-sm">
                        <span className="flex items-center gap-1">
                          <Phone size={13} />
                          {displayEgyptianPhone(customerPhoneOf(selected))}
                        </span>
                        <span>
                          كود العميل: {customerCodeOf(selected) || "بدون كود"}
                        </span>
                        <span>{displayBranch(selected.branch)}</span>
                        <span>الفئة: {followupCategory(selected)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="badge-info">آخر شراء: {lastPurchaseOf(selected) ? dateLabel(lastPurchaseOf(selected)) : "لا يوجد"}</span>
                        <span className="badge-info">شراء الشهر: {currentPurchaseCountOf(selected).toLocaleString("ar-EG")}</span>
                        <span className="badge-info">المتوسط الشهري: {averagePurchaseCountOf(selected).toLocaleString("ar-EG")}</span>
                        {selected.purchase_frequency_status === "decreased" && <span className="badge-warning">انخفاض في تكرار الشراء</span>}
                        {selected.purchase_frequency_status === "stopped" && <span className="badge-danger">توقف عن الشراء</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={openSelectedWhatsApp}
                      disabled={!whatsappHref}
                      className={`btn-primary flex items-center gap-2 ${!whatsappHref ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={
                        whatsappHref
                          ? "فتح واتساب برسالة المتابعة"
                          : "لا يمكن فتح واتساب بدون رقم هاتف صحيح"
                      }
                    >
                      <MessageSquare size={16} /> واتساب
                    </button>
                    {phoneHref && (
                      <a
                        href={phoneHref}
                        className="btn-secondary flex items-center gap-2"
                      >
                        <PhoneCall size={16} /> اتصال
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Detail
                    label="المتابع المقترح"
                    value={assignedDoctor(selected)}
                  />
                  <Detail
                    label="تاريخ المتابعة"
                    value={
                      selected.followup_date ||
                      (selected.created_at
                        ? formatDate(selected.created_at)
                        : "اليوم")
                    }
                  />
                  <Detail
                    label="متوسط شهري"
                    value={
                      readNoteValue(selected.notes, NOTE_LABELS.avgMonthly) ||
                      "غير محدد"
                    }
                  />
                  <Detail
                    label="آخر شراء"
                    value={
                      readNoteValue(selected.notes, NOTE_LABELS.lastPurchase) ||
                      "غير محدد"
                    }
                  />
                  <Detail
                    label="أول شراء"
                    value={
                      readNoteValue(
                        selected.notes,
                        NOTE_LABELS.firstPurchase,
                      ) || "غير محدد"
                    }
                  />
                  <Detail
                    label="الدكتور الأنسب"
                    value={assignedDoctor(selected)}
                  />
                </div>

                <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                  <div className="section-title mb-3">
                    تغيير المتابع المقترح
                  </div>
                  <select
                    value={
                      assignedDoctor(selected) === "غير محدد"
                        ? ""
                        : assignedDoctor(selected)
                    }
                    onChange={(event) =>
                      setFollowupDoctor(selected, event.target.value)
                    }
                    className="input-dark"
                  >
                    <option value="">اختر الدكتور</option>
                    {doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.name}>
                        {doctor.name} - {displayBranch(doctor.branch)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <div className="section-title">السكريبت المقترح</div>
                    <select
                      value={scriptKey}
                      onChange={(event) =>
                        setScriptKey(event.target.value as ScriptKey)
                      }
                      className="input-dark md:w-72"
                    >
                      {SCRIPT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4 text-slate-200 text-sm leading-relaxed whitespace-pre-line">
                    {message || suggestedScript(selected)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={async () => {
                        const ok = await copyText(
                          message || suggestedScript(selected),
                        );
                        toast[ok ? "success" : "error"](
                          ok ? "تم نسخ الرسالة" : "تعذر النسخ",
                        );
                      }}
                      className="btn-secondary flex items-center gap-2"
                    >
                      <Copy size={16} /> نسخ الرسالة
                    </button>
                    <button
                      type="button"
                      onClick={openSelectedWhatsApp}
                      disabled={!whatsappHref}
                      className={`btn-primary flex items-center gap-2 ${!whatsappHref ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={
                        whatsappHref
                          ? "فتح واتساب برسالة المتابعة"
                          : "لا يمكن فتح واتساب بدون رقم هاتف صحيح"
                      }
                    >
                      <MessageSquare size={16} /> فتح واتساب
                    </button>
                    {phoneHref && (
                      <a
                        href={phoneHref}
                        className="btn-secondary flex items-center gap-2"
                      >
                        <PhoneCall size={16} /> اتصال
                      </a>
                    )}
                  </div>
                </div>

                <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
                  <div className="section-title mb-3">المطلوب في المتابعة</div>
                  <div className="bg-white/5 rounded-xl p-4 text-slate-200 text-sm leading-relaxed">
                    {suggestedAction(selected)}
                  </div>
                </div>

                <FollowupResultForm
                  followup={selected}
                  responsibleName={user?.name || assignedDoctor(selected)}
                  defaultScript={scriptKeyFromCategory(
                    followupCategory(selected),
                  )}
                  onSaved={(updated) => {
                    setFollowups((items) =>
                      items.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    );
                    setSelected(updated);
                    logActivity({
                      action: "تسجيل نتيجة متابعة عميل",
                      module: "خدمة العملاء",
                      target_type: "customer",
                      target_id: updated.customer_id || updated.id,
                      user_id: user?.id,
                      user_name: user?.name,
                      user_role: user?.role,
                      branch_name: displayBranch(updated.branch),
                      details: {
                        customer_name: updated.customer_name,
                        customer_code: updated.customer_code,
                        status: updated.status,
                        assigned_to: assignedDoctor(updated),
                      },
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {customer360 && (
        <Customer360QuickView followup={customer360} onClose={() => setCustomer360(null)} />
      )}
    </div>
  );
}

function Customer360QuickView({ followup, onClose }: { followup: DailyFollowup; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" dir="rtl" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl border border-teal-400/30 bg-[#10213a] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-3 border-b border-white/10 bg-[#10213a] p-5">
          <div>
            <div className="text-xs font-bold text-teal-300">ملف العميل 360</div>
            <div className="mt-1 text-2xl font-black text-white">{followup.customer_name || "عميل بدون اسم"}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
              <span className="badge-info">كود: {customerCodeOf(followup) || "بدون كود"}</span>
              <span className="badge-info">هاتف: {displayEgyptianPhone(customerPhoneOf(followup))}</span>
              <span className="badge-info">{displayBranch(followup.branch)}</span>
            </div>
          </div>
          <button type="button" className="btn-secondary px-4" onClick={onClose}>إغلاق</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Detail label="آخر شراء" value={lastPurchaseOf(followup) ? dateLabel(lastPurchaseOf(followup)) : "لا يوجد"} />
          <Detail label="عدد مرات الشراء هذا الشهر" value={currentPurchaseCountOf(followup).toLocaleString("ar-EG")} />
          <Detail label="متوسط مرات الشراء شهريًا" value={averagePurchaseCountOf(followup).toLocaleString("ar-EG")} />
          <Detail label="الفرع" value={displayBranch(followup.branch)} />
          <Detail label="حالة المتابعة" value={displayStatus(followup.followup_status || followup.status)} />
          <Detail label="المسؤول" value={followup.responsible_name || assignedDoctor(followup)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {followup.purchase_frequency_status === "decreased" && <span className="badge-warning">انخفاض في تكرار الشراء</span>}
          {followup.purchase_frequency_status === "stopped" && <span className="badge-danger">توقف عن الشراء</span>}
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 font-bold text-white">ملخص المتابعة</div>
          <div className="text-sm leading-7 text-slate-300">{followupSummary(followup)}</div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="stat-card text-center">
      <div className={`text-2xl font-bold num ${color}`}>
        {value.toLocaleString("ar-EG")}
      </div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1">{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color = "text-white",
  suffix = "",
}: {
  label: string;
  value: number;
  color?: string;
  suffix?: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-2 text-center border border-white/5">
      <div className={`text-lg font-bold num ${color}`}>
        {value.toLocaleString("ar-EG")}
        <span className="text-xs font-normal">{suffix}</span>
      </div>
      <div className="text-slate-400 text-[11px] mt-0.5">{label}</div>
    </div>
  );
}
