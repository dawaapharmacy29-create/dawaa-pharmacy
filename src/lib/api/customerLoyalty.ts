import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

type Row = Record<string, unknown>;

export interface CustomerCashbackSummary {
  cycle_label: string;
  cashback_rate: number;
  total_spent: number;
  cashback_value: number;
  status: string;
  calculated_at: string | null;
  notified_at: string | null;
  bconnect_updated_at: string | null;
  redeemed_value: number;
  settled_at: string | null;
  next_calculation_date: string | null;
}

export interface CustomerWelcomeStatus {
  id: string;
  status: string;
  assigned_to_name: string | null;
  coded_on_phone_at: string | null;
  welcome_message_sent_at: string | null;
  customer_replied_at: string | null;
  notes: string | null;
}

export interface CustomerInvoiceClassificationRow {
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  category: string | null;
  customer_segment: string | null;
  notes: string | null;
}

function keyClauses(customer: {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
}) {
  return [
    customer.customer_id ? `customer_id.eq.${customer.customer_id}` : '',
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : '',
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : '',
    customer.phone ? `customer_phone.eq.${customer.phone}` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function toNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function getCustomerCashbackSummary(customer: {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
}): Promise<CustomerCashbackSummary | null> {
  const clauses = keyClauses(customer);
  if (!clauses) return null;
  try {
    const { data, error } = await supabase
      .from('customer_cashback_cycles')
      .select(
        'cycle_label,cashback_rate,total_spent,cashback_value,status,calculated_at,notified_at,bconnect_updated_at,redeemed_value,settled_at,next_calculation_date'
      )
      .or(clauses)
      .order('cycle_end', { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const row = data[0] as Row;
    return {
      cycle_label: String(row.cycle_label || 'الدورة الحالية'),
      cashback_rate: toNumber(row.cashback_rate),
      total_spent: toNumber(row.total_spent),
      cashback_value: toNumber(row.cashback_value),
      status: String(row.status || 'calculated'),
      calculated_at: row.calculated_at ? String(row.calculated_at) : null,
      notified_at: row.notified_at ? String(row.notified_at) : null,
      bconnect_updated_at: row.bconnect_updated_at ? String(row.bconnect_updated_at) : null,
      redeemed_value: toNumber(row.redeemed_value),
      settled_at: row.settled_at ? String(row.settled_at) : null,
      next_calculation_date: row.next_calculation_date ? String(row.next_calculation_date) : null,
    };
  } catch {
    return null;
  }
}

export async function getCustomerWelcomeStatus(customer: {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
}): Promise<CustomerWelcomeStatus | null> {
  const clauses = keyClauses(customer);
  if (!clauses) return null;
  try {
    const { data, error } = await supabase
      .from('customer_welcome_tasks')
      .select(
        'id,status,assigned_to_name,coded_on_phone_at,welcome_message_sent_at,customer_replied_at,notes'
      )
      .or(clauses)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const row = data[0] as Row;
    return {
      id: String(row.id || ''),
      status: String(row.status || 'pending'),
      assigned_to_name: row.assigned_to_name ? String(row.assigned_to_name) : null,
      coded_on_phone_at: row.coded_on_phone_at ? String(row.coded_on_phone_at) : null,
      welcome_message_sent_at: row.welcome_message_sent_at
        ? String(row.welcome_message_sent_at)
        : null,
      customer_replied_at: row.customer_replied_at ? String(row.customer_replied_at) : null,
      notes: row.notes ? String(row.notes) : null,
    };
  } catch {
    return null;
  }
}

export async function getCustomerInvoiceClassifications(
  customer: {
    customer_code?: string | null;
    customer_phone?: string | null;
    phone?: string | null;
  },
  limit = 10
): Promise<CustomerInvoiceClassificationRow[]> {
  const clauses = keyClauses(customer);
  if (!clauses) return [];
  try {
    const { data, error } = await supabase
      .from('customer_invoice_classifications')
      .select('invoice_number,invoice_date,seller_name,category,customer_segment,notes')
      .or(clauses)
      .order('invoice_date', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((row: Row) => ({
      invoice_number: row.invoice_number ? String(row.invoice_number) : null,
      invoice_date: row.invoice_date ? String(row.invoice_date) : null,
      seller_name: row.seller_name ? String(row.seller_name) : null,
      category: row.category ? String(row.category) : null,
      customer_segment: row.customer_segment ? String(row.customer_segment) : null,
      notes: row.notes ? String(row.notes) : null,
    }));
  } catch {
    return [];
  }
}

export function cashbackStatusLabel(status: string | null | undefined) {
  const s = String(status || '');
  if (s === 'notified') return 'تم تبليغ العميل';
  if (s === 'bconnect_updated') return 'تم تحديث بي كونكت';
  if (s === 'partially_redeemed') return 'تم سحب جزء';
  if (s === 'settled') return 'تمت التسوية';
  if (s === 'calculated') return 'تم احتساب النقاط';
  return s || 'غير محدد';
}

export function cashbackSummaryLine(cashback: CustomerCashbackSummary | null) {
  if (!cashback) return 'لا توجد دورة كاش باك محسوبة لهذا العميل';
  return `${cashback.cycle_label} · ${cashback.cashback_rate}% · ${formatCurrency(cashback.cashback_value)} مستحق · ${cashbackStatusLabel(cashback.status)}`;
}
