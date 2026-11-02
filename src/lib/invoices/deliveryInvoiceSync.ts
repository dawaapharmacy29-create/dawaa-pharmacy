import { supabase } from '@/lib/supabase';
export interface DeliveryInvoiceSyncStatus {
  period_start: string;
  revision: number;
  processed_revision: number;
  last_success_at: string | null;
  last_error: string | null;
  result: {
    invoices: number;
    orders: number;
    matched: number;
    pending: number;
    system_only: number;
    failed: number;
    human_decisions_preserved: number;
  } | null;
}
export async function readDeliveryInvoiceSyncStatus(): Promise<DeliveryInvoiceSyncStatus | null> {
  const { data, error } = await supabase.rpc('get_delivery_invoice_sync_status_v1');
  if (error) throw new Error('تعذر قراءة حالة مطابقة الدليفري');
  return data as DeliveryInvoiceSyncStatus | null;
}
