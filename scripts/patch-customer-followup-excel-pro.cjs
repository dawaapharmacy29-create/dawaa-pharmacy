const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../src/pages/CustomerMonthlyPerformance.tsx');
let source = fs.readFileSync(target, 'utf8');

const importStatement = "import { exportCustomerFollowupWorkbook } from '@/lib/customerMonthlyPerformanceExcelExport';";
if (!source.includes(importStatement)) {
  const importAnchor = "} from '@/components/dashboard/DashboardPrimitives';";
  if (!source.includes(importAnchor)) {
    throw new Error('[customer-followup-excel-pro] dashboard import anchor not found');
  }
  source = source.replace(importAnchor, `${importAnchor}\n${importStatement}`);
}

const startMarker = '  const exportRowsToExcel = async (';
const endMarker = '  const exportActiveCohort = () => {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1 || end <= start) {
  throw new Error('[customer-followup-excel-pro] export function anchors not found');
}

const replacement = `  const exportRowsToExcel = async (\n    rows: CustomerMonthlyRow[],\n    cohort: CohortKey | 'all',\n    fileLabel: string\n  ) => {\n    if (!rows.length || exporting) return;\n    setExporting(true);\n    try {\n      await exportCustomerFollowupWorkbook({\n        rows,\n        fileLabel: cohort === 'all' ? 'كل فئات العملاء' : fileLabel,\n        branch,\n        modeLabel: mode === 'cycle' ? 'دورة دواء 26-25' : 'الشهر الميلادي',\n        periodStart: period.start,\n        periodEnd: period.end,\n        previousStart: prevPeriod.start,\n        previousEnd: prevPeriod.end,\n      });\n    } catch (exportError) {\n      console.error('[CustomerMonthlyPerformance] professional Excel export failed', exportError);\n      setError(exportError instanceof Error ? exportError.message : 'تعذر إنشاء ملف المتابعة');\n    } finally {\n      setExporting(false);\n    }\n  };\n\n`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source);
console.log('[customer-followup-excel-pro] professional Excel exporter wired successfully');
