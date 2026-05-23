import { useMemo, useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Download, Loader2, XCircle, FileCheck, RefreshCw } from "lucide-react";
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

export default function Invoices() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("idle");
  const [importKind, setImportKind] = useState<ImportKind>("sales");
  const [branch, setBranch] = useState<string>(BRANCHES[0]);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | CustomerParseResult | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          <InfoBox title="تصنيف العملاء" items={["مهم جداً: 8000+", "مهم: 4000 إلى 8000", "متوسط: 1500 إلى 4000", "عادي: أقل من 1500"]} />
        </div>
        <button onClick={generateTemplateFile} className="btn-secondary mt-4 flex items-center gap-2">
          <Download size={15} /> تحميل نموذج مبيعات
        </button>
      </div>

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
                  <thead>
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
              </>
            )}
          </div>
          {importSummary.errors.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
              {importSummary.errors.slice(0, 20).map((error, index) => <div key={index} className="text-red-200/80 text-xs">{error.message}</div>)}
            </div>
          )}
          <button onClick={handleReset} className="btn-primary flex items-center gap-2"><RefreshCw size={16} /> استيراد ملف آخر</button>
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

function ResultTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-teal-500/10 border border-white/5 rounded-2xl p-4">
      <div className="text-xl font-bold text-teal-400 num">{value.toLocaleString("ar-EG")}</div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}
