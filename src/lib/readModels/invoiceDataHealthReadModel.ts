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

type HealthPayload = Partial<InvoiceDataHealthSnapshot>;

function stringIds(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : [];
}

/**
 * Transactional invoice data-health boundary.
 *
 * The database RPC owns exact counts and bounded samples. This avoids direct
 * schema-sensitive REST checks against sales_invoices and prevents full-table
 * diagnostic scans from blocking operational pages.
 */
export async function readInvoiceDataHealth(): Promise<InvoiceDataHealthSnapshot> {
  const { data, error } = await supabase.rpc('get_invoice_data_health_v1');
  if (error) throw error;

  const payload = (data || {}) as HealthPayload;
  return {
    totalInvoices: Number(payload.totalInvoices || 0),
    withoutDoctorCount: Number(payload.withoutDoctorCount || 0),
    withoutDoctorIds: stringIds(payload.withoutDoctorIds),
    withoutCustomerCount: Number(payload.withoutCustomerCount || 0),
    withoutCustomerIds: stringIds(payload.withoutCustomerIds),
    withoutClassificationCount: Number(payload.withoutClassificationCount || 0),
    withoutClassificationIds: stringIds(payload.withoutClassificationIds),
  };
}
