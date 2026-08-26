type CellValue = string | number | boolean | null | undefined;
type Row = Record<string, CellValue>;

const COLORS = {
  navy: '0F172A',
  teal: '0F766E',
  tealLight: 'CCFBF1',
  white: 'FFFFFF',
  slate: '475569',
  line: 'CBD5E1',
  alt: 'F8FAFC',
  green: '166534',
  greenLight: 'DCFCE7',
  red: '991B1B',
  redLight: 'FEE2E2',
};

async function saveWorkbook(workbook: any, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function styleWorksheet(ws: any, rows: Row[], headers: string[]) {
  ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  ws.getRow(1).height = 28;

  headers.forEach((header, index) => {
    const cell = ws.getCell(1, index + 1);
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.teal } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: COLORS.navy } } };

    const values = rows.slice(0, 300).map((row) => row[header]);
    const maxLen = Math.max(header.length, ...values.map((value) => String(value ?? '').length));
    ws.getColumn(index + 1).width = Math.max(11, Math.min(maxLen + 3, 34));
  });

  for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
    const row = ws.getRow(rowIndex);
    row.height = 22;
    row.alignment = { vertical: 'middle', horizontal: 'right' };
    if (rowIndex % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.alt } };
    }
    row.eachCell((cell: any, colNumber: number) => {
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } };
      const header = headers[colNumber - 1] || '';
      if (typeof cell.value === 'number') {
        cell.numFmt = header.includes('%') || header.includes('نسبة') || header.includes('معدل')
          ? '0.00'
          : '#,##0.00';
      }
    });
  }
}

export async function exportToExcel(rows: Row[], filename: string, sheetName = 'بيانات') {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'Dawaa Pharmacy 2027';
  workbook.created = new Date();
  const ws = workbook.addWorksheet(sheetName, { properties: { defaultRowHeight: 20 } });
  const headers = Object.keys(rows[0] ?? {});
  ws.addRow(headers);
  rows.forEach((row) => ws.addRow(headers.map((header) => row[header] ?? '')));
  styleWorksheet(ws, rows, headers);
  await saveWorkbook(workbook, filename);
}

export async function exportAttendanceToExcel(
  summaries: {
    staff_name: string;
    branch: string;
    present: number;
    absent: number;
    late: number;
    total_days: number;
    attendance_rate: number;
    avg_checkin: string | null;
  }[],
  month: string
) {
  const rows = summaries.map((s) => ({
    الموظف: s.staff_name,
    الفرع: s.branch,
    'أيام الحضور': s.present,
    'أيام الغياب': s.absent,
    'أيام التأخير': s.late,
    'إجمالي الأيام': s.total_days,
    'متوسط الدخول': s.avg_checkin ?? '-',
    'معدل الانتظام %': s.attendance_rate,
  }));
  await exportToExcel(rows, `تقرير_الحضور_${month}`, 'الحضور');
}

export async function exportMedicineExpiryToExcel(
  medicines: {
    medicine_name?: string | null;
    product_name?: string | null;
    expiry_date?: string | null;
    nearest_expiry_date?: string | null;
    quantity_available?: number | null;
    remaining_quantity?: number | null;
    branch?: string | null;
    branch_name?: string | null;
    responsible_doctor_name?: string | null;
    responsible_doctor?: string | null;
    days?: number | null;
    bucket?: string;
  }[]
) {
  const LABELS: Record<string, string> = {
    expired: 'منتهي الصلاحية',
    urgent: 'أقل من 30 يوم',
    soon: '30 - 60 يوم',
    moderate: '60 - 90 يوم',
    safe: 'أكثر من 90 يوم',
  };
  const rows = medicines.map((m) => ({
    'اسم الدواء': m.medicine_name || m.product_name || '-',
    'تاريخ الانتهاء': m.nearest_expiry_date || m.expiry_date || '-',
    'الأيام المتبقية': m.days ?? '-',
    'الكمية المتبقية': m.remaining_quantity ?? m.quantity_available ?? 0,
    الفرع: m.branch_name || m.branch || '-',
    'الدكتور المسؤول': m.responsible_doctor_name || m.responsible_doctor || '-',
    التصنيف: LABELS[m.bucket ?? ''] ?? '-',
  }));
  const today = new Date().toISOString().slice(0, 10);
  await exportToExcel(rows, `متابعة_صلاحية_الأدوية_${today}`, 'الصلاحية');
}

export async function exportLoyaltyToExcel(
  customers: {
    name: string;
    phone?: string | null;
    branch?: string | null;
    total_purchases?: number | null;
    total_invoices?: number | null;
    avg_monthly?: number | null;
    last_purchase?: string | null;
    tier?: string;
  }[]
) {
  const rows = customers.map((c) => ({
    الاسم: c.name,
    الهاتف: c.phone ?? '-',
    الفرع: c.branch ?? '-',
    'إجمالي الشراء': Number(c.total_purchases ?? 0),
    'عدد الفواتير': c.total_invoices ?? 0,
    'متوسط الشهري': Number(c.avg_monthly ?? 0),
    'آخر شراء': c.last_purchase ?? '-',
    'مستوى الولاء': c.tier ?? '-',
  }));
  const today = new Date().toISOString().slice(0, 10);
  await exportToExcel(rows, `مستويات_ولاء_العملاء_${today}`, 'الولاء');
}
