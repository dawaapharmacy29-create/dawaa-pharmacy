/**
 * مصدر حساب مركزي واحد للمبيعات
 * يستخدم في جميع صفحات التحليلات واللوحات لضمان توحيد الأرقام
 */

import type { SalesInvoiceRow } from '@/lib/analyticsFromInvoices';

export type SalesInvoiceLike = SalesInvoiceRow | Record<string, unknown>;

export type SalesMetricsFilters = {
  from?: string;
  to?: string;
  branch?: string;
  doctor?: string;
  shift?: string;
  invoiceType?: string;
};

export type SalesMetrics = {
  invoiceCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  averageInvoice: number;
  customerCount: number;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  branchCounts: Record<string, number>;
  shiftCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  doctorCounts: Record<string, number>;
  invoicesWithoutCustomerCode: number;
  invoicesWithoutCustomerId: number;
};

/**
 * استخراج تاريخ الفاتورة من عدة أعمدة محتملة
 */
export function getInvoiceDate(invoice: SalesInvoiceLike): string | null {
  const date =
    (invoice as Record<string, unknown>).invoice_date ??
    (invoice as Record<string, unknown>).invoice_datetime ??
    (invoice as Record<string, unknown>).close_datetime ??
    (invoice as Record<string, unknown>).date;
  if (!date) return null;
  return String(date).slice(0, 10);
}

/**
 * استخراج القيمة الصافية للفاتورة
 * الأولوية: net_amount > amount > gross_amount
 */
export function getInvoiceNetAmount(invoice: SalesInvoiceLike): number {
  const value =
    (invoice as Record<string, unknown>).net_amount ??
    (invoice as Record<string, unknown>).amount ??
    (invoice as Record<string, unknown>).gross_amount ??
    0;
  return parseNumericValue(value);
}

/**
 * استخراج القيمة الإجمالية قبل الخصم
 * الأولوية: gross_amount > amount > net_amount
 */
export function getInvoiceGrossAmount(invoice: SalesInvoiceLike): number {
  const value =
    (invoice as Record<string, unknown>).gross_amount ??
    (invoice as Record<string, unknown>).amount ??
    (invoice as Record<string, unknown>).net_amount ??
    0;
  return parseNumericValue(value);
}

/**
 * استخراج قيمة الخصم
 * الأولوية: discount_amount
 */
export function getInvoiceDiscount(invoice: SalesInvoiceLike): number {
  const explicit = (invoice as Record<string, unknown>).discount_amount;
  if (explicit !== null && explicit !== undefined) {
    return parseNumericValue(explicit);
  }
  // حساب الخصم كالفرق بين الإجمالي والصافي
  const gross = getInvoiceGrossAmount(invoice);
  const net = getInvoiceNetAmount(invoice);
  return Math.max(0, gross - net);
}

/**
 * تحويل القيمة إلى رقم
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const cleaned = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬،]/g, '')
    .replace(/جنيه|ج\.م|egp|EGP/gi, '')
    .replace(/[^0-9.\-]/g, '');
  const numberValue = Number.parseFloat(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/**
 * فلترة الفواتير حسب التاريخ
 * endDate شامل لليوم كامل (invoice_date < dayAfterEndDate)
 */
export function filterInvoicesByDate<T extends SalesInvoiceLike>(
  invoices: T[],
  startDate?: string,
  endDate?: string
): T[] {
  if (!startDate && !endDate) return invoices;

  const dayAfterEndDate = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;
  if (dayAfterEndDate) {
    dayAfterEndDate.setDate(dayAfterEndDate.getDate() + 1);
  }

  return invoices.filter((invoice) => {
    const date = getInvoiceDate(invoice);
    if (!date) return false;

    if (startDate && date < startDate) return false;
    if (endDate && dayAfterEndDate && date >= dayAfterEndDate.toISOString().slice(0, 10))
      return false;
    return true;
  });
}

/**
 * فلترة الفواتير حسب الفلاتر المختلفة
 */
export function filterInvoices<T extends SalesInvoiceLike>(
  invoices: T[],
  filters: SalesMetricsFilters = {}
): T[] {
  let filtered = filterInvoicesByDate(invoices, filters.from, filters.to);

  const ALL_FILTERS = new Set([
    '',
    'الكل',
    'كل الفروع',
    'كل الدكاترة',
    'كل الشيفتات',
    'كل الأنواع',
  ]);

  if (filters.branch && !ALL_FILTERS.has(filters.branch)) {
    filtered = filtered.filter(
      (row) => String((row as Record<string, unknown>).branch ?? '').trim() === filters.branch
    );
  }

  if (filters.doctor && !ALL_FILTERS.has(filters.doctor)) {
    filtered = filtered.filter((row) => {
      const doctor =
        (row as Record<string, unknown>).seller_name ??
        (row as Record<string, unknown>).doctor_name ??
        (row as Record<string, unknown>).staff_name;
      return String(doctor ?? '').trim() === filters.doctor;
    });
  }

  if (filters.shift && !ALL_FILTERS.has(filters.shift)) {
    filtered = filtered.filter(
      (row) => String((row as Record<string, unknown>).shift ?? '').trim() === filters.shift
    );
  }

  if (filters.invoiceType && !ALL_FILTERS.has(filters.invoiceType)) {
    filtered = filtered.filter(
      (row) =>
        String((row as Record<string, unknown>).invoice_type ?? '').trim() === filters.invoiceType
    );
  }

  return filtered;
}

/**
 * حساب المقاييس المركزية للمبيعات
 */
export function calculateSalesMetrics<T extends SalesInvoiceLike>(
  invoices: T[],
  filters: SalesMetricsFilters = {}
): SalesMetrics {
  const filtered = filterInvoices(invoices, filters);

  const dates = filtered.map(getInvoiceDate).filter(Boolean).sort();
  const netSales = filtered.reduce((sum, row) => sum + getInvoiceNetAmount(row), 0);
  const grossSales = filtered.reduce((sum, row) => sum + getInvoiceGrossAmount(row), 0);
  const discounts = filtered.reduce((sum, row) => sum + getInvoiceDiscount(row), 0);

  const customers = new Set(
    filtered
      .map((row) =>
        String(
          (row as Record<string, unknown>).customer_id ??
            (row as Record<string, unknown>).customer_code ??
            (row as Record<string, unknown>).customer_phone ??
            (row as Record<string, unknown>).customer_name ??
            ''
        ).trim()
      )
      .filter(Boolean)
  );

  const branchCounts: Record<string, number> = {};
  const shiftCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const doctorCounts: Record<string, number> = {};

  let invoicesWithoutCustomerCode = 0;
  let invoicesWithoutCustomerId = 0;

  for (const row of filtered) {
    const branch = String((row as Record<string, unknown>).branch ?? 'غير محدد').trim();
    branchCounts[branch] = (branchCounts[branch] || 0) + 1;

    const shift = String((row as Record<string, unknown>).shift ?? 'غير محدد').trim();
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;

    const type = String((row as Record<string, unknown>).invoice_type ?? 'غير محدد').trim();
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    const doctor = String(
      (row as Record<string, unknown>).seller_name ??
        (row as Record<string, unknown>).doctor_name ??
        (row as Record<string, unknown>).staff_name ??
        'غير محدد'
    ).trim();
    doctorCounts[doctor] = (doctorCounts[doctor] || 0) + 1;

    if (
      !(row as Record<string, unknown>).customer_code ||
      String((row as Record<string, unknown>).customer_code).trim() === ''
    ) {
      invoicesWithoutCustomerCode++;
    }
    if (
      !(row as Record<string, unknown>).customer_id ||
      String((row as Record<string, unknown>).customer_id).trim() === ''
    ) {
      invoicesWithoutCustomerId++;
    }
  }

  return {
    invoiceCount: filtered.length,
    grossSales,
    discounts,
    netSales,
    averageInvoice: filtered.length ? netSales / filtered.length : 0,
    customerCount: customers.size,
    firstInvoiceDate: dates[0] ?? null,
    lastInvoiceDate: dates[dates.length - 1] ?? null,
    branchCounts,
    shiftCounts,
    typeCounts,
    doctorCounts,
    invoicesWithoutCustomerCode,
    invoicesWithoutCustomerId,
  };
}

/**
 * الحصول على معلومات تشخيصية للمبيعات
 */
export function getSalesDiagnostics<T extends SalesInvoiceLike>(
  invoices: T[],
  filters: SalesMetricsFilters = {}
): Record<string, unknown> {
  const filtered = filterInvoices(invoices, filters);
  const metrics = calculateSalesMetrics(invoices, filters);

  return {
    filters,
    invoiceCount: metrics.invoiceCount,
    firstInvoiceDate: metrics.firstInvoiceDate,
    lastInvoiceDate: metrics.lastInvoiceDate,
    grossSales: metrics.grossSales,
    discounts: metrics.discounts,
    netSales: metrics.netSales,
    totalAmount: filtered.reduce(
      (sum, row) => sum + parseNumericValue((row as Record<string, unknown>).amount ?? 0),
      0
    ),
    branchCounts: metrics.branchCounts,
    shiftCounts: metrics.shiftCounts,
    typeCounts: metrics.typeCounts,
    invoicesWithoutCustomerCode: metrics.invoicesWithoutCustomerCode,
    invoicesWithoutCustomerId: metrics.invoicesWithoutCustomerId,
  };
}
