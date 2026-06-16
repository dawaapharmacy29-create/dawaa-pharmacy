import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canSeeAllBranches, rowMatchesUserBranch, scopeDescription } from "@/lib/security/permissionScopes";

type BranchReviewRow = {
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  current_branch: string | null;
  suggested_branch: string | null;
  invoices_count: number | null;
  total_spent: number | null;
  last_invoice_date: string | null;
  confidence_level: string | null;
  repair_status: string | null;
  review_label: string | null;
  whatsapp_link?: string | null;
};

type BranchSummaryRow = {
  confidence_level: string | null;
  repair_status: string | null;
  customers_count: number | null;
  total_spent: number | null;
  invoices_count: number | null;
};

type InvalidPhoneRow = {
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  source_table: string | null;
  invalid_reason: string | null;
  last_seen_at: string | null;
};

const money = (value?: number | null) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const number = (value?: number | null) => Number(value || 0).toLocaleString("ar-EG");
const date = (value?: string | null) => (value ? new Date(value).toLocaleDateString("ar-EG") : "—");
const labelConfidence = (value?: string | null) => {
  if (value === "medium") return "مراجعة سريعة";
  if (value === "manual_review") return "مراجعة يدوية";
  if (value === "high") return "عالية الثقة";
  return value || "—";
};

function normalizeEgyptPhone(value: string) {
  const digits = value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("20") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("1") && digits.length === 10) return `0${digits}`;
  return digits;
}

function isValidEgyptMobile(value?: string | null) {
  const normalized = normalizeEgyptPhone(String(value || ""));
  return /^01[0125][0-9]{8}$/.test(normalized);
}

async function safeUpdateCustomerBranch(customerCode: string, suggestedBranch: string) {
  const errors: string[] = [];
  const payload = { branch: suggestedBranch, updated_at: new Date().toISOString() };
  const attempts = [
    { table: "customers", column: "customer_code" },
    { table: "customer_metrics_summary", column: "customer_code" },
    { table: "customer_metrics_summary", column: "final_customer_key" },
  ];

  for (const attempt of attempts) {
    const result = await supabase
      .from(attempt.table)
      .update(payload)
      .eq(attempt.column, customerCode)
      .select(attempt.column)
      .limit(1);

    if (!result.error && (result.data || []).length > 0) return true;
    if (result.error) errors.push(`${attempt.table}.${attempt.column}: ${result.error.message}`);
  }

  throw new Error(errors.length ? errors.join(" | ") : "لم يتم العثور على العميل بنفس الكود في جداول العملاء");
}

async function safeMarkBranchRepairReviewed(customerCode: string, reviewer: string) {
  const result = await supabase
    .from("dawaa_customer_branch_repair_review_v14")
    .update({ repair_status: "manual_approved", reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
    .eq("customer_code", customerCode);
  if (result.error) console.warn("branch repair review status update failed", result.error);
}

export default function CustomerDataReview() {
  const { user } = useAuth();
  const canUseAllBranches = canSeeAllBranches(user);
  const userScopeLabel = scopeDescription(user);
  const [activeTab, setActiveTab] = useState<"branch" | "phones">("branch");
  const [summary, setSummary] = useState<BranchSummaryRow[]>([]);
  const [branchRows, setBranchRows] = useState<BranchReviewRow[]>([]);
  const [phoneRows, setPhoneRows] = useState<InvalidPhoneRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [phoneInputs, setPhoneInputs] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, queueResult, phoneResult] = await Promise.all([
        supabase.from("dawaa_customer_branch_review_summary_v14").select("*"),
        supabase.from("dawaa_customer_branch_review_queue_v14").select("*").limit(800),
        supabase.from("dawaa_customer_invalid_phone_review_v14_6").select("*").limit(800),
      ]);

      if (summaryResult.error) throw summaryResult.error;
      if (queueResult.error) throw queueResult.error;
      // invalid phone view is support SQL; if it is missing, keep the page open and show an empty list.
      if (phoneResult.error) {
        console.warn("invalid phone review view failed", phoneResult.error);
        setPhoneRows([]);
      } else {
        setPhoneRows(((phoneResult.data || []) as InvalidPhoneRow[]).filter((row) => rowMatchesUserBranch(user, row.branch)));
      }
      setSummary((summaryResult.data || []) as BranchSummaryRow[]);
      setBranchRows(((queueResult.data || []) as BranchReviewRow[]).filter((row) => canUseAllBranches || rowMatchesUserBranch(user, row.current_branch) || rowMatchesUserBranch(user, row.suggested_branch)));
    } catch (error) {
      console.error(error);
      toast.error("تعذر تحميل بيانات مراجعة العملاء");
    } finally {
      setLoading(false);
    }
  }, [canUseAllBranches, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredBranchRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return branchRows.filter((row) => {
      if (!q) return true;
      return [row.customer_code, row.customer_name, row.customer_phone, row.current_branch, row.suggested_branch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [branchRows, search]);

  const filteredPhoneRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return phoneRows.filter((row) => {
      if (!q) return true;
      return [row.customer_code, row.customer_name, row.customer_phone, row.branch, row.invalid_reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [phoneRows, search]);

  const approveBranch = async (row: BranchReviewRow) => {
    const customerCode = row.customer_code;
    if (!customerCode) return;
    setSavingCode(customerCode);
    try {
      const reviewer = user?.username || user?.name || "app";
      const { data, error } = await supabase.rpc("approve_customer_branch_repair_v14", {
        p_customer_code: customerCode,
        p_reviewed_by: reviewer,
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (error || result?.ok === false) {
        if (!row.suggested_branch) throw error || new Error(result?.message || "لا يوجد فرع مقترح");
        await safeUpdateCustomerBranch(customerCode, row.suggested_branch);
        await safeMarkBranchRepairReviewed(customerCode, reviewer);
      }
      toast.success("تم اعتماد تصحيح الفرع");
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("تعذر اعتماد التصحيح");
    } finally {
      setSavingCode(null);
    }
  };

  const ignoreBranch = async (customerCode?: string | null) => {
    if (!customerCode) return;
    setSavingCode(customerCode);
    try {
      const { error } = await supabase.rpc("ignore_customer_branch_repair_v14", {
        p_customer_code: customerCode,
        p_reviewed_by: user?.username || user?.name || "app",
        p_reason: "تم التجاهل من صفحة مراجعة بيانات العملاء",
      });
      if (error) throw error;
      toast.success("تم تجاهل العميل من قائمة تصحيح الفرع");
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("تعذر تجاهل العميل");
    } finally {
      setSavingCode(null);
    }
  };

  const updatePhone = async (customerCode?: string | null) => {
    if (!customerCode) return;
    const phone = normalizeEgyptPhone(phoneInputs[customerCode] || "");
    if (!isValidEgyptMobile(phone)) {
      toast.error("اكتب رقم موبايل مصري صحيح يبدأ بـ 01");
      return;
    }
    setSavingCode(customerCode);
    try {
      const { error } = await supabase.rpc("update_customer_phone_v14_6", {
        p_customer_code: customerCode,
        p_new_phone: phone,
        p_reviewed_by: user?.username || user?.name || "app",
      });
      if (error) throw error;
      toast.success("تم تحديث رقم العميل");
      setPhoneInputs((prev) => ({ ...prev, [customerCode]: "" }));
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("تعذر تحديث رقم العميل");
    } finally {
      setSavingCode(null);
    }
  };

  const pendingManual = summary.find((row) => row.confidence_level === "manual_review" && row.repair_status === "pending")?.customers_count || 0;
  const pendingMedium = summary.find((row) => row.confidence_level === "medium" && row.repair_status === "pending")?.customers_count || 0;
  const approved = summary.filter((row) => String(row.repair_status || "").includes("approved") || String(row.repair_status || "").includes("auto_repaired")).reduce((sum, row) => sum + Number(row.customers_count || 0), 0);

  return (
    <div className="space-y-6" dir="rtl">
      <section className="dawaa-hero rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-teal-300">مراجعة بيانات العملاء</p>
            <h1 className="mt-2 text-3xl font-black text-white">تصحيح الفروع والأرقام قبل التشغيل مع الفريق</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              الصفحة دي مخصصة للمراجعة الآمنة: اعتماد فرع العميل بعد مراجعة نمط الشراء، ومراجعة العملاء الذين يظهر بجانبهم بدون رقم صالح.
              <span className="mt-2 block font-bold text-teal-200">نطاق عرض حسابك الحالي: {userScopeLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-200 hover:bg-teal-500/20"
          >
            <RefreshCw className="h-4 w-4" /> تحديث البيانات
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5">
          <p className="text-sm text-amber-200">مراجعة سريعة</p>
          <p className="mt-2 text-3xl font-black text-white">{number(pendingMedium)}</p>
        </div>
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">
          <p className="text-sm text-red-200">مراجعة يدوية</p>
          <p className="mt-2 text-3xl font-black text-white">{number(pendingManual)}</p>
        </div>
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <p className="text-sm text-emerald-200">تم اعتمادهم</p>
          <p className="mt-2 text-3xl font-black text-white">{number(approved)}</p>
        </div>
        <div className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5">
          <p className="text-sm text-blue-200">بدون رقم صالح</p>
          <p className="mt-2 text-3xl font-black text-white">{number(phoneRows.length)}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveTab("branch")}
              className={`rounded-2xl px-4 py-2 text-sm font-black ${activeTab === "branch" ? "bg-teal-500 text-slate-950" : "bg-slate-900 text-slate-300"}`}
            >
              مراجعة فروع العملاء
            </button>
            <button
              onClick={() => setActiveTab("phones")}
              className={`rounded-2xl px-4 py-2 text-sm font-black ${activeTab === "phones" ? "bg-teal-500 text-slate-950" : "bg-slate-900 text-slate-300"}`}
            >
              بدون رقم صالح
            </button>
          </div>
          <label className="relative block w-full lg:w-96">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالاسم / الكود / الرقم / الفرع"
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-10 py-3 text-sm text-white outline-none focus:border-teal-400"
            />
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-slate-800 bg-slate-950/70 p-10 text-slate-300">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" /> جارٍ التحميل...
        </div>
      ) : activeTab === "branch" ? (
        <section className="grid gap-4">
          {filteredBranchRows.map((row) => {
            const code = row.customer_code || "";
            const saving = savingCode === code;
            return (
              <article key={`${code}-${row.suggested_branch}`} className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 shadow-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-slate-200">كود {code || "—"}</span>
                      <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">{labelConfidence(row.confidence_level)}</span>
                      {!isValidEgyptMobile(row.customer_phone) ? <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">بدون رقم صالح</span> : null}
                    </div>
                    <h2 className="text-xl font-black text-white">{row.customer_name || "عميل بدون اسم"}</h2>
                    <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2 lg:grid-cols-4">
                      <span>الهاتف: {row.customer_phone || "—"}</span>
                      <span>الفرع الحالي: {row.current_branch || "—"}</span>
                      <span>الفرع المقترح: {row.suggested_branch || "—"}</span>
                      <span>آخر فاتورة: {date(row.last_invoice_date)}</span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2">
                      <span>عدد الفواتير: {number(row.invoices_count)}</span>
                      <span>إجمالي الشراء: {money(row.total_spent)} جنيه</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => approveBranch(row)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> اعتماد
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => ignoreBranch(code)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-2 text-sm font-black text-slate-200 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" /> تجاهل
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {!filteredBranchRows.length ? <EmptyState title="لا توجد حالات فروع مطابقة للبحث" /> : null}
        </section>
      ) : (
        <section className="grid gap-4">
          {filteredPhoneRows.map((row) => {
            const code = row.customer_code || "";
            const saving = savingCode === code;
            return (
              <article key={`${code}-${row.source_table}`} className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 shadow-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-slate-200">كود {code || "—"}</span>
                      <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">{row.invalid_reason || "بدون رقم صالح"}</span>
                    </div>
                    <h2 className="text-xl font-black text-white">{row.customer_name || "عميل بدون اسم"}</h2>
                    <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-3">
                      <span>الرقم الحالي: {row.customer_phone || "—"}</span>
                      <span>الفرع: {row.branch || "—"}</span>
                      <span>آخر ظهور: {date(row.last_seen_at)}</span>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 lg:w-96">
                    <div className="flex gap-2">
                      <input
                        value={phoneInputs[code] || ""}
                        onChange={(event) => setPhoneInputs((prev) => ({ ...prev, [code]: event.target.value }))}
                        placeholder="اكتب الرقم الصحيح 01xxxxxxxxx"
                        className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white outline-none focus:border-teal-400"
                      />
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => updatePhone(code)}
                        className="inline-flex items-center gap-2 rounded-2xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
                      >
                        <Phone className="h-4 w-4" /> حفظ
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">سيتم تحديث رقم العميل في customers وتحديث المتابعات المفتوحة لنفس الكود.</p>
                  </div>
                </div>
              </article>
            );
          })}
          {!filteredPhoneRows.length ? <EmptyState title="لا توجد أرقام غير صالحة ظاهرة الآن" /> : null}
        </section>
      )}

      <section className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5 text-sm leading-7 text-blue-100">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0" />
          <div>
            <p className="font-black text-white">ملاحظة تشغيل مهمة</p>
            <p>
              هذه الصفحة لا تغير فرع أي عميل إلا عند الضغط على اعتماد، ولا تغير رقم أي عميل إلا عند إدخال رقم صحيح والضغط على حفظ.
              كل تصحيح فرع يتم معه Backup من جدول العملاء قبل التعديل.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-10 text-center text-slate-400">
      <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-slate-600" />
      <p className="font-bold">{title}</p>
    </div>
  );
}
