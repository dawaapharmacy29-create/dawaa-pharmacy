import { supabase } from '@/lib/supabase';

export type InvoiceDataHealthSnapshot = {
  totalInvoices: number;
  withoutDoctorCount: number;
  withoutDoctorIds: string[];
  withoutCustomerCount: number;
  withoutCustomerIds: string[];
  withoutClassificationCount: number;
  withoutClassificationIds: string[];
};

const SAMPLE_LIMIT = 100;

function ids(rows: Array<{ id?: string | null }> | null | undefined) {
  return (rows || []).map((row) => String(row.id || '')).filter(Boolean);
}

/**
 * Transactional invoice data-health boundary.
 *
 * Counts are exact PostgreSQL counts while IDs are intentionally bounded samples for diagnostics.
 * Feature/report services must not download every unhealthy invoice merely to render counters.
 */
export async function readInvoiceDataHealth(): Promise<InvoiceDataHealthSnapshot> {
  const [total, withoutDoctor, withoutCustomer, withoutClassification] = await Promise.all([
    supabase.from('sales_invoices').select('id', { count: 'exact', head: true }),
    supabase
      .from('sales_invoices')
      .select('id', { count: 'exact' })
      .is('doctor_name', null)
      .is('staff_name', null)
      .is('seller_name', null)
      .limit(SAMPLE_LIMIT),
    supabase
      .from('sales_invoices')
      .select('id', { count: 'exact' })
      .is('customer_name', null)
      .is('customer_code', null)
      .is('customer_id', null)
      .limit(SAMPLE_LIMIT),
    supabase
      .from('sales_invoices')
      .select('id', { count: 'exact' })
      .is('customer_segment', null)
      .is('customer_type', null)
      .limit(SAMPLE_LIMIT),
  ]);

  if (total.error) throw total.error;
  if (withoutDoctor.error) throw withoutDoctor.error;
  if (withoutCustomer.error) throw withoutCustomer.error;
  if (withoutClassification.error) throw withoutClassification.error;

  return {
    totalInvoices: Number(total.count || 0),
    withoutDoctorCount: Number(withoutDoctor.count || 0),
    withoutDoctorIds: ids(withoutDoctor.data),
    withoutCustomerCount: Number(withoutCustomer.count || 0),
    withoutCustomerIds: ids(withoutCustomer.data),
    withoutClassificationCount: Number(withoutClassification.count || 0),
    withoutClassificationIds: ids(withoutClassification.data),
  };
}
