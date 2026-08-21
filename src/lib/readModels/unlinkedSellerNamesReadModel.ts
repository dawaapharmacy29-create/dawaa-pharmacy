import { supabase } from '@/lib/supabase';

/**
 * Read boundary for seller identities found on transactional invoices but not yet linked to staff.
 * Keeps staff identity services independent from the sales_invoices schema.
 */
export async function readUnlinkedInvoiceSellerNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('seller_name')
    .not('seller_name', 'is', null)
    .is('staff_id', null);

  if (error) throw error;

  const names = new Set<string>();
  for (const row of data || []) {
    const name = String(row.seller_name || '').trim();
    if (name) names.add(name);
  }
  return [...names];
}
