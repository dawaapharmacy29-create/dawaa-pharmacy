import { supabase } from '@/lib/supabase';

export type InvoiceRecordReadRow = {
  id: string;
  customer_code: string | null;
  customer_phone: string | null;
  amount: number | null;
};

export async function readInvoiceRecordById(invoiceId: string): Promise<InvoiceRecordReadRow | null> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('id,customer_code,customer_phone,amount')
    .eq('id', invoiceId)
    .maybeSingle();

  if (error) throw error;
  return (data as InvoiceRecordReadRow | null) ?? null;
}
