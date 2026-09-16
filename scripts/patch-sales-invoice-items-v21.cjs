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

const importFrom = `      setImportSummary(summary);\n\n      const branchMismatch = (summary.errors || []).find((error) => error.field === 'الفرع');`;
const importTo = [
  `      setImportSummary(summary);`,
  ``,
  `      const branchMismatch = (summary.errors || []).find((error) => error.field === 'الفرع');`,
  `      if (importKind === 'sales' && !branchMismatch && invoiceItemsParseResult?.rows.length) {`,
  `        const itemImport = await importSalesInvoiceItemsV21(invoiceItemsParseResult.rows, {`,
  `          sourceFile: fileName,`,
  `          importBatch: batch,`,
  `          createdBy: String(user?.name || user?.id || ''),`,
  `        });`,
  `        setInvoiceItemsImportResult(itemImport);`,
  `        if (itemImport.saved > 0) {`,
  `          const conversionNote = itemImport.reconciledProductConversions`,
  `            ? ' وربط ' + itemImport.reconciledProductConversions.toLocaleString('ar-EG') + ' فرصة واتساب بصنف مباع فعليًا'`,
  `            : '';`,
  `          toast.success('تم حفظ ' + itemImport.saved.toLocaleString('ar-EG') + ' بند صنف' + conversionNote);`,
  `        }`,
  `        if (itemImport.failed > 0) {`,
  `          toast.warning('تعذر حفظ ' + itemImport.failed.toLocaleString('ar-EG') + ' بند صنف؛ الفواتير نفسها محفوظة ولم تتأثر.');`,
  `        }`,
  `      }`,
].join('\n');
patch('import invoice items after safe invoice import', importFrom, importTo);

patch(
  'reset item states',
  `    setParseResult(null);\n    setImportSummary(null);\n    setProgress(0);`,
  `    setParseResult(null);\n    setImportSummary(null);\n    setInvoiceItemsParseResult(null);\n    setInvoiceItemsImportResult(null);\n    setProgress(0);`
);

if (!src.includes('تفاصيل أصناف الفواتير — Product Conversion')) {
  const workspaceAnchor = `{(step === 'preview' || step === 'importing' || step === 'done') && parseResult && (`;
  const workspaceStart = src.indexOf(workspaceAnchor);
  if (workspaceStart < 0) throw new Error('[sales-items-v21] invoice preview workspace anchor not found');
  const statsAnchor = `          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">`;
  const statsStart = src.indexOf(statsAnchor, workspaceStart);
  if (statsStart < 0) throw new Error('[sales-items-v21] preview stats anchor not found after workspace');

  const itemSummary = [
    `          {importKind === 'sales' && invoiceItemsParseResult ? (`,
    `            <div className={'rounded-2xl border p-4 text-sm ' + (invoiceItemsParseResult.rows.length ? 'border-emerald-400/25 bg-emerald-500/5' : 'border-amber-400/25 bg-amber-500/5')}>`,
    `              <div className="font-black text-[var(--dawaa-theme-heading)]">تفاصيل أصناف الفواتير — Product Conversion</div>`,
    `              {invoiceItemsParseResult.rows.length ? (`,
    `                <div className="mt-2 space-y-1 text-xs text-[var(--dawaa-theme-text)]">`,
    `                  <div>تم اكتشاف <b>{invoiceItemsParseResult.rows.length.toLocaleString('ar-EG')}</b> بند صنف داخل: <b>{invoiceItemsParseResult.detectedSheets.join('، ')}</b>.</div>`,
    `                  <div>بعد حفظ الفواتير سيتم حفظ البنود وربطها تلقائيًا بفرص واتساب المطابقة برقم الفاتورة + الفرع + كود/اسم الصنف.</div>`,
    `                  {invoiceItemsImportResult ? <div className="mt-2 font-bold text-emerald-300">حُفظ: {invoiceItemsImportResult.saved.toLocaleString('ar-EG')} • فشل: {invoiceItemsImportResult.failed.toLocaleString('ar-EG')} • Product Conversion مؤكدة: {invoiceItemsImportResult.reconciledProductConversions.toLocaleString('ar-EG')}</div> : null}`,
    `                </div>`,
    `              ) : (`,
    `                <div className="mt-2 text-xs leading-6 text-amber-200">الملف الحالي يحتوي ملخص الفواتير فقط ولا يحتوي أسماء/أكواد بنود البيع. يمكن تأكيد Conversion المحادثة بالفاتورة، لكن Product Conversion يظل غير مثبت حتى يتوفر ملف تفاصيل الأصناف.</div>`,
    `              )}`,
    `            </div>`,
    `          ) : null}`,
    ``,
  ].join('\n');

  src = src.slice(0, statsStart) + itemSummary + src.slice(statsStart);
  console.log('[sales-items-v21] product conversion preview card: applied');
} else console.log('[sales-items-v21] product conversion preview card: already applied');

fs.writeFileSync(file, src);
console.log('[sales-items-v21] invoice item auto-detection/import wired successfully');
require('./patch-whatsapp-product-conversion-v21.cjs');
