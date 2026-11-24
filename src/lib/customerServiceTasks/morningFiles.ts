import { supabase } from '@/supabaseClient';

// ملفات الصبح اللي فريق خدمة العملاء بيرفعها أول ما يوصل (صاحب الصيدلية 2026-11-25): المبيعات وأصنافها، والعملاء،
// والمشتريات. من غيرها مهام النهارده ناقصة: العميل الجديد في شكري من غير رقم لحد ما ملف العملاء يترفع، وفواتير امبارح
// والتحويلات من غير المبيعات، ومراجعة المشتريات من غير ملفات المخازن.

export type MorningUploads = {
  now: string;
  purchases: Array<{
    store: string;
    branch: string;
    uploaded_at: string | null;
    last_day: string | null;
    last_invoice_at: string | null;
  }>;
  sales: Array<{ branch: string; last_invoice_at: string | null; uploaded_at: string | null }>;
  items: Array<{ branch: string; last_invoice_at: string | null; uploaded_at: string | null }>;
  customers: { uploaded_at: string | null; added_at: string | null };
};

export type FileKind = 'sales' | 'items' | 'customers' | 'purchases';

export const PURCHASE_STORES = [
  { store: 'الادارة فرع شكري', branch: 'فرع شكري' },
  { store: 'مخزن د.وائل', branch: 'فرع شكري' },
  { store: 'الفرعية الشامي', branch: 'فرع الشامي' },
  { store: 'مخزن د معاذ', branch: 'فرع الشامي' },
] as const;

function fail(message: string): Error {
  return new Error(message || 'حصلت مشكلة في الاتصال، جرّب تاني');
}

export async function loadMorningUploads(): Promise<MorningUploads> {
  const { data, error } = await supabase.rpc('dawaa_cs_morning_uploads_v1');
  if (error) throw fail(error.message);
  return data as MorningUploads;
}

export async function loadPurchaseSuppliers(): Promise<Array<{ code: string; name: string }>> {
  const { data, error } = await supabase.rpc('dawaa_cs_purchase_suppliers_v1');
  if (error) throw fail(error.message);
  return (data ?? []) as Array<{ code: string; name: string }>;
}

/** The Cairo calendar day of a timestamp. */
export function cairoDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
}

export function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Is each file up to date this morning? Sales and their items: both branches reach yesterday. Customers: updated
 * today. Purchases: every store was uploaded today or already holds yesterday's invoices.
 */
export function freshness(u: MorningUploads, today: string): Record<FileKind, boolean> {
  const yesterday = previousDay(today);
  const reaches = (rows: Array<{ branch: string; last_invoice_at: string | null }>) =>
    ['فرع شكري', 'فرع الشامي'].every((b) => {
      const day = cairoDay(rows.find((r) => r.branch === b)?.last_invoice_at);
      return !!day && day >= yesterday;
    });
  return {
    sales: reaches(u.sales),
    items: reaches(u.items),
    customers: cairoDay(u.customers.uploaded_at) === today,
    purchases: PURCHASE_STORES.every(({ store }) => {
      const p = u.purchases.find((x) => x.store === store);
      if (!p) return false;
      return cairoDay(p.uploaded_at) === today || (!!p.last_day && p.last_day >= yesterday);
    }),
  };
}

/** Sales invoices carry the day only (no time), so their freshness reads as a day. */
export function dayOnlyLabel(iso: string | null | undefined, today: string): string {
  const day = cairoDay(iso);
  if (!day) return 'لسه';
  if (day === today) return 'النهارده';
  if (day === previousDay(today)) return 'امبارح';
  const [, m, d] = day.split('-').map(Number);
  return `${d}/${m}`;
}

export function timeLabel(iso: string | null | undefined, today: string): string {
  if (!iso) return 'لسه';
  const day = cairoDay(iso);
  const time = new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
  if (day === today) return `النهارده ${time}`;
  if (day === previousDay(today)) return `امبارح ${time}`;
  const [, m, d] = (day ?? '').split('-').map(Number);
  return `${d}/${m} ${time}`;
}
