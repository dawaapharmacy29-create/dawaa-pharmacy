export type CustomerServiceExcelRow = Record<string, unknown>;

export type CustomerServiceExcelColumnGroup = 'identity' | 'context' | 'analysis' | 'result' | 'technical';

export type CustomerServiceExcelColumn = {
  key: string;
  width?: number;
  group?: CustomerServiceExcelColumnGroup;
  hidden?: boolean;
  format?: 'text' | 'integer' | 'currency' | 'date' | 'percent' | 'yesno';
};

export type CustomerServiceExcelSheet = {
  name: string;
  title?: string;
  subtitle?: string;
  note?: string;
  rows: CustomerServiceExcelRow[];
  columns: CustomerServiceExcelColumn[];
  kind?: 'execution' | 'dashboard' | 'instructions' | 'reference' | 'review';
};

export type CustomerServiceWorkbookConfig = {
  filename: string;
  title: string;
  subtitle?: string;
  sheets: CustomerServiceExcelSheet[];
};

const COLORS = {
  navy: '0B1F36',
  cyan: '0891B2',
  teal: '0F766E',
  indigo: '4338CA',
  violet: '7C3AED',
  emerald: '047857',
  greenSoft: 'ECFDF5',
  slate: '475569',
  slateSoft: 'F8FAFC',
  border: 'CBD5E1',
  white: 'FFFFFF',
  amber: 'D97706',
  red: 'DC2626',
  roseSoft: 'FFF1F2',
  blueSoft: 'EFF6FF',
};

const resultHeaders = new Set([
  'تمت المتابعة',
  'تم الرد',
  'رد العميل',
  'عملية شراء',
  'قيمة عملية الشراء',
  'هل يحتاج متابعة أخرى',
  'موعد المتابعة القادمة',
  'ملاحظات',
]);

const yesNoHeaders = new Set(['تمت المتابعة', 'تم الرد', 'عملية شراء', 'هل يحتاج متابعة أخرى']);

function headerColor(group: CustomerServiceExcelColumnGroup | undefined) {
  if (group === 'result') return COLORS.emerald;
  if (group === 'context') return COLORS.indigo;
  if (group === 'analysis') return COLORS.violet;
  if (group === 'technical') return COLORS.slate;
  return COLORS.cyan;
}

function valueOrBlank(value: unknown) {
  if (value == null) return '';
  return value;
}

function excelColumnLetter(index: number) {
  let value = index;
  let result = '';
  while (value > 0) {
    const modulo = (value - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function applyBorder(cell: any) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.border } },
    left: { style: 'thin', color: { argb: COLORS.border } },
    bottom: { style: 'thin', color: { argb: COLORS.border } },
    right: { style: 'thin', color: { argb: COLORS.border } },
  };
}

function applyNumberFormat(cell: any, format?: CustomerServiceExcelColumn['format']) {
  if (format === 'currency') cell.numFmt = '#,##0.00 "ج.م"';
  if (format === 'integer') cell.numFmt = '#,##0';
  if (format === 'date') cell.numFmt = 'dd/mm/yyyy';
  if (format === 'percent') cell.numFmt = '0.0"%"';
  if (format === 'text') cell.numFmt = '@';
}

function addTitleRows(worksheet: any, sheet: CustomerServiceExcelSheet, lastColumn: number, headerRow: number) {
  const lastLetter = excelColumnLetter(lastColumn);
  worksheet.mergeCells(`A1:${lastLetter}1`);
  worksheet.getCell('A1').value = sheet.title || sheet.name;
  worksheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: COLORS.white } };
  worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  worksheet.getCell('A1').alignment = { horizontal: 'right', vertical: 'middle' };
  worksheet.getRow(1).height = 34;

  worksheet.mergeCells(`A2:${lastLetter}2`);
  worksheet.getCell('A2').value = sheet.subtitle || 'صيدليات دواء — ملف متابعة العملاء';
  worksheet.getCell('A2').font = { name: 'Arial', size: 11, bold: true, color: { argb: 'DCEAF7' } };
  worksheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '12304D' } };
  worksheet.getCell('A2').alignment = { horizontal: 'right', vertical: 'middle' };
  worksheet.getRow(2).height = 24;

  if (headerRow > 4) {
    worksheet.mergeCells(`A3:${lastLetter}3`);
    worksheet.getCell('A3').value = sheet.note || (sheet.kind === 'execution' ? 'اكتب فقط في الأعمدة الخضراء الخاصة بنتيجة التواصل — باقي الأعمدة للقراءة فقط.' : 'مرجع تحليلي — لا تحتاج التعديل في هذا الشيت.');
    worksheet.getCell('A3').font = { name: 'Arial', size: 10, bold: true, color: { argb: sheet.kind === 'execution' ? '065F46' : '334155' } };
    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheet.kind === 'execution' ? 'D1FAE5' : 'E2E8F0' } };
    worksheet.getCell('A3').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    worksheet.getRow(3).height = 28;

    worksheet.mergeCells(`A4:${lastLetter}4`);
    worksheet.getCell('A4').value = sheet.kind === 'execution'
      ? 'ترتيب التنفيذ من الأعلى للأسفل. تمت المتابعة/تم الرد/عملية شراء/متابعة أخرى = نعم أو لا. الملاحظات 10 حروف على الأقل.'
      : 'يمكن استخدام الفلاتر في الهيدر للوصول السريع لأي عميل أو فرع أو حالة.';
    worksheet.getCell('A4').font = { name: 'Arial', size: 9, color: { argb: '475569' } };
    worksheet.getCell('A4').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    worksheet.getRow(4).height = 24;
  }
}

function dashboardFill(cell: any, color: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function dashboardText(cell: any, options: { size?: number; color?: string; bold?: boolean; align?: 'center' | 'right' } = {}) {
  cell.font = { name: 'Arial', size: options.size || 10, bold: options.bold ?? true, color: { argb: options.color || COLORS.navy } };
  cell.alignment = { horizontal: options.align || 'center', vertical: 'middle', wrapText: true };
}

function addDashboardLiveMetrics(workbook: any, worksheet: any) {
  const execution = workbook.getWorksheet('تنفيذ اليوم');
  if (!execution) return;

  const maxExecutionRow = Math.max(7, execution.rowCount || 7);
  const endRow = Math.max(maxExecutionRow, 5000);
  const q = (column: string) => `'تنفيذ اليوم'!${column}$7:${column}${endRow}`;

  for (let col = 5; col <= 12; col += 1) worksheet.getColumn(col).width = col % 2 === 1 ? 16 : 14;

  worksheet.mergeCells('E4:L4');
  const title = worksheet.getCell('E4');
  title.value = 'لوحة التنفيذ المباشرة — تتحدث تلقائيًا أثناء العمل على «تنفيذ اليوم»';
  dashboardFill(title, COLORS.navy);
  dashboardText(title, { size: 12, color: COLORS.white });
  worksheet.getRow(4).height = Math.max(worksheet.getRow(4).height || 0, 30);

  const card = (labelRange: string, valueRange: string, label: string, formula: string, color: string, numberFormat?: string) => {
    worksheet.mergeCells(labelRange);
    worksheet.mergeCells(valueRange);
    const labelCell = worksheet.getCell(labelRange.split(':')[0]);
    const valueCell = worksheet.getCell(valueRange.split(':')[0]);
    labelCell.value = label;
    valueCell.value = { formula };
    dashboardFill(labelCell, color);
    dashboardText(labelCell, { size: 9, color: COLORS.white });
    dashboardFill(valueCell, 'F8FAFC');
    dashboardText(valueCell, { size: 20, color, bold: true });
    if (numberFormat) valueCell.numFmt = numberFormat;
    applyBorder(labelCell);
    applyBorder(valueCell);
  };

  card('E5:F5', 'E6:F7', 'إجمالي مهام اليوم', `COUNTA(${q('D')})`, COLORS.cyan, '#,##0');
  card('G5:H5', 'G6:H7', 'تم تنفيذ المتابعة', `COUNTIF(${q('K')},\"نعم\")`, COLORS.emerald, '#,##0');
  card('I5:J5', 'I6:J7', 'نسبة الرد من المنفذ', `IFERROR(COUNTIF(${q('L')},\"نعم\")/COUNTIF(${q('K')},\"نعم\"),0)`, COLORS.indigo, '0%');
  card('K5:L5', 'K6:L7', 'تحويل الرد إلى شراء', `IFERROR(COUNTIF(${q('N')},\"نعم\")/COUNTIF(${q('L')},\"نعم\"),0)`, COLORS.violet, '0%');

  card('E9:F9', 'E10:F11', 'نسبة إنجاز القائمة', `IFERROR(COUNTIF(${q('K')},\"نعم\")/COUNTA(${q('D')}),0)`, COLORS.teal, '0%');
  card('G9:H9', 'G10:H11', 'متبقي للتنفيذ', `MAX(0,COUNTA(${q('D')})-COUNTIF(${q('K')},\"نعم\"))`, COLORS.amber, '#,##0');
  card('I9:J9', 'I10:J11', 'يحتاج متابعة أخرى', `COUNTIF(${q('P')},\"نعم\")`, COLORS.slate, '#,##0');
  card('K9:L9', 'K10:L11', 'قيمة شراء بعد المتابعة', `SUM(${q('O')})`, COLORS.emerald, '#,##0.00 \"ج.م\"');

  worksheet.mergeCells('E13:L13');
  const progressTitle = worksheet.getCell('E13');
  progressTitle.value = 'مؤشرات التقدم';
  dashboardFill(progressTitle, 'E2E8F0');
  dashboardText(progressTitle, { size: 11, color: COLORS.navy });

  const progressRows = [
    ['تنفيذ المهام', `COUNTIF(${q('K')},\"نعم\")`, `COUNTA(${q('D')})`],
    ['العملاء الذين ردوا', `COUNTIF(${q('L')},\"نعم\")`, `MAX(1,COUNTIF(${q('K')},\"نعم\"))`],
    ['عمليات الشراء', `COUNTIF(${q('N')},\"نعم\")`, `MAX(1,COUNTIF(${q('L')},\"نعم\"))`],
    ['متابعات قادمة', `COUNTIF(${q('P')},\"نعم\")`, `MAX(1,COUNTIF(${q('K')},\"نعم\"))`],
  ];
  progressRows.forEach(([label, current, target], index) => {
    const row = 14 + index;
    worksheet.mergeCells(`E${row}:F${row}`);
    worksheet.getCell(`E${row}`).value = label;
    dashboardText(worksheet.getCell(`E${row}`), { align: 'right' });
    worksheet.getCell(`G${row}`).value = { formula: current };
    worksheet.getCell(`H${row}`).value = { formula: `IFERROR(${current}/${target},0)` };
    worksheet.getCell(`H${row}`).numFmt = '0%';
    worksheet.mergeCells(`I${row}:L${row}`);
    worksheet.getCell(`I${row}`).value = { formula: `REPT(\"█\",ROUND(MIN(1,IFERROR(${current}/${target},0))*10,0))&REPT(\"░\",10-ROUND(MIN(1,IFERROR(${current}/${target},0))*10,0))` };
    dashboardText(worksheet.getCell(`I${row}`), { size: 12, color: COLORS.teal });
    ['E','G','H','I'].forEach((col) => applyBorder(worksheet.getCell(`${col}${row}`)));
    if (row % 2 === 0) ['E','G','H','I'].forEach((col) => dashboardFill(worksheet.getCell(`${col}${row}`), COLORS.slateSoft));
    worksheet.getRow(row).height = 24;
  });

  worksheet.mergeCells('E20:H20');
  worksheet.getCell('E20').value = 'توزيع مهام التنفيذ';
  dashboardFill(worksheet.getCell('E20'), COLORS.indigo);
  dashboardText(worksheet.getCell('E20'), { color: COLORS.white });
  worksheet.getCell('E21').value = 'نوع القائمة';
  worksheet.getCell('F21').value = 'عدد العملاء';
  worksheet.getCell('G21').value = 'تم التنفيذ';
  worksheet.getCell('H21').value = 'نسبة التنفيذ';
  ['E21','F21','G21','H21'].forEach((ref) => { dashboardFill(worksheet.getCell(ref), COLORS.slate); dashboardText(worksheet.getCell(ref), { color: COLORS.white, size: 9 }); applyBorder(worksheet.getCell(ref)); });
  ['VIP آخر 3 شهور', '+500', 'نقاط'].forEach((type, index) => {
    const row = 22 + index;
    worksheet.getCell(`E${row}`).value = type;
    worksheet.getCell(`F${row}`).value = { formula: `COUNTIF(${q('B')},\"${type}\")` };
    worksheet.getCell(`G${row}`).value = { formula: `COUNTIFS(${q('B')},\"${type}\",${q('K')},\"نعم\")` };
    worksheet.getCell(`H${row}`).value = { formula: `IFERROR(G${row}/F${row},0)` };
    worksheet.getCell(`H${row}`).numFmt = '0%';
    ['E','F','G','H'].forEach((col) => { applyBorder(worksheet.getCell(`${col}${row}`)); dashboardText(worksheet.getCell(`${col}${row}`), { size: 9 }); });
  });

  worksheet.mergeCells('J20:L20');
  worksheet.getCell('J20').value = 'الفروع';
  dashboardFill(worksheet.getCell('J20'), COLORS.cyan);
  dashboardText(worksheet.getCell('J20'), { color: COLORS.white });
  worksheet.getCell('J21').value = 'الفرع';
  worksheet.getCell('K21').value = 'المهام';
  worksheet.getCell('L21').value = 'المنفذ';
  ['J21','K21','L21'].forEach((ref) => { dashboardFill(worksheet.getCell(ref), COLORS.slate); dashboardText(worksheet.getCell(ref), { color: COLORS.white, size: 9 }); applyBorder(worksheet.getCell(ref)); });
  ['فرع شكري', 'فرع الشامي'].forEach((branch, index) => {
    const row = 22 + index;
    worksheet.getCell(`J${row}`).value = branch;
    worksheet.getCell(`K${row}`).value = { formula: `COUNTIF(${q('C')},\"${branch}\")` };
    worksheet.getCell(`L${row}`).value = { formula: `COUNTIFS(${q('C')},\"${branch}\",${q('K')},\"نعم\")` };
    ['J','K','L'].forEach((col) => { applyBorder(worksheet.getCell(`${col}${row}`)); dashboardText(worksheet.getCell(`${col}${row}`), { size: 9 }); });
  });

  worksheet.mergeCells('E27:L27');
  worksheet.getCell('E27').value = 'تنبيهات جودة التنفيذ';
  dashboardFill(worksheet.getCell('E27'), COLORS.amber);
  dashboardText(worksheet.getCell('E27'), { color: COLORS.white });
  const warnings = [
    ['منفذ بدون ملاحظات', `COUNTIFS(${q('K')},\"نعم\",${q('R')},\"\")`],
    ['متابعة أخرى بدون موعد', `COUNTIFS(${q('P')},\"نعم\",${q('Q')},\"\")`],
    ['مواعيد متابعة مستحقة/قديمة', `COUNTIFS(${q('P')},\"نعم\",${q('Q')},\"<=\"&TODAY())`],
  ];
  warnings.forEach(([label, formula], index) => {
    const row = 28 + index;
    worksheet.mergeCells(`E${row}:J${row}`);
    worksheet.getCell(`E${row}`).value = label;
    worksheet.mergeCells(`K${row}:L${row}`);
    worksheet.getCell(`K${row}`).value = { formula };
    dashboardText(worksheet.getCell(`E${row}`), { align: 'right', color: COLORS.slate });
    dashboardText(worksheet.getCell(`K${row}`), { size: 12, color: COLORS.red });
    applyBorder(worksheet.getCell(`E${row}`)); applyBorder(worksheet.getCell(`K${row}`));
  });
}

function addSheet(workbook: any, sheet: CustomerServiceExcelSheet) {
  const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: sheet.kind === 'execution' ? 6 : 4, xSplit: sheet.kind === 'execution' ? Math.min(5, sheet.columns.length) : 0, rightToLeft: true, showGridLines: false }],
    properties: { tabColor: { argb: sheet.kind === 'execution' ? COLORS.emerald : sheet.kind === 'dashboard' ? COLORS.cyan : sheet.kind === 'review' ? COLORS.amber : COLORS.slate } },
    pageSetup: { orientation: sheet.columns.length > 10 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const headerRow = sheet.kind === 'execution' ? 6 : 4;
  addTitleRows(worksheet, sheet, Math.max(1, sheet.columns.length), headerRow);

  const headers = sheet.columns.map((column) => column.key);
  worksheet.getRow(headerRow).values = headers;
  worksheet.getRow(headerRow).height = 34;
  worksheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: Math.max(1, headers.length) } };
  worksheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  sheet.columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    excelColumn.width = Math.max(8, Math.min(column.width || 16, 48));
    excelColumn.hidden = Boolean(column.hidden);
    if (column.hidden) excelColumn.outlineLevel = 1;
    const cell = worksheet.getCell(headerRow, index + 1);
    cell.value = column.key;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor(column.group) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    applyBorder(cell);
  });

  if (!sheet.rows.length) {
    const row = worksheet.addRow(['لا توجد بيانات']);
    worksheet.mergeCells(row.number, 1, row.number, Math.max(1, sheet.columns.length));
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { name: 'Arial', bold: true, color: { argb: '64748B' } };
    row.height = 34;
    return worksheet;
  }

  for (const record of sheet.rows) {
    const row = worksheet.addRow(sheet.columns.map((column) => valueOrBlank(record[column.key])));
    row.height = sheet.kind === 'execution' ? 30 : 24;
    sheet.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.font = { name: 'Arial', size: sheet.kind === 'execution' ? 10 : 9, color: { argb: '0F172A' } };
      cell.alignment = { horizontal: resultHeaders.has(column.key) ? 'right' : 'center', vertical: 'middle', wrapText: true };
      applyBorder(cell);
      applyNumberFormat(cell, column.format);
      if (column.group === 'result') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenSoft } };
      } else if (row.number % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateSoft } };
      }
      if (yesNoHeaders.has(column.key)) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"نعم,لا"'],
          showErrorMessage: true,
          errorTitle: 'قيمة غير صحيحة',
          error: 'اختر نعم أو لا فقط.',
        };
      }
      if (column.key === 'موعد المتابعة القادمة') {
        cell.dataValidation = {
          type: 'date',
          operator: 'greaterThanOrEqual',
          allowBlank: true,
          formulae: [new Date(2020, 0, 1)],
          showErrorMessage: true,
          errorTitle: 'تاريخ غير صحيح',
          error: 'اكتب تاريخًا صحيحًا للمتابعة القادمة.',
        };
      }
    });
  }

  const firstDataRow = headerRow + 1;
  const lastDataRow = headerRow + sheet.rows.length;
  const followedIndex = headers.indexOf('تمت المتابعة') + 1;
  const notesIndex = headers.indexOf('ملاحظات') + 1;
  const needsNextIndex = headers.indexOf('هل يحتاج متابعة أخرى') + 1;
  const nextDateIndex = headers.indexOf('موعد المتابعة القادمة') + 1;

  if (sheet.kind === 'execution' && followedIndex > 0) {
    const followedLetter = excelColumnLetter(followedIndex);
    (worksheet as any).addConditionalFormatting?.({
      ref: `${followedLetter}${firstDataRow}:${followedLetter}${lastDataRow}`,
      rules: [
        { type: 'containsText', operator: 'containsText', text: 'نعم', style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'BBF7D0' } }, font: { color: { argb: '166534' }, bold: true } } },
        { type: 'containsText', operator: 'containsText', text: 'لا', style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } }, font: { color: { argb: '92400E' }, bold: true } } },
      ],
    });
  }
  if (sheet.kind === 'execution' && followedIndex > 0 && notesIndex > 0) {
    const f = excelColumnLetter(followedIndex);
    const n = excelColumnLetter(notesIndex);
    (worksheet as any).addConditionalFormatting?.({
      ref: `${n}${firstDataRow}:${n}${lastDataRow}`,
      rules: [{ type: 'expression', formulae: [`AND($${f}${firstDataRow}="نعم",LEN($${n}${firstDataRow})<10)`], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E6' } }, font: { color: { argb: COLORS.red }, bold: true } } }],
    });
  }
  if (sheet.kind === 'execution' && needsNextIndex > 0 && nextDateIndex > 0) {
    const next = excelColumnLetter(needsNextIndex);
    const date = excelColumnLetter(nextDateIndex);
    (worksheet as any).addConditionalFormatting?.({
      ref: `${date}${firstDataRow}:${date}${lastDataRow}`,
      rules: [{ type: 'expression', formulae: [`AND($${next}${firstDataRow}="نعم",$${date}${firstDataRow}="")`], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.roseSoft } }, font: { color: { argb: COLORS.red }, bold: true } } }],
    });
  }

  if (sheet.kind === 'dashboard') addDashboardLiveMetrics(workbook, worksheet);

  return worksheet;
}

export async function downloadCustomerServiceWorkbook(config: CustomerServiceWorkbookConfig) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'صيدليات دواء';
  workbook.company = 'Dawaa Pharmacy';
  workbook.subject = config.title;
  workbook.title = config.title;
  workbook.description = config.subtitle || 'متابعة خدمة العملاء';
  workbook.created = new Date();
  workbook.modified = new Date();

  config.sheets.forEach((sheet) => addSheet(workbook, sheet));

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = config.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
