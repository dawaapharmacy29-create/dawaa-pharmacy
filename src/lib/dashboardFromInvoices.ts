import { getSalesValue } from '@/lib/analyticsService';
/**
 * تجميع مبيعات لوحة التحكم حسب «يوم العمل» الذي يبدأ 9 صباحًا.
 */

import type { SalesInvoiceRow } from '@/lib/analyticsFromInvoices';

function parseInvoiceDateTime(row: SalesInvoiceRow): Date | null {
  const datePart = (row.invoice_date || '').slice(0, 10);
  if (!datePart) return null;
  const rawTime = (row.close_time || '').trim() || '12:00';
  const t = rawTime.match(/^(\d{1,2}):(\d{2})/);
  const h = t ? Number(t[1]) : 12;
  const m = t ? Number(t[2]) : 0;
  const d = new Date(`${datePart}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * إذا كانت الفاتورة قبل الساعة 9 صباحًا تُحسب ضمن يوم العمل السابق.
 */
export function businessDayKey9am(row: SalesInvoiceRow): string | null {
  const d = parseInvoiceDateTime(row);
  if (!d) return null;
  if (d.getHours() < 9) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

export interface DailyBranchSales {
  day: string;
  شكري: number;
  شامي: number;
}

function branchBucket(branch: string | null | undefined): 'شكري' | 'شامي' | 'أخرى' {
  const b = String(branch || '');
  if (b.includes('شكري')) return 'شكري';
  if (b.includes('شامي')) return 'شامي';
  return 'أخرى';
}

export function buildDailySalesByBusinessDay(
  rows: SalesInvoiceRow[],
  businessDays = 14
): DailyBranchSales[] {
  const map = new Map<string, { شكري: number; شامي: number }>();

  for (const row of rows) {
    const amount = getSalesValue(row) || 0;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = businessDayKey9am(row);
    if (!key) continue;
    const slot = map.get(key) || { شكري: 0, شامي: 0 };
    const bucket = branchBucket(row.branch);
    if (bucket === 'شكري') slot.شكري += amount;
    else if (bucket === 'شامي') slot.شامي += amount;
    map.set(key, slot);
  }

  const keys = [...map.keys()].sort();
  const tail = keys.slice(-businessDays);

  return tail.map((day) => {
    const v = map.get(day) || { شكري: 0, شامي: 0 };
    return { day, ...v };
  });
}

export function totalSalesAmount(rows: SalesInvoiceRow[]): number {
  let t = 0;
  for (const row of rows) {
    const amount = getSalesValue(row) || 0;
    if (Number.isFinite(amount) && amount > 0) t += amount;
  }
  return t;
}

/** نسبة تغيّر آخر يومين في مجموع المبيعات */
export function salesGrowthPercent(series: DailyBranchSales[]): number | null {
  if (series.length < 2) return null;
  const a = series[series.length - 2].شكري + series[series.length - 2].شامي;
  const b = series[series.length - 1].شكري + series[series.length - 1].شامي;
  if (a <= 0) return null;
  return ((b - a) / a) * 100;
}
