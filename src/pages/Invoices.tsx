import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Download, Loader2, XCircle, FileCheck, RefreshCw, ShieldAlert, Trash2, Pencil, Save } from "lucide-react";
import { BRANCHES } from "@/lib/constants";
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

const INVOICE_PAGE_SIZE = 1000;

function invoiceSalesValue(invoice: Pick<ManagedInvoiceRow, "net_amount" | "amount" | "gross_amount">) {
  return Number(invoice.net_amount ?? invoice.amount ?? invoice.gross_amount ?? 0) || 0;
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

  const loadManagedInvoices = useCallback(async () => {
    if (!isAdmin) return;
    setManagedLoading(true);
    const allRows: ManagedInvoiceRow[] = [];
    for (let from = 0; from < 200000; from += INVOICE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id,import_batch,branch,invoice_number,invoice_date,invoice_type,customer_code,customer_name,customer_phone,amount,net_amount,gross_amount,seller_name")
        .order("invoice_date", { ascending: false })
        .range(from, from + INVOICE_PAGE_SIZE - 1);

      if (error) {
        toast.error(`تعذر تحميل كل الفواتير: ${error.message}`);
        break;
      }

      allRows.push(...((data || []) as ManagedInvoiceRow[]));
      if (!data || data.length < INVOICE_PAGE_SIZE) break;
    }
    setManagedInvoices(allRows);
    setManagedLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void loadManagedInvoices();
  }, [loadManagedInvoices]);

  const readFile = (file: File): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as ArrayBuffer);
      reader.onerror = () => reject(new Error("ØªØ¹Ø°Ø± Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ù…Ù„Ù"));
      reader.readAsArrayBuffer(file);
    });

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["csv", "xlsx", "xls"].includes(ext)) {
      toast.error("Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…. Ø§Ø³ØªØ®Ø¯Ù… Excel Ø£Ùˆ CSV");
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

      if (result.rows.length === 0) toast.error("Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ ØµÙÙˆÙ ØµØ§Ù„Ø­Ø© ÙÙŠ Ø§Ù„Ù…Ù„Ù");
      else toast.success(`ØªÙ… ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ù„Ù: ${result.rows.length.toLocaleString("ar-EG")} ØµÙ ØµØ§Ù„Ø­`);
    } catch (error) {
      toast.error(`Ø®Ø·Ø£: ${(error as Error).message}`);
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
      toast.success(importKind === "sales" ? "ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ù„Ù Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª" : "ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡");

      const currentUserProfile = getCurrentUserProfile();
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        importKind === "sales" ? "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ø¨ÙŠØ¹Ø§Øª ÙŠÙˆÙ…ÙŠØ©" : "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ø¹Ù…Ù„Ø§Ø¡",
        importKind === "sales" ? "Ø§Ù„ÙÙˆØ§ØªÙŠØ±" : "Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡",
        `Ø§Ø³ØªÙŠØ±Ø§Ø¯ ${summary.insertedRows} ØµÙ - ØªØ­Ø¯ÙŠØ« ${summary.updatedCustomers} Ø¹Ù…ÙŠÙ„ - Ø¥Ø¶Ø§ÙØ© ${summary.newCustomers} Ø¹Ù…ÙŠÙ„`,
        branch
      );
      if (importKind === "sales") {
        await loadManagedInvoices();
        await supabase.from("notifications").insert({
          title: "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ù„Ù ÙÙˆØ§ØªÙŠØ± Ø¬Ø¯ÙŠØ¯",
          message: `ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ ${summary.insertedRows} ÙØ§ØªÙˆØ±Ø© Ù…Ø¨ÙŠØ¹Ø§Øª Ù…Ù† Ù…Ù„Ù ${fileName}`,
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
      toast.error(`ÙØ´Ù„ Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯: ${(error as Error).message}`);
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
      const batch = invoice.import_batch || "Ø¨Ø¯ÙˆÙ† Ø±Ù‚Ù… Ø¯ÙØ¹Ø©";
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
      "Ø§Ù„ÙÙˆØ§ØªÙŠØ±",
      description,
      "ÙƒÙ„ Ø§Ù„ÙØ±ÙˆØ¹",
      details,
    );
  };

  const deleteInvoiceBatch = async (batch: string) => {
    if (!isAdmin || adminBusy) return;
    if (!window.confirm(`ØªØ£ÙƒÙŠØ¯ Ù…Ø³Ø­ Ø¯ÙØ¹Ø© Ø§Ù„ÙÙˆØ§ØªÙŠØ±: ${batch}`)) return;

    setAdminBusy(true);
    const affectedIdentifiers = Array.from(new Set(
      managedInvoices
        .filter((invoice) => (batch === "Ø¨Ø¯ÙˆÙ† Ø±Ù‚Ù… Ø¯ÙØ¹Ø©" ? !invoice.import_batch : invoice.import_batch === batch))
        .map((invoice) => invoice.customer_code || invoice.customer_phone)
        .filter(Boolean),
    ));
    const query = supabase.from("sales_invoices").delete();
    const { error } = batch === "Ø¨Ø¯ÙˆÙ† Ø±Ù‚Ù… Ø¯ÙØ¹Ø©"
      ? await query.is("import_batch", null)
      : await query.eq("import_batch", batch);

    if (error) {
      toast.error(`ØªØ¹Ø°Ø± Ù…Ø³Ø­ Ø§Ù„Ø¯ÙØ¹Ø©: ${error.message}`);
    } else {
      toast.success("ØªÙ… Ù…Ø³Ø­ Ø¯ÙØ¹Ø© Ø§Ù„ÙÙˆØ§ØªÙŠØ±");
      if (affectedIdentifiers.length > 0) {
        await supabase.from("customer_analysis").delete().in("customer_code", affectedIdentifiers);
      }
      await logInvoiceAdminAction("Ù…Ø³Ø­ Ø¯ÙØ¹Ø© ÙÙˆØ§ØªÙŠØ±", `Ù…Ø³Ø­ Ø¯ÙØ¹Ø© ${batch}`, { import_batch: batch });
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
    if (deleteConfirmText.trim() !== "Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±") {
      toast.error("Ø§ÙƒØªØ¨ Ø¹Ø¨Ø§Ø±Ø© Ø§Ù„ØªØ£ÙƒÙŠØ¯ ÙƒÙ…Ø§ Ù‡ÙŠ: Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±");
      return;
    }

    setAdminBusy(true);
    const loadingToast = toast.loading("Ø¬Ø§Ø±ÙŠ Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ø¹Ù„Ù‰ Ø¯ÙØ¹Ø§Øª...");
    try {
      const deletedInvoices = await deleteTableRowsInChunks("sales_invoices");
      await deleteTableRowsInChunks("customer_analysis");
      await logInvoiceAdminAction("Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„ÙÙˆØ§ØªÙŠØ±", "Ù…Ø³Ø­ ÙƒÙ„ ÙÙˆØ§ØªÙŠØ± Ø§Ù„ØªØ¬Ø±Ø¨Ø© ÙˆØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ù…Ø±ØªØ¨Ø· Ø¨Ù‡Ø§", {
        deleted_invoice_count: deletedInvoices,
      });
      setDeleteConfirmText("");
      setManagedInvoices([]);
      toast.success("ØªÙ… Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ©. ÙŠÙ…ÙƒÙ†Ùƒ Ø±ÙØ¹ Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ù…Ù† Ø§Ù„Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø¢Ù†.", { id: loadingToast });
    } catch (error) {
      toast.error(`ØªØ¹Ø°Ø± Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±: ${(error as Error).message}`, { id: loadingToast });
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
      toast.error("Ø±Ø§Ø¬Ø¹ Ø§Ù„ØªØ§Ø±ÙŠØ® ÙˆÙ‚ÙŠÙ…Ø© Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ù‚Ø¨Ù„ Ø§Ù„Ø­ÙØ¸");
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
      toast.error(`ØªØ¹Ø°Ø± ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„ÙØ§ØªÙˆØ±Ø©: ${error.message}`);
    } else {
      toast.success("ØªÙ… Ø­ÙØ¸ ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„ÙØ§ØªÙˆØ±Ø©");
      await logInvoiceAdminAction("ØªØ¹Ø¯ÙŠÙ„ ÙØ§ØªÙˆØ±Ø©", `ØªØ¹Ø¯ÙŠÙ„ ÙØ§ØªÙˆØ±Ø© ${editForm.invoice_number || editInvoice.id}`, {
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
        <div className="section-title mb-3">Ø§Ø³ØªÙŠØ±Ø§Ø¯ ÙŠÙˆÙ…ÙŠ Ø«Ø§Ø¨Øª</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <InfoBox title="Ù…Ù„Ù Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª" items={["Ø§Ù„Ù‡ÙŠØ¯Ø± ÙÙŠ Ø§Ù„ØµÙ Ø§Ù„Ø«Ø§Ù†ÙŠ", "ÙŠØ¹ØªÙ…Ø¯ Ø§Ù„ÙƒÙˆØ¯ ÙˆØ§Ù„Ø¹Ù…ÙŠÙ„ ÙˆÙ‚ÙŠÙ…Ø© Ø§Ù„ØµØ§ÙÙŠ", "ÙŠØ­ÙØ¸ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø¯Ø§Ø®Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¯ÙƒØ§ØªØ±Ø©"]} />
          <InfoBox title="Ù…Ù„Ù Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡" items={["Ø§Ù„ÙƒÙˆØ¯ Ù‡Ùˆ Ù…ÙØªØ§Ø­ Ø§Ù„Ø±Ø¨Ø·", "Ø§Ù„Ù…ÙˆØ¨Ø§ÙŠÙ„/Ø§Ù„ØªÙ„ÙŠÙÙˆÙ† Ù„ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø¹Ù…ÙŠÙ„", "Ø§Ù„Ø¹Ù†ÙˆØ§Ù† Ù…Ø­ÙÙˆØ¸ Ù…Ø¹ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„ Ø¥Ù† ÙƒØ§Ù† Ø§Ù„Ø¹Ù…ÙˆØ¯ Ù…ÙˆØ¬ÙˆØ¯Ù‹Ø§"]} />
          <InfoBox title="ØªØµÙ†ÙŠÙ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡" items={["Ù…Ù‡Ù… Ø¬Ø¯Ø§Ù‹: 8000+", "Ù…Ù‡Ù…: 4000 Ø¥Ù„Ù‰ 8000", "Ù…ØªÙˆØ³Ø·: 1500 Ø¥Ù„Ù‰ 4000", "Ø¹Ø§Ø¯ÙŠ: Ø£Ù‚Ù„ Ù…Ù† 1500"]} />
        </div>
        <button onClick={generateTemplateFile} className="btn-secondary mt-4 flex items-center gap-2">
          <Download size={15} /> ØªØ­Ù…ÙŠÙ„ Ù†Ù…ÙˆØ°Ø¬ Ù…Ø¨ÙŠØ¹Ø§Øª
        </button>
      </div>

      {isAdmin && (
        <div className="bg-[#1B2B4B] border border-red-500/25 rounded-2xl p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="section-title flex items-center gap-2">
                <ShieldAlert size={18} className="text-red-300" />
                Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ø§Ù„Ù…Ø³ØªÙˆØ±Ø¯Ø©
              </div>
              <div className="text-slate-400 text-xs mt-1">
                Ù‡Ø°Ø§ Ø§Ù„Ù‚Ø³Ù… Ø¸Ø§Ù‡Ø± Ù„Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø¹Ø§Ù… ÙÙ‚Ø·. Ø§Ø³ØªØ®Ø¯Ù…Ù‡ Ù„Ù…Ø³Ø­ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªØ¬Ø±Ø¨Ø© Ø£Ùˆ ØªØ¹Ø¯ÙŠÙ„ ÙØ§ØªÙˆØ±Ø© Ù‚Ø¨Ù„ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø±ÙØ¹ Ø§Ù„Ù…Ù†Ø¸Ù….
              </div>
            </div>
            <button
              type="button"
              onClick={loadManagedInvoices}
              disabled={managedLoading || adminBusy}
              className="btn-secondary px-4 py-2 text-sm flex items-center gap-2"
            >
              <RefreshCw size={15} className={managedLoading ? "animate-spin" : ""} />
              ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©
            </button>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <label className="block text-xs text-slate-300 space-y-1">
              <span>Ù„Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ© Ø§ÙƒØªØ¨: Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±</span>
              <input
                className="input-dark"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±"
              />
            </label>
            <button
              type="button"
              onClick={deleteAllInvoices}
              disabled={adminBusy || deleteConfirmText.trim() !== "Ù…Ø³Ø­ Ø§Ù„ÙÙˆØ§ØªÙŠØ±"}
              className="rounded-xl bg-red-500/20 border border-red-400/30 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 size={15} />
              Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„ÙÙˆØ§ØªÙŠØ±
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={managedInvoices.length} label="ÙÙˆØ§ØªÙŠØ± Ù…Ø­Ù…Ù„Ø©" color="text-white" />
            <StatTile value={invoiceBatches.length} label="Ø¯ÙØ¹Ø§Øª Ø¸Ø§Ù‡Ø±Ø©" color="text-teal-400" />
            <StatTile value={managedInvoices.reduce((sum, row) => sum + invoiceSalesValue(row), 0)} label="Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¸Ø§Ù‡Ø±" color="text-amber-400" isCurrency />
            <StatTile value={new Set(managedInvoices.map((row) => row.customer_code || row.customer_phone || row.customer_name).filter(Boolean)).size} label="Ø¹Ù…Ù„Ø§Ø¡ Ø¸Ø§Ù‡Ø±ÙŠÙ†" color="text-purple-300" />
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">Ø¢Ø®Ø± Ø¯ÙØ¹Ø§Øª Ø§Ù„Ø±ÙØ¹</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ø§Ù„Ø¯ÙØ¹Ø©</th>
                    <th>Ø§Ù„ÙØªØ±Ø©</th>
                    <th>Ø§Ù„ÙØ±ÙˆØ¹</th>
                    <th>Ø¹Ø¯Ø¯ Ø§Ù„ÙÙˆØ§ØªÙŠØ±</th>
                    <th>Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ</th>
                    <th>Ù…Ø³Ø­</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceBatches.map((batchRow) => (
                    <tr key={batchRow.batch}>
                      <td className="text-white font-medium max-w-xs truncate">{batchRow.batch}</td>
                      <td className="text-slate-300">{batchRow.firstDate} Ø¥Ù„Ù‰ {batchRow.lastDate}</td>
                      <td className="text-slate-300">{[...batchRow.branches].join("ØŒ ") || "-"}</td>
                      <td className="num">{batchRow.count.toLocaleString("ar-EG")}</td>
                      <td className="text-amber-300 font-bold">{formatCurrency(batchRow.total)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => deleteInvoiceBatch(batchRow.batch)}
                          disabled={adminBusy}
                          className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                          title="Ù…Ø³Ø­ Ù‡Ø°Ù‡ Ø§Ù„Ø¯ÙØ¹Ø©"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {invoiceBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-6">Ù„Ø§ ØªÙˆØ¬Ø¯ ÙÙˆØ§ØªÙŠØ± Ù…Ø³ØªÙˆØ±Ø¯Ø© Ø­Ø§Ù„ÙŠØ§.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">Ø¢Ø®Ø± Ø§Ù„ÙÙˆØ§ØªÙŠØ± Ù„Ù„ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø³Ø±ÙŠØ¹</div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø©</th>
                    <th>Ø§Ù„ØªØ§Ø±ÙŠØ®</th>
                    <th>Ø§Ù„ÙØ±Ø¹</th>
                    <th>Ø§Ù„Ø¹Ù…ÙŠÙ„</th>
                    <th>Ø§Ù„Ø¯ÙƒØªÙˆØ±</th>
                    <th>Ø§Ù„Ù‚ÙŠÙ…Ø©</th>
                    <th>ØªØ¹Ø¯ÙŠÙ„</th>
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
                          title="ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„ÙØ§ØªÙˆØ±Ø©"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {managedInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-slate-400 py-6">Ù„Ø§ ØªÙˆØ¬Ø¯ ÙÙˆØ§ØªÙŠØ± Ù„Ù„ØªØ¹Ø¯ÙŠÙ„.</td>
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
          <span className="text-slate-300 text-sm font-medium w-24">Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù</span>
          <div className="flex gap-2 bg-white/5 border border-[#2d4063] p-1 rounded-xl w-fit">
            <button onClick={() => setImportKind("sales")} disabled={step === "importing"} className={kindButton(importKind === "sales")}>Ù…Ø¨ÙŠØ¹Ø§Øª ÙŠÙˆÙ…ÙŠØ©</button>
            <button onClick={() => setImportKind("customers")} disabled={step === "importing"} className={kindButton(importKind === "customers")}>Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡</button>
          </div>
        </div>

        {importKind === "sales" && (
          <div className="flex items-center gap-3">
            <label className="text-slate-300 text-sm font-medium w-24">Ø§Ù„ÙØ±Ø¹</label>
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
                <div className="text-slate-300 font-medium">Ø¬Ø§Ø±ÙŠ ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ù„Ù...</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <Upload size={26} className="text-teal-400" />
                </div>
                <div className="text-white font-bold">Ø§Ø³Ø­Ø¨ Ø§Ù„Ù…Ù„Ù Ù‡Ù†Ø§ Ø£Ùˆ Ø§Ø¶ØºØ· Ù„Ù„Ø§Ø®ØªÙŠØ§Ø±</div>
                <div className="text-slate-400 text-sm">{importKind === "sales" ? "Ù…Ù„Ù Ù…Ø¨ÙŠØ¹Ø§Øª Ø§Ù„ÙØ±Ø¹ÙŠÙ† Ø§Ù„ÙŠÙˆÙ…ÙŠ" : "Ù…Ù„Ù Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡"}</div>
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
              <div className="text-slate-400 text-xs">{importKind === "sales" ? "Ù…Ø¨ÙŠØ¹Ø§Øª ÙŠÙˆÙ…ÙŠØ©" : "Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡"}</div>
            </div>
            {step === "preview" && <button onClick={handleReset} className="text-slate-500 hover:text-slate-300"><XCircle size={18} /></button>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={validCount + errorCount} label="Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØµÙÙˆÙ" color="text-white" />
            <StatTile value={validCount} label="ØµÙÙˆÙ ØµØ§Ù„Ø­Ø©" color="text-teal-400" />
            <StatTile value={errorCount} label="Ø£Ø®Ø·Ø§Ø¡" color={errorCount ? "text-red-400" : "text-slate-400"} />
            <StatTile value={importKind === "sales" ? totalAmount : validCount} label={importKind === "sales" ? "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…Ø¨Ø§Ù„Øº" : "Ø¹Ù…Ù„Ø§Ø¡ Ø¬Ø§Ù‡Ø²ÙˆÙ†"} color="text-amber-400" isCurrency={importKind === "sales"} />
          </div>

          {errorCount > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
              <div className="text-red-400 font-semibold text-sm flex items-center gap-2 mb-3"><AlertCircle size={16} /> Ø£Ø®Ø·Ø§Ø¡ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø©</div>
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
                <FileCheck size={16} className="text-teal-400" /> Ù…Ø¹Ø§ÙŠÙ†Ø© Ø£ÙˆÙ„ Ø§Ù„ØµÙÙˆÙ
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Ø§Ù„Ø¹Ù…ÙŠÙ„</th>
                      <th>{importKind === "sales" ? "Ø§Ù„ÙƒÙˆØ¯" : "ÙƒÙˆØ¯ Ø§Ù„Ø¹Ù…ÙŠÙ„"}</th>
                      <th>{importKind === "sales" ? "Ø§Ù„Ù…Ø¨Ù„Øº" : "Ø§Ù„Ù‡Ø§ØªÙ"}</th>
                      <th>{importKind === "sales" ? "Ø§Ù„ØªØ§Ø±ÙŠØ®" : "Ø§Ù„Ø¹Ù†ÙˆØ§Ù†"}</th>
                      {importKind === "sales" && <th>Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…</th>}
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
                <div className="text-white font-semibold text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin text-teal-400" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯...</div>
                <span className="text-teal-400 font-bold text-sm num">{progress}%</span>
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {step === "preview" && validCount > 0 && (
            <div className="flex gap-3">
              <button onClick={handleConfirmImport} className="btn-primary flex items-center gap-2">
                <CheckCircle size={16} /> ØªØ£ÙƒÙŠØ¯ Ø§Ø³ØªÙŠØ±Ø§Ø¯ {validCount.toLocaleString("ar-EG")} {importKind === "sales" ? "ÙØ§ØªÙˆØ±Ø©" : "Ø¹Ù…ÙŠÙ„"}
              </button>
              <button onClick={handleReset} className="btn-secondary flex items-center gap-2"><XCircle size={16} /> Ø¥Ù„ØºØ§Ø¡</button>
            </div>
          )}
        </div>
      )}

      {step === "done" && importSummary && (
        <div className="bg-[#1B2B4B] border border-teal-500/20 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 flex items-center justify-center"><CheckCircle size={24} className="text-teal-400" /></div>
            <div>
              <div className="text-white font-bold text-lg">Ø§ÙƒØªÙ…Ù„ Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯</div>
              <div className="text-slate-400 text-sm">{importKind === "sales" ? "ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ù„ÙÙˆØ§ØªÙŠØ± ÙˆØ§Ù„Ø¹Ù…Ù„Ø§Ø¡" : "ØªÙ… ØªØ­Ø¯ÙŠØ« Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡"}</div>
            </div>
          </div>
          <div className={`grid gap-3 ${importKind === "sales" ? "grid-cols-2 md:grid-cols-6" : "grid-cols-2 md:grid-cols-4"}`}>
            <ResultTile value={importSummary.insertedRows} label="ØµÙÙˆÙ Ø£Ø¶ÙŠÙØª" />
            <ResultTile value={importSummary.skippedDuplicates} label="Ù…ÙƒØ±Ø± ØªØ®Ø·Ù‰" />
            <ResultTile value={importSummary.updatedCustomers} label="Ø¹Ù…ÙŠÙ„ Ù…Ø­Ø¯Ø«" />
            <ResultTile value={importSummary.newCustomers} label="Ø¹Ù…ÙŠÙ„ Ø¬Ø¯ÙŠØ¯" />
            {importKind === "sales" && (
              <>
                <ResultTile value={importSummary.needsReviewRows} label="ØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø©" />
                <ResultTile value={importSummary.unlinkedCustomersEstimate} label="Ø±Ø¨Ø· Ø¹Ù…ÙŠÙ„ Ø¶Ø¹ÙŠÙ" />
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
          {importSummary.errors.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
              {importSummary.errors.slice(0, 20).map((error, index) => <div key={index} className="text-red-200/80 text-xs">{error.message}</div>)}
            </div>
          )}
          <button onClick={handleReset} className="btn-primary flex items-center gap-2"><RefreshCw size={16} /> Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ù„Ù Ø¢Ø®Ø±</button>
        </div>
      )}

      {isAdmin && editInvoice && editForm && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-3xl p-6">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <div className="section-title">ØªØ¹Ø¯ÙŠÙ„ ÙØ§ØªÙˆØ±Ø©</div>
                <div className="text-slate-400 text-xs mt-1">Ø£ÙŠ ØªØ¹Ø¯ÙŠÙ„ Ù‡Ù†Ø§ ÙŠÙ†Ø¹ÙƒØ³ Ø¹Ù„Ù‰ Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª Ø¨Ø¹Ø¯ ØªØ­Ø¯ÙŠØ« Ø§Ù„ØµÙØ­Ø©.</div>
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
              <EditField label="Ø§Ù„ÙØ±Ø¹" value={editForm.branch} onChange={(value) => setEditForm({ ...editForm, branch: value })} />
              <EditField label="Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø©" value={editForm.invoice_number} onChange={(value) => setEditForm({ ...editForm, invoice_number: value })} />
              <label className="text-slate-300 text-xs space-y-1 block">
                <span>ØªØ§Ø±ÙŠØ® Ø§Ù„ÙØ§ØªÙˆØ±Ø©</span>
                <input className="input-dark" type="date" value={editForm.invoice_date} onChange={(event) => setEditForm({ ...editForm, invoice_date: event.target.value })} />
              </label>
              <EditField label="Ù†ÙˆØ¹ Ø§Ù„ÙØ§ØªÙˆØ±Ø©" value={editForm.invoice_type} onChange={(value) => setEditForm({ ...editForm, invoice_type: value })} />
              <EditField label="ÙƒÙˆØ¯ Ø§Ù„Ø¹Ù…ÙŠÙ„" value={editForm.customer_code} onChange={(value) => setEditForm({ ...editForm, customer_code: value })} />
              <EditField label="Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„" value={editForm.customer_name} onChange={(value) => setEditForm({ ...editForm, customer_name: value })} />
              <EditField label="Ù‡Ø§ØªÙ Ø§Ù„Ø¹Ù…ÙŠÙ„" value={editForm.customer_phone} onChange={(value) => setEditForm({ ...editForm, customer_phone: value })} />
              <EditField label="Ø§Ù„Ø¯ÙƒØªÙˆØ±/Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…" value={editForm.seller_name} onChange={(value) => setEditForm({ ...editForm, seller_name: value })} />
              <EditField label="ØµØ§ÙÙŠ Ø§Ù„ÙØ§ØªÙˆØ±Ø©" value={editForm.amount} type="number" onChange={(value) => setEditForm({ ...editForm, amount: value })} />
              <EditField label="Ø¨Ø¹Ø¯ Ø§Ù„Ø®ØµÙ…" value={editForm.net_amount} type="number" onChange={(value) => setEditForm({ ...editForm, net_amount: value })} />
              <EditField label="Ù‚ÙŠÙ…Ø© Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ù‚Ø¨Ù„ Ø§Ù„Ø®ØµÙ…" value={editForm.gross_amount} type="number" onChange={(value) => setEditForm({ ...editForm, gross_amount: value })} />
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" className="btn-primary flex items-center gap-2" onClick={saveInvoiceEdit} disabled={adminBusy}>
                <Save size={16} />
                Ø­ÙØ¸ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„
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
                Ø¥Ù„ØºØ§Ø¡
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
