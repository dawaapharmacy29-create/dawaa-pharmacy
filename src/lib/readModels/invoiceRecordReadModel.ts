import { supabase } from '@/lib/supabase';

export async function readInvoiceRecordById(invoiceId: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}
