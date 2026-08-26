export type CashbackComparisonRow = {
  branch: string;
  customer_code: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashback_rate: number;
  current_purchases: number;
  previous_purchases: number;
  purchases_change: number;
  purchases_growth_pct: number | null;
  current_invoices: number;
  previous_invoices: number;
  current_points: number;
  previous_points: number;
  points_change: number;
  points_growth_pct: number | null;
  trend: 'new' | 'growing' | 'stable' | 'declining' | 'inactive' | string;
};

export type CashbackComparisonPayload = {
  periods: { current_start: string; current_end: string; previous_start: string; previous_end: string };
  summary: Record<string, number | null>;
  branch_summary: Array<Record<string, string | number>>;
};

const C = {
  navy: '0F172A', teal: '0F766E', cyan: '0891B2', white: 'FFFFFF',
  slate: '475569', line: 'CBD5E1', alt: 'F8FAFC',
  green: '166534', greenBg: 'DCFCE7', red: '991B1B', redBg: 'FEE2E2',
  amber: '92400E', amberBg: 'FEF3C7', blue: '1D4ED8', blueBg: 'DBEAFE', violetBg: 'EDE9FE',
};

const TREND_LABEL: Record<string, string> = {
  new: 'عميل جديد', growing: 'نمو', stable: 'مستقر', declining: 'تراجع', inactive: 'توقف',
};

function trendStyle(trend: string) {
  if (trend === 'growing') return { fg: C.greenBg, font: C.green };
  if (trend === 'declining' || trend === 'inactive') return { fg: C.redBg, font: C.red };
  if (trend === 'new') return { fg: C.blueBg, font: C.blue };
  return { fg: C.amberBg, font: C.amber };
}

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatSheetHeader(ws: any, columns: number) {
  ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];
  const row = ws.getRow(1);
  row.height = 30;
  for (let i = 1; i <= columns; i += 1) {
    const cell = row.getCell(i);
    cell.font = { bold: true, color: { argb: C.white }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.navy } } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
}

export async function exportCustomerCashbackAnalyticsWorkbook(args: {
  rows: CashbackComparisonRow[];
  payload: CashbackComparisonPayload;
  branchLabel: string;
}) {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'Dawaa Pharmacy 2027';
  workbook.company = 'Dawaa Pharmacy';
  workbook.subject = 'Customer Cashback Cycle Analytics';
  workbook.created = new Date();

  const { rows, payload, branchLabel } = args;
  const summary = payload.summary || {};
  const periods = payload.periods;

  const dashboard = workbook.addWorksheet('الملخص التنفيذي', { views: [{ rightToLeft: true }] });
  dashboard.mergeCells('A1:H2');
  const title = dashboard.getCell('A1');
  title.value = 'صيدليات دواء — تحليل نقاط العملاء بين الدورات';
  title.font = { bold: true, size: 18, color: { argb: C.white } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  dashboard.getRow(1).height = 28; dashboard.getRow(2).height = 28;
  dashboard.mergeCells('A4:H4');
  dashboard.getCell('A4').value = `النطاق: ${branchLabel} | الحالية ${periods.current_start} → ${periods.current_end} | السابقة ${periods.previous_start} → ${periods.previous_end}`;
  dashboard.getCell('A4').font = { bold: true, color: { argb: C.slate } };
  dashboard.getCell('A4').alignment = { horizontal: 'center' };

  const kpis = [
    ['نقاط الحالية', Number(summary.current_points || 0)],
    ['نقاط السابقة', Number(summary.previous_points || 0)],
    ['نمو النقاط %', summary.points_growth_pct == null ? null : Number(summary.points_growth_pct)],
    ['مشتريات الحالية', Number(summary.current_purchases || 0)],
    ['نمو المشتريات %', summary.purchases_growth_pct == null ? null : Number(summary.purchases_growth_pct)],
    ['عملاء جدد', Number(summary.new_customers || 0)],
    ['عملاء نمو', Number(summary.growing_customers || 0)],
    ['عملاء تراجع/توقف', Number(summary.declining_customers || 0) + Number(summary.inactive_customers || 0)],
  ];
  kpis.forEach(([label, value], idx) => {
    const col = (idx % 4) * 2 + 1;
    const row = 6 + Math.floor(idx / 4) * 3;
    dashboard.mergeCells(row, col, row, col + 1);
    dashboard.mergeCells(row + 1, col, row + 1, col + 1);
    const labelCell = dashboard.getCell(row, col);
    const valueCell = dashboard.getCell(row + 1, col);
    labelCell.value = label; valueCell.value = value as any;
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } };
    labelCell.font = { bold: true, color: { argb: C.white } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDFA' } };
    valueCell.font = { bold: true, size: 15, color: { argb: C.navy } };
    labelCell.alignment = valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (String(label).includes('%')) valueCell.numFmt = '0.00"%"'; else valueCell.numFmt = '#,##0.00';
  });

  dashboard.getCell('A13').value = 'ملخص الفروع';
  dashboard.getCell('A13').font = { bold: true, size: 13, color: { argb: C.navy } };
  const branchHeaders = ['الفرع', 'العملاء', 'نقاط الحالية', 'نقاط السابقة', 'نمو النقاط %', 'مشتريات الحالية', 'مشتريات السابقة', 'نمو المشتريات %'];
  dashboard.addRow([]);
  const headerRow = dashboard.addRow(branchHeaders);
  headerRow.eachCell((cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } };
    cell.font = { bold: true, color: { argb: C.white } };
    cell.alignment = { horizontal: 'center' };
  });
  (payload.branch_summary || []).forEach((b: any) => {
    const cp = Number(b.current_points || 0); const pp = Number(b.previous_points || 0);
    const cs = Number(b.current_purchases || 0); const ps = Number(b.previous_purchases || 0);
    dashboard.addRow([b.branch, Number(b.customers || 0), cp, pp, pp ? ((cp - pp) / pp) * 100 : null, cs, ps, ps ? ((cs - ps) / ps) * 100 : null]);
  });
  dashboard.columns = [22, 14, 18, 18, 16, 20, 20, 18].map((width) => ({ width }));
  dashboard.getColumn(5).numFmt = '0.00"%"'; dashboard.getColumn(8).numFmt = '0.00"%"';

  const compare = workbook.addWorksheet('مقارنة العملاء');
  compare.columns = [
    { header: 'الفرع', key: 'branch', width: 18 }, { header: 'كود العميل', key: 'code', width: 14 },
    { header: 'اسم العميل', key: 'name', width: 30 }, { header: 'الهاتف', key: 'phone', width: 18 },
    { header: 'النسبة %', key: 'rate', width: 12 }, { header: 'مشتريات الحالية', key: 'currPurch', width: 18 },
    { header: 'مشتريات السابقة', key: 'prevPurch', width: 18 }, { header: 'فرق المشتريات', key: 'purchDiff', width: 18 },
    { header: 'نمو المشتريات %', key: 'purchGrowth', width: 17 }, { header: 'فواتير الحالية', key: 'currInv', width: 14 },
    { header: 'فواتير السابقة', key: 'prevInv', width: 14 }, { header: 'نقاط الحالية', key: 'currPts', width: 16 },
    { header: 'نقاط السابقة', key: 'prevPts', width: 16 }, { header: 'فرق النقاط', key: 'ptsDiff', width: 16 },
    { header: 'نمو النقاط %', key: 'ptsGrowth', width: 16 }, { header: 'اتجاه العميل', key: 'trend', width: 16 },
  ];
  formatSheetHeader(compare, compare.columns.length);
  rows.forEach((r, idx) => {
    const row = compare.addRow({ branch: r.branch, code: r.customer_code, name: r.customer_name || '', phone: r.customer_phone || '', rate: r.cashback_rate,
      currPurch: r.current_purchases, prevPurch: r.previous_purchases, purchDiff: r.purchases_change, purchGrowth: r.purchases_growth_pct,
      currInv: r.current_invoices, prevInv: r.previous_invoices, currPts: r.current_points, prevPts: r.previous_points, ptsDiff: r.points_change,
      ptsGrowth: r.points_growth_pct, trend: TREND_LABEL[r.trend] || r.trend });
    if (idx % 2) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.alt } };
    row.eachCell((cell: any) => { cell.border = { bottom: { style: 'hair', color: { argb: C.line } } }; cell.alignment = { vertical: 'middle', horizontal: 'right' }; });
    const tone = trendStyle(r.trend);
    row.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fg } };
    row.getCell(16).font = { bold: true, color: { argb: tone.font } };
  });
  [5, 9, 15].forEach((c) => { compare.getColumn(c).numFmt = '0.00"%"'; });
  [6, 7, 8, 12, 13, 14].forEach((c) => { compare.getColumn(c).numFmt = '#,##0.00'; });
  compare.getColumn(2).numFmt = '@'; compare.getColumn(4).numFmt = '@';

  const movers = workbook.addWorksheet('أهم التغيرات');
  const moversHeaders = ['التصنيف', 'الفرع', 'الكود', 'العميل', 'نقاط الحالية', 'نقاط السابقة', 'فرق النقاط', 'نمو النقاط %'];
  movers.addRow(moversHeaders); formatSheetHeader(movers, moversHeaders.length);
  const topGrowth = [...rows].filter((r) => r.points_change > 0).sort((a, b) => b.points_change - a.points_change).slice(0, 50);
  const topDecline = [...rows].filter((r) => r.points_change < 0).sort((a, b) => a.points_change - b.points_change).slice(0, 50);
  [...topGrowth.map((r) => ['أعلى نمو', r]), ...topDecline.map((r) => ['أكبر تراجع', r])].forEach(([label, raw]: any) => {
    const r = raw as CashbackComparisonRow;
    movers.addRow([label, r.branch, r.customer_code, r.customer_name || '', r.current_points, r.previous_points, r.points_change, r.points_growth_pct]);
  });
  movers.columns = [16, 18, 14, 30, 16, 16, 16, 16].map((width) => ({ width }));
  [5, 6, 7].forEach((c) => { movers.getColumn(c).numFmt = '#,##0.00'; }); movers.getColumn(8).numFmt = '0.00"%"';

  const dictionary = workbook.addWorksheet('دليل التحليل', { views: [{ rightToLeft: true }] });
  dictionary.columns = [{ width: 25 }, { width: 70 }];
  dictionary.addRows([
    ['البند', 'التعريف'],
    ['الدورة الحالية', `${periods.current_start} → ${periods.current_end}`],
    ['الدورة السابقة', `${periods.previous_start} → ${periods.previous_end}`],
    ['مصدر المبيعات', 'Customer Sales Analytics Truth — بعد استبعادات خدمة العملاء المعتمدة.'],
    ['نقاط العميل', 'إجمالي مشتريات الدورة × نسبة الكاش باك المطبقة على العميل + أي Voucher معتمد.'],
    ['نمو النقاط %', '(نقاط الحالية - نقاط السابقة) ÷ نقاط السابقة × 100.'],
    ['عميل جديد', 'له نقاط في الدورة الحالية ولم يكن له نقاط في الدورة السابقة.'],
    ['نمو', 'زيادة 10% أو أكثر في النقاط مقارنة بالدورة السابقة.'],
    ['مستقر', 'التغير بين -10% و +10%.'],
    ['تراجع', 'انخفاض 10% أو أكثر.'],
    ['توقف', 'كان له نقاط في الدورة السابقة ولا توجد نقاط في الحالية.'],
    ['ملاحظة الشامي', 'المقارنة التحليلية تستخدم دورات معيارية متساوية 3 شهور حتى تكون نسبة النمو عادلة، بينما شاشة التشغيل قد تحتفظ باستثناء تاريخي للدورة.'],
  ]);
  dictionary.getRow(1).eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }; cell.font = { bold: true, color: { argb: C.white } }; });
  dictionary.eachRow((row: any, rowNo: number) => { row.alignment = { vertical: 'top', horizontal: 'right', wrapText: true }; if (rowNo > 1 && rowNo % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.alt } }; });

  const buffer = await workbook.xlsx.writeBuffer();
  const safeBranch = branchLabel.replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '');
  download(buffer as ArrayBuffer, `تحليل_نقاط_العملاء_${safeBranch}_${periods.current_end}.xlsx`);
}
