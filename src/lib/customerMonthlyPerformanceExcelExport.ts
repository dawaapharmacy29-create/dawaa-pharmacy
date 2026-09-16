import type { CustomerMonthlyRow } from '@/lib/customerMonthlyPerformanceService';

export type CustomerFollowupExcelContext = {
  rows: CustomerMonthlyRow[];
  fileLabel: string;
  branch: string;
  modeLabel: string;
  periodStart: string;
  periodEnd: string;
  previousStart: string;
  previousEnd: string;
};

type FollowupPlan = {
  priority: 'عاجلة' | 'عالية' | 'متوسطة' | 'عادية';
  reason: string;
  action: string;
  channel: string;
};

const COLORS = {
  navy: 'FF153247',
  teal: 'FF16A39A',
  tealDark: 'FF0E746E',
  tealLight: 'FFE8F7F5',
  white: 'FFFFFFFF',
  text: 'FF1E293B',
  muted: 'FF64748B',
  border: 'FFD7E1E7',
  surface: 'FFF8FAFB',
  green: 'FF15803D',
  greenLight: 'FFDCFCE7',
  amber: 'FFB45309',
  amberLight: 'FFFEF3C7',
  red: 'FFB91C1C',
  redLight: 'FFFEE2E2',
  blue: 'FF1D4ED8',
  blueLight: 'FFDBEAFE',
  purple: 'FF7E22CE',
  purpleLight: 'FFF3E8FF',
  grayLight: 'FFF1F5F9',
};

function riskGap(row: CustomerMonthlyRow) {
  const expected = Number(row.expected_to_date_sales ?? row.previous_month_sales) || 0;
  const current = Number(row.sales_amount) || 0;
  return Math.max(0, expected - current);
}

function followupPlan(row: CustomerMonthlyRow): FollowupPlan {
  switch (row.customer_state) {
    case 'جديد':
      return {
        priority: 'متوسطة',
        reason: 'عميل جديد',
        action: 'ترحيب بالعميل + التأكد من رضاه عن أول تجربة + تثبيت التعامل مع الصيدلية',
        channel: 'واتساب / اتصال',
      };
    case 'مستعاد':
      return {
        priority: 'عالية',
        reason: 'عميل عاد بعد توقف',
        action: 'شكر العميل على العودة + فهم سبب التوقف السابق + التأكد من احتياجاته القادمة',
        channel: 'اتصال / واتساب',
      };
    case 'مختفي هذا الشهر':
      return {
        priority: 'عاجلة',
        reason: 'توقف عن الشراء في الفترة الحالية',
        action: 'استرجاع عاجل + معرفة سبب الانقطاع + عرض المساعدة أو توفير الاحتياج الحالي',
        channel: 'اتصال ثم واتساب',
      };
    case 'تراجع قوي':
      return {
        priority: 'عاجلة',
        reason: 'انخفاض قوي في المشتريات',
        action: 'فهم سبب التراجع + مراجعة احتياجات العميل + محاولة استعادة معدل الشراء السابق',
        channel: 'اتصال',
      };
    case 'تراجع':
      return {
        priority: 'عالية',
        reason: 'انخفاض في المشتريات',
        action: 'متابعة مبكرة + فهم السبب + منع انتقال العميل إلى تراجع قوي أو توقف كامل',
        channel: 'واتساب / اتصال',
      };
    default:
      return {
        priority: 'عادية',
        reason: row.customer_state || 'متابعة دورية',
        action: 'متابعة رضا العميل واحتياجاته القادمة',
        channel: 'واتساب',
      };
  }
}

function priorityOrder(priority: FollowupPlan['priority']) {
  return priority === 'عاجلة' ? 0 : priority === 'عالية' ? 1 : priority === 'متوسطة' ? 2 : 3;
}

function cleanFilePart(value: string) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 70);
}

function downloadBuffer(buffer: ArrayBuffer | Uint8Array, filename: string) {
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportCustomerFollowupWorkbook(context: CustomerFollowupExcelContext) {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule.default || ExcelJSModule) as typeof ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dawaa Pharmacy 2027';
  workbook.company = 'صيدليات دواء';
  workbook.subject = 'متابعة أداء العملاء';
  workbook.title = `متابعة العملاء - ${context.fileLabel}`;
  workbook.description = 'ملف تشغيل متكامل لفريق خدمة العملاء: متابعة، رد العميل، نتيجة التواصل، المتابعة القادمة، وقيمة الطلب.';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sortedRows = [...context.rows].sort((a, b) => {
    const aPlan = followupPlan(a);
    const bPlan = followupPlan(b);
    const p = priorityOrder(aPlan.priority) - priorityOrder(bPlan.priority);
    if (p !== 0) return p;
    return riskGap(b) - riskGap(a) || Number(b.sales_amount || 0) - Number(a.sales_amount || 0);
  });

  const lists = workbook.addWorksheet('قوائم');
  lists.state = 'veryHidden';
  const listValues: Record<string, string[]> = {
    A: ['حالة المتابعة', 'لم تبدأ', 'محاولة أولى', 'محاولة ثانية', 'تم التواصل', 'مؤجل', 'مغلق'],
    B: ['هل تم الرد؟', 'لم يتم التواصل', 'لم يتم الرد', 'تم الرد', 'طلب التواصل لاحقًا', 'غير متاح', 'رقم غير صحيح'],
    C: ['نتيجة التواصل', 'تم الاطمئنان', 'تم بيع / طلب', 'تم استرجاع العميل', 'يحتاج متابعة', 'لا يوجد احتياج حاليًا', 'غير مهتم حاليًا', 'شكوى / ملاحظة', 'تعذر الوصول'],
    D: ['متابعة أخرى؟', 'نعم', 'لا'],
    E: ['حالة البيع', 'لا يوجد حتى الآن', 'تم بيع / طلب', 'لم يتم البيع', 'متوقع طلب لاحقًا'],
  };
  Object.entries(listValues).forEach(([col, values]) => {
    values.forEach((value, index) => {
      lists.getCell(`${col}${index + 1}`).value = value;
    });
  });

  const work = workbook.addWorksheet('خطة العمل', {
    properties: { defaultRowHeight: 22 },
    views: [{ state: 'frozen', ySplit: 7, xSplit: 4, rightToLeft: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  work.mergeCells('A1:AD2');
  work.getCell('A1').value = 'صيدليات دواء | خطة متابعة العملاء';
  work.getCell('A1').font = { name: 'Arial', size: 20, bold: true, color: { argb: COLORS.white } };
  work.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  work.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  work.getRow(1).height = 30;
  work.getRow(2).height = 18;

  work.mergeCells('A3:H3');
  work.getCell('A3').value = `الفئة: ${context.fileLabel} | الفرع: ${context.branch}`;
  work.mergeCells('I3:P3');
  work.getCell('I3').value = `${context.modeLabel}: ${context.periodStart} ← ${context.periodEnd}`;
  work.mergeCells('Q3:X3');
  work.getCell('Q3').value = `المقارنة: ${context.previousStart} ← ${context.previousEnd}`;
  work.mergeCells('Y3:AD3');
  work.getCell('Y3').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}`;
  ['A3', 'I3', 'Q3', 'Y3'].forEach((address) => {
    const cell = work.getCell(address);
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.text } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealLight } };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.border } },
      bottom: { style: 'thin', color: { argb: COLORS.border } },
      left: { style: 'thin', color: { argb: COLORS.border } },
      right: { style: 'thin', color: { argb: COLORS.border } },
    };
  });

  work.mergeCells('A4:AD4');
  work.getCell('A4').value =
    'طريقة العمل: ابدأ بالأولوية العاجلة → سجّل حالة المتابعة → هل رد العميل؟ → نتيجة التواصل → هل يحتاج متابعة أخرى؟ → الموعد القادم → مسؤول المتابعة → قيمة أي طلب تم.';
  work.getCell('A4').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.tealDark } };
  work.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  work.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
  work.getRow(4).height = 34;

  const workHeaders = [
    '#',
    'الأولوية',
    'حالة العميل',
    'اسم العميل',
    'كود العميل',
    'الهاتف',
    'الفرع',
    'قبل 3 فترات',
    'قبل فترتين',
    'الفترة السابقة',
    'الفترة الحالية',
    'الإيراد المعرض للخطر',
    'حالة المتابعة',
    'هل تم الرد؟',
    'نتيجة التواصل',
    'متابعة 1 - التاريخ',
    'متابعة 1 - ملخص',
    'متابعة 2 - التاريخ',
    'متابعة 2 - ملخص',
    'يحتاج متابعة أخرى؟',
    'موعد المتابعة القادمة',
    'مسؤول المتابعة',
    'حالة البيع / الطلب',
    'قيمة الطلب',
    'الخطوة التالية',
    'آخر شراء',
    'قناة التواصل المقترحة',
    'سبب المتابعة',
    'الإجراء المقترح',
    'ملاحظات إضافية',
  ];

  work.getRow(6).values = workHeaders;
  work.getRow(6).height = 38;
  work.getRow(6).eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealDark } };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.white } },
      bottom: { style: 'thin', color: { argb: COLORS.white } },
      left: { style: 'thin', color: { argb: COLORS.white } },
      right: { style: 'thin', color: { argb: COLORS.white } },
    };
  });

  const workRows = sortedRows.map((row, index) => {
    const plan = followupPlan(row);
    return [
      index + 1,
      plan.priority,
      row.customer_state || '',
      row.customer_name || '',
      row.customer_code || '',
      row.phone || '',
      row.branch || '',
      Number(row.month_3_ago_sales || 0),
      Number(row.month_2_ago_sales || 0),
      Number(row.previous_month_sales || 0),
      Number(row.sales_amount || 0),
      riskGap(row),
      'لم تبدأ',
      'لم يتم التواصل',
      '',
      '',
      '',
      '',
      '',
      'نعم',
      '',
      '',
      'لا يوجد حتى الآن',
      '',
      '',
      row.last_purchase_date || '',
      plan.channel,
      plan.reason,
      plan.action,
      '',
    ];
  });

  workRows.forEach((values, index) => {
    const excelRow = work.getRow(index + 7);
    excelRow.values = values;
    excelRow.height = 34;
    excelRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: COLORS.text } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.border } },
        left: { style: 'hair', color: { argb: COLORS.border } },
        right: { style: 'hair', color: { argb: COLORS.border } },
      };
    });
    if (index % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.surface } };
      });
    }
    const formulaRow = index + 7;
    excelRow.getCell(25).value = {
      formula: `IF(M${formulaRow}="لم تبدأ","ابدأ المتابعة",IF(N${formulaRow}="لم يتم الرد","محاولة تواصل جديدة",IF(N${formulaRow}="طلب التواصل لاحقًا","حدد موعد متابعة",IF(O${formulaRow}="تم بيع / طلب","مغلق - تم البيع",IF(T${formulaRow}="نعم",IF(U${formulaRow}="","حدد موعد المتابعة القادمة","متابعة في الموعد المحدد"),"راجع النتيجة ثم أغلق الحالة")))))`,
      result: 'ابدأ المتابعة',
    };
    excelRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    excelRow.getCell(17).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    excelRow.getCell(19).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    excelRow.getCell(29).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    excelRow.getCell(30).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  });

  const lastWorkRow = Math.max(7, sortedRows.length + 6);
  work.autoFilter = { from: 'A6', to: 'AD6' };
  work.getRange?.('A6:AD6');

  const widths = [6, 11, 20, 27, 14, 16, 14, 15, 15, 15, 15, 18, 16, 18, 22, 17, 32, 17, 32, 19, 20, 18, 20, 15, 25, 16, 21, 22, 42, 34];
  widths.forEach((width, index) => {
    work.getColumn(index + 1).width = width;
  });
  [8, 9, 10, 11, 12, 24].forEach((col) => {
    work.getColumn(col).numFmt = '#,##0.00';
  });
  [16, 18, 21].forEach((col) => {
    work.getColumn(col).numFmt = 'dd/mm/yyyy';
  });

  for (let rowNumber = 7; rowNumber <= lastWorkRow; rowNumber += 1) {
    work.getCell(`M${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`'قوائم'!$A$2:$A$7`],
    };
    work.getCell(`N${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`'قوائم'!$B$2:$B$7`],
    };
    work.getCell(`O${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`'قوائم'!$C$2:$C$9`],
    };
    work.getCell(`T${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`'قوائم'!$D$2:$D$3`],
    };
    work.getCell(`W${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`'قوائم'!$E$2:$E$5`],
    };
  }

  const priorityRef = `B7:B${lastWorkRow}`;
  const followupRef = `M7:M${lastWorkRow}`;
  const responseRef = `N7:N${lastWorkRow}`;
  const outcomeRef = `O7:O${lastWorkRow}`;
  const nextDateRef = `U7:U${lastWorkRow}`;
  work.addConditionalFormatting({
    ref: priorityRef,
    rules: [
      { type: 'expression', formulae: ['B7="عاجلة"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redLight }, fgColor: { argb: COLORS.redLight } }, font: { bold: true, color: { argb: COLORS.red } } } },
      { type: 'expression', formulae: ['B7="عالية"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.amberLight }, fgColor: { argb: COLORS.amberLight } }, font: { bold: true, color: { argb: COLORS.amber } } } },
      { type: 'expression', formulae: ['B7="متوسطة"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.blueLight }, fgColor: { argb: COLORS.blueLight } }, font: { bold: true, color: { argb: COLORS.blue } } } },
    ],
  });
  work.addConditionalFormatting({
    ref: followupRef,
    rules: [
      { type: 'expression', formulae: ['M7="لم تبدأ"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.grayLight }, fgColor: { argb: COLORS.grayLight } }, font: { bold: true, color: { argb: COLORS.muted } } } },
      { type: 'expression', formulae: ['M7="تم التواصل"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.greenLight }, fgColor: { argb: COLORS.greenLight } }, font: { bold: true, color: { argb: COLORS.green } } } },
      { type: 'expression', formulae: ['M7="مغلق"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.blueLight }, fgColor: { argb: COLORS.blueLight } }, font: { bold: true, color: { argb: COLORS.blue } } } },
    ],
  });
  work.addConditionalFormatting({
    ref: responseRef,
    rules: [
      { type: 'expression', formulae: ['N7="تم الرد"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.greenLight }, fgColor: { argb: COLORS.greenLight } }, font: { bold: true, color: { argb: COLORS.green } } } },
      { type: 'expression', formulae: ['N7="لم يتم الرد"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redLight }, fgColor: { argb: COLORS.redLight } }, font: { bold: true, color: { argb: COLORS.red } } } },
      { type: 'expression', formulae: ['N7="طلب التواصل لاحقًا"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.amberLight }, fgColor: { argb: COLORS.amberLight } }, font: { bold: true, color: { argb: COLORS.amber } } } },
    ],
  });
  work.addConditionalFormatting({
    ref: outcomeRef,
    rules: [
      { type: 'expression', formulae: ['O7="تم بيع / طلب"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.greenLight }, fgColor: { argb: COLORS.greenLight } }, font: { bold: true, color: { argb: COLORS.green } } } },
      { type: 'expression', formulae: ['O7="شكوى / ملاحظة"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redLight }, fgColor: { argb: COLORS.redLight } }, font: { bold: true, color: { argb: COLORS.red } } } },
    ],
  });
  work.addConditionalFormatting({
    ref: nextDateRef,
    rules: [
      { type: 'expression', formulae: ['AND(U7<>"",U7<TODAY(),T7="نعم")'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redLight }, fgColor: { argb: COLORS.redLight } }, font: { bold: true, color: { argb: COLORS.red } } } },
      { type: 'expression', formulae: ['AND(U7=TODAY(),T7="نعم")'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.amberLight }, fgColor: { argb: COLORS.amberLight } }, font: { bold: true, color: { argb: COLORS.amber } } } },
    ],
  });

  work.addTable({
    name: 'CustomerFollowupWorkTable',
    ref: 'A6',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: false, showFirstColumn: false, showLastColumn: false },
    columns: workHeaders.map((name) => ({ name })),
    rows: workRows.map((row, index) => {
      const excelRow = index + 7;
      const copy = [...row];
      copy[24] = { formula: `IF(M${excelRow}="لم تبدأ","ابدأ المتابعة",IF(N${excelRow}="لم يتم الرد","محاولة تواصل جديدة",IF(N${excelRow}="طلب التواصل لاحقًا","حدد موعد متابعة",IF(O${excelRow}="تم بيع / طلب","مغلق - تم البيع",IF(T${excelRow}="نعم",IF(U${excelRow}="","حدد موعد المتابعة القادمة","متابعة في الموعد المحدد"),"راجع النتيجة ثم أغلق الحالة")))))` } as never;
      return copy;
    }),
  });

  const dashboard = workbook.addWorksheet('لوحة المتابعة', {
    properties: { defaultRowHeight: 22 },
    views: [{ state: 'frozen', ySplit: 4, rightToLeft: true }],
  });
  dashboard.mergeCells('A1:H2');
  dashboard.getCell('A1').value = 'لوحة متابعة خدمة العملاء | صيدليات دواء';
  dashboard.getCell('A1').font = { name: 'Arial', size: 22, bold: true, color: { argb: COLORS.white } };
  dashboard.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  dashboard.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  dashboard.getRow(1).height = 32;
  dashboard.getRow(2).height = 20;
  dashboard.mergeCells('A3:H3');
  dashboard.getCell('A3').value = `${context.fileLabel} | ${context.branch} | ${context.periodStart} إلى ${context.periodEnd}`;
  dashboard.getCell('A3').font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.tealDark } };
  dashboard.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  dashboard.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealLight } };

  const card = (range: string, title: string, formula: string, fill: string, color: string) => {
    dashboard.mergeCells(range);
    const start = range.split(':')[0];
    const cell = dashboard.getCell(start);
    cell.value = { formula, result: 0 };
    cell.numFmt = '#,##0';
    cell.font = { name: 'Arial', size: 20, bold: true, color: { argb: color } };
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.border = {
      top: { style: 'medium', color: { argb: color } },
      bottom: { style: 'medium', color: { argb: color } },
      left: { style: 'medium', color: { argb: color } },
      right: { style: 'medium', color: { argb: color } },
    };
    const [topLeft, bottomRight] = range.split(':');
    const labelRow = Number(bottomRight.match(/\d+/)?.[0] || 0) + 1;
    const col = topLeft.match(/[A-Z]+/)?.[0] || 'A';
    const endCol = bottomRight.match(/[A-Z]+/)?.[0] || col;
    dashboard.mergeCells(`${col}${labelRow}:${endCol}${labelRow}`);
    const label = dashboard.getCell(`${col}${labelRow}`);
    label.value = title;
    label.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.text } };
    label.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };

  card('A5:B6', 'إجمالي العملاء', `COUNTA('خطة العمل'!D7:D${lastWorkRow})`, COLORS.blueLight, COLORS.blue);
  card('C5:D6', 'لم تبدأ المتابعة', `COUNTIF('خطة العمل'!M7:M${lastWorkRow},"لم تبدأ")`, COLORS.grayLight, COLORS.muted);
  card('E5:F6', 'تم التواصل', `COUNTIF('خطة العمل'!M7:M${lastWorkRow},"تم التواصل")`, COLORS.tealLight, COLORS.tealDark);
  card('G5:H6', 'تم الرد', `COUNTIF('خطة العمل'!N7:N${lastWorkRow},"تم الرد")`, COLORS.greenLight, COLORS.green);
  card('A9:B10', 'تم بيع / طلب', `COUNTIF('خطة العمل'!O7:O${lastWorkRow},"تم بيع / طلب")`, COLORS.greenLight, COLORS.green);
  card('C9:D10', 'يحتاج متابعة أخرى', `COUNTIF('خطة العمل'!T7:T${lastWorkRow},"نعم")`, COLORS.amberLight, COLORS.amber);
  card('E9:F10', 'مواعيد متابعة متأخرة', `COUNTIFS('خطة العمل'!T7:T${lastWorkRow},"نعم",'خطة العمل'!U7:U${lastWorkRow},"<"&TODAY(),'خطة العمل'!U7:U${lastWorkRow},"<>")`, COLORS.redLight, COLORS.red);
  dashboard.mergeCells('G9:H10');
  dashboard.getCell('G9').value = { formula: `SUM('خطة العمل'!X7:X${lastWorkRow})`, result: 0 };
  dashboard.getCell('G9').numFmt = '#,##0.00 "ج.م"';
  dashboard.getCell('G9').font = { name: 'Arial', size: 19, bold: true, color: { argb: COLORS.purple } };
  dashboard.getCell('G9').alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  dashboard.getCell('G9').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.purpleLight } };
  dashboard.getCell('G9').border = {
    top: { style: 'medium', color: { argb: COLORS.purple } }, bottom: { style: 'medium', color: { argb: COLORS.purple } }, left: { style: 'medium', color: { argb: COLORS.purple } }, right: { style: 'medium', color: { argb: COLORS.purple } },
  };
  dashboard.mergeCells('G11:H11');
  dashboard.getCell('G11').value = 'قيمة الطلبات الناتجة من المتابعة';
  dashboard.getCell('G11').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.text } };
  dashboard.getCell('G11').alignment = { horizontal: 'center', vertical: 'middle' };

  dashboard.mergeCells('A13:H13');
  dashboard.getCell('A13').value = 'خطوات التشغيل اليومية';
  dashboard.getCell('A13').font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.white } };
  dashboard.getCell('A13').alignment = { horizontal: 'center', vertical: 'middle' };
  dashboard.getCell('A13').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealDark } };
  const workflow = [
    ['1', 'ابدأ بالعاجل', 'رتّب أو فلتر الأولوية = عاجلة، ثم الأعلى في الإيراد المعرض للخطر.'],
    ['2', 'سجّل المحاولة', 'غيّر حالة المتابعة إلى محاولة أولى، وسجّل التاريخ وملخص التواصل.'],
    ['3', 'سجّل رد العميل', 'اختر هل تم الرد؟ ثم نتيجة التواصل بدقة.'],
    ['4', 'حدّد الخطوة التالية', 'لو يحتاج متابعة أخرى = نعم، ضع موعدًا واضحًا ومسؤول المتابعة.'],
    ['5', 'اقفل الحلقة', 'عند البيع سجّل حالة البيع وقيمة الطلب. عند اكتمال الحالة اجعل المتابعة = مغلق.'],
  ];
  workflow.forEach((item, index) => {
    const rowNumber = 14 + index;
    dashboard.getCell(`A${rowNumber}`).value = item[0];
    dashboard.mergeCells(`B${rowNumber}:C${rowNumber}`);
    dashboard.getCell(`B${rowNumber}`).value = item[1];
    dashboard.mergeCells(`D${rowNumber}:H${rowNumber}`);
    dashboard.getCell(`D${rowNumber}`).value = item[2];
    ['A', 'B', 'D'].forEach((col) => {
      const cell = dashboard.getCell(`${col}${rowNumber}`);
      cell.font = { name: 'Arial', size: 10, bold: col !== 'D', color: { argb: col === 'A' ? COLORS.white : COLORS.text } };
      cell.alignment = { horizontal: col === 'D' ? 'right' : 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col === 'A' ? COLORS.teal : index % 2 === 0 ? COLORS.surface : COLORS.white } };
      cell.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
    });
    dashboard.getRow(rowNumber).height = 30;
  });
  dashboard.mergeCells('A20:H20');
  dashboard.getCell('A20').value = 'مهم: كل التعديلات التشغيلية تتم في شيت «خطة العمل». لوحة المتابعة تتحدث تلقائيًا من نفس الشيت.';
  dashboard.getCell('A20').font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.red } };
  dashboard.getCell('A20').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  dashboard.getCell('A20').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.redLight } };
  dashboard.getRow(20).height = 32;
  dashboard.columns = [18, 18, 18, 18, 18, 18, 18, 18].map((width) => ({ width }));

  const sales = workbook.addWorksheet('بيانات المبيعات', {
    properties: { defaultRowHeight: 21 },
    views: [{ state: 'frozen', ySplit: 2, rightToLeft: true }],
  });
  sales.mergeCells('A1:R1');
  sales.getCell('A1').value = 'تفاصيل المبيعات المستخدمة في تصنيف العملاء';
  sales.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: COLORS.white } };
  sales.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sales.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  const salesHeaders = [
    '#', 'اسم العميل', 'كود العميل', 'الهاتف', 'الفرع', 'حالة العميل', 'التصنيف السابق', 'التصنيف الحالي',
    'قبل 3 فترات', 'قبل فترتين', 'الفترة السابقة', 'الفترة الحالية', 'فرق المبيعات', 'نسبة التغير %',
    'الإيراد المعرض للخطر', 'عدد الفواتير', 'متوسط الفاتورة', 'آخر شراء',
  ];
  sales.getRow(2).values = salesHeaders;
  sales.getRow(2).height = 34;
  sales.getRow(2).eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealDark } };
  });
  sortedRows.forEach((row, index) => {
    const excelRow = sales.getRow(index + 3);
    excelRow.values = [
      index + 1, row.customer_name || '', row.customer_code || '', row.phone || '', row.branch || '', row.customer_state || '',
      row.previous_segment || '', row.current_segment || '', Number(row.month_3_ago_sales || 0), Number(row.month_2_ago_sales || 0),
      Number(row.previous_month_sales || 0), Number(row.sales_amount || 0), Number(row.sales_change_amount || 0), row.sales_change_pct ?? '',
      riskGap(row), Number(row.invoice_count || 0), Number(row.avg_invoice || 0), row.last_purchase_date || '',
    ];
    excelRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: COLORS.text } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    });
    excelRow.getCell(2).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  });
  sales.autoFilter = { from: 'A2', to: 'R2' };
  [9, 10, 11, 12, 13, 15, 17].forEach((col) => { sales.getColumn(col).numFmt = '#,##0.00'; });
  sales.getColumn(14).numFmt = '0.0%';
  const salesWidths = [6, 27, 14, 16, 14, 20, 17, 17, 15, 15, 15, 15, 16, 14, 19, 14, 16, 16];
  salesWidths.forEach((width, index) => { sales.getColumn(index + 1).width = width; });

  const guide = workbook.addWorksheet('دليل الاستخدام', { views: [{ rightToLeft: true }] });
  guide.mergeCells('A1:F2');
  guide.getCell('A1').value = 'دليل تشغيل ملف متابعة العملاء';
  guide.getCell('A1').font = { name: 'Arial', size: 19, bold: true, color: { argb: COLORS.white } };
  guide.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  guide.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  const guideRows = [
    ['الحقل', 'متى نستخدمه؟', 'القيمة الصحيحة', 'مهم للفريق', 'لون المتابعة', 'ملاحظة'],
    ['الأولوية', 'لتحديد ترتيب الشغل', 'عاجلة / عالية / متوسطة / عادية', 'ابدأ دائمًا بالعاجلة', 'أحمر / أصفر / أزرق', 'مرتبة تلقائيًا عند التصدير'],
    ['حالة المتابعة', 'بعد كل محاولة', 'لم تبدأ / محاولة أولى / محاولة ثانية / تم التواصل / مؤجل / مغلق', 'لا تترك عميلًا تم التواصل معه على «لم تبدأ»', 'يتغير تلقائيًا', 'استخدم القائمة المنسدلة'],
    ['هل تم الرد؟', 'بعد محاولة التواصل', 'تم الرد / لم يتم الرد / طلب التواصل لاحقًا / غير متاح', 'تفرق بين «تم الاتصال» و«رد العميل»', 'أخضر للرد وأحمر لعدم الرد', 'استخدم القائمة المنسدلة'],
    ['نتيجة التواصل', 'لو تم الرد', 'بيع / استرجاع / متابعة / لا احتياج / شكوى...', 'تحدد النتيجة الحقيقية من المتابعة', 'أخضر للبيع', 'لا تكتب نتيجة عامة غير مفهومة'],
    ['متابعة أخرى؟', 'قبل إنهاء كل حالة', 'نعم / لا', 'لو نعم لازم موعد واضح', '—', 'لا تترك نعم بدون موعد'],
    ['موعد المتابعة القادمة', 'لو العميل طلب وقت أو يحتاج متابعة', 'تاريخ محدد', 'المتأخر يظهر بالأحمر', 'أحمر عند التأخير', 'راجع لوحة المتابعة يوميًا'],
    ['مسؤول المتابعة', 'عند توزيع العملاء', 'اسم مسؤول خدمة العملاء', 'يمنع ضياع المسؤولية', '—', 'كل عميل له مسؤول واضح'],
    ['حالة البيع وقيمته', 'لو المتابعة نتج عنها طلب', 'تم بيع / طلب + القيمة', 'لقياس أثر خدمة العملاء على المبيعات', 'أخضر', 'سجل القيمة الفعلية فقط'],
  ];
  guideRows.forEach((values, index) => {
    const row = guide.getRow(index + 4);
    row.values = values;
    row.height = index === 0 ? 34 : 38;
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, bold: index === 0, color: { argb: index === 0 ? COLORS.white : COLORS.text } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 0 ? COLORS.tealDark : index % 2 === 0 ? COLORS.surface : COLORS.white } };
      cell.border = {
        top: { style: 'thin', color: { argb: COLORS.border } }, bottom: { style: 'thin', color: { argb: COLORS.border } },
        left: { style: 'thin', color: { argb: COLORS.border } }, right: { style: 'thin', color: { argb: COLORS.border } },
      };
    });
  });
  [24, 37, 42, 34, 21, 35].forEach((width, index) => { guide.getColumn(index + 1).width = width; });

  const addCohortSheet = (name: string, states: string[], color: string, light: string) => {
    const cohortRows = sortedRows.filter((row) => states.includes(row.customer_state));
    if (!cohortRows.length) return;
    const sheet = workbook.addWorksheet(name, {
      properties: { defaultRowHeight: 21 },
      views: [{ state: 'frozen', ySplit: 3, rightToLeft: true }],
    });
    sheet.mergeCells('A1:L1');
    sheet.getCell('A1').value = `${name} | عرض سريع — التحديث التشغيلي يتم في «خطة العمل»`;
    sheet.getCell('A1').font = { name: 'Arial', size: 15, bold: true, color: { argb: COLORS.white } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    const headers = ['#', 'اسم العميل', 'الكود', 'الهاتف', 'الفرع', 'حالة العميل', 'قبل 3 فترات', 'قبل فترتين', 'السابق', 'الحالي', 'الخطر', 'الإجراء المقترح'];
    sheet.getRow(3).values = headers;
    sheet.getRow(3).height = 34;
    sheet.getRow(3).eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.white } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    });
    cohortRows.forEach((row, index) => {
      const plan = followupPlan(row);
      const excelRow = sheet.getRow(index + 4);
      excelRow.values = [index + 1, row.customer_name || '', row.customer_code || '', row.phone || '', row.branch || '', row.customer_state || '', Number(row.month_3_ago_sales || 0), Number(row.month_2_ago_sales || 0), Number(row.previous_month_sales || 0), Number(row.sales_amount || 0), riskGap(row), plan.action];
      excelRow.height = 34;
      excelRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 10, color: { argb: COLORS.text } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? light : COLORS.white } };
        cell.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
      });
      excelRow.getCell(2).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      excelRow.getCell(12).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    });
    sheet.autoFilter = { from: 'A3', to: 'L3' };
    [6, 27, 14, 16, 14, 20, 15, 15, 15, 15, 17, 45].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    [7, 8, 9, 10, 11].forEach((col) => { sheet.getColumn(col).numFmt = '#,##0.00'; });
  };

  addCohortSheet('المهددون', ['مختفي هذا الشهر', 'تراجع قوي'], COLORS.red, COLORS.redLight);
  addCohortSheet('قللوا مشترياتهم', ['تراجع'], COLORS.amber, COLORS.amberLight);
  addCohortSheet('المستعادون', ['مستعاد'], COLORS.tealDark, COLORS.tealLight);
  addCohortSheet('العملاء الجدد', ['جديد'], COLORS.green, COLORS.greenLight);

  workbook.worksheets.forEach((sheet) => {
    if (sheet.name === 'قوائم') return;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.font?.name) cell.font = { ...cell.font, name: 'Arial' };
      });
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `متابعة-العملاء-${cleanFilePart(context.fileLabel)}-${cleanFilePart(context.branch)}-${context.periodStart}-${context.periodEnd}.xlsx`;
  downloadBuffer(buffer as unknown as ArrayBuffer, filename);
}
