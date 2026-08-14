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
