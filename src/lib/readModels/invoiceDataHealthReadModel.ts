import { supabase } from '@/lib/supabase';

export type InvoiceDataHealthSnapshot = {
  totalInvoices: number;
  withoutDoctorIds: string[];
  withoutCustomerIds: string[];
  withoutClassificationIds: string[];
};

function ids(rows: Array<{ id?: string | null }> | null | undefined) {
  return (rows || []).map((row) => String(row.id || '')).filter(Boolean);
}

/**
 * Transactional invoice data-health boundary.
 * Feature/report services must not query sales_invoices directly for integrity checks.
 */
export async function readInvoiceDataHealth(): Promise<InvoiceDataHealthSnapshot> {
  const [total, withoutDoctor, withoutCustomer, withoutClassification] = await Promise.all([
    supabase.from('sales_invoices').select('id', { count: 'exact', head: true }),
    supabase
      .from('sales_invoices')
      .select('id')
      .is('doctor_name', null)
      .is('staff_name', null)
      .is('seller_name', null),
    supabase
      .from('sales_invoices')
      .select('id')
      .is('customer_name', null)
      .is('customer_code', null)
      .is('customer_id', null),
    supabase
      .from('sales_invoices')
      .select('id')
      .is('customer_segment', null)
      .is('customer_type', null),
  ]);

  if (total.error) throw total.error;
  if (withoutDoctor.error) throw withoutDoctor.error;
  if (withoutCustomer.error) throw withoutCustomer.error;
  if (withoutClassification.error) throw withoutClassification.error;

  return {
    totalInvoices: Number(total.count || 0),
    withoutDoctorIds: ids(withoutDoctor.data),
    withoutCustomerIds: ids(withoutCustomer.data),
    withoutClassificationIds: ids(withoutClassification.data),
  };
}
