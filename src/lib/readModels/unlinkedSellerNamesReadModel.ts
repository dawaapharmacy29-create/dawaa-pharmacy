import { supabase } from '@/lib/supabase';

/**
 * Read boundary for seller identities found on transactional invoices but not yet linked to staff.
 * PostgreSQL owns the aggregation so callers receive unique names instead of raw invoice rows.
 */
export async function readUnlinkedInvoiceSellerNames(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_unlinked_invoice_seller_names_v1');
  if (error) throw error;

  return (data || [])
    .map((row: { seller_name?: string | null }) => String(row.seller_name || '').trim())
    .filter(Boolean);
}
