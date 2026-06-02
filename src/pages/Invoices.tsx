import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Download, Loader2, XCircle, FileCheck, RefreshCw, ShieldAlert, Trash2, Pencil, Save, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import { BRANCHES } from "@/lib/constants";
import { getSalesValue } from "@/lib/analyticsService";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth, getCurrentUserProfile } from "@/hooks/useAuth";
import { logActivity } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  generateTemplateFile,
  importCustomersToDB,
  importInvoicesToDB,
  parseCustomerFile,
  parseInvoiceFile,
  type CustomerParseResult,
  type ImportSummary,
  type ParseResult,
} from "@/lib/invoiceImporter";

type Step = "idle" | "parsing" | "preview" | "importing" | "done";
type ImportKind = "sales" | "customers";

interface ManagedInvoiceRow {
  id: string;
  import_batch: string | null;
  branch: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_type: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number | null;
  net_amount: number | null;
  gross_amount: number | null;
  seller_name: string | null;
}

const INVOICE_PAGE_SIZE = 200;

function invoiceSalesValue(invoice: Pick<ManagedInvoiceRow, "net_amount" | "amount" | "gross_amount">) {
  return getSalesValue(invoice as unknown as Record<string, unknown>);
}

interface InvoiceEditForm {
  branch: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  seller_name: string;
  amount: string;
  net_amount: string;
  gross_amount: string;
}

export default function Invoices() {
  const { user, isAdmin } = useAuth();
  const [step, setStep] = useState<Step>("idle");
  const [importKind, setImportKind] = useState<ImportKind>("sales");
  const [branch, setBranch] = useState<string>(BRANCHES[0]);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | CustomerParseResult | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managedInvoices, setManagedInvoices] = useState<ManagedInvoiceRow[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editInvoice, setEditInvoice] = useState<ManagedInvoiceRow | null>(null);
  const [editForm, setEditForm] = useState<InvoiceEditForm | null>(null);
  useEscapeKey(() => {
    setEditInvoice(null);
    setEditForm(null);
  }, Boolean(editInvoice && editForm));

  const loadManagedInvoices = useCallback(async () => {
    if (!isAdmin) return;
    setManagedLoading(true);
    const { data, error } = await supabase
      .from("sales_invoices")
      .select("id,import_batch,branch,invoice_number,invoice_date,invoice_type,customer_code,customer_name,customer_phone,amount,net_amount,gross_amount,seller_name")
      .order("invoice_date", { ascending: false })
      .limit(INVOICE_PAGE_SIZE);

    if (error) {
      toast.error(`تعذر تحميل أحدث الفواتير: ${error.message}`);
      setManagedInvoices([]);
    } else {
      setManagedInvoices((data || []) as ManagedInvoiceRow[]);
    }
    setManagedLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void loadManagedInvoices();
  }, [loadManagedInvoices]);

  const readFile = (file: File): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as ArrayBuffer);
      reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
      reader.readAsArrayBuffer(file);
    });

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["csv", "xlsx", "xls"].includes(ext)) {
      toast.error("نوع الملف غير مدعوم. استخدم Excel أو CSV");
      return;
    }

    setFileName(file.name);
    setStep("parsing");
    setParseResult(null);
    setImportSummary(null);
    setProgress(0);

    try {
      const buffer = await readFile(file);
      const result = importKind === "sales"
        ? parseInvoiceFile(buffer, file.name, branch)
        : parseCustomerFile(buffer, file.name);

      setParseResult(result);
      setStep("preview");

      if (result.rows.length === 0) toast.error("لم يتم العثور على صفوف صالحة في الملف");
      else toast.success(`تم تحليل الملف: ${result.rows.length.toLocaleString("ar-EG")} صف صالح`);
    } catch (error) {
      toast.error(`خطأ: ${(error as Error).message}`);
      setStep("idle");
    }
  }, [branch, importKind]);

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.rows.length === 0) return;

    setStep("importing");
    setProgress(0);
    const batch = `import-${importKind}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;

    try {
      const summary = importKind === "sales"
        ? await importInvoicesToDB(
            (parseResult as ParseResult).rows,
            branch,
            batch,
            (done, total) => setProgress(total > 0 ? Math.round((done / total) * 100) : 0)
          )
        : await importCustomersToDB((parseResult as CustomerParseResult).rows, batch);

      setImportSummary(summary);
      setStep("done");
      toast.success(importKind === "sales" ? "تم استيراد ملف المبيعات" : "تم استيراد بيانات العملاء");

      const currentUserProfile = getCurrentUserProfile();
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        importKind === "sales" ? "استيراد مبيعات يومية" : "استيراد بيانات عملاء",
        importKind === "sales" ? "الفواتير" : "العملاء",
        `استيراد ${summary.insertedRows} صف - تحديث ${summary.updatedCustomers} عميل - إضافة ${summary.newCustomers} عميل`,
        branch
      );
      if (importKind === "sales") {
        await loadManagedInvoices();
        await supabase.from("notifications").insert({
          title: "استيراد ملف فواتير جديد",
          message: `تم استيراد ${summary.insertedRows} فاتورة مبيعات من ملف ${fileName}`,
          type: "sales_import",
          severity: summary.errors.length ? "medium" : "info",
          entity_type: "sales_invoices",
          entity_id: summary.importBatch,
          route_path: "/analytics",
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      toast.error(`فشل الاستيراد: ${(error as Error).message}`);
      setStep("preview");
    }
  };

  const handleReset = () => {
    setStep("idle");
    setFileName("");
    setParseResult(null);
    setImportSummary(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const invoiceBatches = useMemo(() => {
    const map = new Map<string, { batch: string; count: number; total: number; firstDate: string; lastDate: string; branches: Set<string> }>();
    for (const invoice of managedInvoices) {
      const batch = invoice.import_batch || "بدون رقم دفعة";
      const date = String(invoice.invoice_date || "").slice(0, 10);
      const current = map.get(batch) || {
        batch,
        count: 0,
        total: 0,
        firstDate: date || "-",
        lastDate: date || "-",
        branches: new Set<string>(),
      };
      current.count += 1;
      current.total += invoiceSalesValue(invoice);
      if (date && (current.firstDate === "-" || date < current.firstDate)) current.firstDate = date;
      if (date && (current.lastDate === "-" || date > current.lastDate)) current.lastDate = date;
      if (invoice.branch) current.branches.add(invoice.branch);
      map.set(batch, current);
    }
    return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [managedInvoices]);

  const logInvoiceAdminAction = async (action: string, description: string, details?: Record<string, unknown>) => {
    const currentUserProfile = getCurrentUserProfile();
    await logActivity(
      currentUserProfile.id,
      currentUserProfile.name,
      action,
      "الفواتير",
      description,
      "كل الفروع",
      details,
    );
  };

  const deleteInvoiceBatch = async (batch: string) => {
    if (!isAdmin || adminBusy) return;
    if (!window.confirm(`تأكيد مسح دفعة الفواتير: ${batch}`)) return;

    setAdminBusy(true);
    const affectedIdentifiers = Array.from(new Set(
      managedInvoices
        .filter((invoice) => (batch === "بدون رقم دفعة" ? !invoice.import_batch : invoice.import_batch === batch))
        .map((invoice) => invoice.customer_code || invoice.customer_phone)
        .filter(Boolean),
    ));
    const query = supabase.from("sales_invoices").delete();
    const { error } = batch === "بدون رقم دفعة"
      ? await query.is("import_batch", null)
      : await query.eq("import_batch", batch);

    if (error) {
      toast.error(`تعذر مسح الدفعة: ${error.message}`);
    } else {
      toast.success("تم مسح دفعة الفواتير");
      if (affectedIdentifiers.length > 0) {
        await supabase.from("customer_analysis").delete().in("customer_code", affectedIdentifiers);
      }
      await logInvoiceAdminAction("مسح دفعة فواتير", `مسح دفعة ${batch}`, { import_batch: batch });
      await loadManagedInvoices();
    }
    setAdminBusy(false);
  };

  const deleteTableRowsInChunks = async (table: string, batchSize = 400) => {
    let deleted = 0;
    for (let round = 0; round < 1000; round += 1) {
      const { data, error: selectError } = await supabase.from(table).select("id").limit(batchSize);
      if (selectError) {
        if (selectError.message.includes("does not exist") || selectError.message.includes("schema cache")) return deleted;
        throw new Error(selectError.message);
      }

      const ids = (data || []).map((row) => row.id).filter(Boolean);
      if (ids.length === 0) return deleted;

      const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
      if (deleteError) throw new Error(deleteError.message);

      deleted += ids.length;
      if (ids.length < batchSize) return deleted;
    }
    return deleted;
  };

  const deleteAllInvoices = async () => {
    if (!isAdmin || adminBusy) return;
    if (deleteConfirmText.trim() !== "مسح الفواتير") {
      toast.error("اكتب عبارة التأكيد كما هي: مسح الفواتير");
      return;
    }

    setAdminBusy(true);
    const loadingToast = toast.loading("جاري مسح الفواتير على دفعات...");
    try {
      const deletedInvoices = await deleteTableRowsInChunks("sales_invoices");
      await deleteTableRowsInChunks("customer_analysis");
      await logInvoiceAdminAction("مسح كل الفواتير", "مسح كل فواتير التجربة وتحليل العملاء المرتبط بها", {
        deleted_invoice_count: deletedInvoices,
      });
      setDeleteConfirmText("");
      setManagedInvoices([]);
      toast.success("تم مسح كل الفواتير التجريبية. يمكنك رفع الفواتير من البداية الآن.", { id: loadingToast });
    } catch (error) {
      toast.error(`تعذر مسح الفواتير: ${(error as Error).message}`, { id: loadingToast });
    } finally {
      setAdminBusy(false);
    }
  };

  const startEditInvoice = (invoice: ManagedInvoiceRow) => {
    setEditInvoice(invoice);
    setEditForm({
      branch: invoice.branch || branch,
      invoice_number: invoice.invoice_number || "",
      invoice_date: String(invoice.invoice_date || "").slice(0, 10),
      invoice_type: invoice.invoice_type || "",
      customer_code: invoice.customer_code || "",
      customer_name: invoice.customer_name || "",
      customer_phone: invoice.customer_phone || "",
      seller_name: invoice.seller_name || "",
      amount: String(invoice.amount ?? ""),
      net_amount: String(invoice.net_amount ?? ""),
      gross_amount: String(invoice.gross_amount ?? ""),
    });
  };

  const saveInvoiceEdit = async () => {
    if (!isAdmin || !editInvoice || !editForm || adminBusy) return;
    const amount = Number(editForm.amount);
    const netAmount = editForm.net_amount.trim() ? Number(editForm.net_amount) : amount;
    const grossAmount = editForm.gross_amount.trim() ? Number(editForm.gross_amount) : amount;
    if (!editForm.invoice_date || !Number.isFinite(amount)) {
      toast.error("راجع التاريخ وقيمة الفاتورة قبل الحفظ");
      return;
    }

    setAdminBusy(true);
    const payload = {
      branch: editForm.branch,
      invoice_number: editForm.invoice_number,
      invoice_date: editForm.invoice_date,
      invoice_type: editForm.invoice_type,
      customer_code: editForm.customer_code,
      customer_name: editForm.customer_name,
      customer_phone: editForm.customer_phone,
      seller_name: editForm.seller_name,
      amount,
      net_amount: Number.isFinite(netAmount) ? netAmount : amount,
      gross_amount: Number.isFinite(grossAmount) ? grossAmount : amount,
    };
    const { error } = await supabase.from("sales_invoices").update(payload).eq("id", editInvoice.id);
    if (error) {
      toast.error(`تعذر تعديل الفاتورة: ${error.message}`);
    } else {
      toast.success("تم حفظ تعديل الفاتورة");
      await logInvoiceAdminAction("تعديل فاتورة", `تعديل فاتورة ${editForm.invoice_number || editInvoice.id}`, {
        invoice_id: editInvoice.id,
        new_value: payload,
      });
      setEditInvoice(null);
      setEditForm(null);
      await loadManagedInvoices();
    }
    setAdminBusy(false);
  };

  const validCount = parseResult?.rows.length ?? 0;
  const errorCount = parseResult?.errors.length ?? 0;
  const totalAmount = importKind === "sales" && parseResult
    ? (parseResult as ParseResult).rows.reduce((sum, row) => sum + row.amount, 0)
    : 0;

  const rowsForPreview = parseResult?.rows.slice(0, 120) ?? [];

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
        <div className="section-title mb-3">استيراد يومي ثابت</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <InfoBox title="ملف المبيعات" items={["الهيدر في الصف الثاني", "يعتمد الكود والعميل وقيمة الصافي", "يحفظ المستخدم داخل بيانات الفاتورة لتحليل الدكاترة"]} />
          <InfoBox title="ملف العملاء" items={["الكود هو مفتاح الربط", "الموبايل/التليفون لتحديث العميل", "العنوان محفوظ مع بيانات العميل إن كان العمود موجودًا"]} />
          <InfoBox title="تصنيف العملاء" items={["مهم جدًا: 8000+", "مهم: 4000 إلى 8000", "متوسط: 1500 إلى 4000", "عادي: أقل من 1500"]} />
        </div>
        <button onClick={generateTemplateFile} className="btn-secondary mt-4 flex items-center gap-2">
          <Download size={15} /> تحميل نموذج مبيعات
        </button>
      </div>

      {isAdmin && (
        <div className="bg-[#1B2B4B] border border-red-500/25 rounded-2xl p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="section-title flex items-center gap-2">
                <ShieldAlert size={18} className="text-red-300" />
                إدارة الفواتير المستوردة
              </div>
              <div className="text-slate-400 text-xs mt-1">
                هذا القسم ظاهر للمدير العام فقط. استخدمه لمسح بيانات التجربة أو تعديل فاتورة قبل إعادة الرفع المنظم.
              </div>
            </div>
            <button
              type="button"
              onClick={loadManagedInvoices}
              disabled={managedLoading || adminBusy}
              className="btn-secondary px-4 py-2 text-sm flex items-center gap-2"
            >
              <RefreshCw size={15} className={managedLoading ? "animate-spin" : ""} />
              تحديث القائمة
            </button>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <label className="block text-xs text-slate-300 space-y-1">
              <span>لمسح كل الفواتير التجريبية اكتب: مسح الفواتير</span>
              <input
                className="input-dark"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="مسح الفواتير"
              />
            </label>
            <button
              type="button"
              onClick={deleteAllInvoices}
              disabled={adminBusy || deleteConfirmText.trim() !== "مسح الفواتير"}
              className="rounded-xl bg-red-500/20 border border-red-400/30 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 size={15} />
              مسح كل الفواتير
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={managedInvoices.length} label="فواتير محملة" color="text-white" />
            <StatTile value={invoiceBatches.length} label="دفعات ظاهرة" color="text-teal-400" />
            <StatTile value={managedInvoices.reduce((sum, row) => sum + invoiceSalesValue(row), 0)} label="إجمالي الظاهر" color="text-amber-400" isCurrency />
            <StatTile value={new Set(managedInvoices.map((row) => row.customer_code || row.customer_phone || row.customer_name).filter(Boolean)).size} label="عملاء ظاهرين" color="text-purple-300" />
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">آخر دفعات الرفع</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                  <tr>
                    <th>الدفعة</th>
                    <th>الفترة</th>
                    <th>الفروع</th>
                    <th>عدد الفواتير</th>
                    <th>الإجمالي</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceBatches.map((batchRow) => (
                    <tr key={batchRow.batch}>
                      <td className="text-white font-medium max-w-xs truncate">{batchRow.batch}</td>
                      <td className="text-slate-300">{batchRow.firstDate} إلى {batchRow.lastDate}</td>
                      <td className="text-slate-300">{[...batchRow.branches].join("، ") || "-"}</td>
                      <td className="num">{batchRow.count.toLocaleString("ar-EG")}</td>
                      <td className="text-amber-300 font-bold">{formatCurrency(batchRow.total)}</td>
                      <td>
                        <div className="flex gap-2">
                          <Link
                            to={`/analytics?start=${batchRow.firstDate}&end=${batchRow.lastDate}`}
                            className="rounded-lg border border-teal-400/30 bg-teal-500/10 p-2 text-teal-200 hover:bg-teal-500/20 disabled:opacity-50"
                            title="فتح في التحليلات"
                          >
                            <BarChart3 size={15} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => deleteInvoiceBatch(batchRow.batch)}
                            disabled={adminBusy}
                            className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                            title="مسح هذه الدفعة"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {invoiceBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-6">لا توجد فواتير مستوردة حاليا.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">آخر الفواتير للتعديل السريع</div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="data-table">
                <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>التاريخ</th>
                    <th>الفرع</th>
                    <th>العميل</th>
                    <th>الدكتور</th>
                    <th>القيمة</th>
                    <th>تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {managedInvoices.slice(0, 120).map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="num">{invoice.invoice_number || "-"}</td>
                      <td>{invoice.invoice_date ? formatDate(invoice.invoice_date) : "-"}</td>
                      <td>{invoice.branch || "-"}</td>
                      <td>{invoice.customer_name || invoice.customer_code || "-"}</td>
                      <td>{invoice.seller_name || "-"}</td>
                      <td className="text-teal-300 font-bold">{formatCurrency(invoiceSalesValue(invoice))}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => startEditInvoice(invoice)}
                          disabled={adminBusy}
                          className="rounded-lg border border-teal-400/30 bg-teal-500/10 p-2 text-teal-200 hover:bg-teal-500/20 disabled:opacity-50"
                          title="تعديل الفاتورة"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {managedInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-slate-400 py-6">لا توجد فواتير للتعديل.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <span className="text-slate-300 text-sm font-medium w-24">نوع الملف</span>
          <div className="flex gap-2 bg-white/5 border border-[#2d4063] p-1 rounded-xl w-fit">
            <button onClick={() => setImportKind("sales")} disabled={step === "importing"} className={kindButton(importKind === "sales")}>مبيعات يومية</button>
            <button onClick={() => setImportKind("customers")} disabled={step === "importing"} className={kindButton(importKind === "customers")}>بيانات العملاء</button>
          </div>
        </div>

        {importKind === "sales" && (
          <div className="flex items-center gap-3">
            <label className="text-slate-300 text-sm font-medium w-24">الفرع</label>
            <select value={branch} onChange={(event) => setBranch(event.target.value)} disabled={step === "importing"} className="input-dark max-w-xs">
              {BRANCHES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        )}

        {(step === "idle" || step === "parsing") && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) processFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
              dragging ? "border-teal-400 bg-teal-500/5" : "border-[#2d4063] hover:border-teal-500/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) processFile(file);
              }}
            />
            {step === "parsing" ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={34} className="animate-spin text-teal-400" />
                <div className="text-slate-300 font-medium">جاري تحليل الملف...</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <Upload size={26} className="text-teal-400" />
                </div>
                <div className="text-white font-bold">اسحب الملف هنا أو اضغط للاختيار</div>
                <div className="text-slate-400 text-sm">{importKind === "sales" ? "ملف مبيعات الفرعين اليومي" : "ملف بيانات العملاء"}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {(step === "preview" || step === "importing" || step === "done") && parseResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-[#1B2B4B] border border-[#2d4063] rounded-2xl px-5 py-3">
            <FileSpreadsheet size={20} className="text-teal-400" />
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{fileName}</div>
              <div className="text-slate-400 text-xs">{importKind === "sales" ? "مبيعات يومية" : "بيانات العملاء"}</div>
            </div>
            {step === "preview" && <button onClick={handleReset} className="text-slate-500 hover:text-slate-300"><XCircle size={18} /></button>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={validCount + errorCount} label="إجمالي الصفوف" color="text-white" />
            <StatTile value={validCount} label="صفوف صالحة" color="text-teal-400" />
            <StatTile value={errorCount} label="أخطاء" color={errorCount ? "text-red-400" : "text-slate-400"} />
            <StatTile value={importKind === "sales" ? totalAmount : validCount} label={importKind === "sales" ? "إجمالي المبالغ" : "عملاء جاهزون"} color="text-amber-400" isCurrency={importKind === "sales"} />
          </div>

          {errorCount > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
              <div className="text-red-400 font-semibold text-sm flex items-center gap-2 mb-3"><AlertCircle size={16} /> أخطاء القراءة</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {parseResult.errors.slice(0, 80).map((error, index) => (
                  <div key={index} className="text-red-200/80 text-xs bg-red-500/5 rounded-lg px-3 py-2">{error.message}</div>
                ))}
              </div>
            </div>
          )}

          {validCount > 0 && (
            <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#2d4063] flex items-center gap-2 text-white font-semibold text-sm">
                <FileCheck size={16} className="text-teal-400" /> معاينة أول الصفوف
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                    <tr>
                      <th>#</th>
                      <th>العميل</th>
                      <th>{importKind === "sales" ? "الكود" : "كود العميل"}</th>
                      <th>{importKind === "sales" ? "المبلغ" : "الهاتف"}</th>
                      <th>{importKind === "sales" ? "التاريخ" : "العنوان"}</th>
                      {importKind === "sales" && <th>المستخدم</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForPreview.map((row, index) => (
                      <tr key={index}>
                        <td className="text-slate-500 text-xs">{row.rowIndex}</td>
                        <td className="text-white font-medium">{row.name}</td>
                        <td className="num">{importKind === "sales" ? (row as ParseResult["rows"][number]).customerCode : (row as CustomerParseResult["rows"][number]).code}</td>
                        <td className="text-teal-400 font-bold num">{importKind === "sales" ? formatCurrency((row as ParseResult["rows"][number]).amount) : ((row as CustomerParseResult["rows"][number]).phone || "-")}</td>
                        <td className="text-slate-400">{importKind === "sales" ? formatDate((row as ParseResult["rows"][number]).date) : ((row as CustomerParseResult["rows"][number]).address || "-")}</td>
                        {importKind === "sales" && <td className="text-slate-300">{(row as ParseResult["rows"][number]).seller || "-"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-semibold text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin text-teal-400" /> جاري الاستيراد...</div>
                <span className="text-teal-400 font-bold text-sm num">{progress}%</span>
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {step === "preview" && validCount > 0 && (
            <div className="flex gap-3">
              <button onClick={handleConfirmImport} className="btn-primary flex items-center gap-2">
                <CheckCircle size={16} /> تأكيد استيراد {validCount.toLocaleString("ar-EG")} {importKind === "sales" ? "فاتورة" : "عميل"}
              </button>
              <button onClick={handleReset} className="btn-secondary flex items-center gap-2"><XCircle size={16} /> إلغاء</button>
            </div>
          )}
        </div>
      )}

      {step === "done" && importSummary && (
        <div className="bg-[#1B2B4B] border border-teal-500/20 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 flex items-center justify-center"><CheckCircle size={24} className="text-teal-400" /></div>
            <div>
              <div className="text-white font-bold text-lg">اكتمل الاستيراد</div>
              <div className="text-slate-400 text-sm">{importKind === "sales" ? "تم تحديث الفواتير والعملاء" : "تم تحديث بيانات العملاء"}</div>
            </div>
          </div>
          <div className={`grid gap-3 ${importKind === "sales" ? "grid-cols-2 md:grid-cols-6" : "grid-cols-2 md:grid-cols-4"}`}>
            <ResultTile value={importSummary.insertedRows} label="صفوف أضيفت" />
            <ResultTile value={importSummary.skippedDuplicates} label="مكرر تخطى" />
            <ResultTile value={importSummary.updatedCustomers} label="عميل محدث" />
            <ResultTile value={importSummary.newCustomers} label="عميل جديد" />
            {importKind === "sales" && (
              <>
                <ResultTile value={importSummary.needsReviewRows} label="تحتاج مراجعة" />
                <ResultTile value={importSummary.unlinkedCustomersEstimate} label="ربط عميل ضعيف" />
                <ResultTile value={importSummary.unmatchedCustomerRows || 0} label="عميل غير مسجل" />
                <ResultTile value={importSummary.zeroAmountRows || 0} label="فواتير صفرية" />
                <ResultTile value={Math.round(importSummary.fileNetSales || 0)} label="صافي الملف" />
                <ResultTile value={Math.round(importSummary.importedNetSales || 0)} label="صافي المستورد" />
              </>
            )}
          </div>
          {importKind === "sales" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 font-bold text-white">عدد الفواتير حسب اليوم</div>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {(importSummary.dailyCounts || []).map((row) => (
                    <div key={row.date} className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200">
                      <span>{row.date}</span>
                      <span>{row.count.toLocaleString("ar-EG")} | {formatCurrency(row.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 font-bold text-white">عدد الفواتير حسب الفرع</div>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {(importSummary.branchCounts || []).map((row) => (
                    <div key={row.branch} className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200">
                      <span>{row.branch}</span>
                      <span>{row.count.toLocaleString("ar-EG")} | {formatCurrency(row.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {importKind === "sales" && (importSummary.skippedDuplicateInvoices?.length || 0) > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="mb-3 font-bold text-amber-200">فواتير مكررة تم تخطيها</div>
              <div className="max-h-44 space-y-2 overflow-auto">
                {(importSummary.skippedDuplicateInvoices || []).slice(0, 30).map((row, index) => (
                  <div key={`${row.branch}-${row.date}-${row.invoiceNumber}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200">
                    <span>{row.invoiceNumber}</span>
                    <span>{row.branch} | {row.date}</span>
                  </div>
                ))}
              </div>
              {(importSummary.skippedDuplicateInvoices?.length || 0) > 30 && (
                <div className="mt-2 text-xs text-amber-100/80">تم عرض أول 30 فقط من التكرارات.</div>
              )}
            </div>
          )}
          {importSummary.errors.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
              {importSummary.errors.slice(0, 20).map((error, index) => <div key={index} className="text-red-200/80 text-xs">{error.message}</div>)}
            </div>
          )}
          <button onClick={handleReset} className="btn-primary flex items-center gap-2"><RefreshCw size={16} /> استيراد ملف آخر</button>
        </div>
      )}

      {isAdmin && editInvoice && editForm && (
        <div className="modal-backdrop" onClick={() => {
          setEditInvoice(null);
          setEditForm(null);
        }}>
          <div className="modal-panel max-w-3xl p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <div className="section-title">تعديل فاتورة</div>
                <div className="text-slate-400 text-xs mt-1">أي تعديل هنا ينعكس على التحليلات بعد تحديث الصفحة.</div>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-white"
                onClick={() => {
                  setEditInvoice(null);
                  setEditForm(null);
                }}
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <EditField label="الفرع" value={editForm.branch} onChange={(value) => setEditForm({ ...editForm, branch: value })} />
              <EditField label="رقم الفاتورة" value={editForm.invoice_number} onChange={(value) => setEditForm({ ...editForm, invoice_number: value })} />
              <label className="text-slate-300 text-xs space-y-1 block">
                <span>تاريخ الفاتورة</span>
                <input className="input-dark" type="date" value={editForm.invoice_date} onChange={(event) => setEditForm({ ...editForm, invoice_date: event.target.value })} />
              </label>
              <EditField label="نوع الفاتورة" value={editForm.invoice_type} onChange={(value) => setEditForm({ ...editForm, invoice_type: value })} />
              <EditField label="كود العميل" value={editForm.customer_code} onChange={(value) => setEditForm({ ...editForm, customer_code: value })} />
              <EditField label="اسم العميل" value={editForm.customer_name} onChange={(value) => setEditForm({ ...editForm, customer_name: value })} />
              <EditField label="هاتف العميل" value={editForm.customer_phone} onChange={(value) => setEditForm({ ...editForm, customer_phone: value })} />
              <EditField label="الدكتور/المستخدم" value={editForm.seller_name} onChange={(value) => setEditForm({ ...editForm, seller_name: value })} />
              <EditField label="صافي الفاتورة" value={editForm.amount} type="number" onChange={(value) => setEditForm({ ...editForm, amount: value })} />
              <EditField label="بعد الخصم" value={editForm.net_amount} type="number" onChange={(value) => setEditForm({ ...editForm, net_amount: value })} />
              <EditField label="قيمة الفاتورة قبل الخصم" value={editForm.gross_amount} type="number" onChange={(value) => setEditForm({ ...editForm, gross_amount: value })} />
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" className="btn-primary flex items-center gap-2" onClick={saveInvoiceEdit} disabled={adminBusy}>
                <Save size={16} />
                حفظ التعديل
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditInvoice(null);
                  setEditForm(null);
                }}
                disabled={adminBusy}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function kindButton(active: boolean) {
  return `px-4 py-2 rounded-lg text-sm font-semibold transition-all ${active ? "bg-teal-500 text-navy-900" : "text-slate-400 hover:text-white hover:bg-white/5"}`;
}

function InfoBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-teal-500/10 rounded-xl p-3 border border-white/5">
      <div className="text-slate-300 font-semibold mb-2 text-xs">{title}</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-slate-400 text-xs flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({ value, label, color, isCurrency = false }: { value: number; label: string; color: string; isCurrency?: boolean }) {
  return (
    <div className="stat-card text-center">
      <div className={`text-xl font-bold ${color} num`}>{isCurrency ? formatCurrency(value) : value.toLocaleString("ar-EG")}</div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="text-slate-300 text-xs space-y-1 block">
      <span>{label}</span>
      <input className="input-dark" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ResultTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-teal-500/10 border border-white/5 rounded-2xl p-4">
      <div className="text-xl font-bold text-teal-400 num">{value.toLocaleString("ar-EG")}</div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}
