import * as XLSX from 'xlsx';

type CellValue = string | number | boolean | null | undefined;
type Row = Record<string, CellValue>;

export async function exportToExcel(rows: Row[], filename: string, sheetName = 'بيانات') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = Object.keys(rows[0] ?? {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.slice(0, 100).map((r) => String(r[key] ?? '').length)
    );
    return { wch: Math.min(maxLen + 4, 50) };
  });
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
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
