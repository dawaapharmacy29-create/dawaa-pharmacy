const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Invoices.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[sales-items-v21] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[sales-items-v21] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[sales-items-v21] ${label}: applied`);
}

patch(
  'line item import helpers',
  `} from '@/lib/invoiceImporter';`,
  `} from '@/lib/invoiceImporter';\nimport {\n  importSalesInvoiceItemsV21,\n  parseSalesInvoiceItemsV21,\n  type SalesInvoiceItemsImportResultV21,\n  type SalesInvoiceItemsParseResultV21,\n} from '@/lib/salesInvoiceItemsV21';`
);

patch(
  'line item states',
  `  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);\n  const [progress, setProgress] = useState(0);`,
  `  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);\n  const [invoiceItemsParseResult, setInvoiceItemsParseResult] = useState<SalesInvoiceItemsParseResultV21 | null>(null);\n  const [invoiceItemsImportResult, setInvoiceItemsImportResult] = useState<SalesInvoiceItemsImportResultV21 | null>(null);\n  const [progress, setProgress] = useState(0);`
);

patch(
  'reset item preview when starting file',
  `      setParseResult(null);\n      setImportSummary(null);\n      setProgress(0);`,
  `      setParseResult(null);\n      setImportSummary(null);\n      setInvoiceItemsParseResult(null);\n      setInvoiceItemsImportResult(null);\n      setProgress(0);`
);

patch(
  'detect invoice line item sheets',
  `        const result =\n          importKind === 'sales'\n            ? parseInvoiceFile(buffer, file.name, branch)\n            : parseCustomerFile(buffer, file.name);\n\n        setParseResult(result);`,
  `        const result =\n          importKind === 'sales'\n            ? parseInvoiceFile(buffer, file.name, branch)\n            : parseCustomerFile(buffer, file.name);\n        const detectedItems = importKind === 'sales' ? parseSalesInvoiceItemsV21(buffer, branch) : null;\n        setInvoiceItemsParseResult(detectedItems);\n\n        setParseResult(result);`
);

patch(
  'import invoice items after safe invoice import',
  `      setImportSummary(summary);\n\n      const branchMismatch = (summary.errors || []).find((error) => error.field === 'الفرع');`,
  `      setImportSummary(summary);\n\n      const branchMismatch = (summary.errors || []).find((error) => error.field === 'الفرع');\n      if (importKind === 'sales' && !branchMismatch && invoiceItemsParseResult?.rows.length) {\n        const itemImport = await importSalesInvoiceItemsV21(invoiceItemsParseResult.rows, {\n          sourceFile: fileName,\n          importBatch: batch,\n          createdBy: String(user?.name || user?.id || ''),\n        });\n        setInvoiceItemsImportResult(itemImport);\n        if (itemImport.saved > 0) {\n          toast.success(\`تم حفظ ${'${itemImport.saved.toLocaleString(\'ar-EG\')}'} بند صنف${'${itemImport.reconciledProductConversions ? ` وربط ${itemImport.reconciledProductConversions.toLocaleString(\'ar-EG\')} فرصة واتساب بصنف مباع فعليًا` : \'\'}'}\`);\n        }\n        if (itemImport.failed > 0) {\n          toast.warning(\`تعذر حفظ ${'${itemImport.failed.toLocaleString(\'ar-EG\')}'} بند صنف؛ الفواتير نفسها محفوظة ولم تتأثر.\`);\n        }\n      }\n\n      `
);

patch(
  'reset item states',
  `    setParseResult(null);\n    setImportSummary(null);\n    setProgress(0);`,
  `    setParseResult(null);\n    setImportSummary(null);\n    setInvoiceItemsParseResult(null);\n    setInvoiceItemsImportResult(null);\n    setProgress(0);`
);

const fileCardEnd = `          </div>\n\n          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">`;
const itemSummary = `          </div>\n\n          {importKind === 'sales' && invoiceItemsParseResult ? (\n            <div className={\`rounded-2xl border p-4 text-sm ${'${invoiceItemsParseResult.rows.length ? \'border-emerald-400/25 bg-emerald-500/5\' : \'border-amber-400/25 bg-amber-500/5\'}'}\`}>\n              <div className="font-black text-[var(--dawaa-theme-heading)]">تفاصيل أصناف الفواتير — Product Conversion</div>\n              {invoiceItemsParseResult.rows.length ? (\n                <div className="mt-2 space-y-1 text-xs text-[var(--dawaa-theme-text)]">\n                  <div>تم اكتشاف <b>${'${invoiceItemsParseResult.rows.length.toLocaleString(\'ar-EG\')}'}</b> بند صنف داخل: <b>${'${invoiceItemsParseResult.detectedSheets.join(\'، \')}'}</b>.</div>\n                  <div>بعد حفظ الفواتير سيتم حفظ البنود وربطها تلقائيًا بفرص واتساب المطابقة برقم الفاتورة + الفرع + كود/اسم الصنف.</div>\n                  {invoiceItemsImportResult ? <div className="mt-2 font-bold text-emerald-300">حُفظ: ${'${invoiceItemsImportResult.saved.toLocaleString(\'ar-EG\')}'} • فشل: ${'${invoiceItemsImportResult.failed.toLocaleString(\'ar-EG\')}'} • Product Conversion مؤكدة: ${'${invoiceItemsImportResult.reconciledProductConversions.toLocaleString(\'ar-EG\')}'}</div> : null}\n                </div>\n              ) : (\n                <div className="mt-2 text-xs leading-6 text-amber-200">الملف الحالي يحتوي ملخص الفواتير فقط ولا يحتوي أسماء/أكواد بنود البيع. يمكن تأكيد Conversion المحادثة بالفاتورة، لكن Product Conversion يظل غير مثبت حتى يتوفر ملف تفاصيل الأصناف.</div>\n              )}\n            </div>\n          ) : null}\n\n          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">`;
if (!src.includes('تفاصيل أصناف الفواتير — Product Conversion')) {
  if (!src.includes(fileCardEnd)) throw new Error('[sales-items-v21] preview file card anchor not found');
  src = src.replace(fileCardEnd, itemSummary);
  console.log('[sales-items-v21] product conversion preview card: applied');
} else console.log('[sales-items-v21] product conversion preview card: already applied');

fs.writeFileSync(file, src);
console.log('[sales-items-v21] invoice item auto-detection/import wired successfully');
